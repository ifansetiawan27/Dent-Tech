'use strict';
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'sms.db'));

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','technician','customer')),
  phone TEXT DEFAULT '',
  customer_id TEXT,
  photo_path TEXT DEFAULT '',
  photo_mime TEXT DEFAULT '',
  active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  industry TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  city TEXT DEFAULT '',
  status TEXT DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_contacts (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  name TEXT NOT NULL,
  role TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  is_primary INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS equipment (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  name TEXT NOT NULL,
  category TEXT DEFAULT '',
  model TEXT DEFAULT '',
  serial_number TEXT DEFAULT '',
  location TEXT DEFAULT '',
  install_date TEXT DEFAULT '',
  warranty_until TEXT DEFAULT '',
  status TEXT DEFAULT 'OPERATIONAL',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  number TEXT UNIQUE NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  equipment_id TEXT REFERENCES equipment(id),
  equipment_type TEXT DEFAULT '',
  equipment_brand TEXT DEFAULT '',
  service_address TEXT DEFAULT '',
  contact_name TEXT DEFAULT '',
  contact_phone TEXT DEFAULT '',
  service_type TEXT DEFAULT '',
  priority TEXT DEFAULT 'MEDIUM',
  problem TEXT NOT NULL,
  description TEXT DEFAULT '',
  preferred_date TEXT DEFAULT '',
  preferred_time TEXT DEFAULT '',
  status TEXT DEFAULT 'OPEN',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS ticket_status_history (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  by_user TEXT,
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ticket_timeline (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  visibility TEXT DEFAULT 'CUSTOMER_VISIBLE',
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS work_orders (
  id TEXT PRIMARY KEY,
  number TEXT UNIQUE NOT NULL,
  ticket_id TEXT NOT NULL REFERENCES tickets(id),
  technician_id TEXT REFERENCES users(id),
  checklist_template_id TEXT,
  scheduled_date TEXT DEFAULT '',
  time_window TEXT DEFAULT '',
  status TEXT DEFAULT 'ASSIGNED',
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checklist_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  service_type TEXT DEFAULT '',
  equipment_category TEXT DEFAULT '',
  version TEXT DEFAULT '1.0',
  status TEXT DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checklist_template_items (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES checklist_templates(id),
  section TEXT NOT NULL,
  label TEXT NOT NULL,
  required INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS checklist_responses (
  id TEXT PRIMARY KEY,
  work_order_id TEXT NOT NULL REFERENCES work_orders(id),
  item_id TEXT NOT NULL,
  section TEXT NOT NULL,
  label TEXT NOT NULL,
  required INTEGER DEFAULT 1,
  result TEXT DEFAULT '',
  note TEXT DEFAULT '',
  updated_at TEXT NOT NULL,
  UNIQUE (work_order_id, item_id)
);

CREATE TABLE IF NOT EXISTS diagnoses (
  id TEXT PRIMARY KEY,
  work_order_id TEXT NOT NULL REFERENCES work_orders(id),
  findings TEXT DEFAULT '',
  root_cause TEXT DEFAULT '',
  recommendation TEXT DEFAULT '',
  visibility TEXT DEFAULT 'CUSTOMER_VISIBLE',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS work_performed (
  id TEXT PRIMARY KEY,
  work_order_id TEXT NOT NULL REFERENCES work_orders(id),
  description TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS parts (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT DEFAULT '',
  unit TEXT DEFAULT 'pcs',
  price REAL DEFAULT 0,
  stock REAL DEFAULT 0,
  min_stock REAL DEFAULT 0,
  status TEXT DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS part_usages (
  id TEXT PRIMARY KEY,
  work_order_id TEXT NOT NULL REFERENCES work_orders(id),
  part_id TEXT NOT NULL REFERENCES parts(id),
  qty REAL NOT NULL,
  unit_price REAL NOT NULL,
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT,
  work_order_id TEXT,
  kind TEXT DEFAULT 'other',
  file_path TEXT NOT NULL,
  file_name TEXT DEFAULT '',
  mime TEXT DEFAULT '',
  size INTEGER DEFAULT 0,
  caption TEXT DEFAULT '',
  visibility TEXT DEFAULT 'CUSTOMER_VISIBLE',
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS service_reports (
  id TEXT PRIMARY KEY,
  number TEXT UNIQUE NOT NULL,
  version INTEGER DEFAULT 1,
  work_order_id TEXT NOT NULL REFERENCES work_orders(id),
  summary TEXT DEFAULT '',
  technician_note TEXT DEFAULT '',
  status TEXT DEFAULT 'SUBMITTED',
  approved_at TEXT,
  approved_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  number TEXT UNIQUE NOT NULL,
  ticket_id TEXT REFERENCES tickets(id),
  work_order_id TEXT REFERENCES work_orders(id),
  customer_id TEXT REFERENCES customers(id),
  labor_cost REAL DEFAULT 0,
  discount REAL DEFAULT 0,
  tax_rate REAL DEFAULT 11,
  status TEXT DEFAULT 'SENT',
  type TEXT DEFAULT 'FINAL',
  issued_at TEXT NOT NULL,
  due_at TEXT DEFAULT '',
  paid_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  amount REAL NOT NULL,
  method TEXT DEFAULT 'TRANSFER',
  reference TEXT DEFAULT '',
  paid_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  role TEXT,
  customer_id TEXT,
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  type TEXT DEFAULT 'INFO',
  ref_type TEXT DEFAULT '',
  ref_id TEXT DEFAULT '',
  read_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  user_name TEXT DEFAULT '',
  role TEXT DEFAULT '',
  action TEXT NOT NULL,
  entity TEXT DEFAULT '',
  entity_id TEXT DEFAULT '',
  details TEXT DEFAULT '',
  ip TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tickets_customer ON tickets(customer_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_wo_ticket ON work_orders(ticket_id);
CREATE INDEX IF NOT EXISTS idx_wo_tech ON work_orders(technician_id);
CREATE INDEX IF NOT EXISTS idx_timeline_ticket ON ticket_timeline(ticket_id);
CREATE INDEX IF NOT EXISTS idx_attach_ticket ON attachments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_attach_wo ON attachments(work_order_id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
`);

// Idempotent migrations for databases created before these columns existed.
const MIGRATIONS = [
  "ALTER TABLE tickets ADD COLUMN equipment_type TEXT DEFAULT ''",
  "ALTER TABLE tickets ADD COLUMN equipment_brand TEXT DEFAULT ''",
  "ALTER TABLE tickets ADD COLUMN service_address TEXT DEFAULT ''",
  "ALTER TABLE users ADD COLUMN photo_path TEXT DEFAULT ''",
  "ALTER TABLE users ADD COLUMN photo_mime TEXT DEFAULT ''",
  "ALTER TABLE invoices ADD COLUMN type TEXT DEFAULT 'FINAL'"
];
for (const m of MIGRATIONS) {
  try { db.exec(m); } catch { /* column already exists */ }
}

module.exports = { db, DATA_DIR, UPLOADS_DIR };
