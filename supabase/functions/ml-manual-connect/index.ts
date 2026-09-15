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

// O access_token do ML carrega o aplicativo que o emitiu: APP_USR-<app_id>-<...>.
// Um refresh_token só é aceito pelo client_id que o gerou, então tokens de outro
// aplicativo passam no /users/me mas nunca conseguem renovar.
function appIdFromAccessToken(token: string): string | null {
  const m = /^APP_USR-(\d+)-/.exec(token);
  return m ? m[1] : null;
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
    // Não impomos prefixo (APP_USR- / TG-): o Dev Center do ML às vezes mostra
    // tokens em formatos diferentes. Quem decide se o token vale é o /users/me.
    if (accessToken.length < 10) {
      return new Response(JSON.stringify({ error: "Access Token muito curto — copie o valor completo." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    const clientId = Deno.env.get("ML_CLIENT_ID")!;
    const clientSecret = Deno.env.get("ML_CLIENT_SECRET")!;

    // Tokens de outro aplicativo conectam mas nunca renovam — barra antes de salvar.
    const tokenAppId = appIdFromAccessToken(accessToken);
    if (tokenAppId && tokenAppId !== clientId) {
      return new Response(
        JSON.stringify({
          error:
            `Estes tokens foram emitidos pelo aplicativo ${tokenAppId}, mas o sistema usa o aplicativo ${clientId}. ` +
            `Um refresh_token só é aceito pelo aplicativo que o gerou, então a loja conectaria agora e pararia de renovar em 6 horas. ` +
            `Gere os tokens pelo aplicativo ${clientId} ou conecte a loja via OAuth.`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Troca o refresh_token ANTES de salvar: é a única prova de que a loja vai
    // conseguir renovar sozinha. Sem isso ela conecta e só quebra 6h depois,
    // quando o access_token expira. Como o refresh_token do ML é de uso único,
    // guardamos o par novo devolvido pela troca, não o que o usuário colou.
    const refreshResp = await fetch("https://api.mercadolibre.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }).toString(),
    });
    const refreshJson = await refreshResp.json();

    if (!refreshResp.ok) {
      console.error("ML refresh test failed:", refreshResp.status, refreshJson);
      const probe = await fetch("https://api.mercadolibre.com/users/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const accessOk = probe.ok;
      return new Response(
        JSON.stringify({
          error:
            (accessOk
              ? "O Access Token é válido, mas o Refresh Token foi recusado pelo Mercado Livre"
              : "Access Token e Refresh Token foram recusados pelo Mercado Livre") +
            ` (${refreshJson?.error ?? refreshResp.status}). Salvar assim faria a loja parar de sincronizar em 6 horas. ` +
            `O ML retorna esse erro quando o refresh_token já foi usado (é de uso único), quando ele pertence a outro aplicativo, ` +
            `ou quando a conta do vendedor tem dados/documentos pendentes de validação no Mercado Livre.`,
          details: refreshJson,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const freshAccessToken: string = refreshJson.access_token ?? accessToken;
    const freshRefreshToken: string = refreshJson.refresh_token ?? refreshToken;
    const expiresAt = new Date(Date.now() + (refreshJson.expires_in ?? 21600) * 1000).toISOString();

    const meResp = await fetch("https://api.mercadolibre.com/users/me", {
      headers: { Authorization: `Bearer ${freshAccessToken}` },
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
          access_token: freshAccessToken,
          refresh_token: freshRefreshToken,
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
        access_token: freshAccessToken,
        refresh_token: freshRefreshToken,
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
