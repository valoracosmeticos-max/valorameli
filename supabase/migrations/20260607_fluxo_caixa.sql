-- Migração: Fluxo de Caixa — payments_releases, purchases, purchase_items, stock

-- 1. Estoque nos produtos
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS stock INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stock_updated_at TIMESTAMPTZ;

-- 2. Liberações de pagamentos MP
-- Cruzamento: ml_order_id (EXTERNAL_REFERENCE no MP) ↔ orders.ml_order_id
CREATE TABLE IF NOT EXISTS public.payments_releases (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL,
  store_id              UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  mp_payment_id         TEXT NOT NULL,
  ml_order_id           TEXT,
  order_db_id           UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  date_created          TIMESTAMPTZ,
  date_approved         TIMESTAMPTZ,
  money_release_date    TIMESTAMPTZ,
  money_release_status  TEXT,
  transaction_amount    NUMERIC(12,2),
  net_received_amount   NUMERIC(12,2),
  fee_amount            NUMERIC(12,2),
  shipping_fee_amount   NUMERIC(12,2),
  financing_fee_amount  NUMERIC(12,2),
  taxes_amount          NUMERIC(12,2),
  coupon_amount         NUMERIC(12,2),
  installments          INTEGER,
  payment_method_id     TEXT,
  payment_method_type   TEXT,
  status                TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, mp_payment_id)
);

ALTER TABLE public.payments_releases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own payments_releases" ON public.payments_releases
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_pr_store    ON public.payments_releases(store_id);
CREATE INDEX idx_pr_release  ON public.payments_releases(money_release_date);
CREATE INDEX idx_pr_ml_order ON public.payments_releases(ml_order_id);
CREATE INDEX idx_pr_status   ON public.payments_releases(money_release_status);
CREATE INDEX idx_pr_user     ON public.payments_releases(user_id);

CREATE TRIGGER trg_pr_updated BEFORE UPDATE ON public.payments_releases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Compras de fornecedor (para PMP)
CREATE TABLE IF NOT EXISTS public.purchases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  store_id        UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  supplier        TEXT NOT NULL,
  description     TEXT,
  invoice_number  TEXT,
  purchase_date   DATE NOT NULL,
  due_date        DATE NOT NULL,
  paid_date       DATE,
  total_amount    NUMERIC(12,2) NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'paid', 'overdue')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own purchases" ON public.purchases
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_purchases_user  ON public.purchases(user_id);
CREATE INDEX idx_purchases_store ON public.purchases(store_id);
CREATE INDEX idx_purchases_due   ON public.purchases(due_date);

CREATE TRIGGER trg_purchases_updated BEFORE UPDATE ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Itens das compras
CREATE TABLE IF NOT EXISTS public.purchase_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id  UUID NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
  product_id   UUID REFERENCES public.products(id) ON DELETE SET NULL,
  description  TEXT NOT NULL,
  quantity     INTEGER NOT NULL DEFAULT 1,
  unit_cost    NUMERIC(12,2) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own purchase_items" ON public.purchase_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.purchases p
      WHERE p.id = purchase_items.purchase_id
        AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.purchases p
      WHERE p.id = purchase_items.purchase_id
        AND p.user_id = auth.uid()
    )
  );

CREATE INDEX idx_pi_purchase ON public.purchase_items(purchase_id);
CREATE INDEX idx_pi_product  ON public.purchase_items(product_id);
