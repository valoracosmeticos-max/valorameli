import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listStores from "./tools/list-stores";
import listOrders from "./tools/list-orders";
import salesSummary from "./tools/sales-summary";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "erp-valora-meli",
  title: "ERP Valora Meli",
  version: "0.1.0",
  instructions:
    "ERP de vendas das lojas do Mercado Livre. Use `list_stores` para ver as lojas, `list_orders` para pedidos de um período e `sales_summary` para faturamento, custos e lucro. Datas em yyyy-MM-dd, fuso de Brasília.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listStores, listOrders, salesSummary],
});
