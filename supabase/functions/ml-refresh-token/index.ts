import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { store_id } = await req.json();
    if (!store_id) {
      return new Response(JSON.stringify({ error: "store_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: store, error } = await admin
      .from("stores")
      .select("id, refresh_token, user_id")
      .eq("id", store_id)
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (error || !store?.refresh_token) {
      return new Response(JSON.stringify({ error: "Store not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const params = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: Deno.env.get("ML_CLIENT_ID")!,
      client_secret: Deno.env.get("ML_CLIENT_SECRET")!,
      refresh_token: store.refresh_token,
    });
    const resp = await fetch("https://api.mercadolibre.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: params.toString(),
    });
    const json = await resp.json();
    if (!resp.ok) {
      // refresh_token do ML é de uso único. Se Sincronizar ou Pagamentos MP
      // já rotacionaram o token nesse meio-tempo, este pedido perde a corrida
      // e recebe invalid_grant mesmo que o outro tenha funcionado — relê a
      // loja antes de reportar falha.
      const { data: fresh } = await admin
        .from("stores")
        .select("access_token, refresh_token, token_expires_at")
        .eq("id", store.id)
        .maybeSingle();
      const freshExpires = fresh?.token_expires_at ? new Date(fresh.token_expires_at).getTime() : 0;
      if (fresh && fresh.refresh_token !== store.refresh_token && freshExpires > Date.now()) {
        return new Response(JSON.stringify({ success: true, expires_at: fresh.token_expires_at }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Se o refresh token já foi usado/expirou, o access token atual ainda pode
      // estar válido — testa antes de exigir reconexão.
      if (fresh?.access_token) {
        const probe = await fetch("https://api.mercadolibre.com/users/me", {
          headers: { Authorization: `Bearer ${fresh.access_token}` },
        });
        if (probe.ok) {
          return new Response(
            JSON.stringify({ success: true, expires_at: fresh.token_expires_at ?? null }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }

      console.error("Refresh failed", json);
      const invalidGrant = json?.error === "invalid_grant";
      return new Response(
        JSON.stringify({
          error: invalidGrant ? "reconnect_required" : "Refresh failed",
          message: invalidGrant
            ? "A autorização desta loja expirou ou já foi usada. Reconecte a loja em Setup de Lojas."
            : "Não foi possível renovar o token do Mercado Livre.",
          details: json,
        }),
        {
          status: invalidGrant ? 409 : 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const expiresAt = new Date(Date.now() + (json.expires_in ?? 21600) * 1000).toISOString();
    await admin
      .from("stores")
      .update({
        access_token: json.access_token,
        refresh_token: json.refresh_token,
        token_expires_at: expiresAt,
      })
      .eq("id", store.id);

    return new Response(JSON.stringify({ success: true, expires_at: expiresAt }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
