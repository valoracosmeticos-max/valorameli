import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  store_name: string;
  seller_id?: string;
  access_token: string;
  refresh_token?: string;
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
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claims.claims.sub;

    const body: Body = await req.json();
    if (!body.store_name?.trim() || !body.access_token?.trim()) {
      return new Response(JSON.stringify({ error: "Nome da loja e Access Token são obrigatórios" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = body.access_token.trim();

    // Validate token against ML API (server-side, no CORS)
    const meResp = await fetch("https://api.mercadolibre.com/users/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!meResp.ok) {
      const txt = await meResp.text();
      console.error("ML /users/me failed:", meResp.status, txt);
      return new Response(
        JSON.stringify({
          error: meResp.status === 401
            ? "Access Token inválido ou expirado. Gere um novo no Dev Center do Mercado Livre."
            : `Falha ao validar token (HTTP ${meResp.status})`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const me = await meResp.json();
    const realSellerId = String(me.id);
    const nickname: string | null = me.nickname ?? null;

    let mismatch = false;
    if (body.seller_id?.trim() && body.seller_id.trim() !== realSellerId) {
      mismatch = true;
    }

    const expiresAt = new Date(Date.now() + 6 * 3600 * 1000).toISOString();
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: existing } = await admin
      .from("stores")
      .select("id")
      .eq("user_id", userId)
      .eq("ml_seller_id", realSellerId)
      .maybeSingle();

    if (existing) {
      const { error } = await admin
        .from("stores")
        .update({
          name: body.store_name.trim(),
          access_token: accessToken,
          refresh_token: body.refresh_token?.trim() || null,
          token_expires_at: expiresAt,
          ml_nickname: nickname,
        })
        .eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await admin.from("stores").insert({
        user_id: userId,
        name: body.store_name.trim(),
        ml_seller_id: realSellerId,
        ml_nickname: nickname,
        access_token: accessToken,
        refresh_token: body.refresh_token?.trim() || null,
        token_expires_at: expiresAt,
      });
      if (error) throw error;
    }

    return new Response(
      JSON.stringify({
        success: true,
        seller_id: realSellerId,
        nickname,
        updated: !!existing,
        mismatch,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("ml-connect-store error:", e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
