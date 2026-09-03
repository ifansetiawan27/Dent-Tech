'use strict';
const { db } = require('../db');
const { uid, now, sendJSON, nextNumber, fileSig, localDate, getSetting } = require('../util');
const {
  audit, timeline, getTicket, getWorkOrder,
  notify, getInvoiceItems, snapshotWorkOrderInvoiceItems, invoiceTotals
} = require('./_common');

async function reportDetail(r) {
  const wo = await db.prepare(
    `SELECT wo.*, t.number AS ticket_number, t.problem, t.service_type, c.name AS customer_name, e.name AS equipment_name, u.name AS technician_name
     FROM work_orders wo JOIN tickets t ON t.id = wo.ticket_id JOIN customers c ON c.id = t.customer_id
     LEFT JOIN equipment e ON e.id = t.equipment_id LEFT JOIN users u ON u.id = wo.technician_id WHERE wo.id = ?`
  ).get(r.work_order_id);
  const diagnosis = (await db.prepare('SELECT * FROM diagnoses WHERE work_order_id = ?').get(r.work_order_id)) || null;
  const workPerformed = await db.prepare('SELECT * FROM work_performed WHERE work_order_id = ? ORDER BY created_at').all(r.work_order_id);
  const partUsages = await db.prepare(
    'SELECT pu.*, p.name AS part_name, p.unit FROM part_usages pu JOIN parts p ON p.id = pu.part_id WHERE pu.work_order_id = ?'
  ).all(r.work_order_id);
  const photos = (await db.prepare('SELECT * FROM attachments WHERE work_order_id = ? ORDER BY created_at').all(r.work_order_id))
    .map((a) => { const sig = fileSig(a.id); return { ...a, url: `/api/files/${a.id}?exp=${sig.exp}&sig=${sig.sig}` }; });
  return { report: r, work_order: wo, diagnosis, work_performed: workPerformed, part_usages: partUsages, photos };
}

async function listReportsHandler(ctx) {
  const { status } = ctx.query;
  const where = [];
  const params = [];
  if (ctx.user.role === 'technician') where.push('wo.technician_id = ?'), params.push(ctx.user.id);
  if (ctx.user.role === 'customer') where.push('t.customer_id = ?'), params.push(ctx.user.customer_id);
  if (status) where.push('sr.status = ?'), params.push(status);
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
  let rows = await db.prepare(
    `SELECT sr.*, wo.number AS wo_number, wo.scheduled_date, t.number AS ticket_number, t.problem,
       c.name AS customer_name, u.name AS technician_name
     FROM service_reports sr
     JOIN work_orders wo ON wo.id = sr.work_order_id
     JOIN tickets t ON t.id = wo.ticket_id
     JOIN customers c ON c.id = t.customer_id
     LEFT JOIN users u ON u.id = wo.technician_id
     ${whereSql} ORDER BY sr.created_at DESC`
  ).all(...params);
  if (ctx.user.role === 'customer') rows = rows.filter((r) => r.status === 'APPROVED');
  sendJSON(ctx.res, 200, { reports: rows });
}

async function getReportHandler(ctx) {
  const r = await db.prepare('SELECT * FROM service_reports WHERE id = ?').get(ctx.params.id);
  if (!r) return sendJSON(ctx.res, 404, { error: 'Service report tidak ditemukan' });
  const wo = await getWorkOrder(r.work_order_id);
  const t = await getTicket(wo.ticket_id);
  if (ctx.user.role === 'customer') {
    if (t.customer_id !== ctx.user.customer_id) return sendJSON(ctx.res, 403, { error: 'Tidak memiliki akses' });
    if (r.status !== 'APPROVED') return sendJSON(ctx.res, 403, { error: 'Laporan service belum disetujui admin sehingga belum dapat dilihat' });
  }
  if (ctx.user.role === 'technician' && wo.technician_id !== ctx.user.id) return sendJSON(ctx.res, 403, { error: 'Tidak memiliki akses' });
  const detail = await reportDetail(r);
  if (ctx.user.role === 'customer') {
    detail.photos = detail.photos.filter((p) => p.visibility !== 'INTERNAL');
    if (detail.diagnosis) detail.diagnosis = { findings: detail.diagnosis.findings, root_cause: detail.diagnosis.root_cause, recommendation: detail.diagnosis.recommendation };
    detail.report = { id: r.id, number: r.number, version: r.version, summary: r.summary, status: r.status, approved_at: r.approved_at, created_at: r.created_at };
  }
  sendJSON(ctx.res, 200, detail);
}

async function approveReportHandler(ctx) {
  const approvedAt = now();
  let r, wo, t, proforma;
  try {
    await db.transaction(async (tx) => {
      r = await tx.prepare('SELECT * FROM service_reports WHERE id = ? FOR UPDATE').get(ctx.params.id);
      if (!r) { const e = new Error('Service report tidak ditemukan'); e.status = 404; throw e; }
      if (r.status !== 'SUBMITTED') { const e = new Error('Hanya laporan berstatus SUBMITTED yang bisa disetujui'); e.status = 400; throw e; }
      wo = await tx.prepare('SELECT * FROM work_orders WHERE id = ? FOR UPDATE').get(r.work_order_id);
      t = wo ? await tx.prepare('SELECT * FROM tickets WHERE id = ? FOR UPDATE').get(wo.ticket_id) : null;
      if (!wo || !t) { const e = new Error('Work order atau ticket tidak ditemukan'); e.status = 404; throw e; }
      proforma = await tx.prepare("SELECT * FROM invoices WHERE work_order_id = ? AND type = 'PROFORMA' ORDER BY created_at DESC LIMIT 1 FOR UPDATE").get(wo.id);
      if (!proforma || proforma.approval_status !== 'APPROVED') { const e = new Error('Proforma harus disetujui customer sebelum laporan dapat disetujui'); e.status = 409; throw e; }
      await tx.prepare("UPDATE service_reports SET status = 'APPROVED', approved_at = ?, approved_by = ?, updated_at = ? WHERE id = ?")
        .run(approvedAt, ctx.user.id, approvedAt, r.id);
      await tx.prepare("UPDATE work_orders SET status = 'APPROVED', updated_at = ? WHERE id = ?").run(approvedAt, wo.id);
      await tx.prepare("UPDATE tickets SET status = 'COMPLETED', updated_at = ? WHERE id = ?").run(approvedAt, t.id);
      await tx.prepare('INSERT INTO ticket_status_history (id, ticket_id, from_status, to_status, by_user, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(uid(), t.id, t.status, 'COMPLETED', ctx.user.id, 'Laporan disetujui; pembayaran proforma tersedia', approvedAt);
    });
  } catch (e) {
    if (e.status) return sendJSON(ctx.res, e.status, { error: e.message });
    throw e;
  }
  const totals = invoiceTotals(proforma, await getInvoiceItems(proforma.id));
  timeline(t.id, 'APPROVAL', 'Pekerjaan selesai dan disetujui', `Service report ${r.number} disetujui. Pembayaran proforma ${proforma.number} tersedia.`, 'CUSTOMER_VISIBLE', ctx.user.id);
  notify({ customer_id: t.customer_id, title: `Pekerjaan ${t.number} selesai`, body: `Silakan bayar proforma ${proforma.number} sebesar Rp ${totals.total.toLocaleString('id-ID')} melalui QRIS atau transfer bank.`, type: 'INVOICE', ref_type: 'invoice', ref_id: proforma.id });
  if (wo.technician_id) notify({ user_id: wo.technician_id, title: `Laporan ${r.number} disetujui`, body: `Work order ${wo.number} selesai dan menunggu pembayaran customer`, type: 'REPORT', ref_type: 'work_order', ref_id: wo.id });
  audit(ctx.user, 'UPDATE', 'service_report', r.id, `Approve laporan ${r.number}; pembayaran proforma ${proforma.number} dibuka`, ctx.ip);
  sendJSON(ctx.res, 200, { ok: true, invoice_id: proforma.id, invoice_number: proforma.number });
}

async function rejectReportHandler(ctx) {
  const r = await db.prepare('SELECT * FROM service_reports WHERE id = ?').get(ctx.params.id);
  if (!r) return sendJSON(ctx.res, 404, { error: 'Service report tidak ditemukan' });
  if (r.status !== 'SUBMITTED') return sendJSON(ctx.res, 400, { error: 'Hanya laporan berstatus SUBMITTED yang bisa direvisi' });
  const { note = '' } = ctx.body;
  const wo = await getWorkOrder(r.work_order_id);
  await db.prepare("UPDATE service_reports SET status = 'REJECTED', technician_note = ?, updated_at = ? WHERE id = ?")
    .run(note || r.technician_note, now(), r.id);
  const t = await getTicket(wo.ticket_id);
  if (t) timeline(t.id, 'NOTE', 'Laporan diminta revisi', note || 'Admin meminta revisi laporan', 'INTERNAL', ctx.user.id);
  if (wo.technician_id) notify({ user_id: wo.technician_id, title: `Laporan ${r.number} perlu revisi`, body: note || 'Periksa kembali laporan Anda', type: 'REPORT', ref_type: 'service_report', ref_id: r.id });
  audit(ctx.user, 'UPDATE', 'service_report', r.id, `Request revisi laporan ${r.number}`, ctx.ip);
  sendJSON(ctx.res, 200, { ok: true });
}

async function resubmitReportHandler(ctx) {
  const r = await db.prepare('SELECT * FROM service_reports WHERE id = ?').get(ctx.params.id);
  if (!r) return sendJSON(ctx.res, 404, { error: 'Service report tidak ditemukan' });
  const wo = await getWorkOrder(r.work_order_id);
  if (ctx.user.role !== 'admin' && wo.technician_id !== ctx.user.id) return sendJSON(ctx.res, 403, { error: 'Tidak memiliki akses' });
  if (r.status !== 'REJECTED') return sendJSON(ctx.res, 400, { error: 'Hanya laporan berstatus REJECTED yang bisa dikirim ulang' });
  const { summary, technician_note } = ctx.body;
  if (!summary || !String(summary).trim()) return sendJSON(ctx.res, 400, { error: 'Ringkasan wajib diisi' });
  await db.prepare("UPDATE service_reports SET status = 'SUBMITTED', summary = ?, technician_note = ?, version = version + 1, updated_at = ? WHERE id = ?")
    .run(String(summary).trim(), technician_note !== undefined ? technician_note : r.technician_note, now(), r.id);
  notify({ role: 'admin', title: `Laporan ${r.number} dikirim ulang`, body: 'Menunggu approval', type: 'REPORT', ref_type: 'service_report', ref_id: r.id });
  audit(ctx.user, 'UPDATE', 'service_report', r.id, `Resubmit laporan ${r.number}`, ctx.ip);
  sendJSON(ctx.res, 200, { ok: true });
}

// ---------------- Analytics ----------------
async function analyticsHandler(ctx) {
  const from = ctx.query.from || '';
  const to = ctx.query.to || '';
  const dateFilter = (col) => {
    const cond = [];
    const params = [];
    if (from) { cond.push(`substr(${col},1,10) >= ?`); params.push(from); }
    if (to) { cond.push(`substr(${col},1,10) <= ?`); params.push(to); }
    return { sql: cond.length ? ' AND ' + cond.join(' AND ') : '', params };
  };
  const tf = dateFilter('created_at');

  const months = [];
  const d = new Date();
  for (let i = 11; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    months.push({ key: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`, label: m.toLocaleDateString('id-ID', { month: 'short', year: '2-digit' }) });
  }
  const ticketsByMonth = [];
  for (const m of months) {
    const row = await db.prepare(`SELECT COUNT(*) AS c FROM tickets WHERE substr(created_at,1,7) = ? ${tf.sql}`).get(m.key, ...tf.params);
    ticketsByMonth.push({ ...m, count: row.c });
  }

  const rf = dateFilter('paid_at');
  const paidInvoices = await db.prepare(
    `SELECT i.*, COALESCE((SELECT SUM(ii.qty*ii.unit_price) FROM invoice_items ii WHERE ii.invoice_id = i.id),0)::float8 AS items_total
     FROM invoices i WHERE i.status = 'PAID' AND i.paid_at IS NOT NULL ${rf.sql}`
  ).all(...rf.params);
  const revMap = new Map();
  let totalRevenue = 0;
  for (const inv of paidInvoices) {
    const key = inv.paid_at.slice(0, 7);
    const totals = invoiceTotals({ ...inv, labor_cost: 0 }, inv.items_total);
    revMap.set(key, (revMap.get(key) || 0) + totals.total);
    totalRevenue += totals.total;
  }
  const revenueByMonth = months.map((m) => ({ ...m, revenue: Math.round(revMap.get(m.key) || 0) }));

  const byServiceType = await db.prepare(`SELECT service_type AS label, COUNT(*) AS count FROM tickets WHERE 1=1 ${tf.sql} GROUP BY service_type ORDER BY count DESC`).all(...tf.params);
  const byPriority = await db.prepare(`SELECT priority AS label, COUNT(*) AS count FROM tickets WHERE 1=1 ${tf.sql} GROUP BY priority ORDER BY count DESC`).all(...tf.params);
  const byEquipmentType = await db.prepare(`SELECT COALESCE(NULLIF(equipment_type,''),'(terdaftar)') AS label, COUNT(*) AS count FROM tickets WHERE 1=1 ${tf.sql} GROUP BY label ORDER BY count DESC`).all(...tf.params);

  const techPerf = await db.prepare(
    `SELECT u.id, u.name,
        COUNT(wo.id) AS total_wo,
        SUM(CASE WHEN wo.status IN ('COMPLETED','APPROVED') THEN 1 ELSE 0 END) AS completed
     FROM users u LEFT JOIN work_orders wo ON wo.technician_id = u.id
     WHERE u.role = 'technician' GROUP BY u.id ORDER BY completed DESC`
  ).all();
  const topParts = await db.prepare(
    `SELECT p.name, p.unit, SUM(pu.qty) AS qty, SUM(pu.qty*pu.unit_price) AS value
     FROM part_usages pu JOIN parts p ON p.id = pu.part_id GROUP BY p.id ORDER BY qty DESC LIMIT 10`
  ).all();
  const topCustomers = await db.prepare(
    `SELECT c.name, COUNT(t.id) AS tickets FROM customers c JOIN tickets t ON t.customer_id = c.id WHERE 1=1 ${dateFilter('t.created_at').sql} GROUP BY c.id ORDER BY tickets DESC LIMIT 5`
  ).all(...dateFilter('t.created_at').params);

  const totalTickets = (await db.prepare(`SELECT COUNT(*) AS c FROM tickets WHERE 1=1 ${tf.sql}`).get(...tf.params)).c;
  const completedTickets = (await db.prepare(`SELECT COUNT(*) AS c FROM tickets WHERE status IN ('COMPLETED','CLOSED') ${tf.sql}`).get(...tf.params)).c;
  const cancelledTickets = (await db.prepare(`SELECT COUNT(*) AS c FROM tickets WHERE status = 'CANCELLED' ${tf.sql}`).get(...tf.params)).c;
  const openTickets = (await db.prepare(`SELECT COUNT(*) AS c FROM tickets WHERE status IN ('OPEN','REVIEWING','ASSIGNED','IN_PROGRESS') ${tf.sql}`).get(...tf.params)).c;
  const outstanding = (await db.prepare(`
    SELECT COALESCE(SUM(GREATEST(0, COALESCE(ii.items_total,0) - i.discount) * (1 + i.tax_rate/100.0)),0)::float8 AS s
    FROM invoices i
    LEFT JOIN (SELECT invoice_id, SUM(qty*unit_price) AS items_total FROM invoice_items GROUP BY invoice_id) ii ON ii.invoice_id = i.id
    WHERE i.status IN ('SENT','OVERDUE')
  `).get()).s;

  const summary = {
    from: from || null, to: to || null,
    total_tickets: totalTickets,
    completed_tickets: completedTickets,
    open_tickets: openTickets,
    cancelled_tickets: cancelledTickets,
    total_revenue: Math.round(totalRevenue),
    paid_invoices: paidInvoices.length,
    outstanding
  };

  sendJSON(ctx.res, 200, {
    summary,
    tickets_by_month: ticketsByMonth, revenue_by_month: revenueByMonth,
    by_service_type: byServiceType, by_priority: byPriority, by_equipment_type: byEquipmentType,
    technician_performance: techPerf, top_parts: topParts, top_customers: topCustomers
  });
}

module.exports = {
  listReportsHandler, getReportHandler, approveReportHandler, rejectReportHandler, resubmitReportHandler,
  analyticsHandler
};
