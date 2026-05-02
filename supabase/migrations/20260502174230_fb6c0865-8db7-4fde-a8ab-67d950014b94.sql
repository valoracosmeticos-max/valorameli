-- Backfill: amount_received vinha como paid_amount bruto. Tornar líquido (paid - ml_fees) e total_amount = bruto pago.
UPDATE public.orders
SET
  total_amount = GREATEST(total_amount, amount_received),
  amount_received = GREATEST(0, amount_received - COALESCE(ml_fees, 0))
WHERE status <> 'cancelled';