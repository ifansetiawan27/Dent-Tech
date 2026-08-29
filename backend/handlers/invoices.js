'use strict';
const { db } = require('../db');
const { uid, now, sendJSON, nextNumber, fileSig, localDate, getSetting, setSetting } = require('../util');
const { audit, timeline, notify, partTotalForWorkOrder, invoiceTotals, getTicket, buildChecklistState } = require('./_common');

function attachmentWithUrl(a) {
  const sig = fileSig(a.id);
  return { ...a, url: `/api/files/${a.id}?exp=${sig.exp}&sig=${sig.sig}` };
}

async function invoiceDetail(inv, user) {
  const parts = await partTotalForWorkOrder(inv.work_order_id);
  const totals = invoiceTotals(inv, parts);
  const items = await db.prepare(
    'SELECT pu.*, p.name AS part_name, p.code AS part_code, p.unit FROM part_usages pu JOIN parts p ON p.id = pu.part_id WHERE pu.work_order_id = ? ORDER BY pu.created_at'
  ).all(inv.work_order_id);
  const customer = await db.prepare('SELECT id, code, name, address, city, phone, email FROM customers WHERE id = ?').get(inv.customer_id);
  const payments = await db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_at').all(inv.id);
  const wo = inv.work_order_id ? await db.prepare('SELECT * FROM work_orders WHERE id = ?').get(inv.work_order_id) : null;
  const ticket = inv.ticket_id ? await db.prepare('SELECT number, problem, service_type FROM tickets WHERE id = ?').get(inv.ticket_id) : null;

  let evidence = { photos: [], checklist: null, diagnosis: null };
  if (wo) {
    const rawPhotos = await db.prepare('SELECT * FROM attachments WHERE work_order_id = ? ORDER BY created_at').all(wo.id);
    const visible = (user && user.role === 'customer') ? rawPhotos.filter((p) => p.visibility !== 'INTERNAL') : rawPhotos;
    evidence.photos = visible.map(attachmentWithUrl);
    evidence.checklist = await buildChecklistState(wo);
    evidence.diagnosis = (await db.prepare('SELECT findings, root_cause, recommendation FROM diagnoses WHERE work_order_id = ? ORDER BY updated_at DESC LIMIT 1').get(wo.id)) || null;
  }

  return {
    invoice: inv, totals, items, customer, payments,
    payment_account: await readBankSettings(),
    work_order: wo ? { id: wo.id, number: wo.number, scheduled_date: wo.scheduled_date } : null,
    ticket, evidence
  };
}

async function listInvoicesHandler(ctx) {
  const { status, customer_id, type } = ctx.query;
  const where = [];
  const params = [];
  if (ctx.user.role === 'customer') where.push('i.customer_id = ?'), params.push(ctx.user.customer_id);
  else if (customer_id) where.push('i.customer_id = ?'), params.push(customer_id);
  if (status) where.push('i.status = ?'), params.push(status);
  if (type) where.push('i.type = ?'), params.push(type);
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const rows = await db.prepare(
    `SELECT i.*, c.name AS customer_name, t.number AS ticket_number, wo.number AS wo_number
     FROM invoices i
     LEFT JOIN customers c ON c.id = i.customer_id
     LEFT JOIN tickets t ON t.id = i.ticket_id
     LEFT JOIN work_orders wo ON wo.id = i.work_order_id
     ${whereSql} ORDER BY i.created_at DESC`
  ).all(...params);
  for (const inv of rows) {
    inv.totals = invoiceTotals(inv, await partTotalForWorkOrder(inv.work_order_id));
  }
  sendJSON(ctx.res, 200, { invoices: rows });
}

async function getInvoiceHandler(ctx) {
  const inv = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(ctx.params.id);
  if (!inv) return sendJSON(ctx.res, 404, { error: 'Invoice tidak ditemukan' });
  if (ctx.user.role === 'customer' && inv.customer_id !== ctx.user.customer_id) return sendJSON(ctx.res, 403, { error: 'Tidak memiliki akses' });
  sendJSON(ctx.res, 200, await invoiceDetail(inv, ctx.user));
}

async function updateInvoiceHandler(ctx) {
  const inv = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(ctx.params.id);
  if (!inv) return sendJSON(ctx.res, 404, { error: 'Invoice tidak ditemukan' });
  if (inv.status === 'PAID') return sendJSON(ctx.res, 400, { error: 'Invoice sudah dibayar' });
  const { labor_cost, discount, tax_rate, due_at } = ctx.body;
  if (labor_cost !== undefined && Number(labor_cost) < 0) return sendJSON(ctx.res, 400, { error: 'Biaya jasa tidak boleh negatif' });
  if (labor_cost !== undefined) await db.prepare('UPDATE invoices SET labor_cost = ? WHERE id = ?').run(Number(labor_cost), inv.id);
  if (discount !== undefined && Number(discount) >= 0) await db.prepare('UPDATE invoices SET discount = ? WHERE id = ?').run(Number(discount), inv.id);
  if (tax_rate !== undefined && Number(tax_rate) >= 0) await db.prepare('UPDATE invoices SET tax_rate = ? WHERE id = ?').run(Number(tax_rate), inv.id);
  if (due_at !== undefined) await db.prepare('UPDATE invoices SET due_at = ? WHERE id = ?').run(due_at, inv.id);
  audit(ctx.user, 'UPDATE', 'invoice', inv.id, `Memperbarui invoice ${inv.number}`, ctx.ip);
  sendJSON(ctx.res, 200, { ok: true });
}

async function payInvoiceHandler(ctx) {
  const inv = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(ctx.params.id);
  if (!inv) return sendJSON(ctx.res, 404, { error: 'Invoice tidak ditemukan' });
  if (ctx.user.role === 'customer' && inv.customer_id !== ctx.user.customer_id) return sendJSON(ctx.res, 403, { error: 'Tidak memiliki akses' });
  if (inv.status === 'PAID') return sendJSON(ctx.res, 400, { error: 'Invoice sudah dibayar' });
  const totals = invoiceTotals(inv, await partTotalForWorkOrder(inv.work_order_id));
  const { method = 'TRANSFER', reference = '' } = ctx.body;
  await db.prepare('INSERT INTO payments (id, invoice_id, amount, method, reference, paid_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uid(), inv.id, totals.total, method, reference, now());
  await db.prepare("UPDATE invoices SET status = 'PAID', paid_at = ? WHERE id = ?").run(now(), inv.id);
  if (inv.ticket_id) {
    const t = await getTicket(inv.ticket_id);
    if (t) timeline(t.id, 'PAYMENT', `Invoice ${inv.number} dibayar`, `Pembayaran ${method} ${reference}`.trim(), 'CUSTOMER_VISIBLE', ctx.user.id);
    notify({ role: 'admin', title: `Invoice ${inv.number} dibayar`, body: `Rp ${totals.total.toLocaleString('id-ID')} via ${method}`, type: 'INVOICE', ref_type: 'invoice', ref_id: inv.id });
  }
  audit(ctx.user, 'UPDATE', 'invoice', inv.id, `Pembayaran invoice ${inv.number} Rp ${totals.total}`, ctx.ip);
  sendJSON(ctx.res, 200, { ok: true, paid_amount: totals.total });
}

// ---------- Invoice settings (PPN / Non-PPN, default labor, rekening pembayaran) ----------
async function readBankSettings() {
  return {
    bank_name: await getSetting('invoice_bank_name', ''),
    bank_account_name: await getSetting('invoice_bank_account_name', ''),
    bank_account_number: await getSetting('invoice_bank_account_number', '')
  };
}

async function getInvoiceSettingsHandler(ctx) {
  sendJSON(ctx.res, 200, {
    tax_mode: await getSetting('invoice_tax_mode', 'PPN'),
    default_labor: Number(await getSetting('invoice_default_labor', '500000')),
    ...(await readBankSettings())
  });
}

async function updateInvoiceSettingsHandler(ctx) {
  const { tax_mode, default_labor, bank_name, bank_account_name, bank_account_number } = ctx.body;
  if (tax_mode !== undefined) {
    if (!['PPN', 'NON_PPN'].includes(tax_mode)) return sendJSON(ctx.res, 400, { error: 'Mode PPN tidak valid' });
    await setSetting('invoice_tax_mode', tax_mode);
  }
  if (default_labor !== undefined) {
    const v = Number(default_labor);
    if (isNaN(v) || v < 0) return sendJSON(ctx.res, 400, { error: 'Biaya jasa default tidak valid' });
    await setSetting('invoice_default_labor', String(v));
  }
  if (bank_name !== undefined) await setSetting('invoice_bank_name', String(bank_name).trim().slice(0, 100));
  if (bank_account_name !== undefined) await setSetting('invoice_bank_account_name', String(bank_account_name).trim().slice(0, 100));
  if (bank_account_number !== undefined) await setSetting('invoice_bank_account_number', String(bank_account_number).trim().slice(0, 50));
  audit(ctx.user, 'UPDATE', 'settings', 'invoice', 'Memperbarui pengaturan invoice', ctx.ip);
  sendJSON(ctx.res, 200, {
    ok: true,
    tax_mode: await getSetting('invoice_tax_mode', 'PPN'),
    default_labor: Number(await getSetting('invoice_default_labor', '500000')),
    ...(await readBankSettings())
  });
}

// ---------- Proforma Invoice ----------
async function createProformaHandler(ctx) {
  const { work_order_id, labor_cost, due_days = 14 } = ctx.body;
  if (!work_order_id) return sendJSON(ctx.res, 400, { error: 'work_order_id wajib diisi' });
  const wo = await db.prepare('SELECT * FROM work_orders WHERE id = ?').get(work_order_id);
  if (!wo) return sendJSON(ctx.res, 404, { error: 'Work order tidak ditemukan' });
  if (!['COMPLETED', 'APPROVED'].includes(wo.status)) return sendJSON(ctx.res, 400, { error: 'Proforma hanya bisa dibuat setelah pekerjaan selesai' });
  const t = await getTicket(wo.ticket_id);
  const existing = await db.prepare("SELECT id, number FROM invoices WHERE work_order_id = ? AND type = 'PROFORMA' AND status != 'PAID'").get(wo.id);
  if (existing) return sendJSON(ctx.res, 409, { error: `Proforma ${existing.number} sudah ada untuk work order ini` });

  const labor = labor_cost !== undefined ? Number(labor_cost) : Number(await getSetting('invoice_default_labor', '500000'));
  const taxRate = (await getSetting('invoice_tax_mode', 'PPN')) === 'NON_PPN' ? 0 : 11;
  const invId = uid();
  const invNumber = await nextNumber('PI');
  const issued = now();
  const due = localDate(new Date(Date.now() + (Number(due_days) || 14) * 24 * 3600 * 1000));
  await db.prepare(`INSERT INTO invoices (id, number, ticket_id, work_order_id, customer_id, labor_cost, discount, tax_rate, status, type, issued_at, due_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'SENT', 'PROFORMA', ?, ?, ?)`)
    .run(invId, invNumber, t ? t.id : null, wo.id, t.customer_id, labor, taxRate, issued, due, issued);
  const inv = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(invId);
  const totals = invoiceTotals(inv, await partTotalForWorkOrder(wo.id));
  if (t) {
    timeline(t.id, 'STATUS', `Proforma Invoice ${invNumber} diterbitkan`, `Penagihan ke customer (Total Rp ${totals.total.toLocaleString('id-ID')})`, 'CUSTOMER_VISIBLE', ctx.user.id);
    notify({ customer_id: t.customer_id, title: `Proforma Invoice ${invNumber} diterbitkan`, body: `Total Rp ${totals.total.toLocaleString('id-ID')} · Jatuh tempo ${due}`, type: 'INVOICE', ref_type: 'invoice', ref_id: invId });
  }
  audit(ctx.user, 'CREATE', 'invoice', invId, `Membuat proforma invoice ${invNumber}`, ctx.ip);
  sendJSON(ctx.res, 201, { id: invId, number: invNumber });
}

module.exports = {
  listInvoicesHandler, getInvoiceHandler, updateInvoiceHandler, payInvoiceHandler,
  getInvoiceSettingsHandler, updateInvoiceSettingsHandler, createProformaHandler
};
