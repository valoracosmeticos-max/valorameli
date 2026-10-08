import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

const BRT_OFFSET_MS = 3 * 3600_000;
const toBrtDate = (iso: string) => new Date(new Date(iso).getTime() - BRT_OFFSET_MS).toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => {
  const d = new Date(ymd + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const estimateDays = (storeName: string) => (/edua/i.test(storeName) ? 30 : 15);
const r2 = (n: number) => Math.round(n * 100) / 100;

export default defineTool({
  name: "cash_profit_summary",
  title: "Lucro em caixa do mês",
  description:
    "Visão de fluxo de caixa: lucro (recebido − custo) de cada venda contado na data de liberação do Mercado Pago. Retorna o que já caiu, o que ainda vai cair, o que fica para o mês seguinte, publicidade, custos adicionais e a sobra para gastar no mês.",
  inputSchema: {
    month: z.string().regex(/^\d{4}-\d{2}$/).describe("Mês no formato yyyy-MM."),
    store_id: z.string().uuid().optional().describe("Filtrar por loja (opcional; omita para todas)."),
    include_orders: z.boolean().default(false).describe("Incluir a lista de pedidos por data de liberação."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ month, store_id, include_orders }, ctx) => {
    const sb = supabaseForUser(ctx);
    const [y, m] = month.split("-").map(Number);
    const monthStart = `${month}-01`;
    const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const lookback = new Date(Date.UTC(y, m - 1, 1) - 75 * 86400_000).toISOString();

    let storesQ = sb.from("stores").select("id, name");
    let ordersQ = sb
      .from("orders")
      .select("id, ml_order_id, store_id, date_created, status, amount_received, order_items(quantity, cost_price)")
      .gte("date_created", lookback)
      .not("status", "in", "(cancelled,refunded)");
    let relQ = sb
      .from("payments_releases")
      .select("order_db_id, money_release_date, money_release_status")
      .not("order_db_id", "is", null);
    let adsQ = sb.from("ad_spend").select("amount").gte("charge_date", monthStart).lte("charge_date", monthEnd);
    if (store_id) {
      storesQ = storesQ.eq("id", store_id);
      ordersQ = ordersQ.eq("store_id", store_id);
      relQ = relQ.eq("store_id", store_id);
      adsQ = adsQ.eq("store_id", store_id);
    }
    const costsQ = sb.from("additional_costs").select("amount, cost_type, cost_date");

    const [st, od, rl, ad, ac] = await Promise.all([storesQ, ordersQ.limit(5000), relQ.limit(10000), adsQ, costsQ]);
    for (const r of [st, od, rl, ad, ac]) if (r.error) throw new ToolError(r.error.message);

    const storeName = new Map((st.data ?? []).map((s: any) => [s.id, s.name as string]));
    const relByOrder = new Map<string, { date: string; released: boolean }>();
    for (const r of (rl.data ?? []) as any[]) {
      if (!r.money_release_date) continue;
      const date = toBrtDate(r.money_release_date);
      const prev = relByOrder.get(r.order_db_id);
      if (!prev || date > prev.date) relByOrder.set(r.order_db_id, { date, released: r.money_release_status === "released" });
    }

    const today = toBrtDate(new Date().toISOString());
    const all = ((od.data ?? []) as any[]).map((o) => {
      const name = storeName.get(o.store_id) ?? "—";
      const received = Number(o.amount_received ?? 0);
      const cost = (o.order_items ?? []).reduce((s: number, i: any) => s + Number(i.cost_price ?? 0) * Number(i.quantity ?? 1), 0);
      const rel = relByOrder.get(o.id);
      const release_date = rel?.date ?? addDays(toBrtDate(o.date_created), estimateDays(name));
      return {
        ml_order_id: o.ml_order_id as string, store: name, sale_date: toBrtDate(o.date_created),
        received: r2(received), cost: r2(cost), profit: r2(received - cost), release_date,
        confirmed: !!rel, released: rel ? rel.released || release_date <= today : false,
      };
    });

    const inMonth = all.filter((o) => o.release_date >= monthStart && o.release_date <= monthEnd)
      .sort((a, b) => a.release_date.localeCompare(b.release_date));
    const next = all.filter((o) => o.release_date > monthEnd && o.sale_date <= monthEnd);
    const sum = (a: typeof all) => a.reduce((s, o) => s + o.profit, 0);

    const advertising = (ad.data ?? []).reduce((s: number, a: any) => s + Number(a.amount ?? 0), 0);
    const additional = (ac.data ?? []).reduce((s: number, c: any) => {
      if (c.cost_type === "fixed") return s + Number(c.amount ?? 0);
      return c.cost_date >= monthStart && c.cost_date <= monthEnd ? s + Number(c.amount ?? 0) : s;
    }, 0);
    const total = sum(inMonth);

    const summary = {
      month, today,
      orders_in_month: inMonth.length,
      total_cash_profit: r2(total),
      already_released: r2(sum(inMonth.filter((o) => o.released))),
      pending_release: r2(sum(inMonth.filter((o) => !o.released))),
      next_month_retained: r2(sum(next)),
      next_month_orders: next.length,
      advertising: r2(advertising),
      additional_costs: r2(additional),
      net_cash_left: r2(total - advertising - additional),
      ...(include_orders ? { orders: inMonth } : {}),
    };
    return { content: [{ type: "text", text: JSON.stringify(summary) }], structuredContent: { summary } };
  },
});
