CREATE TABLE IF NOT EXISTS public.ad_spend (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  period_key DATE NOT NULL,
  charge_date DATE NOT NULL,
  detail_id TEXT NOT NULL,
  detail_sub_type TEXT NOT NULL DEFAULT 'PADS',
  description TEXT,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (store_id, detail_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_spend TO authenticated;
GRANT ALL ON public.ad_spend TO service_role;
ALTER TABLE public.ad_spend ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own ad_spend" ON public.ad_spend;
CREATE POLICY "Users manage own ad_spend" ON public.ad_spend FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_ad_spend_user_date ON public.ad_spend(user_id, charge_date DESC);
CREATE INDEX IF NOT EXISTS idx_ad_spend_store_period ON public.ad_spend(store_id, period_key);