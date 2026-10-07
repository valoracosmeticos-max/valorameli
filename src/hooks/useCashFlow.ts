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
  PMRSamples: number;      // Qtd pagamentos usados no PMR (liberados + previstos)
  PMRReleased: number;     // Destes, quantos já foram liberados
  PMRExcluded: number;     // Pagamentos do período fora do PMR por não terem pedido do ML vinculado
  PMPSamples: number;      // Qtd compras usadas no PMP
}

export interface ReleaseEvent {
  mp_payment_id: string;
  ml_order_id: string | null;
  order_db_id: string | null;
  money_release_date: string;
  money_release_status: string | null;
  net_received_amount: number;
  transaction_amount: number;
  date_approved: string | null;
  installments: number;
  payment_method_id: string | null;
}

export const useCashFlow = (storeId: string | undefined, days = 90) => {
  const today     = new Date();
  const beginDate = new Date(Date.now() - days * 86400_000);

  // ── Pagamentos (para PMR + calendário) ─────────────────────────────
  // storeId undefined = todas as lojas (sem filtro de loja).
  const { data: releases = [], isLoading: loadingReleases, refetch: refetchReleases } = useQuery({
    queryKey: ["payments_releases", storeId ?? "all", days],
    queryFn: async () => {
      let q = (supabase as any)
        .from("payments_releases")
        .select(
          "mp_payment_id, ml_order_id, order_db_id, money_release_date, money_release_status, " +
          "net_received_amount, transaction_amount, date_approved, installments, payment_method_id"
        );
      if (storeId) q = q.eq("store_id", storeId);
      const { data, error } = await q
        .not("money_release_date", "is", null)
        .order("money_release_date", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown) as ReleaseEvent[];
    },
  });

  // ── Compras (para PMP + contas a pagar) ────────────────────────────
  const { data: purchases = [], isLoading: loadingPurchases } = useQuery({
    queryKey: ["purchases", storeId ?? "all"],
    queryFn: async () => {
      let q = supabase
        .from("purchases")
        .select("id, purchase_date, due_date, paid_date, total_amount, status");
      if (storeId) q = q.eq("store_id", storeId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  // ── Produtos (estoque em R$) ────────────────────────────────────────
  const { data: products = [], isLoading: loadingProducts } = useQuery({
    queryKey: ["products_stock", storeId ?? "all"],
    queryFn: async () => {
      let q = supabase
        .from("products")
        .select("id, cost_price, stock");
      if (storeId) q = q.eq("store_id", storeId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  // ── CMV do período (para Ciclo de Estoque) ─────────────────────────
  // Busca em 2 passos para evitar joins complexos
  const { data: periodOrders = [], isLoading: loadingOrders } = useQuery({
    queryKey: ["orders_ids_period", storeId ?? "all", days],
    queryFn: async () => {
      let q = supabase
        .from("orders")
        .select("id")
        .gte("date_created", beginDate.toISOString());
      if (storeId) q = q.eq("store_id", storeId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((o) => o.id);
    },
  });

  const { data: orderItems = [], isLoading: loadingItems } = useQuery({
    queryKey: ["order_items_cost", storeId ?? "all", days, periodOrders],
    queryFn: async () => {
      if (periodOrders.length === 0) return [];
      const { data, error } = await supabase
        .from("order_items")
        .select("quantity, cost_price")
        .in("order_id", periodOrders);
      if (error) throw error;
      return data ?? [];
    },
  });

  const isLoading = loadingReleases || loadingPurchases || loadingProducts || loadingOrders || loadingItems;

  // ── Cálculos ────────────────────────────────────────────────────────
  const indicators: CashFlowIndicators | null = (() => {
    if (isLoading) return null;

    // PMR: média(money_release_date − date_approved) dos pagamentos aprovados no
    // período selecionado, em dias corridos fracionados.
    //
    // Entram os já liberados E os pendentes (com a data de liberação prevista pelo
    // MP). Só com os liberados a média ignora justamente as vendas mais lentas, que
    // ainda não caíram — nos dados reais: liberados 10,9 d vs pendentes 16,8 d.
    // Dias fracionados em vez de differenceInDays, que trunca e perde até 1 dia
    // por pagamento.
    //
    // Só entram pagamentos vinculados a um pedido do ML (order_db_id). O
    // ml_order_id sozinho não serve de filtro: ele vem do external_reference do
    // pagamento, que links de pagamento, QR e outras integrações também
    // preenchem, com texto livre. Nos dados reais, 85 de 98 pagamentos sem
    // pedido não tinham ID no formato do ML (2000 + 12 dígitos), e os rápidos
    // (0-1 dia) eram 67% sem pedido contra 20% nos lentos.
    const MS_DIA = 86_400_000;
    const inPeriod = releases.filter(
      (r) =>
        r.date_approved &&
        r.money_release_date &&
        !isBefore(parseISO(r.date_approved), beginDate)
    );
    const pmrPayments = inPeriod.filter((r) => r.order_db_id);
    const PMRExcluded = inPeriod.length - pmrPayments.length;
    const PMR = pmrPayments.length > 0
      ? pmrPayments.reduce((sum, r) => {
          const d = (parseISO(r.money_release_date).getTime() - parseISO(r.date_approved!).getTime()) / MS_DIA;
          return sum + Math.max(0, d);
        }, 0) / pmrPayments.length
      : 0;
    const PMRReleased = pmrPayments.filter((r) => r.money_release_status === "released").length;

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
      PMRSamples: pmrPayments.length,
      PMRReleased,
      PMRExcluded,
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
