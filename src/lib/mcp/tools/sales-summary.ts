import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

const EXCLUDED = ["cancelled", "refunded"];

export default defineTool({
  name: "sales_summary",
  title: "Resumo de vendas",
  description: "Calcula faturamento, recebido, custos, publicidade e lucro de um período (exclui cancelados).",
  inputSchema: {
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Data inicial (yyyy-MM-dd)."),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Data final inclusiva (yyyy-MM-dd)."),
    store_id: z.string().uuid().optional().describe("Filtrar por loja (opcional)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ from, to, store_id }, ctx) => {
    const sb = supabaseForUser(ctx);
    let oq = sb
      .from("orders")
      .select("status, total_amount, amount_received, ml_fees, shipping_cost, order_items(quantity, cost_price)")
      .gte("date_created", `${from}T00:00:00-03:00`)
      .lte("date_created", `${to}T23:59:59.999-03:00`)
      .limit(10000);
    if (store_id) oq = oq.eq("store_id", store_id);
    let aq = sb.from("ad_spend").select("amount").gte("charge_date", from).lte("charge_date", to);
    if (store_id) aq = aq.eq("store_id", store_id);
    const [{ data: orders, error: oe }, { data: ads, error: ae }] = await Promise.all([oq, aq]);
    if (oe) throw new ToolError(oe.message);
    if (ae) throw new ToolError(ae.message);

    const valid = (orders ?? []).filter((o) => !EXCLUDED.includes(o.status));
    let revenue = 0, received = 0, fees = 0, shipping = 0, cost = 0;
    for (const o of valid) {
      revenue += Number(o.total_amount);
      received += Number(o.amount_received ?? 0);
      fees += Number(o.ml_fees ?? 0);
      shipping += Number(o.shipping_cost ?? 0);
      for (const i of o.order_items ?? []) cost += Number(i.cost_price ?? 0) * i.quantity;
    }
    const advertising = (ads ?? []).reduce((a, r) => a + Number(r.amount), 0);
    const profit = received - cost - advertising;
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const summary = {
      orders: valid.length, revenue: r2(revenue), received: r2(received), ml_fees: r2(fees),
      shipping: r2(shipping), product_cost: r2(cost), advertising: r2(advertising), profit: r2(profit),
      margin_pct: revenue ? r2((profit / revenue) * 100) : 0,
      note: "Custos adicionais da aba 'Custos Adicionais' não estão incluídos.",
    };
    return { content: [{ type: "text", text: JSON.stringify(summary) }], structuredContent: { summary } };
  },
});
