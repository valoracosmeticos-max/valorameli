import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  store_name: string;
  seller_id: string;
  access_token: string;
  refresh_token: string;
  app_id?: string;
}

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
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body: Body = await req.json();
    const storeName = (body.store_name ?? "").trim();
    const sellerId = String(body.seller_id ?? "").trim();
    const accessToken = (body.access_token ?? "").trim();
    const refreshToken = (body.refresh_token ?? "").trim();

    if (!storeName || !sellerId || !accessToken || !refreshToken) {
      return new Response(JSON.stringify({ error: "Campos obrigatórios faltando." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!/^\d{6,12}$/.test(sellerId)) {
      return new Response(JSON.stringify({ error: `Seller ID inválido (${sellerId}).` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!accessToken.startsWith("APP_USR-") || accessToken.length < 50) {
      return new Response(JSON.stringify({ error: "Access Token tem formato inválido (deve começar com APP_USR-)." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!refreshToken.startsWith("TG-")) {
      return new Response(JSON.stringify({ error: "Refresh Token tem formato inválido (deve começar com TG-)." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const meResp = await fetch("https://api.mercadolibre.com/users/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!meResp.ok) {
      const txt = await meResp.text();
      console.error("ML /users/me failed:", meResp.status, txt);
      return new Response(
        JSON.stringify({
          error: `Não foi possível validar o token (HTTP ${meResp.status}). Verifique se o Access Token é válido e não expirou.`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const me = await meResp.json();
    if (String(me.id) !== sellerId) {
      return new Response(
        JSON.stringify({ error: `O Seller ID informado (${sellerId}) não bate com o dono do token (${me.id}).` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const nickname: string | null = me.nickname ?? null;
    // Manual tokens: assume 6h validity from now
    const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: existing } = await admin
      .from("stores")
      .select("id")
      .eq("user_id", userId)
      .eq("ml_seller_id", sellerId)
      .maybeSingle();

    if (existing) {
      await admin
        .from("stores")
        .update({
          name: storeName,
          access_token: accessToken,
          refresh_token: refreshToken,
          token_expires_at: expiresAt,
          ml_nickname: nickname,
        })
        .eq("id", existing.id);
    } else {
      await admin.from("stores").insert({
        user_id: userId,
        name: storeName,
        ml_seller_id: sellerId,
        ml_nickname: nickname,
        access_token: accessToken,
        refresh_token: refreshToken,
        token_expires_at: expiresAt,
      });
    }

    return new Response(JSON.stringify({ success: true, seller_id: sellerId, nickname }), {
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
