import { auth, defineMcp } from "@lovable.dev/mcp-js";
import { createSupabaseHandler } from "@lovable.dev/mcp-js/stacks/supabase";
import listStores from "./tools/list-stores";
import listOrders from "./tools/list-orders";
import salesSummary from "./tools/sales-summary";
import cashProfitSummary from "./tools/cash-profit-summary";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

const NAME = "erp-valora-meli";
const TITLE = "ERP Valora Meli";
const VERSION = "0.1.0";
const INSTRUCTIONS =
  "ERP de vendas das lojas do Mercado Livre. Use `list_stores` para ver as lojas, `list_orders` para pedidos de um período, `sales_summary` para faturamento, custos e lucro (competência) e `cash_profit_summary` para o lucro em caixa por data de liberação (já caiu, vai cair, sobra). Datas em yyyy-MM-dd, fuso de Brasília.";

const tools = [listStores, listOrders, salesSummary, cashProfitSummary];

const mcp = defineMcp({
  name: NAME,
  title: TITLE,
  version: VERSION,
  instructions: INSTRUCTIONS,
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools,
});

export default mcp;

// ---------------------------------------------------------------------------
// Static API key access (secret MCP_API_KEY). Read-only tools only.
// Wraps Deno.serve at runtime so the generated entry keeps working unchanged.
// ---------------------------------------------------------------------------
type DenoLike = {
  env?: { get?: (n: string) => string | undefined };
  serve?: (...args: any[]) => unknown;
};
const D = (globalThis as { Deno?: DenoLike }).Deno;

async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i];
  return diff === 0;
}

async function isStaticKey(req: Request): Promise<boolean> {
  const expected = D?.env?.get?.("MCP_API_KEY")?.trim();
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) return false;
  const token = m[1].trim();
  // JWTs (OAuth) contain dots; skip hashing work is not needed but harmless.
  return constantTimeEqual(token, expected);
}

if (D?.serve) {
  const serviceKey = () => D.env?.get?.("SUPABASE_SERVICE_ROLE_KEY");
  const readOnlyTools = tools
    .filter((t: any) => t.annotations?.readOnlyHint === true)
    .map((t: any) => ({
      ...t,
      handler: (args: unknown, ctx: any) => {
        const key = serviceKey();
        if (!key) throw new Error("Servidor sem credencial de leitura configurada.");
        const keyCtx = Object.create(ctx);
        keyCtx.getToken = () => key;
        return t.handler(args, keyCtx);
      },
    }));

  const keyMcp = defineMcp({
    name: NAME,
    title: TITLE,
    version: VERSION,
    instructions: INSTRUCTIONS,
    tools: readOnlyTools,
  } as any);
  const keyHandler = createSupabaseHandler(keyMcp as any, { functionName: "mcp" }) as (r: Request) => Promise<Response>;

  const originalServe = D.serve.bind(D);
  D.serve = (...args: any[]) => {
    const idx = args.findIndex((a) => typeof a === "function");
    if (idx >= 0) {
      const oauthHandler = args[idx];
      args[idx] = async (req: Request, info: unknown) => {
        const header = req.headers.get("authorization") ?? "";
        const hasBearer = /^Bearer\s+\S+/i.test(header);
        if (hasBearer) {
          // Static key: run read-only tools with the service role, never JWT-decode it.
          if (await isStaticKey(req)) return keyHandler(req);
          // Bearer present but not the static key: try OAuth (JWTs contain dots).
          const token = header.replace(/^Bearer\s+/i, "").trim();
          if (!token.includes(".")) {
            return new Response(JSON.stringify({ error: "invalid_token", error_description: "Chave inválida." }), {
              status: 401,
              headers: { "content-type": "application/json", "www-authenticate": "Bearer" },
            });
          }
        }
        return oauthHandler(req, info);
      };
    }
    return originalServe(...args);
  };
}
