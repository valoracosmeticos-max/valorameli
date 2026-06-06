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
          const mlFees = (o.order_items ?? []).reduce(
            (acc: number, it: any) => acc + Number(it.sale_fee ?? 0) * Number(it.quantity ?? 1),
            0,
          );
          const grossSales = (o.order_items ?? []).reduce(
            (acc: number, it: any) => acc + Number(it.unit_price ?? 0) * Number(it.quantity ?? 1),
            0,
          );

          // Custo de frete do vendedor (o que o seller paga ao ML líquido)
          let shippingCost = 0;
          const shippingId = o.shipping?.id;

          // Método 1: transaction_details.net_received_amount
          // O ML popula este campo em todos os pedidos pagos (não só os liquidados).
          // Representa o valor EFETIVAMENTE depositado ao seller após todas as
          // deduções: tarifa de venda + frete líquido do seller.
          // Fórmula: frete_seller = (grossSales - mlFees) - net_received_amount
          //
          // Exemplo pedido 05/06 R$532,03:
          //   grossSales=532,03  mlFees=78,70  net_received=421,83
          //   frete = (532,03-78,70) - 421,83 = 453,33 - 421,83 = 31,50 ✓
          const pmt0 = (o.payments ?? [])[0];
          // transaction_details.net_received_amount é o campo correto e disponível imediatamente.
          // payments[].net_received_amount (raiz) costuma vir 0 até a liquidação (~30 dias).
          const txNetReceived = Number(pmt0?.transaction_details?.net_received_amount ?? 0);
          const flatNetReceived = Number(pmt0?.net_received_amount ?? 0);
          const mlNetDeposit = txNetReceived > 0 ? txNetReceived : flatNetReceived;
          if (mlNetDeposit > 0) {
            const amountBeforeShipping = Math.round((grossSales - mlFees) * 100) / 100;
            const diff = Math.round((amountBeforeShipping - mlNetDeposit) * 100) / 100;
            if (diff >= 0) {
              shippingCost = diff;
              if (shippingCost > 0) shippingWithCost++;
            }
            // Diagnóstico do 1º pedido resolvido por este método
            if (!shipDiag) {
              shipDiag = {
                method: "transaction_details",
                order_id: String(o.id),
                tx_net_received: txNetReceived,
                flat_net_received: flatNetReceived,
                gross_sales: grossSales,
                ml_fees: mlFees,
                shipping_calc: shippingCost,
              };
            }
          }

          if (shippingCost === 0 && shippingId) {
            let _shipErr = "";
            try {
              // Endpoint principal: requer escopo read_shipments no OAuth
              const costs = await mlGet(`${ML_API}/shipments/${shippingId}/costs`, token);
              // API ML retorna: costs.senders{cost,save}, costs.receiver{cost,save}, gross_amount
              // Custo líquido do seller = senders.cost - senders.save
              // senders.save = desconto/subsídio ML + contribuição do comprador (quando houver)
              const sc = costs?.senders;
              if (typeof sc === "number" && sc >= 0) {
                shippingCost = sc;
              } else if (sc && typeof sc === "object") {
                const gross = Number(sc.cost ?? -1);
                const save  = Number(sc.save ?? 0);
                const net   = gross - save;
                if (net >= 0) shippingCost = net;
                else if (gross >= 0) shippingCost = gross;
              }
              // senders ausente: gross_amount − receiver.cost
              if (shippingCost === 0 && typeof costs?.gross_amount === "number") {
                const recv = costs?.receiver;
                const receiverCost = typeof recv === "number"
                  ? recv
                  : Number(recv?.cost ?? recv?.amount ?? 0);
                const diff = Math.max(0, Number(costs.gross_amount) - receiverCost);
                shippingCost = diff;
              }
            } catch (e1) {
              _shipErr = String(e1).slice(0, 200);
              // Fallback: /shipments/{id} — sem escopo especial
              // cost.amount é o valor líquido após descontos/contribuição do comprador
              // cost.gross_amount pode incluir seguro de valor declarado (inflado)
              try {
                const shipment = await mlGet(`${ML_API}/shipments/${shippingId}`, token);
                const c = shipment?.cost ?? {};
                // Capturar diagnóstico do 1º pedido que usa fallback
                if (!shipDiag) {
                  shipDiag = {
                    order_id: String(o.id),
                    cost_keys: Object.keys(c),
                    gross_amount: c.gross_amount,
                    amount: c.amount,
                    save: c.save,
                    discount: c.discount,
                    buyer_shipping_cost: (o.payments ?? []).map((p: any) => p.shipping_cost),
                  };
                }
                // Preferir cost.amount (líquido) sobre cost.gross_amount (pode ser inflado)
                const base = Number(c.amount ?? c.gross_amount ?? 0);
                const buyerPaid = (o.payments ?? []).reduce(
                  (s: number, p: any) => s + Math.max(0, Number(p.shipping_cost ?? 0)), 0
                );
                // Se cost.amount < buyerPaid: já é o líquido do seller (não subtrair)
                // Se cost.amount >= buyerPaid: subtrair contribuição do comprador
                shippingCost = base > buyerPaid
                  ? Math.max(0, base - buyerPaid)
                  : Math.max(0, base);
              } catch (e2) {
                _shipErr += ` | /shipments: ${String(e2).slice(0, 100)}`;
              }
            }
            if (_shipErr) lastShipErr = _shipErr;
            if (shippingCost > 0) shippingWithCost++;
          }

          // amount_received = bruto menos tarifas ML (frete é custo separado)
          const netReceived = Math.max(0, grossSales - mlFees);

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
          };

          const { data: upOrder, error: upErr } = await admin
            .from("orders")
            .upsert(orderRow, { onConflict: "ml_order_id" })
            .select("id")
            .single();
          if (upErr) {
            summary.push({ store: store.name, error: upErr.message, ml_order_id: o.id });
            continue;
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
        }

        offset += results.length;
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
