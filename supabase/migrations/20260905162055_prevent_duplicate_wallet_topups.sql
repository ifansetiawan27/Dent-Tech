-- Keep only the newest pending wallet top-up for each customer before adding
-- the uniqueness guard. Older QRIS orders remain auditable as failed orders.
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY created_at DESC, id DESC) AS position
  FROM payment_orders
  WHERE kind = 'WALLET_TOPUP' AND status = 'PENDING'
)
UPDATE payment_orders
SET status = 'FAILED', updated_at = CURRENT_TIMESTAMP::text
WHERE id IN (SELECT id FROM ranked WHERE position > 1);

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_wallet_topup_order
  ON payment_orders(customer_id)
  WHERE kind = 'WALLET_TOPUP' AND status = 'PENDING';
