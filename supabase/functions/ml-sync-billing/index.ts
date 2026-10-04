import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ML_API = "https://api.mercadolibre.com";

// O refresh_token do ML é de uso único. Se outra sync rotacionou o token nesse
// meio-tempo, esta chamada perde a corrida e recebe invalid_grant mesmo que a
// outra tenha funcionado — relê a loja antes de desistir.
async function refreshIfNeeded(admin: any, store: any): Promise<string> {
  const expiresAt = store.token_expires_at ? new Date(store.token_expires_at).getTime() : 0;
  if (expiresAt > Date.now() + 5 * 60 * 1000 && store.access_token) return store.access_token;

  const r = await fetch(`${ML_API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: store.ml_client_id || Deno.env.get("ML_CLIENT_ID")!,
      client_secret: store.ml_client_secret || Deno.env.get("ML_CLIENT_SECRET")!,
      refresh_token: store.refresh_token,
    }).toString(),
  });
  const j = await r.json();
  if (!r.ok) {
    const { data: fresh } = await admin
      .from("stores")
      .select("access_token, refresh_token, token_expires_at")
      .eq("id", store.id)
      .maybeSingle();
    const freshExpires = fresh?.token_expires_at ? new Date(fresh.token_expires_at).getTime() : 0;
    if (fresh && fresh.refresh_token !== store.refresh_token && freshExpires > Date.now()) {
      return fresh.access_token;
    }
    throw new Error(`Refresh failed: ${JSON.stringify(j)}`);
  }
  await admin.from("stores").update({
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    token_expires_at: new Date(Date.now() + (j.expires_in ?? 21600) * 1000).toISOString(),
  }).eq("id", store.id);
  return j.access_token;
}

async function mlGet(url: string, token: string) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 429 && attempt < 4) {
      await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
      continue;
    }
    if (!r.ok) throw new Error(`ML GET ${r.status}: ${(await r.text()).slice(0, 400)}`);
    return r.json();
  }
}

// A key do período é sempre o primeiro dia do mês; a doc recomenda construí-la
// direto em vez de chamar /monthly/periods repetidamente.
function periodKeys(months: number): string[] {
  const now = new Date();
  return Array.from({ length: months }, (_, i) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 10),
  );
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
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const storeId: string | undefined = body.store_id;
    const months = Math.min(Math.max(Number(body.months ?? 3), 1), 12);

    const storesQuery = admin.from("stores").select("*").eq("user_id", userId);
    const { data: stores, error: storesErr } = storeId
      ? await storesQuery.eq("id", storeId)
      : await storesQuery;
    if (storesErr) throw storesErr;
    if (!stores?.length) {
      return new Response(JSON.stringify({ error: "Nenhuma loja encontrada" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const summary: any[] = [];

    for (const store of stores) {
      let token: string;
      try {
        token = await refreshIfNeeded(admin, store);
      } catch (e) {
        summary.push({ store: store.name, error: String(e).slice(0, 200) });
        continue;
      }

      for (const key of periodKeys(months)) {
        let synced = 0;
        let detailSum = 0;
        let summaryTotal: number | null = null;
        let periodErr = "";

        // Resumo do período: serve para conferir se o detalhe veio completo.
        try {
          const sum = await mlGet(
            `${ML_API}/billing/integration/periods/key/${key}/summary/details?group=ML`,
            token,
          );
          const pads = (sum?.bill_includes?.charges ?? []).find((c: any) => c.type === "PADS");
          summaryTotal = pads ? Number(pads.amount ?? 0) : 0;
        } catch (e) {
          periodErr = `summary: ${String(e).slice(0, 120)}`;
        }

        // Detalhe linha a linha. Pagina por from_id — offset trava em 10.000.
        let fromId = 0;
        const rows: any[] = [];
        try {
          for (let page = 0; page < 50; page++) {
            const data = await mlGet(
              `${ML_API}/billing/integration/periods/key/${key}/group/ML/details` +
              `?document_type=BILL&detail_sub_types=PADS&limit=1000` +
              `&from_id=${fromId}&sort_by=ID&order_by=ASC`,
              token,
            );
            const results: any[] = data?.results ?? [];
            if (results.length === 0) break;

            for (const r of results) {
              const ci = r?.charge_info ?? r;
              const detailId = ci?.detail_id;
              const amount = Number(ci?.detail_amount ?? 0);
              if (detailId == null || !amount) continue;
              const when = String(ci?.creation_date_time ?? "").slice(0, 10);
              if (!when) continue;

              rows.push({
                user_id: userId,
                store_id: store.id,
                period_key: key,
                charge_date: when,
                detail_id: String(detailId),
                detail_sub_type: String(ci?.detail_sub_type ?? "PADS"),
                description: ci?.transaction_detail ?? null,
                amount,
              });
              detailSum += amount;
            }

            const lastId = data?.last_id;
            if (lastId == null || Number(lastId) === fromId) break;
            fromId = Number(lastId);
          }
        } catch (e) {
          periodErr = `${periodErr ? periodErr + " | " : ""}details: ${String(e).slice(0, 120)}`;
        }

        if (rows.length > 0) {
          const { error: upErr } = await admin
            .from("ad_spend")
            .upsert(rows, { onConflict: "store_id,detail_id" });
          if (upErr) periodErr = `${periodErr ? periodErr + " | " : ""}upsert: ${upErr.message}`;
          else synced = rows.length;
        }

        // Regra de conciliação da doc: a soma dos detail_amount de um
        // detail_sub_type tem que bater com o amount do mesmo type no resumo.
        const mismatch =
          summaryTotal !== null && Math.abs(summaryTotal - detailSum) > 0.01
            ? Number((summaryTotal - detailSum).toFixed(2))
            : null;

        summary.push({
          store: store.name,
          period: key,
          synced,
          detail_total: Number(detailSum.toFixed(2)),
          ...(summaryTotal !== null ? { summary_total: Number(summaryTotal.toFixed(2)) } : {}),
          ...(mismatch !== null ? { mismatch } : {}),
          ...(periodErr ? { error: periodErr } : {}),
        });
      }
    }

    return new Response(JSON.stringify({ success: true, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
