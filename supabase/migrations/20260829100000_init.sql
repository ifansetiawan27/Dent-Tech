-- Dent Tech schema (migrated from SQLite)

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL DEFAULT '',
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','technician','customer')),
  phone text DEFAULT '',
  customer_id text,
  photo_path text DEFAULT '',
  photo_mime text DEFAULT '',
  active integer DEFAULT 1,
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS tokens (
  token text PRIMARY KEY,
  user_id text NOT NULL,
  created_at text NOT NULL,
  expires_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id text PRIMARY KEY,
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  industry text DEFAULT '',
  phone text DEFAULT '',
  email text DEFAULT '',
  address text DEFAULT '',
  city text DEFAULT '',
  status text DEFAULT 'ACTIVE',
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_contacts (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id),
  name text NOT NULL,
  role text DEFAULT '',
  phone text DEFAULT '',
  email text DEFAULT '',
  is_primary integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS equipment (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id),
  name text NOT NULL,
  category text DEFAULT '',
  model text DEFAULT '',
  serial_number text DEFAULT '',
  location text DEFAULT '',
  install_date text DEFAULT '',
  warranty_until text DEFAULT '',
  status text DEFAULT 'OPERATIONAL',
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
  id text PRIMARY KEY,
  number text UNIQUE NOT NULL,
  customer_id text NOT NULL REFERENCES customers(id),
  equipment_id text REFERENCES equipment(id),
  equipment_type text DEFAULT '',
  equipment_brand text DEFAULT '',
  service_address text DEFAULT '',
  contact_name text DEFAULT '',
  contact_phone text DEFAULT '',
  service_type text DEFAULT '',
  priority text DEFAULT 'MEDIUM',
  problem text NOT NULL,
  description text DEFAULT '',
  preferred_date text DEFAULT '',
  preferred_time text DEFAULT '',
  status text DEFAULT 'OPEN',
  created_by text,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  closed_at text
);

CREATE TABLE IF NOT EXISTS ticket_status_history (
  id text PRIMARY KEY,
  ticket_id text NOT NULL REFERENCES tickets(id),
  from_status text,
  to_status text NOT NULL,
  by_user text,
  note text DEFAULT '',
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS ticket_timeline (
  id text PRIMARY KEY,
  ticket_id text NOT NULL REFERENCES tickets(id),
  type text NOT NULL,
  title text NOT NULL,
  description text DEFAULT '',
  visibility text DEFAULT 'CUSTOMER_VISIBLE',
  created_by text,
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS work_orders (
  id text PRIMARY KEY,
  number text UNIQUE NOT NULL,
  ticket_id text NOT NULL REFERENCES tickets(id),
  technician_id text REFERENCES users(id),
  checklist_template_id text,
  scheduled_date text DEFAULT '',
  time_window text DEFAULT '',
  status text DEFAULT 'ASSIGNED',
  started_at text,
  completed_at text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS checklist_templates (
  id text PRIMARY KEY,
  name text NOT NULL,
  service_type text DEFAULT '',
  equipment_category text DEFAULT '',
  version text DEFAULT '1.0',
  status text DEFAULT 'ACTIVE',
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS checklist_template_items (
  id text PRIMARY KEY,
  template_id text NOT NULL REFERENCES checklist_templates(id),
  section text NOT NULL,
  label text NOT NULL,
  required integer DEFAULT 1,
  sort_order integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS checklist_responses (
  id text PRIMARY KEY,
  work_order_id text NOT NULL REFERENCES work_orders(id),
  item_id text NOT NULL,
  section text NOT NULL,
  label text NOT NULL,
  required integer DEFAULT 1,
  result text DEFAULT '',
  note text DEFAULT '',
  updated_at text NOT NULL,
  UNIQUE (work_order_id, item_id)
);

CREATE TABLE IF NOT EXISTS diagnoses (
  id text PRIMARY KEY,
  work_order_id text NOT NULL REFERENCES work_orders(id),
  findings text DEFAULT '',
  root_cause text DEFAULT '',
  recommendation text DEFAULT '',
  visibility text DEFAULT 'CUSTOMER_VISIBLE',
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS work_performed (
  id text PRIMARY KEY,
  work_order_id text NOT NULL REFERENCES work_orders(id),
  description text NOT NULL,
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS parts (
  id text PRIMARY KEY,
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  category text DEFAULT '',
  unit text DEFAULT 'pcs',
  price double precision DEFAULT 0,
  stock double precision DEFAULT 0,
  min_stock double precision DEFAULT 0,
  status text DEFAULT 'ACTIVE',
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS part_usages (
  id text PRIMARY KEY,
  work_order_id text NOT NULL REFERENCES work_orders(id),
  part_id text NOT NULL REFERENCES parts(id),
  qty double precision NOT NULL,
  unit_price double precision NOT NULL,
  note text DEFAULT '',
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
  id text PRIMARY KEY,
  ticket_id text,
  work_order_id text,
  kind text DEFAULT 'other',
  file_path text NOT NULL,
  file_name text DEFAULT '',
  mime text DEFAULT '',
  size integer DEFAULT 0,
  caption text DEFAULT '',
  visibility text DEFAULT 'CUSTOMER_VISIBLE',
  created_by text,
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS service_reports (
  id text PRIMARY KEY,
  number text UNIQUE NOT NULL,
  version integer DEFAULT 1,
  work_order_id text NOT NULL REFERENCES work_orders(id),
  summary text DEFAULT '',
  technician_note text DEFAULT '',
  status text DEFAULT 'SUBMITTED',
  approved_at text,
  approved_by text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id text PRIMARY KEY,
  number text UNIQUE NOT NULL,
  ticket_id text REFERENCES tickets(id),
  work_order_id text REFERENCES work_orders(id),
  customer_id text REFERENCES customers(id),
  labor_cost double precision DEFAULT 0,
  discount double precision DEFAULT 0,
  tax_rate double precision DEFAULT 11,
  status text DEFAULT 'SENT',
  type text DEFAULT 'FINAL',
  issued_at text NOT NULL,
  due_at text DEFAULT '',
  paid_at text,
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id text PRIMARY KEY,
  invoice_id text NOT NULL REFERENCES invoices(id),
  amount double precision NOT NULL,
  method text DEFAULT '',
  reference text DEFAULT '',
  paid_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id text PRIMARY KEY,
  user_id text,
  role text,
  customer_id text,
  title text NOT NULL,
  body text DEFAULT '',
  type text DEFAULT 'INFO',
  ref_type text DEFAULT '',
  ref_id text DEFAULT '',
  read_at text,
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id text PRIMARY KEY,
  user_id text,
  user_name text DEFAULT '',
  role text DEFAULT '',
  action text NOT NULL,
  entity text DEFAULT '',
  entity_id text DEFAULT '',
  details text DEFAULT '',
  ip text DEFAULT '',
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tickets_customer ON tickets(customer_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_wo_ticket ON work_orders(ticket_id);
CREATE INDEX IF NOT EXISTS idx_wo_technician ON work_orders(technician_id);
CREATE INDEX IF NOT EXISTS idx_wo_status ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_wo_date ON work_orders(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_tpl_items ON checklist_template_items(template_id);
CREATE INDEX IF NOT EXISTS idx_resp_wo ON checklist_responses(work_order_id);
CREATE INDEX IF NOT EXISTS idx_part_usage_wo ON part_usages(work_order_id);
CREATE INDEX IF NOT EXISTS idx_sr_wo ON service_reports(work_order_id);
CREATE INDEX IF NOT EXISTS idx_inv_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_inv_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_pay_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_hist_ticket ON ticket_status_history(ticket_id);
CREATE INDEX IF NOT EXISTS idx_timeline_ticket ON ticket_timeline(ticket_id);
CREATE INDEX IF NOT EXISTS idx_attach_ticket ON attachments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_attach_wo ON attachments(work_order_id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

-- Atomic sequence generator (pengganti nextNumber berbasis settings)
CREATE OR REPLACE FUNCTION next_number(p_prefix text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_key text;
  v_n integer;
  v_year integer := extract(year FROM now())::integer;
BEGIN
  v_key := 'seq:' || p_prefix || ':' || v_year;
  INSERT INTO settings (key, value) VALUES (v_key, '1')
  ON CONFLICT (key) DO UPDATE SET value = (settings.value::integer + 1)::text;
  SELECT value::integer INTO v_n FROM settings WHERE key = v_key;
  RETURN p_prefix || '-' || v_year || '-' || lpad(v_n::text, 6, '0');
END;
$$;
