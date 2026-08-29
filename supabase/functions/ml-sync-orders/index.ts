import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ML_API = "https://api.mercadolibre.com";

async function refreshIfNeeded(admin: any, store: any) {
  const expiresAt = store.token_expires_at ? new Date(store.token_expires_at).getTime() : 0;
  if (expiresAt > Date.now() + 5 * 60 * 1000 && store.access_token) return store.access_token;
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: Deno.env.get("ML_CLIENT_ID")!,
    client_secret: Deno.env.get("ML_CLIENT_SECRET")!,
    refresh_token: store.refresh_token,
  });
  const r = await fetch(`${ML_API}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: params.toString(),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Refresh failed: ${JSON.stringify(j)}`);
  const newExpires = new Date(Date.now() + (j.expires_in ?? 21600) * 1000).toISOString();
  await admin.from("stores").update({
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    token_expires_at: newExpires,
  }).eq("id", store.id);
  return j.access_token;
}

async function mlGet(url: string, token: string) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`ML GET ${url} -> ${r.status} ${t}`);
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

    const body = await req.json().catch(() => ({}));
    const store_id: string | undefined = body.store_id;
    const days: number = Math.min(Math.max(Number(body.days ?? 90), 1), 365);

    const admin = createClient(supabaseUrl, serviceKey);
    const storesQuery = admin.from("stores").select("*").eq("user_id", userId);
    const { data: stores, error: storesErr } = store_id
      ? await storesQuery.eq("id", store_id)
      : await storesQuery;
    if (storesErr) throw storesErr;
    if (!stores || stores.length === 0) {
      return new Response(JSON.stringify({ error: "No stores" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    const summary: any[] = [];

    for (const store of stores) {
      let token: string;
      try {
        token = await refreshIfNeeded(admin, store);
      } catch (e) {
        summary.push({ store: store.name, error: String(e) });
        continue;
      }

      const sellerId = store.ml_seller_id;
      if (!sellerId) {
        summary.push({ store: store.name, error: "missing seller_id" });
        continue;
      }

      let offset = 0;
      const limit = 50;
      let total = 0;
      let fetched = 0;
      let shippingWithCost = 0;
      let lastShipErr = "";
      let shipDiag: any = null; // diagnóstico de um envio para debug
      const productCache = new Map<string, { title: string; thumbnail: string | null }>();

      while (true) {
        const url = `${ML_API}/orders/search?seller=${sellerId}&order.date_created.from=${encodeURIComponent(since)}&sort=date_desc&limit=${limit}&offset=${offset}`;
        let page;
        try {
          page = await mlGet(url, token);
        } catch (e) {
          summary.push({ store: store.name, error: String(e), at: "orders.search" });
          break;
        }
        total = page.paging?.total ?? 0;
        const results: any[] = page.results ?? [];
        if (results.length === 0) break;

        for (const o of results) {
          const grossSales = Number(o.total_amount ?? 0);

          let mlFees = 0;
          let shippingCost = 0;
          let paymentNet = 0;

          // 1. DADOS DO PAGAMENTO (Tarifas Reais)
          const pmt0 = (o.payments ?? [])[0];
          const paymentId = pmt0?.id;

          if (paymentId) {
            try {
              // Endpoint correto e atual do ML — /collections/payments/ está bloqueado
              const pmtData = await mlGet(`${ML_API}/v1/payments/${paymentId}`, token);
              if (pmtData && Array.isArray(pmtData.fee_details)) {
                for (const fee of pmtData.fee_details) {
                  if (fee.type === "meli_fee") {
                    mlFees += Math.abs(Number(fee.amount ?? 0));
                  }
                }
              }
              // Líquido depositado direto na raiz do extrato de pagamento
              paymentNet = Number(pmtData?.transaction_details?.net_received_amount ?? 0);
            } catch (_errPmt) {
              // falha silenciosa — fallbacks abaixo assumem
            }
          }

          // Fallbacks de segurança
          if (paymentNet === 0) {
            paymentNet = Number(pmt0?.transaction_details?.net_received_amount ?? 0);
          }
          if (mlFees === 0) {
            mlFees = (o.order_items ?? []).reduce(
              (acc: number, it: any) => acc + Number(it.sale_fee ?? 0) * Number(it.quantity ?? 1),
              0,
            );
          }
          if (paymentNet === 0) {
            paymentNet = grossSales - mlFees;
          }

          // Tenta extrair o que vier na busca inicial
          let buyerName = o.buyer?.nickname || 
                          [o.buyer?.first_name, o.buyer?.last_name].filter(Boolean).join(' ');

          // 2. BUSCA DO FRETE (Custo e Endereço da Etiqueta)
          const shippingId = o.shipping?.id;
          const shippingMode = o.shipping?.mode;
          const logisticType = o.shipping?.logistic_type;

          if (shippingId) {
            // 2.1 CAPTURA DO NOME E ENDEREÇO NA ETIQUETA
            try {
              const shipmentData = await mlGet(`${ML_API}/shipments/${shippingId}`, token);
              const addr = shipmentData?.receiver_address;
              
              if (addr) {
                const rName = addr.receiver_name;
                const rStreet = addr.address_line;
                const rCity = addr.city?.name;
                
                if (rName && rName.trim() !== '') {
                  buyerName = rName; // Nome exato impresso na etiqueta
                } else if (rStreet) {
                  buyerName = `${rStreet} - ${rCity}`; // Fallback: Endereço da etiqueta
                }
              }
            } catch (errAddr) {
              console.log(`Erro ao buscar etiqueta ${shippingId}:`, errAddr);
            }

            // 2.2 CÁLCULO DE CUSTO (Blindado contra envios customizados)
            if (shippingMode !== 'custom' && logisticType !== 'custom') {
              try {
                const costs = await mlGet(`${ML_API}/shipments/${shippingId}/costs`, token);
                const sc = costs?.senders;
                
                if (Array.isArray(sc) && sc.length > 0) {
                  shippingCost = Number(sc[0].cost ?? 0);
                } else if (sc && typeof sc === 'object' && !Array.isArray(sc)) {
                  shippingCost = Number(sc.cost ?? 0);
                }
              } catch (e1) {
                lastShipErr = String(e1).slice(0, 100);
              }
            }
          }

          if (shippingCost > 0) shippingWithCost++;

          // Fallback final 
          if (!buyerName || buyerName.trim() === '') {
            buyerName = 'Endereço/Nome restrito pelo ML';
          }

          // 3. CÁLCULO FINAL DO RECEBIDO
          const netReceived = paymentNet > 0 ? paymentNet : Math.max(0, grossSales - mlFees - shippingCost);

          const orderRow = {
            user_id: userId,
            store_id: store.id,
            ml_order_id: String(o.id),
            date_created: o.date_created,
            status: o.status,
            total_amount: grossSales,
            amount_received: netReceived,
            shipping_cost: shippingCost,
            ml_fees: mlFees,
            buyer_name: buyerName, // O nome ou endereço capturado acima
          };

          const { data: upOrder, error: upErr } = await admin
            .from("orders")
            .upsert(orderRow, { onConflict: "ml_order_id" })
            .select("id")
            .single();
          if (upErr) {
            summary.push({ store: store.name, error: upErr.message, ml_order_id: o.id });
            return;

          }

          await admin.from("order_items").delete().eq("order_id", upOrder.id);

          const itemsRows: any[] = [];
          for (const it of o.order_items ?? []) {
            const mlItemId = String(it.item?.id ?? "");
            const title = it.item?.title ?? "";
            const qty = Number(it.quantity ?? 1);
            const unit = Number(it.unit_price ?? 0);

            let product_id: string | null = null;
            if (mlItemId) {
              const { data: existingProd } = await admin
                .from("products")
                .select("id, cost_price")
                .eq("user_id", userId)
                .eq("ml_item_id", mlItemId)
                .maybeSingle();
              if (existingProd) {
                product_id = existingProd.id;
                await admin.from("products").update({ title, store_id: store.id }).eq("id", existingProd.id);
              } else {
                let thumbnail: string | null = null;
                let sku: string | null = null;
                if (!productCache.has(mlItemId)) {
                  try {
                    const itemData = await mlGet(`${ML_API}/items/${mlItemId}?attributes=thumbnail,seller_custom_field,attributes`, token);
                    thumbnail = itemData.thumbnail ?? null;
                    sku = itemData.seller_custom_field ?? null;
                    if (!sku && Array.isArray(itemData.attributes)) {
                      const skuAttr = itemData.attributes.find((a: any) => a.id === "SELLER_SKU");
                      sku = skuAttr?.value_name ?? null;
                    }
                    productCache.set(mlItemId, { title, thumbnail });
                  } catch (_) {}
                }
                const { data: newProd } = await admin.from("products").insert({
                  user_id: userId,
                  store_id: store.id,
                  ml_item_id: mlItemId,
                  title,
                  thumbnail,
                  sku,
                  cost_price: 0,
                }).select("id").single();
                product_id = newProd?.id ?? null;
              }
            }

            let cost = 0;
            if (product_id) {
              const { data: p } = await admin.from("products").select("cost_price").eq("id", product_id).maybeSingle();
              cost = Number(p?.cost_price ?? 0);
            }

            itemsRows.push({
              user_id: userId,
              order_id: upOrder.id,
              product_id,
              ml_item_id: mlItemId,
              title,
              quantity: qty,
              unit_price: unit,
              cost_price: cost,
            });
          }

          if (itemsRows.length > 0) {
            await admin.from("order_items").insert(itemsRows);
          }

          fetched++;
        };

        // Processa em paralelo (lotes) para não estourar o tempo da função
        const CONCURRENCY = 6;
        for (let i = 0; i < results.length; i += CONCURRENCY) {
          await Promise.all(results.slice(i, i + CONCURRENCY).map((o) => processOrder(o).catch((e) => {
            summary.push({ store: store.name, error: String(e).slice(0, 200), ml_order_id: o?.id });
          })));
          if (Date.now() - startedAt > TIME_BUDGET_MS) break;
        }

        offset += results.length;
        if (Date.now() - startedAt > TIME_BUDGET_MS) {
          summary.push({ store: store.name, partial: true, note: "Tempo limite atingido — rode a sincronização novamente para continuar." });
          break;
        }
        if (offset >= total) break;
        if (offset > 5000) break;
      }


      await admin.from("stores").update({ last_sync_at: new Date().toISOString() }).eq("id", store.id);
      summary.push({ store: store.name, fetched, total, shippingWithCost, ...(lastShipErr ? { lastShipErr } : {}), ...(shipDiag ? { shipDiag } : {}) });
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
