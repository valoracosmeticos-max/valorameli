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

    // Hardened validation
    if (!accessToken || !accessToken.startsWith("APP_USR-") || accessToken.length < 50) {
      return new Response(
        JSON.stringify({ error: "Token retornado pelo Mercado Livre tem formato inválido." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!/^\d{6,12}$/.test(sellerId)) {
      return new Response(
        JSON.stringify({ error: `Seller ID retornado é inválido (${sellerId}).` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Require /users/me to validate the token has proper scopes
    let nickname: string | null = null;
    const meResp = await fetch("https://api.mercadolibre.com/users/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!meResp.ok) {
      const txt = await meResp.text();
      console.error("ML /users/me failed:", meResp.status, txt);
      return new Response(
        JSON.stringify({
          error: `Não foi possível validar o token OAuth (HTTP ${meResp.status}). Verifique se a aplicação no Dev Center possui os escopos 'read offline_access' e tente novamente.`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const me = await meResp.json();
    nickname = me.nickname ?? null;
    if (String(me.id) !== sellerId) {
      return new Response(
        JSON.stringify({ error: "Inconsistência: o seller_id do token não bate com /users/me." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    const admin = createClient(supabaseUrl, serviceKey);

    // Upsert by (user_id, ml_seller_id)
    const { data: existing } = await admin
      .from("stores")
      .select("id, name")
      .eq("user_id", userId)
      .eq("ml_seller_id", sellerId)
      .maybeSingle();

    // Mesma conta ML autorizada sob outro nome = o usuário não trocou de conta no
    // navegador. Recusa antes de gravar, senão a loja existente seria renomeada.
    if (existing && existing.name !== body.store_name) {
      return new Response(
        JSON.stringify({
          error:
            `Esta conta do Mercado Livre (${nickname ?? sellerId}) já está conectada como "${existing.name}". ` +
            `Para adicionar outra loja, saia da conta do Mercado Livre no navegador e entre com a conta administradora da loja que deseja conectar.`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

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
