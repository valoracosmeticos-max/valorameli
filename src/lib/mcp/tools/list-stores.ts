import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_stores",
  title: "Listar lojas",
  description: "Lista as lojas do Mercado Livre conectadas e a data da última sincronização.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_args, ctx) => {
    const { data, error } = await supabaseForUser(ctx)
      .from("stores")
      .select("id, name, ml_seller_id, ml_nickname, last_sync_at")
      .order("created_at");
    if (error) throw new ToolError(error.message);
    const stores = (data ?? []).map((s) => ({
      id: s.id, name: s.name, seller_id: s.ml_seller_id, nickname: s.ml_nickname, last_sync_at: s.last_sync_at,
    }));
    return { content: [{ type: "text", text: JSON.stringify(stores) }], structuredContent: { stores } };
  },
});
