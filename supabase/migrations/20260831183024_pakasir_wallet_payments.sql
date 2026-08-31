-- Pakasir wallet and invoice payment orders. All money values are integer rupiah.

CREATE TABLE wallet_accounts (
  id text PRIMARY KEY,
  customer_id text NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
  balance bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE TABLE payment_orders (
  id text PRIMARY KEY,
  order_id text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('WALLET_TOPUP','INVOICE')),
  customer_id text NOT NULL REFERENCES customers(id),
  invoice_id text REFERENCES invoices(id),
  project text NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','COMPLETED','EXPIRED','FAILED')),
  payment_method text NOT NULL DEFAULT 'qris',
  payment_number text,
  gateway_fee bigint CHECK (gateway_fee IS NULL OR gateway_fee >= 0),
  total_payment bigint CHECK (total_payment IS NULL OR total_payment >= amount),
  expired_at text,
  gateway_completed_at text,
  settled_at text,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  CHECK ((kind = 'INVOICE' AND invoice_id IS NOT NULL) OR (kind = 'WALLET_TOPUP' AND invoice_id IS NULL))
);

CREATE TABLE wallet_transactions (
  id text PRIMARY KEY,
  wallet_id text NOT NULL REFERENCES wallet_accounts(id) ON DELETE CASCADE,
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('CREDIT_TOPUP','DEBIT_ONSITE')),
  amount bigint NOT NULL CHECK (amount > 0),
  balance_after bigint NOT NULL CHECK (balance_after >= 0),
  payment_order_id text REFERENCES payment_orders(id),
  ticket_id text REFERENCES tickets(id),
  description text NOT NULL DEFAULT '',
  created_at text NOT NULL,
  CHECK ((type = 'CREDIT_TOPUP' AND payment_order_id IS NOT NULL AND ticket_id IS NULL)
      OR (type = 'DEBIT_ONSITE' AND ticket_id IS NOT NULL AND payment_order_id IS NULL))
);

CREATE TABLE finance_income (
  id text PRIMARY KEY,
  income_type text NOT NULL CHECK (income_type IN ('WALLET_TOPUP_CASH','ONSITE_FEE_REVENUE')),
  amount bigint NOT NULL CHECK (amount > 0),
  customer_id text NOT NULL REFERENCES customers(id),
  payment_order_id text REFERENCES payment_orders(id),
  ticket_id text REFERENCES tickets(id),
  occurred_at text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at text NOT NULL,
  CHECK ((income_type = 'WALLET_TOPUP_CASH' AND payment_order_id IS NOT NULL AND ticket_id IS NULL)
      OR (income_type = 'ONSITE_FEE_REVENUE' AND ticket_id IS NOT NULL AND payment_order_id IS NULL))
);

-- Composite keys let child rows prove that references belong to the same customer.
ALTER TABLE wallet_accounts ADD CONSTRAINT uq_wallet_id_customer UNIQUE (id, customer_id);
ALTER TABLE payment_orders ADD CONSTRAINT uq_payment_order_id_customer UNIQUE (id, customer_id);
ALTER TABLE tickets ADD CONSTRAINT uq_ticket_id_customer UNIQUE (id, customer_id);
ALTER TABLE invoices ADD CONSTRAINT uq_invoice_id_customer UNIQUE (id, customer_id);
ALTER TABLE payment_orders ADD CONSTRAINT fk_payment_order_invoice_customer
  FOREIGN KEY (invoice_id, customer_id) REFERENCES invoices(id, customer_id);
ALTER TABLE wallet_transactions ADD CONSTRAINT fk_wallet_transaction_wallet_customer
  FOREIGN KEY (wallet_id, customer_id) REFERENCES wallet_accounts(id, customer_id) ON DELETE CASCADE;
ALTER TABLE wallet_transactions ADD CONSTRAINT fk_wallet_transaction_order_customer
  FOREIGN KEY (payment_order_id, customer_id) REFERENCES payment_orders(id, customer_id);
ALTER TABLE wallet_transactions ADD CONSTRAINT fk_wallet_transaction_ticket_customer
  FOREIGN KEY (ticket_id, customer_id) REFERENCES tickets(id, customer_id);
ALTER TABLE finance_income ADD CONSTRAINT fk_finance_topup_order_customer
  FOREIGN KEY (payment_order_id, customer_id) REFERENCES payment_orders(id, customer_id);
ALTER TABLE finance_income ADD CONSTRAINT fk_finance_ticket_customer
  FOREIGN KEY (ticket_id, customer_id) REFERENCES tickets(id, customer_id);

CREATE INDEX idx_payment_orders_customer_created ON payment_orders(customer_id, created_at DESC);
CREATE INDEX idx_payment_orders_invoice ON payment_orders(invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX idx_payment_orders_status ON payment_orders(status) WHERE status = 'PENDING';
CREATE INDEX idx_wallet_transactions_customer_created ON wallet_transactions(customer_id, created_at DESC);
CREATE INDEX idx_finance_income_occurred ON finance_income(occurred_at DESC);
CREATE UNIQUE INDEX uq_active_invoice_payment_order ON payment_orders(invoice_id) WHERE kind = 'INVOICE' AND status = 'PENDING';
CREATE UNIQUE INDEX uq_wallet_topup_transaction ON wallet_transactions(payment_order_id) WHERE payment_order_id IS NOT NULL;
CREATE UNIQUE INDEX uq_wallet_ticket_debit ON wallet_transactions(ticket_id) WHERE ticket_id IS NOT NULL;
CREATE UNIQUE INDEX uq_finance_topup ON finance_income(payment_order_id) WHERE payment_order_id IS NOT NULL;
CREATE UNIQUE INDEX uq_finance_ticket_fee ON finance_income(ticket_id) WHERE ticket_id IS NOT NULL;
CREATE UNIQUE INDEX uq_gateway_payment_reference ON payments(reference) WHERE method = 'PAKASIR_QRIS' AND reference <> '';

CREATE FUNCTION enforce_payment_order_transition() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'PENDING' AND NEW.status IN ('COMPLETED','EXPIRED','FAILED')) OR
    (OLD.status IN ('EXPIRED','FAILED') AND NEW.status = 'COMPLETED')
  ) THEN
    RAISE EXCEPTION 'invalid payment order transition: % -> %', OLD.status, NEW.status;
  END IF;
  IF NEW.status = 'COMPLETED' AND (NEW.gateway_completed_at IS NULL OR NEW.settled_at IS NULL) THEN
    RAISE EXCEPTION 'completed payment order requires completion timestamps';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payment_order_state_transition
BEFORE UPDATE OF status ON payment_orders
FOR EACH ROW EXECUTE FUNCTION enforce_payment_order_transition();
REVOKE ALL ON FUNCTION enforce_payment_order_transition() FROM PUBLIC, anon, authenticated;

INSERT INTO wallet_accounts (id, customer_id, balance, created_at, updated_at)
SELECT md5('wallet:' || c.id), c.id, 0, CURRENT_TIMESTAMP::text, CURRENT_TIMESTAMP::text
FROM customers c
ON CONFLICT (customer_id) DO NOTHING;

ALTER TABLE wallet_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_income ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE wallet_accounts, payment_orders, wallet_transactions, finance_income FROM anon, authenticated;
