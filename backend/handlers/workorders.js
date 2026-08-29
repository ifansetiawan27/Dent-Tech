'use strict';
const { db } = require('../db');
const { uid, now, sendJSON, nextNumber, fileSig } = require('../util');
const {
  audit, timeline, setTicketStatus, getTicket, getWorkOrder, canAccessWorkOrder,
  notify, partTotalForWorkOrder, buildChecklistState
} = require('./_common');

function attachmentWithUrl(a) {
  const sig = fileSig(a.id);
  return { ...a, url: `/api/files/${a.id}?exp=${sig.exp}&sig=${sig.sig}` };
}

async function listWorkOrdersHandler(ctx) {
  const { status, technician_id, date } = ctx.query;
  const where = [];
  const params = [];
  if (ctx.user.role === 'technician') where.push('wo.technician_id = ?'), params.push(ctx.user.id);
  else if (technician_id) where.push('wo.technician_id = ?'), params.push(technician_id);
  if (status) where.push('wo.status = ?'), params.push(status);
  if (date) where.push('wo.scheduled_date = ?'), params.push(date);
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const rows = db.prepare(
    `SELECT wo.*, t.number AS ticket_number, t.problem, t.priority, t.service_type,
       c.name AS customer_name, c.address AS customer_address, c.city AS customer_city, c.phone AS customer_phone,
       e.name AS equipment_name, u.name AS technician_name
     FROM work_orders wo
     JOIN tickets t ON t.id = wo.ticket_id
     JOIN customers c ON c.id = t.customer_id
     LEFT JOIN equipment e ON e.id = t.equipment_id
     LEFT JOIN users u ON u.id = wo.technician_id
     ${whereSql}
     ORDER BY wo.scheduled_date ASC, wo.created_at DESC`
  ).all(...params);
  sendJSON(ctx.res, 200, { work_orders: rows });
}

async function getWorkOrderHandler(ctx) {
  const wo = db.prepare(
    `SELECT wo.*, t.number AS ticket_number, t.problem, t.description AS ticket_description, t.priority, t.service_type, t.status AS ticket_status,
       t.equipment_type AS ticket_equipment_type, t.equipment_brand AS ticket_equipment_brand, t.service_address AS ticket_service_address,
       c.id AS customer_id, c.name AS customer_name, c.address AS customer_address, c.city AS customer_city, c.phone AS customer_phone,
       e.name AS equipment_name, e.category AS equipment_category, e.model AS equipment_model, e.serial_number AS equipment_serial, e.location AS equipment_location,
       u.name AS technician_name, u.phone AS technician_phone
     FROM work_orders wo
     JOIN tickets t ON t.id = wo.ticket_id
     JOIN customers c ON c.id = t.customer_id
     LEFT JOIN equipment e ON e.id = t.equipment_id
     LEFT JOIN users u ON u.id = wo.technician_id
     WHERE wo.id = ?`
  ).get(ctx.params.id);
  if (!wo) return sendJSON(ctx.res, 404, { error: 'Work order tidak ditemukan' });
  if (!canAccessWorkOrder(ctx.user, wo)) return sendJSON(ctx.res, 403, { error: 'Tidak memiliki akses ke work order ini' });

  const checklist = buildChecklistState(wo);
  const diagnosis = db.prepare('SELECT * FROM diagnoses WHERE work_order_id = ? ORDER BY updated_at DESC LIMIT 1').get(wo.id) || null;
  const workPerformed = db.prepare('SELECT * FROM work_performed WHERE work_order_id = ? ORDER BY created_at ASC').all(wo.id);
  const partUsages = db.prepare(
    `SELECT pu.*, p.name AS part_name, p.code AS part_code, p.unit FROM part_usages pu JOIN parts p ON p.id = pu.part_id WHERE pu.work_order_id = ? ORDER BY pu.created_at ASC`
  ).all(wo.id);
  const photos = db.prepare('SELECT * FROM attachments WHERE work_order_id = ? ORDER BY created_at ASC').all(wo.id).map(attachmentWithUrl);
  const report = db.prepare('SELECT * FROM service_reports WHERE work_order_id = ? ORDER BY created_at DESC LIMIT 1').get(wo.id) || null;

  if (ctx.user.role === 'customer') {
    const approved = report && report.status === 'APPROVED';
    return sendJSON(ctx.res, 200, {
      work_order: {
        id: wo.id, number: wo.number, status: wo.status, scheduled_date: wo.scheduled_date, time_window: wo.time_window,
        started_at: wo.started_at, completed_at: wo.completed_at, technician_name: wo.technician_name
      },
      photos: photos.filter((p) => p.visibility !== 'INTERNAL'),
      checklist: approved ? checklist : null,
      diagnosis: approved && diagnosis && diagnosis.visibility !== 'INTERNAL'
        ? { findings: diagnosis.findings, root_cause: diagnosis.root_cause, recommendation: diagnosis.recommendation }
        : null,
      service_report: approved ? { id: report.id, number: report.number, summary: report.summary, status: report.status, approved_at: report.approved_at } : null
    });
  }

  sendJSON(ctx.res, 200, {
    work_order: wo,
    checklist,
    diagnosis,
    work_performed: workPerformed,
    part_usages: partUsages,
    parts_total: partTotalForWorkOrder(wo.id),
    photos,
    service_report: report
  });
}

async function startWorkOrderHandler(ctx) {
  const wo = getWorkOrder(ctx.params.id);
  if (!wo) return sendJSON(ctx.res, 404, { error: 'Work order tidak ditemukan' });
  if (ctx.user.role !== 'admin' && wo.technician_id !== ctx.user.id) return sendJSON(ctx.res, 403, { error: 'Work order bukan milik Anda' });
  if (wo.status !== 'ASSIGNED') return sendJSON(ctx.res, 400, { error: 'Work order hanya bisa dimulai dari status ASSIGNED' });
  db.prepare("UPDATE work_orders SET status = 'STARTED', started_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), wo.id);
  const t = getTicket(wo.ticket_id);
  if (t && t.status === 'ASSIGNED') {
    setTicketStatus(t, 'IN_PROGRESS', ctx.user, 'Teknisi memulai pekerjaan');
    db.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').run(now(), t.id);
  }
  timeline(wo.ticket_id, 'STATUS', 'Service dimulai', 'Teknisi memulai pekerjaan di lokasi', 'CUSTOMER_VISIBLE', ctx.user.id);
  notify({ customer_id: t.customer_id, title: `Service dimulai`, body: `Teknisi sedang bekerja untuk ticket ${t.number}`, type: 'WORK_ORDER', ref_type: 'ticket', ref_id: t.id });
  audit(ctx.user, 'UPDATE', 'work_order', wo.id, `Memulai work order ${wo.number}`, ctx.ip);
  sendJSON(ctx.res, 200, { ok: true });
}

async function saveChecklistHandler(ctx) {
  const wo = getWorkOrder(ctx.params.id);
  if (!wo) return sendJSON(ctx.res, 404, { error: 'Work order tidak ditemukan' });
  if (ctx.user.role !== 'admin' && wo.technician_id !== ctx.user.id) return sendJSON(ctx.res, 403, { error: 'Work order bukan milik Anda' });
  if (!['ASSIGNED', 'STARTED'].includes(wo.status)) return sendJSON(ctx.res, 400, { error: 'Checklist hanya bisa diisi sebelum work order selesai' });
  const items = Array.isArray(ctx.body.items) ? ctx.body.items : [];
  if (!items.length) return sendJSON(ctx.res, 400, { error: 'Tidak ada item checklist dikirim' });
  const upsert = db.prepare(`INSERT INTO checklist_responses (id, work_order_id, item_id, section, label, required, result, note, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (work_order_id, item_id) DO UPDATE SET result = excluded.result, note = excluded.note, updated_at = excluded.updated_at`);
  for (const it of items) {
    const tplItem = db.prepare('SELECT * FROM checklist_template_items WHERE id = ?').get(it.item_id);
    if (!tplItem) continue;
    if (it.result && !['PASS', 'FAIL', 'NA'].includes(it.result)) continue;
    upsert.run(uid(), wo.id, tplItem.id, tplItem.section, tplItem.label, tplItem.required, it.result || '', it.note || '', now());
  }
  db.prepare('UPDATE work_orders SET updated_at = ? WHERE id = ?').run(now(), wo.id);
  sendJSON(ctx.res, 200, { ok: true, checklist: buildChecklistState(wo) });
}

async function saveDiagnosisHandler(ctx) {
  const wo = getWorkOrder(ctx.params.id);
  if (!wo) return sendJSON(ctx.res, 404, { error: 'Work order tidak ditemukan' });
  if (ctx.user.role !== 'admin' && wo.technician_id !== ctx.user.id) return sendJSON(ctx.res, 403, { error: 'Work order bukan milik Anda' });
  if (!['ASSIGNED', 'STARTED'].includes(wo.status)) return sendJSON(ctx.res, 400, { error: 'Diagnosis hanya bisa diisi sebelum work order selesai' });
  const { findings = '', root_cause = '', recommendation = '' } = ctx.body;
  if (!findings.trim()) return sendJSON(ctx.res, 400, { error: 'Temuan diagnosis wajib diisi' });
  const existing = db.prepare('SELECT * FROM diagnoses WHERE work_order_id = ?').get(wo.id);
  if (existing) {
    db.prepare('UPDATE diagnoses SET findings = ?, root_cause = ?, recommendation = ?, updated_at = ? WHERE id = ?')
      .run(findings, root_cause, recommendation, now(), existing.id);
  } else {
    db.prepare('INSERT INTO diagnoses (id, work_order_id, findings, root_cause, recommendation, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(uid(), wo.id, findings, root_cause, recommendation, 'CUSTOMER_VISIBLE', now(), now());
  }
  timeline(wo.ticket_id, 'DIAGNOSIS', 'Diagnosis dicatat', findings.slice(0, 200), 'CUSTOMER_VISIBLE', ctx.user.id);
  db.prepare('UPDATE work_orders SET updated_at = ? WHERE id = ?').run(now(), wo.id);
  audit(ctx.user, 'UPDATE', 'work_order', wo.id, `Diagnosis ${wo.number}`, ctx.ip);
  sendJSON(ctx.res, 200, { ok: true });
}

async function addWorkPerformedHandler(ctx) {
  const wo = getWorkOrder(ctx.params.id);
  if (!wo) return sendJSON(ctx.res, 404, { error: 'Work order tidak ditemukan' });
  if (ctx.user.role !== 'admin' && wo.technician_id !== ctx.user.id) return sendJSON(ctx.res, 403, { error: 'Work order bukan milik Anda' });
  if (!['ASSIGNED', 'STARTED'].includes(wo.status)) return sendJSON(ctx.res, 400, { error: 'Pekerjaan hanya bisa dicatat sebelum work order selesai' });
  const { description } = ctx.body;
  if (!description || !String(description).trim()) return sendJSON(ctx.res, 400, { error: 'Deskripsi pekerjaan wajib diisi' });
  db.prepare('INSERT INTO work_performed (id, work_order_id, description, created_at) VALUES (?, ?, ?, ?)')
    .run(uid(), wo.id, String(description).trim(), now());
  db.prepare('UPDATE work_orders SET updated_at = ? WHERE id = ?').run(now(), wo.id);
  sendJSON(ctx.res, 201, { ok: true });
}

async function addPartUsageHandler(ctx) {
  const wo = getWorkOrder(ctx.params.id);
  if (!wo) return sendJSON(ctx.res, 404, { error: 'Work order tidak ditemukan' });
  if (ctx.user.role !== 'admin' && wo.technician_id !== ctx.user.id) return sendJSON(ctx.res, 403, { error: 'Work order bukan milik Anda' });
  if (!['ASSIGNED', 'STARTED'].includes(wo.status)) return sendJSON(ctx.res, 400, { error: 'Spare part hanya bisa dicatat sebelum work order selesai' });
  const { part_id, qty = 1, note = '' } = ctx.body;
  const part = db.prepare('SELECT * FROM parts WHERE id = ?').get(part_id);
  if (!part) return sendJSON(ctx.res, 400, { error: 'Spare part tidak ditemukan' });
  const q = Number(qty);
  if (!q || q <= 0) return sendJSON(ctx.res, 400, { error: 'Jumlah tidak valid' });
  if (part.stock < q) return sendJSON(ctx.res, 400, { error: `Stok tidak mencukupi (tersisa ${part.stock} ${part.unit})` });
  db.prepare('UPDATE parts SET stock = stock - ? WHERE id = ?').run(q, part.id);
  db.prepare('INSERT INTO part_usages (id, work_order_id, part_id, qty, unit_price, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(uid(), wo.id, part.id, q, part.price, note, now());
  db.prepare('UPDATE work_orders SET updated_at = ? WHERE id = ?').run(now(), wo.id);
  audit(ctx.user, 'CREATE', 'part_usage', wo.id, `Pakai ${q}x ${part.name} di ${wo.number}`, ctx.ip);
  sendJSON(ctx.res, 201, { ok: true, parts_total: partTotalForWorkOrder(wo.id) });
}

async function removePartUsageHandler(ctx) {
  const wo = getWorkOrder(ctx.params.id);
  if (!wo) return sendJSON(ctx.res, 404, { error: 'Work order tidak ditemukan' });
  if (ctx.user.role !== 'admin' && wo.technician_id !== ctx.user.id) return sendJSON(ctx.res, 403, { error: 'Work order bukan milik Anda' });
  if (!['ASSIGNED', 'STARTED'].includes(wo.status)) return sendJSON(ctx.res, 400, { error: 'Spare part hanya bisa diubah sebelum work order selesai' });
  const usage = db.prepare('SELECT * FROM part_usages WHERE id = ? AND work_order_id = ?').get(ctx.params.usageId, wo.id);
  if (!usage) return sendJSON(ctx.res, 404, { error: 'Penggunaan part tidak ditemukan' });
  db.prepare('UPDATE parts SET stock = stock + ? WHERE id = ?').run(usage.qty, usage.part_id);
  db.prepare('DELETE FROM part_usages WHERE id = ?').run(usage.id);
  db.prepare('UPDATE work_orders SET updated_at = ? WHERE id = ?').run(now(), wo.id);
  audit(ctx.user, 'DELETE', 'part_usage', usage.id, `Batal pakai part di ${wo.number}`, ctx.ip);
  sendJSON(ctx.res, 200, { ok: true, parts_total: partTotalForWorkOrder(wo.id) });
}

async function rescheduleHandler(ctx) {
  const wo = getWorkOrder(ctx.params.id);
  if (!wo) return sendJSON(ctx.res, 404, { error: 'Work order tidak ditemukan' });
  if (!['ASSIGNED', 'STARTED'].includes(wo.status)) return sendJSON(ctx.res, 400, { error: 'Work order sudah selesai' });
  const { scheduled_date, time_window } = ctx.body;
  if (!scheduled_date) return sendJSON(ctx.res, 400, { error: 'Tanggal jadwal wajib diisi' });
  db.prepare('UPDATE work_orders SET scheduled_date = ?, time_window = ?, updated_at = ? WHERE id = ?')
    .run(scheduled_date, time_window || '', now(), wo.id);
  const t = getTicket(wo.ticket_id);
  timeline(wo.ticket_id, 'SCHEDULE', 'Jadwal diperbarui', `Jadwal baru: ${scheduled_date} ${time_window || ''}`.trim(), 'CUSTOMER_VISIBLE', ctx.user.id);
  if (wo.technician_id) notify({ user_id: wo.technician_id, title: `Jadwal ${wo.number} berubah`, body: `${scheduled_date} ${time_window || ''}`.trim(), type: 'WORK_ORDER', ref_type: 'work_order', ref_id: wo.id });
  if (t) notify({ customer_id: t.customer_id, title: `Jadwal service ${t.number} diperbarui`, body: `${scheduled_date} ${time_window || ''}`.trim(), type: 'WORK_ORDER', ref_type: 'ticket', ref_id: t.id });
  audit(ctx.user, 'UPDATE', 'work_order', wo.id, `Reschedule ${wo.number} → ${scheduled_date}`, ctx.ip);
  sendJSON(ctx.res, 200, { ok: true });
}

async function completeWorkOrderHandler(ctx) {
  const wo = getWorkOrder(ctx.params.id);
  if (!wo) return sendJSON(ctx.res, 404, { error: 'Work order tidak ditemukan' });
  if (ctx.user.role !== 'admin' && wo.technician_id !== ctx.user.id) return sendJSON(ctx.res, 403, { error: 'Work order bukan milik Anda' });
  if (wo.status !== 'STARTED') return sendJSON(ctx.res, 400, { error: 'Work order harus dimulai terlebih dahulu' });

  const checklist = buildChecklistState(wo);
  if (checklist && !checklist.complete) {
    return sendJSON(ctx.res, 400, { error: `Checklist wajib belum lengkap (${checklist.required_done}/${checklist.required_total} item wajib diisi)` });
  }
  const diagnosis = db.prepare('SELECT * FROM diagnoses WHERE work_order_id = ?').get(wo.id);
  if (!diagnosis || !diagnosis.findings.trim()) return sendJSON(ctx.res, 400, { error: 'Diagnosis wajib diisi sebelum menyelesaikan pekerjaan' });
  const performed = db.prepare('SELECT COUNT(*) AS c FROM work_performed WHERE work_order_id = ?').get(wo.id).c;
  if (!performed) return sendJSON(ctx.res, 400, { error: 'Catat minimal satu pekerjaan yang dilakukan' });
  const afterPhotos = db.prepare("SELECT COUNT(*) AS c FROM attachments WHERE work_order_id = ? AND kind = 'after'").get(wo.id).c;
  if (!afterPhotos) return sendJSON(ctx.res, 400, { error: 'Upload minimal satu foto AFTER sebagai bukti service' });
  const { summary } = ctx.body;
  if (!summary || !String(summary).trim()) return sendJSON(ctx.res, 400, { error: 'Ringkasan service report wajib diisi' });

  const t = getTicket(wo.ticket_id);
  db.prepare("UPDATE work_orders SET status = 'COMPLETED', completed_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), wo.id);
  const reportId = uid();
  const reportNumber = nextNumber('SR');
  db.prepare(`INSERT INTO service_reports (id, number, version, work_order_id, summary, technician_note, status, created_at, updated_at)
    VALUES (?, ?, 1, ?, ?, ?, 'SUBMITTED', ?, ?)`)
    .run(reportId, reportNumber, wo.id, String(summary).trim(), ctx.body.technician_note || '', now(), now());
  if (t) {
    setTicketStatus(t, 'COMPLETED', ctx.user, 'Pekerjaan selesai, menunggu approval laporan');
    db.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').run(now(), t.id);
    timeline(t.id, 'STATUS', 'Service selesai', 'Semua checklist selesai. Laporan dikirim untuk approval admin.', 'CUSTOMER_VISIBLE', ctx.user.id);
    notify({ role: 'admin', title: `Laporan ${reportNumber} menunggu approval`, body: `${wo.number} — ${t.problem}`, type: 'REPORT', ref_type: 'service_report', ref_id: reportId });
    notify({ customer_id: t.customer_id, title: `Service ${t.number} selesai`, body: 'Laporan service sedang menunggu persetujuan admin', type: 'REPORT', ref_type: 'ticket', ref_id: t.id });
  }
  audit(ctx.user, 'UPDATE', 'work_order', wo.id, `Menyelesaikan ${wo.number} & submit laporan ${reportNumber}`, ctx.ip);
  sendJSON(ctx.res, 200, { ok: true, report_id: reportId, report_number: reportNumber });
}

module.exports = {
  listWorkOrdersHandler, getWorkOrderHandler, startWorkOrderHandler,
  saveChecklistHandler, saveDiagnosisHandler, addWorkPerformedHandler,
  addPartUsageHandler, removePartUsageHandler, rescheduleHandler, completeWorkOrderHandler,
  buildChecklistState
};
