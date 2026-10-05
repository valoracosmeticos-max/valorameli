import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CashProfitOrder {
  id: string;
  ml_order_id: string;
  store_name: string;
  date_created: string;
  received: number;
  cost: number;
  profit: number;
  release_date: string; // yyyy-MM-dd (BRT)
  confirmed: boolean; // data informada pelo Mercado Pago
  released: boolean;
}

const BRT_OFFSET_MS = 3 * 3600_000;
const toBrtDate = (iso: string) => new Date(new Date(iso).getTime() - BRT_OFFSET_MS).toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => {
  const d = new Date(ymd + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// Regra estimada por loja quando o Mercado Pago ainda não informou a data.
const estimateDays = (storeName: string) => (/edua/i.test(storeName) ? 30 : 15);

/** month = "yyyy-MM" */
export const useCashProfit = (storeId: string | undefined, month: string) => {
  return useQuery({
    queryKey: ["cash_profit", storeId ?? "all", month],
    queryFn: async () => {
      const [y, m] = month.split("-").map(Number);
      const monthStart = `${month}-01`;
      const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      const lookback = new Date(Date.UTC(y, m - 1, 1) - 75 * 86400_000).toISOString();

      let storesQ = supabase.from("stores").select("id, name");
      if (storeId) storesQ = storesQ.eq("id", storeId);
      let ordersQ = supabase
        .from("orders")
        .select("id, ml_order_id, store_id, date_created, status, amount_received, order_items(quantity, cost_price)")
        .gte("date_created", lookback)
        .not("status", "in", "(cancelled,refunded)");
      if (storeId) ordersQ = ordersQ.eq("store_id", storeId);
      let relQ = (supabase as any)
        .from("payments_releases")
        .select("order_db_id, money_release_date, money_release_status")
        .not("order_db_id", "is", null);
      if (storeId) relQ = relQ.eq("store_id", storeId);
      let adsQ = supabase.from("ad_spend").select("amount, charge_date, store_id")
        .gte("charge_date", monthStart).lte("charge_date", monthEnd);
      if (storeId) adsQ = adsQ.eq("store_id", storeId);
      const costsQ = supabase.from("additional_costs").select("amount, cost_type, cost_date");

      const [st, od, rl, ad, ac] = await Promise.all([storesQ, ordersQ.limit(5000), relQ.limit(10000), adsQ, costsQ]);
      for (const r of [st, od, rl, ad, ac]) if (r.error) throw r.error;

      const storeName = new Map((st.data ?? []).map((s: any) => [s.id, s.name as string]));
      const relByOrder = new Map<string, { date: string; released: boolean }>();
      for (const r of (rl.data ?? []) as any[]) {
        if (!r.money_release_date) continue;
        const prev = relByOrder.get(r.order_db_id);
        const date = toBrtDate(r.money_release_date);
        if (!prev || date > prev.date) relByOrder.set(r.order_db_id, { date, released: r.money_release_status === "released" });
      }

      const today = toBrtDate(new Date().toISOString());
      const orders: CashProfitOrder[] = ((od.data ?? []) as any[]).map((o) => {
        const name = storeName.get(o.store_id) ?? "—";
        const received = Number(o.amount_received ?? 0);
        const cost = (o.order_items ?? []).reduce((s: number, i: any) => s + Number(i.cost_price ?? 0) * Number(i.quantity ?? 1), 0);
        const rel = relByOrder.get(o.id);
        const release_date = rel?.date ?? addDays(toBrtDate(o.date_created), estimateDays(name));
        return {
          id: o.id, ml_order_id: o.ml_order_id, store_name: name, date_created: o.date_created,
          received, cost, profit: received - cost, release_date,
          confirmed: !!rel, released: rel ? rel.released || release_date <= today : false,
        };
      });

      const inMonth = orders.filter((o) => o.release_date >= monthStart && o.release_date <= monthEnd)
        .sort((a, b) => a.release_date.localeCompare(b.release_date));
      const nextMonth = orders.filter((o) => o.release_date > monthEnd && toBrtDate(o.date_created) <= monthEnd);

      const advertising = (ad.data ?? []).reduce((s: number, a: any) => s + Number(a.amount ?? 0), 0);
      const additional = (ac.data ?? []).reduce((s: number, c: any) => {
        if (c.cost_type === "fixed") return s + Number(c.amount ?? 0);
        return c.cost_date >= monthStart && c.cost_date <= monthEnd ? s + Number(c.amount ?? 0) : s;
      }, 0);

      const sum = (arr: CashProfitOrder[]) => arr.reduce((s, o) => s + o.profit, 0);
      const releasedOrders = inMonth.filter((o) => o.released);
      return {
        orders: inMonth,
        total: sum(inMonth),
        released: sum(releasedOrders),
        pending: sum(inMonth.filter((o) => !o.released)),
        nextMonth: sum(nextMonth),
        nextMonthCount: nextMonth.length,
        advertising,
        additional,
        today,
      };
    },
  });
};
