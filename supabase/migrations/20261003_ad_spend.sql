-- Gastos com publicidade (Product Ads) extraidos do faturamento do Mercado Livre.
-- Fonte: GET /billing/integration/periods/key/{key}/group/ML/details?detail_sub_types=PADS
--
-- Tabela separada de additional_costs de proposito: additional_costs e editado
-- manualmente pelo usuario, e um re-sync recriaria linhas apagadas. Aqui a chave
-- (store_id, detail_id) vem do proprio ML, entao o upsert e idempotente.
CREATE TABLE IF NOT EXISTS public.ad_spend (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL,
  store_id         UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  period_key       DATE NOT NULL,
  charge_date      DATE NOT NULL,
  detail_id        TEXT NOT NULL,
  detail_sub_type  TEXT NOT NULL DEFAULT 'PADS',
  description      TEXT,
  amount           NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, detail_id)
);

ALTER TABLE public.ad_spend ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own ad_spend" ON public.ad_spend;
CREATE POLICY "Users manage own ad_spend"
ON public.ad_spend FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_ad_spend_user_date   ON public.ad_spend(user_id, charge_date DESC);
CREATE INDEX IF NOT EXISTS idx_ad_spend_store_period ON public.ad_spend(store_id, period_key);
