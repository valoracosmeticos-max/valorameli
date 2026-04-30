import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  code: string;
  redirect_uri: string;
  store_name: string;
  code_verifier?: string;
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
    if (!body.code || !body.redirect_uri || !body.store_name) {
      return new Response(JSON.stringify({ error: "Missing fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const clientId = Deno.env.get("ML_CLIENT_ID")!;
    const clientSecret = Deno.env.get("ML_CLIENT_SECRET")!;

    const params = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code: body.code,
      redirect_uri: body.redirect_uri,
    });
    if (body.code_verifier) params.append("code_verifier", body.code_verifier);

    const tokenResp = await fetch("https://api.mercadolibre.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: params.toString(),
    });
    const tokenJson = await tokenResp.json();
    if (!tokenResp.ok) {
      console.error("ML token error:", tokenJson);
      return new Response(JSON.stringify({ error: "Token exchange failed", details: tokenJson }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken: string = tokenJson.access_token;
    const refreshToken: string = tokenJson.refresh_token;
    const expiresIn: number = tokenJson.expires_in ?? 21600;
    const sellerId: string = String(tokenJson.user_id);

    // Get nickname
    let nickname: string | null = null;
    try {
      const meResp = await fetch("https://api.mercadolibre.com/users/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (meResp.ok) {
        const me = await meResp.json();
        nickname = me.nickname ?? null;
      }
    } catch (_) {}

    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    const admin = createClient(supabaseUrl, serviceKey);

    // Upsert by (user_id, ml_seller_id)
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
          name: body.store_name,
          access_token: accessToken,
          refresh_token: refreshToken,
          token_expires_at: expiresAt,
          ml_nickname: nickname,
        })
        .eq("id", existing.id);
    } else {
      await admin.from("stores").insert({
        user_id: userId,
        name: body.store_name,
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
