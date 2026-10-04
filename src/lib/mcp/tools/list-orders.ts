import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_orders",
  title: "Listar pedidos",
  description: "Lista pedidos de um período (datas yyyy-MM-dd), com valores, cliente e itens.",
  inputSchema: {
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Data inicial (yyyy-MM-dd)."),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Data final inclusiva (yyyy-MM-dd)."),
    store_id: z.string().uuid().optional().describe("Filtrar por loja (opcional)."),
    limit: z.number().int().min(1).max(500).default(100).describe("Máximo de pedidos."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ from, to, store_id, limit }, ctx) => {
    let q = supabaseForUser(ctx)
      .from("orders")
      .select("id, ml_order_id, store_id, status, date_created, buyer_name, total_amount, amount_received, ml_fees, shipping_cost, order_items(title, quantity, unit_price, cost_price)")
      .gte("date_created", `${from}T00:00:00-03:00`)
      .lte("date_created", `${to}T23:59:59.999-03:00`)
      .order("date_created", { ascending: false })
      .limit(limit);
    if (store_id) q = q.eq("store_id", store_id);
    const { data, error } = await q;
    if (error) throw new ToolError(error.message);
    const orders = (data ?? []).map((o) => ({
      id: o.id, ml_order_id: o.ml_order_id, store_id: o.store_id, status: o.status,
      date_created: o.date_created, buyer_name: o.buyer_name,
      total_amount: Number(o.total_amount), amount_received: Number(o.amount_received ?? 0),
      ml_fees: Number(o.ml_fees ?? 0), shipping_cost: Number(o.shipping_cost ?? 0),
      items: (o.order_items ?? []).map((i) => ({
        title: i.title, quantity: i.quantity, unit_price: Number(i.unit_price), cost_price: Number(i.cost_price ?? 0),
      })),
    }));
    return { content: [{ type: "text", text: JSON.stringify(orders) }], structuredContent: { orders } };
  },
});
