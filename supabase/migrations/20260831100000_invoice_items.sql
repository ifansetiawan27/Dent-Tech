-- Snapshot line items untuk invoice/proforma + revision untuk sinkronisasi customer.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS updated_at text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
UPDATE invoices SET updated_at = COALESCE(updated_at, created_at, issued_at, CURRENT_TIMESTAMP::text) WHERE updated_at IS NULL;
ALTER TABLE invoices ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP::text;
ALTER TABLE invoices ALTER COLUMN updated_at SET NOT NULL;

CREATE TABLE IF NOT EXISTS invoice_items (
  id text PRIMARY KEY,
  invoice_id text NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  item_type text NOT NULL DEFAULT 'CUSTOM' CHECK (item_type IN ('LABOR','PART','CUSTOM')),
  description text NOT NULL,
  qty numeric(14,4) NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit text NOT NULL DEFAULT 'unit',
  unit_price numeric(18,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  source_id text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_sort ON invoice_items(invoice_id, sort_order, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_items_source_snapshot
  ON invoice_items(invoice_id, item_type, source_id)
  WHERE source_id IS NOT NULL;

-- Backfill snapshot untuk invoice lama. Labor dan sparepart tidak akan lagi dihitung live dari WO.
INSERT INTO invoice_items (id, invoice_id, item_type, description, qty, unit, unit_price, sort_order, source_id, created_at, updated_at)
SELECT md5(i.id || ':labor'), i.id, 'LABOR',
       CASE WHEN t.problem IS NOT NULL AND t.problem <> '' THEN 'Biaya Jasa — ' || t.problem ELSE 'Biaya Jasa' END,
       1, 'jasa', COALESCE(i.labor_cost, 0), 0, 'labor',
       COALESCE(i.created_at, i.issued_at, CURRENT_TIMESTAMP::text),
       COALESCE(i.updated_at, i.created_at, i.issued_at, CURRENT_TIMESTAMP::text)
FROM invoices i
LEFT JOIN tickets t ON t.id = i.ticket_id
WHERE NOT EXISTS (SELECT 1 FROM invoice_items ii WHERE ii.invoice_id = i.id AND ii.item_type = 'LABOR');

INSERT INTO invoice_items (id, invoice_id, item_type, description, qty, unit, unit_price, sort_order, source_id, created_at, updated_at)
SELECT md5(i.id || ':part:' || pu.id), i.id, 'PART',
       'Spare Part: ' || p.name || CASE WHEN p.code <> '' THEN ' (' || p.code || ')' ELSE '' END,
       COALESCE(pu.qty, 1), COALESCE(NULLIF(p.unit, ''), 'pcs'), COALESCE(pu.unit_price, 0),
       100 + ROW_NUMBER() OVER (PARTITION BY i.id ORDER BY pu.created_at, pu.id),
       pu.id, COALESCE(pu.created_at, i.created_at, i.issued_at, CURRENT_TIMESTAMP::text),
       COALESCE(i.updated_at, i.created_at, i.issued_at, CURRENT_TIMESTAMP::text)
FROM invoices i
JOIN part_usages pu ON pu.work_order_id = i.work_order_id
JOIN parts p ON p.id = pu.part_id
WHERE NOT EXISTS (
  SELECT 1 FROM invoice_items ii
  WHERE ii.invoice_id = i.id AND ii.item_type = 'PART' AND ii.source_id = pu.id
);

ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE invoice_items FROM anon, authenticated;
