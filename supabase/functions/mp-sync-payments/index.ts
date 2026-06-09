import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MP_API  = "https://api.mercadopago.com";
const ML_API  = "https://api.mercadolibre.com";

// Reutiliza o mesmo padrão do ml-sync-orders: renova o token se expirado/próximo de expirar
async function refreshIfNeeded(admin: any, store: any): Promise<string> {
  const expiresAt = store.token_expires_at ? new Date(store.token_expires_at).getTime() : 0;
  if (expiresAt > Date.now() + 5 * 60 * 1000 && store.access_token) return store.access_token;
  const params = new URLSearchParams({
    grant_type:    "refresh_token",
    client_id:     Deno.env.get("ML_CLIENT_ID")!,
    client_secret: Deno.env.get("ML_CLIENT_SECRET")!,
    refresh_token: store.refresh_token,
  });
  const r = await fetch(`${ML_API}/oauth/token`, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body:    params.toString(),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Refresh token failed: ${JSON.stringify(j)}`);
  const newExpires = new Date(Date.now() + (j.expires_in ?? 21600) * 1000).toISOString();
  await admin.from("stores").update({
    access_token:     j.access_token,
    refresh_token:    j.refresh_token,
    token_expires_at: newExpires,
  }).eq("id", store.id);
  return j.access_token;
}

async function mpGet(url: string, token: string): Promise<any> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`MP API ${r.status}: ${txt.slice(0, 200)}`);
  }
  return r.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey     = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;
    const admin  = createClient(supabaseUrl, serviceKey);

    const body    = await req.json().catch(() => ({}));
    const storeId: string | null = body.store_id ?? null;
    const days    = Math.min(Math.max(Number(body.days ?? 90), 1), 365);

    // Buscar lojas do usuário
    let storeQuery = admin
      .from("stores")
      .select("id, access_token, refresh_token, token_expires_at, ml_seller_id, name")
      .eq("user_id", userId);
    if (storeId) storeQuery = storeQuery.eq("id", storeId);
    const { data: stores, error: stErr } = await storeQuery;

    if (stErr || !stores?.length) {
      return new Response(JSON.stringify({ error: "Nenhuma loja encontrada" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const summary: any[] = [];

    for (const store of stores) {
      if (!store.access_token) {
        summary.push({ store_id: store.id, store_name: store.name, error: "Sem token" });
        continue;
      }

      let token: string;
      try {
        token = await refreshIfNeeded(admin, store);
      } catch (e) {
        summary.push({ store_id: store.id, store_name: store.name, error: `Refresh falhou: ${String(e).slice(0, 200)}` });
        continue;
      }

      // Período de busca
      const beginDate = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 19) + ".000-00:00";
      const endDate   = new Date().toISOString().slice(0, 19) + ".000-00:00";

      let offset       = 0;
      const limit      = 50;
      let totalFetched = 0;
      let totalSynced  = 0;
      let lastError    = "";

      while (true) {
        // Buscar pagamentos do período via MP API
        // external_reference = ml_order_id → cruzamento direto com orders
        // collector.id filtra pagamentos RECEBIDOS pelo seller (não feitos por ele como comprador)
        const url = `${MP_API}/v1/payments/search`
          + `?sort=date_created&criteria=desc`
          + `&range=date_created&begin_date=${beginDate}&end_date=${endDate}`
          + `&collector.id=${store.ml_seller_id}`
          + `&offset=${offset}&limit=${limit}`;

        let data: any;
        try {
          data = await mpGet(url, token);
        } catch (e) {
          lastError = String(e).slice(0, 300);
          break;
        }

        const results: any[] = data?.results ?? [];
        if (results.length === 0) break;
        totalFetched += results.length;

        for (const p of results) {
          // fee_details: breakdown de taxas
          const fees: any[]          = p.fee_details ?? [];
          const feeTotal             = fees.reduce((s: number, f: any) => s + Math.abs(Number(f.amount ?? 0)), 0);
          const shippingFeeEntry     = fees.find((f: any) => f.type === "shipping");
          const financingFeeEntry    = fees.find((f: any) => f.type === "financing" || f.type === "financing_fee");
          const shippingFeeAmount    = Math.abs(Number(shippingFeeEntry?.amount ?? 0));
          const financingFeeAmount   = Math.abs(Number(financingFeeEntry?.amount ?? 0));

          // external_reference = ml_order_id (quando venda no ML)
          const mlOrderId: string | null = p.external_reference ? String(p.external_reference) : null;

          // Buscar order_db_id (FK para orders.id)
          let orderDbId: string | null = null;
          if (mlOrderId) {
            const { data: ord } = await admin
              .from("orders")
              .select("id")
              .eq("store_id", store.id)
              .eq("ml_order_id", mlOrderId)
              .maybeSingle();
            orderDbId = ord?.id ?? null;
          }

          // net_received_amount fica em transaction_details no search endpoint
          const netReceived =
            Number(p.transaction_details?.net_received_amount ?? 0) ||
            Number(p.net_received_amount ?? 0);

          const row = {
            user_id:              userId,
            store_id:             store.id,
            mp_payment_id:        String(p.id),
            ml_order_id:          mlOrderId,
            order_db_id:          orderDbId,
            date_created:         p.date_created   ?? null,
            date_approved:        p.date_approved   ?? null,
            money_release_date:   p.money_release_date  ?? null,
            money_release_status: p.money_release_status ?? null,
            transaction_amount:   Number(p.transaction_amount  ?? 0),
            net_received_amount:  netReceived,
            fee_amount:           Math.abs(feeTotal),
            shipping_fee_amount:  shippingFeeAmount,
            financing_fee_amount: financingFeeAmount,
            taxes_amount:         Math.abs(Number(p.taxes_amount  ?? 0)),
            coupon_amount:        Math.abs(Number(p.coupon_amount ?? 0)),
            installments:         Number(p.installments ?? 1),
            payment_method_id:    p.payment_method_id ?? null,
            payment_method_type:  p.payment_type_id   ?? null,
            status:               p.status ?? null,
          };

          const { error: upErr } = await admin
            .from("payments_releases")
            .upsert(row, { onConflict: "store_id,mp_payment_id" });

          if (!upErr) totalSynced++;
          else console.error("upsert error:", upErr.message, "payment:", p.id);
        }

        // Sem mais páginas
        if (results.length < limit) break;
        offset += limit;

        // Segurança: máximo 2000 pagamentos por loja por execução
        if (offset >= 2000) break;
      }

      summary.push({
        store_id:   store.id,
        store_name: store.name,
        fetched:    totalFetched,
        synced:     totalSynced,
        error:      lastError || undefined,
      });
    }

    return new Response(JSON.stringify({ ok: true, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("mp-sync-payments error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
