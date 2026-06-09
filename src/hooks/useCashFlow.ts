import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { differenceInDays, isAfter, isBefore, parseISO } from "date-fns";

export interface CashFlowIndicators {
  PMR: number;             // Prazo Médio de Recebimento (dias)
  PMP: number;             // Prazo Médio de Pagamento (dias)
  CE: number;              // Ciclo de Estoque (dias)
  cicloOperacional: number; // CE + PMR
  cicloFinanceiro: number;  // CE + PMR - PMP
  NCG: number;             // Necessidade de Capital de Giro (R$)
  contasReceber: number;   // Pagamentos ainda não liberados (R$)
  contasPagar: number;     // Compras pendentes (R$)
  estoqueTotal: number;    // Valor total em estoque (R$)
  PMRSamples: number;      // Qtd pagamentos usados no PMR
  PMPSamples: number;      // Qtd compras usadas no PMP
}

export interface ReleaseEvent {
  mp_payment_id: string;
  ml_order_id: string | null;
  money_release_date: string;
  money_release_status: string | null;
  net_received_amount: number;
  transaction_amount: number;
  date_approved: string | null;
  installments: number;
  payment_method_id: string | null;
}

export const useCashFlow = (storeId: string, days = 90) => {
  const today     = new Date();
  const beginDate = new Date(Date.now() - days * 86400_000);

  // ── Pagamentos (para PMR + calendário) ─────────────────────────────
  const { data: releases = [], isLoading: loadingReleases, refetch: refetchReleases } = useQuery({
    queryKey: ["payments_releases", storeId, days],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("payments_releases")
        .select(
          "mp_payment_id, ml_order_id, money_release_date, money_release_status, " +
          "net_received_amount, transaction_amount, date_approved, installments, payment_method_id"
        )
        .eq("store_id", storeId)
        .not("money_release_date", "is", null)
        .order("money_release_date", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown) as ReleaseEvent[];
    },
    enabled: !!storeId,
  });

  // ── Compras (para PMP + contas a pagar) ────────────────────────────
  const { data: purchases = [], isLoading: loadingPurchases } = useQuery({
    queryKey: ["purchases", storeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchases")
        .select("id, purchase_date, due_date, paid_date, total_amount, status")
        .eq("store_id", storeId);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!storeId,
  });

  // ── Produtos (estoque em R$) ────────────────────────────────────────
  const { data: products = [], isLoading: loadingProducts } = useQuery({
    queryKey: ["products_stock", storeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, cost_price, stock")
        .eq("store_id", storeId);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!storeId,
  });

  // ── CMV do período (para Ciclo de Estoque) ─────────────────────────
  // Busca em 2 passos para evitar joins complexos
  const { data: periodOrders = [], isLoading: loadingOrders } = useQuery({
    queryKey: ["orders_ids_period", storeId, days],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id")
        .eq("store_id", storeId)
        .gte("date_created", beginDate.toISOString());
      if (error) throw error;
      return (data ?? []).map((o) => o.id);
    },
    enabled: !!storeId,
  });

  const { data: orderItems = [], isLoading: loadingItems } = useQuery({
    queryKey: ["order_items_cost", storeId, days, periodOrders],
    queryFn: async () => {
      if (periodOrders.length === 0) return [];
      const { data, error } = await supabase
        .from("order_items")
        .select("quantity, cost_price")
        .in("order_id", periodOrders);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!storeId && periodOrders.length >= 0,
  });

  const isLoading = loadingReleases || loadingPurchases || loadingProducts || loadingOrders || loadingItems;

  // ── Cálculos ────────────────────────────────────────────────────────
  const indicators: CashFlowIndicators | null = (() => {
    if (isLoading) return null;

    // PMR: média(money_release_date − date_approved) para pagamentos liberados
    const releasedPayments = releases.filter(
      (r) => r.date_approved && r.money_release_date && r.money_release_status === "released"
    );
    const PMR = releasedPayments.length > 0
      ? releasedPayments.reduce((sum, r) => {
          const d = Math.max(
            0,
            differenceInDays(parseISO(r.money_release_date), parseISO(r.date_approved!))
          );
          return sum + d;
        }, 0) / releasedPayments.length
      : 0;

    // Contas a Receber: pagamentos futuros não liberados
    const contasReceber = releases
      .filter(
        (r) =>
          r.money_release_status !== "released" &&
          r.money_release_date &&
          isAfter(parseISO(r.money_release_date), today)
      )
      .reduce((sum, r) => sum + (r.net_received_amount ?? 0), 0);

    // PMP: média(paid_date − purchase_date) para compras pagas
    const paidPurchases = purchases.filter((p) => p.paid_date && p.purchase_date);
    const PMP = paidPurchases.length > 0
      ? paidPurchases.reduce((sum, p) => {
          const d = Math.max(
            0,
            differenceInDays(parseISO(p.paid_date!), parseISO(p.purchase_date))
          );
          return sum + d;
        }, 0) / paidPurchases.length
      : 0;

    // Contas a Pagar: compras não pagas
    const contasPagar = purchases
      .filter((p) => p.status !== "paid")
      .reduce((sum, p) => sum + p.total_amount, 0);

    // Estoque total em R$
    const estoqueTotal = products.reduce(
      (sum, p) => sum + (p.cost_price ?? 0) * (p.stock ?? 0),
      0
    );

    // CE: Ciclo de Estoque = estoque / CMV_diário
    const CMVtotal  = orderItems.reduce((sum, i) => sum + (i.cost_price ?? 0) * (i.quantity ?? 1), 0);
    const CMVdiario = days > 0 ? CMVtotal / days : 0;
    const CE        = CMVdiario > 0 ? estoqueTotal / CMVdiario : 0;

    const cicloOperacional = CE + PMR;
    const cicloFinanceiro  = CE + PMR - PMP;
    const NCG              = estoqueTotal + contasReceber - contasPagar;

    return {
      PMR, PMP, CE,
      cicloOperacional,
      cicloFinanceiro,
      NCG,
      contasReceber,
      contasPagar,
      estoqueTotal,
      PMRSamples: releasedPayments.length,
      PMPSamples: paidPurchases.length,
    };
  })();

  // Liberações futuras (calendário)
  const upcomingReleases: ReleaseEvent[] = releases.filter(
    (r) =>
      r.money_release_date &&
      r.money_release_status !== "released" &&
      isAfter(parseISO(r.money_release_date), today)
  );

  // Liberações passadas (histórico)
  const pastReleases: ReleaseEvent[] = releases.filter(
    (r) =>
      r.money_release_date &&
      r.money_release_status === "released" &&
      isBefore(parseISO(r.money_release_date), today)
  );

  return { indicators, upcomingReleases, pastReleases, isLoading, releases, refetch: refetchReleases };
};
