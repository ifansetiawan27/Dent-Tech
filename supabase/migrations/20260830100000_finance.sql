-- Finance: harga beli (cost) pada spare part + tabel pengeluaran (expenses)

ALTER TABLE parts ADD COLUMN IF NOT EXISTS cost double precision DEFAULT 0;

CREATE TABLE IF NOT EXISTS expenses (
  id text PRIMARY KEY,
  category text NOT NULL DEFAULT 'SPARE_PART' CHECK (category IN ('SPARE_PART','OPERATIONAL','OTHER')),
  description text NOT NULL DEFAULT '',
  part_id text REFERENCES parts(id),
  qty double precision DEFAULT 0,
  unit_cost double precision DEFAULT 0,
  amount double precision NOT NULL,
  restocked integer DEFAULT 0,
  expense_date text NOT NULL,
  created_by text,
  created_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_expenses_part ON expenses(part_id);

-- Finance hanya diakses melalui backend admin; jangan expose langsung ke Data API.
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE expenses FROM anon, authenticated;
