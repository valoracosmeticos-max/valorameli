import { createClient } from "@supabase/supabase-js";
import type { ToolContext } from "@lovable.dev/mcp-js";

type RuntimeGlobals = typeof globalThis & {
  Deno?: { env?: { get?: (name: string) => string | undefined } };
  process?: { env?: Record<string, string | undefined> };
};

function runtimeEnv(name: string): string | undefined {
  const runtime = globalThis as RuntimeGlobals;
  return runtime.Deno?.env?.get?.(name) ?? runtime.process?.env?.[name];
}

function configuredEnv(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = runtimeEnv(name)?.trim();
    if (value) return value;
  }
  return undefined;
}

function supabaseProjectUrl(): string {
  const url = configuredEnv(["SUPABASE_URL", "VITE_SUPABASE_URL"]);
  if (!url) throw new Error("SUPABASE_URL (or VITE_SUPABASE_URL) is required");
  return url;
}

function supabasePublishableKey(): string {
  const direct = configuredEnv(["SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY"]);
  if (direct) return direct;
  const keyset = runtimeEnv("SUPABASE_PUBLISHABLE_KEYS");
  if (keyset) {
    try {
      const parsed: unknown = JSON.parse(keyset);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const keys = parsed as Record<string, unknown>;
        const key = [keys.default, ...Object.values(keys)]
          .find((v): v is string => typeof v === "string" && v.trim().startsWith("sb_publishable_"))
          ?.trim();
        if (key) return key;
      }
    } catch {
      // ignore malformed dictionary
    }
  }
  const legacy = configuredEnv(["SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"]);
  if (legacy) return legacy;
  throw new Error("SUPABASE_PUBLISHABLE_KEY, SUPABASE_PUBLISHABLE_KEYS, or SUPABASE_ANON_KEY is required");
}

/** Marker set on the tool context when the request was authenticated with the static MCP_API_KEY. */
export const STATIC_KEY_FLAG = "__mcpStaticKey";

function isJwt(v: string): boolean {
  return v.split(".").length === 3;
}

function serviceRoleKey(): string {
  const direct = configuredEnv(["SUPABASE_SERVICE_ROLE_KEY"]);
  if (direct) return direct;
  const keyset = runtimeEnv("SUPABASE_SECRET_KEYS");
  if (keyset) {
    try {
      const parsed = JSON.parse(keyset) as Record<string, unknown>;
      const key = [parsed.default, ...Object.values(parsed)].find(
        (v): v is string => typeof v === "string" && v.trim().length > 0,
      );
      if (key) return key.trim();
    } catch {
      // ignore
    }
  }
  throw new Error("Servidor sem credencial de leitura configurada.");
}

/**
 * Service-role client for static-key requests. Never forwards the caller's
 * Bearer and never sends a non-JWT key as Authorization (which the API would
 * try to decode as a JWT).
 */
function supabaseServiceRole() {
  const key = serviceRoleKey();
  const safeFetch: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set("apikey", key);
    if (isJwt(key)) headers.set("Authorization", `Bearer ${key}`);
    else headers.delete("Authorization");
    return fetch(input, { ...init, headers });
  };
  return createClient(supabaseProjectUrl(), key, {
    global: { fetch: safeFetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function supabaseForUser(ctx: ToolContext) {
  if ((ctx as unknown as Record<string, unknown>)[STATIC_KEY_FLAG] === true) {
    return supabaseServiceRole();
  }
  const token = ctx.getToken();
  if (!token) throw new Error("supabaseForUser requires a verified OAuth token");
  return createClient(supabaseProjectUrl(), supabasePublishableKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
