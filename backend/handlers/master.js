'use strict';
const { db } = require('../db');
const { uid, now, sendJSON, nextNumber, localDate } = require('../util');
const { audit, invoiceTotals } = require('./_common');

const PARTS_TOTAL_SUBQUERY = '(SELECT work_order_id, SUM(qty*unit_price) AS parts_total FROM part_usages GROUP BY work_order_id)';

// ---------------- Customers ----------------
async function listCustomersHandler(ctx) {
  const { search } = ctx.query;
  let sql = 'SELECT * FROM customers WHERE 1=1';
  const params = [];
  if (search) { sql += ' AND (name ILIKE ? OR code ILIKE ? OR city ILIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  sql += ' ORDER BY name ASC';
  const customers = await db.prepare(sql).all(...params);
  const tAgg = await db.query(`SELECT customer_id, COUNT(*) AS total_tickets,
      COUNT(*) FILTER (WHERE status NOT IN ('CLOSED','CANCELLED')) AS open_tickets,
      COUNT(*) FILTER (WHERE status = 'CLOSED') AS closed_tickets,
      MAX(created_at) AS last_ticket_at
    FROM tickets GROUP BY customer_id`);
  const iAgg = await db.query(`SELECT i.customer_id, COUNT(*) AS invoice_count,
      COUNT(*) FILTER (WHERE i.status = 'PAID') AS paid_invoices,
      COUNT(*) FILTER (WHERE i.status IN ('SENT','OVERDUE')) AS unpaid_invoices,
      COALESCE(SUM((i.labor_cost + COALESCE(pu.parts_total,0) - i.discount) * (1 + i.tax_rate/100.0)) FILTER (WHERE i.status = 'PAID'), 0)::float8 AS paid_total,
      COALESCE(SUM((i.labor_cost + COALESCE(pu.parts_total,0) - i.discount) * (1 + i.tax_rate/100.0)) FILTER (WHERE i.status IN ('SENT','OVERDUE')), 0)::float8 AS outstanding
    FROM invoices i
    LEFT JOIN ${PARTS_TOTAL_SUBQUERY} pu ON pu.work_order_id = i.work_order_id
    GROUP BY i.customer_id`);
  const tMap = new Map(tAgg.map((r) => [r.customer_id, r]));
  const iMap = new Map(iAgg.map((r) => [r.customer_id, r]));
  for (const c of customers) {
    c.equipment_count = (await db.prepare('SELECT COUNT(*) AS c FROM equipment WHERE customer_id = ?').get(c.id)).c;
    c.contacts = await db.prepare('SELECT * FROM customer_contacts WHERE customer_id = ? ORDER BY is_primary DESC').all(c.id);
    const t = tMap.get(c.id);
    c.total_tickets = t ? t.total_tickets : 0;
    c.open_tickets = t ? t.open_tickets : 0;
    c.closed_tickets = t ? t.closed_tickets : 0;
    c.last_ticket_at = t ? t.last_ticket_at : null;
    const i = iMap.get(c.id);
    c.invoice_count = i ? i.invoice_count : 0;
    c.paid_total = i ? Math.round(i.paid_total) : 0;
    c.outstanding = i ? Math.round(i.outstanding) : 0;
  }
  sendJSON(ctx.res, 200, { customers });
}

async function createCustomerHandler(ctx) {
  const { name, industry = '', phone = '', email = '', address = '', city = '', contacts = [] } = ctx.body;
  if (!name) return sendJSON(ctx.res, 400, { error: 'Nama customer wajib diisi' });
  const id = uid();
  const code = 'CUS-' + String((await nextNumber('CUS')).split('-')[2]);
  await db.prepare('INSERT INTO customers (id, code, name, industry, phone, email, address, city, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, code, name, industry, phone, email, address, city, 'ACTIVE', now());
  for (const ct of contacts) {
    if (!ct.name) continue;
    await db.prepare('INSERT INTO customer_contacts (id, customer_id, name, role, phone, email, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(uid(), id, ct.name, ct.role || '', ct.phone || '', ct.email || '', ct.is_primary ? 1 : 0);
  }
  audit(ctx.user, 'CREATE', 'customer', id, `Membuat customer ${name}`, ctx.ip);
  sendJSON(ctx.res, 201, { id, code });
}

async function getCustomerHandler(ctx) {
  const id = ctx.params.id;
  const c = await db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!c) return sendJSON(ctx.res, 404, { error: 'Customer tidak ditemukan' });
  if (ctx.user.role === 'customer' && ctx.user.customer_id !== id) return sendJSON(ctx.res, 403, { error: 'Tidak memiliki akses' });
  c.contacts = await db.prepare('SELECT * FROM customer_contacts WHERE customer_id = ? ORDER BY is_primary DESC').all(id);
  c.equipment = await db.prepare('SELECT * FROM equipment WHERE customer_id = ? ORDER BY created_at DESC').all(id);
  if (ctx.user.role === 'admin') {
    const today = localDate();
    let warrantyActive = 0;
    for (const eq of c.equipment) {
      eq.under_warranty = !!(eq.warranty_until && eq.warranty_until >= today);
      if (eq.under_warranty) warrantyActive++;
    }
    const tAgg = await db.prepare(`SELECT COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status NOT IN ('CLOSED','CANCELLED')) AS active,
        COUNT(*) FILTER (WHERE status = 'CLOSED') AS closed,
        COUNT(*) FILTER (WHERE status = 'CANCELLED') AS cancelled
      FROM tickets WHERE customer_id = ?`).get(id);
    const invoices = await db.prepare(`SELECT i.id, i.number, i.type, i.status, i.labor_cost, i.discount, i.tax_rate, i.issued_at, i.due_at,
        COALESCE(pu.parts_total, 0) AS parts_total
      FROM invoices i
      LEFT JOIN ${PARTS_TOTAL_SUBQUERY} pu ON pu.work_order_id = i.work_order_id
      WHERE i.customer_id = ? ORDER BY i.issued_at DESC`).all(id);
    let paidTotal = 0;
    let outstanding = 0;
    for (const inv of invoices) {
      inv.total = invoiceTotals(inv, inv.parts_total).total;
      if (inv.status === 'PAID') paidTotal += inv.total;
      else if (inv.status === 'SENT' || inv.status === 'OVERDUE') outstanding += inv.total;
      delete inv.labor_cost; delete inv.discount; delete inv.tax_rate; delete inv.parts_total;
    }
    c.summary = {
      tickets: { total: tAgg.total, active: tAgg.active, closed: tAgg.closed, cancelled: tAgg.cancelled },
      equipment_count: c.equipment.length,
      warranty_active: warrantyActive,
      billing: { invoice_count: invoices.length, paid_total: paidTotal, outstanding }
    };
    c.recent_tickets = await db.prepare(
      'SELECT id, number, service_type, equipment_type, priority, status, created_at FROM tickets WHERE customer_id = ? ORDER BY created_at DESC LIMIT 8'
    ).all(id);
    c.invoices = invoices;
  }
  sendJSON(ctx.res, 200, { customer: c });
}

async function updateCustomerHandler(ctx) {
  const c = await db.prepare('SELECT * FROM customers WHERE id = ?').get(ctx.params.id);
  if (!c) return sendJSON(ctx.res, 404, { error: 'Customer tidak ditemukan' });
  const { name, industry, phone, email, address, city, status, contacts } = ctx.body;
  if (name !== undefined) await db.prepare('UPDATE customers SET name = ? WHERE id = ?').run(name, c.id);
  if (industry !== undefined) await db.prepare('UPDATE customers SET industry = ? WHERE id = ?').run(industry, c.id);
  if (phone !== undefined) await db.prepare('UPDATE customers SET phone = ? WHERE id = ?').run(phone, c.id);
  if (email !== undefined) await db.prepare('UPDATE customers SET email = ? WHERE id = ?').run(email, c.id);
  if (address !== undefined) await db.prepare('UPDATE customers SET address = ? WHERE id = ?').run(address, c.id);
  if (city !== undefined) await db.prepare('UPDATE customers SET city = ? WHERE id = ?').run(city, c.id);
  if (status !== undefined) await db.prepare('UPDATE customers SET status = ? WHERE id = ?').run(status, c.id);
  if (Array.isArray(contacts)) {
    await db.prepare('DELETE FROM customer_contacts WHERE customer_id = ?').run(c.id);
    for (const ct of contacts) {
      if (!ct.name) continue;
      await db.prepare('INSERT INTO customer_contacts (id, customer_id, name, role, phone, email, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(uid(), c.id, ct.name, ct.role || '', ct.phone || '', ct.email || '', ct.is_primary ? 1 : 0);
    }
  }
  audit(ctx.user, 'UPDATE', 'customer', c.id, `Memperbarui customer ${c.name}`, ctx.ip);
  sendJSON(ctx.res, 200, { ok: true });
}

async function deleteCustomerHandler(ctx) {
  const c = await db.prepare('SELECT * FROM customers WHERE id = ?').get(ctx.params.id);
  if (!c) return sendJSON(ctx.res, 404, { error: 'Customer tidak ditemukan' });
  const tickets = (await db.prepare('SELECT COUNT(*) AS c FROM tickets WHERE customer_id = ?').get(c.id)).c;
  if (tickets > 0) return sendJSON(ctx.res, 409, { error: 'Customer memiliki riwayat ticket dan tidak dapat dihapus' });
  await db.prepare('DELETE FROM customer_contacts WHERE customer_id = ?').run(c.id);
  await db.prepare('DELETE FROM equipment WHERE customer_id = ?').run(c.id);
  await db.prepare('DELETE FROM users WHERE customer_id = ? AND role = ?').run(c.id, 'customer');
  await db.prepare('DELETE FROM customers WHERE id = ?').run(c.id);
  audit(ctx.user, 'DELETE', 'customer', c.id, `Menghapus customer ${c.name}`, ctx.ip);
  sendJSON(ctx.res, 200, { ok: true });
}

// ---------------- Equipment ----------------
async function listEquipmentHandler(ctx) {
  const { customer_id, search } = ctx.query;
  let sql = `SELECT e.*, c.name AS customer_name FROM equipment e JOIN customers c ON c.id = e.customer_id`;
  const params = [];
  const where = [];
  if (ctx.user.role === 'customer') where.push('e.customer_id = ?'), params.push(ctx.user.customer_id);
  else if (customer_id) where.push('e.customer_id = ?'), params.push(customer_id);
  if (search) where.push('(e.name ILIKE ? OR e.serial_number ILIKE ? OR e.model ILIKE ?)'), params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY e.created_at DESC';
  const equipment = await db.prepare(sql).all(...params);
  for (const e of equipment) {
    e.service_count = (await db.prepare('SELECT COUNT(*) AS c FROM tickets WHERE equipment_id = ?').get(e.id)).c;
    e.last_service = (await db.prepare("SELECT created_at FROM tickets WHERE equipment_id = ? ORDER BY created_at DESC LIMIT 1").get(e.id))?.created_at || null;
  }
  sendJSON(ctx.res, 200, { equipment });
}

async function createEquipmentHandler(ctx) {
  const { customer_id, name, category = '', model = '', serial_number = '', location = '', install_date = '', warranty_until = '', status = 'OPERATIONAL' } = ctx.body;
  if (!customer_id || !name) return sendJSON(ctx.res, 400, { error: 'Customer dan nama equipment wajib diisi' });
  const c = await db.prepare('SELECT id FROM customers WHERE id = ?').get(customer_id);
  if (!c) return sendJSON(ctx.res, 400, { error: 'Customer tidak ditemukan' });
  const id = uid();
  await db.prepare('INSERT INTO equipment (id, customer_id, name, category, model, serial_number, location, install_date, warranty_until, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, customer_id, name, category, model, serial_number, location, install_date, warranty_until, status, now());
  audit(ctx.user, 'CREATE', 'equipment', id, `Menambah equipment ${name}`, ctx.ip);
  sendJSON(ctx.res, 201, { id });
}

async function getEquipmentHandler(ctx) {
  const e = await db.prepare('SELECT e.*, c.name AS customer_name FROM equipment e JOIN customers c ON c.id = e.customer_id WHERE e.id = ?').get(ctx.params.id);
  if (!e) return sendJSON(ctx.res, 404, { error: 'Equipment tidak ditemukan' });
  if (ctx.user.role === 'customer' && e.customer_id !== ctx.user.customer_id) return sendJSON(ctx.res, 403, { error: 'Tidak memiliki akses' });
  let histSql = `SELECT t.id, t.number, t.service_type, t.priority, t.problem, t.status, t.created_at, t.closed_at, u.name AS technician_name
    FROM tickets t LEFT JOIN work_orders wo ON wo.ticket_id = t.id LEFT JOIN users u ON u.id = wo.technician_id WHERE t.equipment_id = ?`;
  if (ctx.user.role === 'customer') histSql += ` AND t.status != 'CANCELLED'`;
  histSql += ' ORDER BY t.created_at DESC';
  e.service_history = await db.prepare(histSql).all(e.id);
  sendJSON(ctx.res, 200, { equipment: e });
}

async function updateEquipmentHandler(ctx) {
  const e = await db.prepare('SELECT * FROM equipment WHERE id = ?').get(ctx.params.id);
  if (!e) return sendJSON(ctx.res, 404, { error: 'Equipment tidak ditemukan' });
  const fields = ['name', 'category', 'model', 'serial_number', 'location', 'install_date', 'warranty_until', 'status'];
  for (const f of fields) {
    if (ctx.body[f] !== undefined) await db.prepare(`UPDATE equipment SET ${f} = ? WHERE id = ?`).run(ctx.body[f], e.id);
  }
  audit(ctx.user, 'UPDATE', 'equipment', e.id, `Memperbarui equipment ${e.name}`, ctx.ip);
  sendJSON(ctx.res, 200, { ok: true });
}

async function deleteEquipmentHandler(ctx) {
  const e = await db.prepare('SELECT * FROM equipment WHERE id = ?').get(ctx.params.id);
  if (!e) return sendJSON(ctx.res, 404, { error: 'Equipment tidak ditemukan' });
  const tickets = (await db.prepare('SELECT COUNT(*) AS c FROM tickets WHERE equipment_id = ?').get(e.id)).c;
  if (tickets > 0) return sendJSON(ctx.res, 409, { error: 'Equipment memiliki riwayat service dan tidak dapat dihapus' });
  await db.prepare('DELETE FROM equipment WHERE id = ?').run(e.id);
  audit(ctx.user, 'DELETE', 'equipment', e.id, `Menghapus equipment ${e.name}`, ctx.ip);
  sendJSON(ctx.res, 200, { ok: true });
}

// ---------------- Spare Parts ----------------
async function listPartsHandler(ctx) {
  const { search, low } = ctx.query;
  let sql = 'SELECT * FROM parts WHERE 1=1';
  const params = [];
  if (search) { sql += ' AND (name ILIKE ? OR code ILIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  if (low === '1') sql += ' AND stock <= min_stock';
  sql += ' ORDER BY name ASC';
  const parts = await db.prepare(sql).all(...params);
  for (const p of parts) {
    p.used_total = (await db.prepare('SELECT COALESCE(SUM(qty),0) AS c FROM part_usages WHERE part_id = ?').get(p.id)).c;
  }
  sendJSON(ctx.res, 200, { parts });
}

async function createPartHandler(ctx) {
  const { name, category = '', unit = 'pcs', price = 0, cost = 0, stock = 0, min_stock = 0 } = ctx.body;
  if (!name) return sendJSON(ctx.res, 400, { error: 'Nama spare part wajib diisi' });
  const id = uid();
  const code = 'PRT-' + String((await nextNumber('PRT')).split('-')[2]);
  await db.prepare('INSERT INTO parts (id, code, name, category, unit, price, cost, stock, min_stock, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, code, name, category, unit, Number(price) || 0, Number(cost) || 0, Number(stock) || 0, Number(min_stock) || 0, 'ACTIVE', now());
  audit(ctx.user, 'CREATE', 'part', id, `Menambah spare part ${name}`, ctx.ip);
  sendJSON(ctx.res, 201, { id, code });
}

async function updatePartHandler(ctx) {
  const p = await db.prepare('SELECT * FROM parts WHERE id = ?').get(ctx.params.id);
  if (!p) return sendJSON(ctx.res, 404, { error: 'Spare part tidak ditemukan' });
  const fields = ['name', 'category', 'unit', 'price', 'cost', 'stock', 'min_stock', 'status'];
  for (const f of fields) {
    if (ctx.body[f] !== undefined) await db.prepare(`UPDATE parts SET ${f} = ? WHERE id = ?`).run(ctx.body[f], p.id);
  }
  audit(ctx.user, 'UPDATE', 'part', p.id, `Memperbarui spare part ${p.name}`, ctx.ip);
  sendJSON(ctx.res, 200, { ok: true });
}

async function adjustStockHandler(ctx) {
  const p = await db.prepare('SELECT * FROM parts WHERE id = ?').get(ctx.params.id);
  if (!p) return sendJSON(ctx.res, 404, { error: 'Spare part tidak ditemukan' });
  const delta = Number(ctx.body.delta) || 0;
  if (!delta) return sendJSON(ctx.res, 400, { error: 'Jumlah penyesuaian tidak valid' });
  const newStock = p.stock + delta;
  if (newStock < 0) return sendJSON(ctx.res, 400, { error: 'Stok tidak boleh negatif' });

  const recordExpense = delta > 0 && ctx.body.record_expense === true;
  const unitCost = Number(ctx.body.unit_cost) || Number(p.cost) || 0;
  const expenseDate = ctx.body.expense_date || localDate();
  const reason = String(ctx.body.reason || '').trim();
  if (recordExpense && unitCost <= 0) return sendJSON(ctx.res, 400, { error: 'Harga beli wajib diisi untuk mencatat pengeluaran' });
  if (recordExpense && !/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) return sendJSON(ctx.res, 400, { error: 'Tanggal pembelian tidak valid' });

  let expenseId = null;
  await db.transaction(async (tx) => {
    await tx.prepare('UPDATE parts SET stock = ?, cost = CASE WHEN ? THEN ? ELSE cost END WHERE id = ?')
      .run(newStock, recordExpense, unitCost, p.id);
    if (recordExpense) {
      expenseId = uid();
      const amount = Math.round(delta * unitCost * 100) / 100;
      await tx.prepare('INSERT INTO expenses (id, category, description, part_id, qty, unit_cost, amount, restocked, expense_date, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run(expenseId, 'SPARE_PART', reason || `Pembelian ${p.name}`, p.id, delta, unitCost, amount, 1, expenseDate, ctx.user.id, now());
    }
  });
  audit(ctx.user, 'UPDATE', 'part', p.id, `Penyesuaian stok ${p.name}: ${delta > 0 ? '+' : ''}${delta} → ${newStock}${expenseId ? ' · tercatat di Finance' : ''}`, ctx.ip);
  sendJSON(ctx.res, 200, { ok: true, stock: newStock, expense_id: expenseId });
}

// ---------------- Checklist Templates ----------------
async function templateWithItems(id) {
  const tpl = await db.prepare('SELECT * FROM checklist_templates WHERE id = ?').get(id);
  if (!tpl) return null;
  tpl.items = await db.prepare('SELECT * FROM checklist_template_items WHERE template_id = ? ORDER BY sort_order').all(id);
  return tpl;
}

async function listTemplatesHandler(ctx) {
  const templates = await db.prepare('SELECT * FROM checklist_templates ORDER BY created_at DESC').all();
  for (const t of templates) {
    t.item_count = (await db.prepare('SELECT COUNT(*) AS c FROM checklist_template_items WHERE template_id = ?').get(t.id)).c;
  }
  sendJSON(ctx.res, 200, { templates });
}

async function getTemplateHandler(ctx) {
  const tpl = await templateWithItems(ctx.params.id);
  if (!tpl) return sendJSON(ctx.res, 404, { error: 'Template tidak ditemukan' });
  sendJSON(ctx.res, 200, { template: tpl });
}

async function saveTemplateItems(templateId, sections) {
  await db.prepare('DELETE FROM checklist_template_items WHERE template_id = ?').run(templateId);
  let sort = 0;
  for (const sec of sections || []) {
    for (const item of sec.items || []) {
      if (!item.label) continue;
      await db.prepare('INSERT INTO checklist_template_items (id, template_id, section, label, required, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
        .run(uid(), templateId, sec.section || 'Umum', item.label, item.required === false ? 0 : 1, ++sort);
    }
  }
}

async function createTemplateHandler(ctx) {
  const { name, service_type = '', equipment_category = '', version = '1.0', sections = [] } = ctx.body;
  if (!name) return sendJSON(ctx.res, 400, { error: 'Nama template wajib diisi' });
  if (!sections.length) return sendJSON(ctx.res, 400, { error: 'Template minimal memiliki satu section dengan item' });
  const id = uid();
  await db.prepare('INSERT INTO checklist_templates (id, name, service_type, equipment_category, version, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, name, service_type, equipment_category, version, 'ACTIVE', now());
  await saveTemplateItems(id, sections);
  audit(ctx.user, 'CREATE', 'checklist_template', id, `Membuat checklist template ${name} v${version}`, ctx.ip);
  sendJSON(ctx.res, 201, { id });
}

async function updateTemplateHandler(ctx) {
  const tpl = await db.prepare('SELECT * FROM checklist_templates WHERE id = ?').get(ctx.params.id);
  if (!tpl) return sendJSON(ctx.res, 404, { error: 'Template tidak ditemukan' });
  const { name, service_type, equipment_category, version, status, sections } = ctx.body;
  if (name !== undefined) await db.prepare('UPDATE checklist_templates SET name = ? WHERE id = ?').run(name, tpl.id);
  if (service_type !== undefined) await db.prepare('UPDATE checklist_templates SET service_type = ? WHERE id = ?').run(service_type, tpl.id);
  if (equipment_category !== undefined) await db.prepare('UPDATE checklist_templates SET equipment_category = ? WHERE id = ?').run(equipment_category, tpl.id);
  if (version !== undefined) await db.prepare('UPDATE checklist_templates SET version = ? WHERE id = ?').run(version, tpl.id);
  if (status !== undefined) await db.prepare('UPDATE checklist_templates SET status = ? WHERE id = ?').run(status, tpl.id);
  if (Array.isArray(sections)) await saveTemplateItems(tpl.id, sections);
  audit(ctx.user, 'UPDATE', 'checklist_template', tpl.id, `Memperbarui checklist template ${tpl.name}`, ctx.ip);
  sendJSON(ctx.res, 200, { ok: true });
}

async function duplicateTemplateHandler(ctx) {
  const tpl = await templateWithItems(ctx.params.id);
  if (!tpl) return sendJSON(ctx.res, 404, { error: 'Template tidak ditemukan' });
  const id = uid();
  const newVersion = String((parseFloat(tpl.version) + 0.1).toFixed(1));
  await db.prepare('INSERT INTO checklist_templates (id, name, service_type, equipment_category, version, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, tpl.name, tpl.service_type, tpl.equipment_category, newVersion, 'ACTIVE', now());
  let sort = 0;
  for (const item of tpl.items) {
    await db.prepare('INSERT INTO checklist_template_items (id, template_id, section, label, required, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uid(), id, item.section, item.label, item.required, ++sort);
  }
  audit(ctx.user, 'CREATE', 'checklist_template', id, `Duplikasi template ${tpl.name} → v${newVersion}`, ctx.ip);
  sendJSON(ctx.res, 201, { id, version: newVersion });
}

module.exports = {
  listCustomersHandler, createCustomerHandler, getCustomerHandler, updateCustomerHandler, deleteCustomerHandler,
  listEquipmentHandler, createEquipmentHandler, getEquipmentHandler, updateEquipmentHandler, deleteEquipmentHandler,
  listPartsHandler, createPartHandler, updatePartHandler, adjustStockHandler,
  listTemplatesHandler, getTemplateHandler, createTemplateHandler, updateTemplateHandler, duplicateTemplateHandler
};
