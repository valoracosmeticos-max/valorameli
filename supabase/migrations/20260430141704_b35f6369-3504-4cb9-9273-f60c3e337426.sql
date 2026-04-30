-- Unique constraints for upserts
CREATE UNIQUE INDEX IF NOT EXISTS orders_ml_order_id_key ON public.orders (ml_order_id);
CREATE UNIQUE INDEX IF NOT EXISTS products_user_ml_item_key ON public.products (user_id, ml_item_id);

-- Performance indexes
CREATE INDEX IF NOT EXISTS orders_user_store_date_idx ON public.orders (user_id, store_id, date_created DESC);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON public.order_items (order_id);
CREATE INDEX IF NOT EXISTS order_items_product_idx ON public.order_items (product_id);
CREATE INDEX IF NOT EXISTS products_user_store_idx ON public.products (user_id, store_id);