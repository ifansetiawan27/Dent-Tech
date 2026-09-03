-- Diagnosis-first quotation lifecycle for service work orders.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN IF NOT EXISTS approved_at text,
  ADD COLUMN IF NOT EXISTS approved_by text,
  ADD COLUMN IF NOT EXISTS proforma_number text,
  ADD COLUMN IF NOT EXISTS converted_at text;

CREATE INDEX IF NOT EXISTS idx_invoices_approval_status ON invoices(approval_status);
CREATE INDEX IF NOT EXISTS idx_attachments_work_order_kind ON attachments(work_order_id, kind);

UPDATE invoices
SET approval_status = CASE
  WHEN type = 'PROFORMA' AND status = 'PAID' THEN 'APPROVED'
  WHEN type = 'PROFORMA' THEN 'SENT'
  ELSE 'NOT_REQUIRED'
END
WHERE approval_status = 'NOT_REQUIRED';

-- Keep legacy proformas usable after rollout without rewriting completed service history.
UPDATE work_orders wo
SET status = 'WAITING_CUSTOMER_APPROVAL', updated_at = COALESCE(wo.updated_at, i.updated_at)
FROM invoices i
WHERE i.work_order_id = wo.id AND i.type = 'PROFORMA' AND i.status <> 'PAID'
  AND wo.status = 'COMPLETED';

UPDATE tickets t
SET status = 'WAITING_CUSTOMER_APPROVAL', updated_at = COALESCE(t.updated_at, i.updated_at)
FROM invoices i
WHERE i.ticket_id = t.id AND i.type = 'PROFORMA' AND i.status <> 'PAID'
  AND t.status = 'COMPLETED';
