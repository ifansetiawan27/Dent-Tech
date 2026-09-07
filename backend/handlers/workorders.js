'use strict';
const { db } = require('../db');
const { uid, now, sendJSON, nextNumber, fileSig } = require('../util');
const {
  audit, timeline, setTicketStatus, getTicket, getWorkOrder, canAccessWorkOrder,
  notify, partTotalForWorkOrder, workOrderPhotoRequirements, buildChecklistState
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
  const rows = await db.prepare(
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
  const wo = await db.prepare(
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
  if (!await canAccessWorkOrder(ctx.user, wo)) return sendJSON(ctx.res, 403, { error: 'Tidak memiliki akses ke work order ini' });

  const [checklist, diagnosisRow, workPerformed, partUsages, photoRows, report] = await Promise.all([
    buildChecklistState(wo),
    db.prepare('SELECT * FROM diagnoses WHERE work_order_id = ? ORDER BY updated_at DESC LIMIT 1').get(wo.id),
    db.prepare('SELECT * FROM work_performed WHERE work_order_id = ? ORDER BY created_at ASC').all(wo.id),
    db.prepare(
      `SELECT pu.*, p.name AS part_name, p.code AS part_code, p.unit FROM part_usages pu JOIN parts p ON p.id = pu.part_id WHERE pu.work_order_id = ? ORDER BY pu.created_at ASC`
    ).all(wo.id),
    db.prepare(`SELECT * FROM attachments
      WHERE work_order_id = ? OR (ticket_id = ? AND work_order_id IS NULL AND kind = 'request')
      ORDER BY created_at ASC`).all(wo.id, wo.ticket_id),
    db.prepare('SELECT * FROM service_reports WHERE work_order_id = ? ORDER BY created_at DESC LIMIT 1').get(wo.id)
  ]);
  const diagnosis = diagnosisRow || null;
  const photos = photoRows.map(attachmentWithUrl);

  if (ctx.user.role === 'customer') {
    const approved = report && report.status === 'APPROVED';
    return sendJSON(ctx.res, 200, {
      work_order: {
         id: wo.id, number: wo.number, status: wo.status, scheduled_date: wo.scheduled_date, time_window: wo.time_window,
         started_at: wo.started_at, completed_at: wo.completed_at, technician_name: wo.technician_name,
         serviced_equipment_name: wo.serviced_equipment_name,
         serviced_equipment_type_model: wo.serviced_equipment_type_model,
         serviced_equipment_serial_number: wo.serviced_equipment_serial_number,
         equipment_identity_confirmed_at: wo.equipment_identity_confirmed_at
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
    parts_total: await partTotalForWorkOrder(wo.id),
    photos,
    photo_requirements: await workOrderPhotoRequirements(wo.id),
    service_report: report
  });
}

async function startWorkOrderHandler(ctx) {
  const wo = await getWorkOrder(ctx.params.id);
  if (!wo) return sendJSON(ctx.res, 404, { error: 'Work order tidak ditemukan' });
  if (ctx.user.role !== 'admin' && wo.technician_id !== ctx.user.id) return sendJSON(ctx.res, 403, { error: 'Work order bukan milik Anda' });
  if (wo.status !== 'ASSIGNED') return sendJSON(ctx.res, 400, { error: 'Inspeksi hanya bisa dimulai dari status ASSIGNED' });
  const started = await db.prepare("UPDATE work_orders SET status = 'STARTED', started_at = ?, updated_at = ? WHERE id = ? AND status = 'ASSIGNED'").run(now(), now(), wo.id);
  if (!started.changes) return sendJSON(ctx.res, 409, { error: 'Status work order berubah. Muat ulang halaman.' });
  const t = await getTicket(wo.ticket_id);
  if (t && t.status === 'ASSIGNED') {
    await setTicketStatus(t, 'IN_PROGRESS', ctx.user, 'Teknisi memulai inspeksi dan diagnosis');
    await db.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').run(now(), t.id);
  }
  timeline(wo.ticket_id, 'STATUS', 'Inspeksi dimulai', 'Teknisi memulai checklist dan diagnosis di lokasi', 'CUSTOMER_VISIBLE', ctx.user.id);
  notify({ customer_id: t.customer_id, title: 'Inspeksi dimulai', body: `Teknisi sedang memeriksa unit untuk ticket ${t.number}`, type: 'WORK_ORDER', ref_type: 'ticket', ref_id: t.id });
  audit(ctx.user, 'UPDATE', 'work_order', wo.id, `Memulai inspeksi ${wo.number}`, ctx.ip);
  sendJSON(ctx.res, 200, { ok: true });
}

async function updateEquipmentIdentityHandler(ctx) {
  const name = typeof ctx.body.name === 'string' ? ctx.body.name.trim() : '';
  const typeModel = typeof ctx.body.type_model === 'string' ? ctx.body.type_model.trim() : '';
  const serialNumber = typeof ctx.body.serial_number === 'string' ? ctx.body.serial_number.trim() : '';
  const version = Number(ctx.body.version);
  if (!name || !typeModel || !serialNumber) return sendJSON(ctx.res, 400, { error: 'Nama alat, tipe/model, dan serial number wajib diisi' });
  if (name.length > 200 || typeModel.length > 200 || serialNumber.length > 150) return sendJSON(ctx.res, 400, { error: 'Data identitas alat terlalu panjang' });
  if (!Number.isInteger(version) || version < 0) return sendJSON(ctx.res, 400, { error: 'Versi identitas alat tidak valid' });

  let updated;
  try {
    await db.transaction(async (tx) => {
      const wo = await tx.prepare('SELECT * FROM work_orders WHERE id = ? FOR UPDATE').get(ctx.params.id);
      if (!wo) { const e = new Error('Work order tidak ditemukan'); e.status = 404; throw e; }
      if (wo.technician_id !== ctx.user.id) { const e = new Error('Work order bukan milik Anda'); e.status = 403; throw e; }
      if (wo.status !== 'STARTED') { const e = new Error('Identitas alat hanya dapat dicatat saat inspeksi berlangsung'); e.status = 409; throw e; }
      if (Number(wo.equipment_identity_version || 0) !== version) { const e = new Error('Data identitas alat telah berubah. Muat ulang halaman.'); e.status = 409; throw e; }
      const confirmedAt = now();
      await tx.prepare(`UPDATE work_orders SET serviced_equipment_name = ?, serviced_equipment_type_model = ?,
        serviced_equipment_serial_number = ?, equipment_identity_confirmed_at = ?, equipment_identity_confirmed_by = ?,
        equipment_identity_version = equipment_identity_version + 1, updated_at = ? WHERE id = ?`)
        .run(name, typeModel, serialNumber, confirmedAt, ctx.user.id, confirmedAt, wo.id);
      updated = {
        name, type_model: typeModel, serial_number: serialNumber, confirmed_at: confirmedAt,
        confirmed_by: ctx.user.id, version: version + 1
      };
    });
  } catch (e) {
    if (e.status) return sendJSON(ctx.res, e.status, { error: e.message });
    throw e;
  }
  audit(ctx.user, 'UPDATE', 'work_order', ctx.params.id, `Konfirmasi alat diservis: ${name} / ${typeModel} / ${serialNumber}`, ctx.ip);
  sendJSON(ctx.res, 200, { ok: true, equipment_identity: updated });
}

async function submitDiagnosisHandler(ctx) {
  const wo = await getWorkOrder(ctx.params.id);
  if (!wo) return sendJSON(ctx.res, 404, { error: 'Work order tidak ditemukan' });
  if (ctx.user.role !== 'admin' && wo.technician_id !== ctx.user.id) return sendJSON(ctx.res, 403, { error: 'Work order bukan milik Anda' });
  if (wo.status !== 'STARTED') return sendJSON(ctx.res, 400, { error: 'Diagnosis hanya dapat dikirim setelah inspeksi dimulai' });
  const [checklist, diagnosis] = await Promise.all([
    buildChecklistState(wo),
    db.prepare('SELECT * FROM diagnoses WHERE work_order_id = ?').get(wo.id)
  ]);
  if (!checklist) return sendJSON(ctx.res, 400, { error: 'Checklist inspeksi wajib tersedia sebelum diagnosis dikirim' });
  if (!checklist.complete) return sendJSON(ctx.res, 400, { error: `Checklist wajib belum lengkap (${checklist.required_done}/${checklist.required_total})` });
  if (!diagnosis || !String(diagnosis.findings || '').trim()) return sendJSON(ctx.res, 400, { error: 'Diagnosis wajib diisi sebelum dikirim ke admin' });
  if (!wo.equipment_identity_confirmed_at || !String(wo.serviced_equipment_name || '').trim() || !String(wo.serviced_equipment_type_model || '').trim() || !String(wo.serviced_equipment_serial_number || '').trim()) {
    return sendJSON(ctx.res, 400, { error: 'Konfirmasi nama, tipe/model, dan serial number alat sebelum mengirim diagnosis', code: 'EQUIPMENT_IDENTITY_REQUIRED' });
  }
  const ts = now();
  let missingInspection = [];
  const transition = await db.transaction(async (tx) => {
    const lockedWo = await tx.prepare('SELECT status FROM work_orders WHERE id = ? FOR UPDATE').get(wo.id);
    if (!lockedWo || lockedWo.status !== 'STARTED') return false;
    const inspectionEvidence = await tx.prepare(`SELECT kind FROM attachments WHERE work_order_id = ?
      AND kind IN ('before','equipment_brand','equipment_serial') AND mime IN ('image/jpeg','image/png','image/webp')`).all(wo.id);
    const capturedKinds = new Set(inspectionEvidence.map((photo) => photo.kind));
    missingInspection = ['before', 'equipment_brand', 'equipment_serial'].filter((kind) => !capturedKinds.has(kind));
    if (missingInspection.length) return false;
    await tx.prepare("UPDATE work_orders SET status = 'WAITING_QUOTATION', updated_at = ? WHERE id = ?").run(ts, wo.id);
    return true;
  });
  if (missingInspection.length) return sendJSON(ctx.res, 400, {
    error: 'Foto inspeksi wajib belum lengkap', code: 'INSPECTION_PHOTOS_MISSING', missing_photo_kinds: missingInspection
  });
  if (!transition) return sendJSON(ctx.res, 409, { error: 'Status work order berubah. Muat ulang halaman.' });
  const t = await getTicket(wo.ticket_id);
  if (t) {
    await setTicketStatus(t, 'WAITING_QUOTATION', ctx.user, 'Diagnosis selesai, menunggu proforma invoice');
    timeline(t.id, 'DIAGNOSIS', 'Diagnosis selesai', 'Hasil inspeksi dikirim ke admin untuk penyusunan proforma invoice.', 'CUSTOMER_VISIBLE', ctx.user.id);
    notify({ role: 'admin', title: `Diagnosis ${wo.number} siap direview`, body: `${t.number} — buat proforma biaya perbaikan`, type: 'WORK_ORDER', ref_type: 'work_order', ref_id: wo.id });
  }
  audit(ctx.user, 'UPDATE', 'work_order', wo.id, `Mengirim diagnosis ${wo.number} untuk pembuatan proforma`, ctx.ip);
  sendJSON(ctx.res, 200, { ok: true, status: 'WAITING_QUOTATION' });
}

async function startRepairHandler(ctx) {
  const wo = await getWorkOrder(ctx.params.id);
  if (!wo) return sendJSON(ctx.res, 404, { error: 'Work order tidak ditemukan' });
  if (ctx.user.role !== 'admin' && wo.technician_id !== ctx.user.id) return sendJSON(ctx.res, 403, { error: 'Work order bukan milik Anda' });
  if (wo.status !== 'REPAIR_AUTHORIZED') return sendJSON(ctx.res, 400, { error: 'Perbaikan belum disetujui customer' });
  const ts = now();
  const started = await db.prepare("UPDATE work_orders SET status = 'REPAIR_STARTED', updated_at = ? WHERE id = ? AND status = 'REPAIR_AUTHORIZED'").run(ts, wo.id);
  if (!started.changes) return sendJSON(ctx.res, 409, { error: 'Status work order berubah. Muat ulang halaman.' });
  const t = await getTicket(wo.ticket_id);
  if (t) {
    await setTicketStatus(t, 'REPAIR_IN_PROGRESS', ctx.user, 'Teknisi memulai perbaikan yang disetujui');
    timeline(t.id, 'STATUS', 'Perbaikan dimulai', 'Teknisi mulai mengerjakan perbaikan sesuai proforma yang disetujui.', 'CUSTOMER_VISIBLE', ctx.user.id);
    notify({ customer_id: t.customer_id, title: `Perbaikan ${t.number} dimulai`, body: 'Teknisi mulai mengerjakan perbaikan yang Anda setujui', type: 'WORK_ORDER', ref_type: 'ticket', ref_id: t.id });
  }
  audit(ctx.user, 'UPDATE', 'work_order', wo.id, `Memulai perbaikan ${wo.number}`, ctx.ip);
  sendJSON(ctx.res, 200, { ok: true, status: 'REPAIR_STARTED' });
}

async function saveChecklistHandler(ctx) {
  const wo = await getWorkOrder(ctx.params.id);
  if (!wo) return sendJSON(ctx.res, 404, { error: 'Work order tidak ditemukan' });
  if (ctx.user.role !== 'admin' && wo.technician_id !== ctx.user.id) return sendJSON(ctx.res, 403, { error: 'Work order bukan milik Anda' });
  if (!['ASSIGNED', 'STARTED'].includes(wo.status)) return sendJSON(ctx.res, 400, { error: 'Checklist hanya bisa diisi sebelum work order selesai' });
  const items = Array.isArray(ctx.body.items) ? ctx.body.items : [];
  if (!items.length) return sendJSON(ctx.res, 400, { error: 'Tidak ada item checklist dikirim' });
  // Set-based: 1 lookup + 1 batched upsert (bukan loop query per item)
  // Kolom checklist_template_items.id bertipe TEXT (bukan uuid), jadi bandingkan apa adanya.
  const byItem = new Map(items.map((it) => [String(it.item_id), it]));
  const templateItems = await db.prepare('SELECT * FROM checklist_template_items WHERE id = ANY($1::text[])')
    .all([...byItem.keys()]);
  const valid = [];
  for (const tplItem of templateItems) {
    const it = byItem.get(tplItem.id);
    if (!it || (it.result && !['PASS', 'FAIL', 'NA'].includes(it.result))) continue;
    valid.push({ tplItem, result: it.result || '', note: it.note || '' });
  }
  if (valid.length) {
    const ts = now();
    const values = [];
    const params = [];
    valid.forEach((entry, i) => {
      const base = i * 9;
      values.push(`(${Array.from({ length: 9 }, (_, j) => '$' + (base + j + 1)).join(', ')})`);
      params.push(uid(), wo.id, entry.tplItem.id, entry.tplItem.section, entry.tplItem.label, entry.tplItem.required, entry.result, entry.note, ts);
    });
    await db.prepare(`INSERT INTO checklist_responses (id, work_order_id, item_id, section, label, required, result, note, updated_at)
      VALUES ${values.join(', ')}
      ON CONFLICT (work_order_id, item_id) DO UPDATE SET result = excluded.result, note = excluded.note, updated_at = excluded.updated_at`)
      .run(...params);
  }
  await db.prepare('UPDATE work_orders SET updated_at = ? WHERE id = ?').run(now(), wo.id);
  sendJSON(ctx.res, 200, { ok: true, checklist: await buildChecklistState(wo) });
}

async function saveDiagnosisHandler(ctx) {
  const wo = await getWorkOrder(ctx.params.id);
  if (!wo) return sendJSON(ctx.res, 404, { error: 'Work order tidak ditemukan' });
  if (ctx.user.role !== 'admin' && wo.technician_id !== ctx.user.id) return sendJSON(ctx.res, 403, { error: 'Work order bukan milik Anda' });
  if (!['ASSIGNED', 'STARTED'].includes(wo.status)) return sendJSON(ctx.res, 400, { error: 'Diagnosis hanya bisa diisi sebelum work order selesai' });
  const { findings = '', root_cause = '', recommendation = '' } = ctx.body;
  if (!findings.trim()) return sendJSON(ctx.res, 400, { error: 'Temuan diagnosis wajib diisi' });
  const existing = await db.prepare('SELECT * FROM diagnoses WHERE work_order_id = ?').get(wo.id);
  if (existing) {
    await db.prepare('UPDATE diagnoses SET findings = ?, root_cause = ?, recommendation = ?, updated_at = ? WHERE id = ?')
      .run(findings, root_cause, recommendation, now(), existing.id);
  } else {
    await db.prepare('INSERT INTO diagnoses (id, work_order_id, findings, root_cause, recommendation, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(uid(), wo.id, findings, root_cause, recommendation, 'CUSTOMER_VISIBLE', now(), now());
  }
  timeline(wo.ticket_id, 'DIAGNOSIS', 'Diagnosis dicatat', findings.slice(0, 200), 'CUSTOMER_VISIBLE', ctx.user.id);
  await db.prepare('UPDATE work_orders SET updated_at = ? WHERE id = ?').run(now(), wo.id);
  audit(ctx.user, 'UPDATE', 'work_order', wo.id, `Diagnosis ${wo.number}`, ctx.ip);
  sendJSON(ctx.res, 200, { ok: true });
}

async function addWorkPerformedHandler(ctx) {
  const wo = await getWorkOrder(ctx.params.id);
  if (!wo) return sendJSON(ctx.res, 404, { error: 'Work order tidak ditemukan' });
  if (ctx.user.role !== 'admin' && wo.technician_id !== ctx.user.id) return sendJSON(ctx.res, 403, { error: 'Work order bukan milik Anda' });
  if (wo.status !== 'REPAIR_STARTED') return sendJSON(ctx.res, 400, { error: 'Pekerjaan perbaikan hanya dapat dicatat setelah proforma disetujui dan perbaikan dimulai' });
  const { description } = ctx.body;
  if (!description || !String(description).trim()) return sendJSON(ctx.res, 400, { error: 'Deskripsi pekerjaan wajib diisi' });
  await db.prepare('INSERT INTO work_performed (id, work_order_id, description, created_at) VALUES (?, ?, ?, ?)')
    .run(uid(), wo.id, String(description).trim(), now());
  await db.prepare('UPDATE work_orders SET updated_at = ? WHERE id = ?').run(now(), wo.id);
  sendJSON(ctx.res, 201, { ok: true });
}

async function addPartUsageHandler(ctx) {
  const wo = await getWorkOrder(ctx.params.id);
  if (!wo) return sendJSON(ctx.res, 404, { error: 'Work order tidak ditemukan' });
  if (ctx.user.role !== 'admin' && wo.technician_id !== ctx.user.id) return sendJSON(ctx.res, 403, { error: 'Work order bukan milik Anda' });
  if (wo.status !== 'REPAIR_STARTED') return sendJSON(ctx.res, 400, { error: 'Spare part hanya dapat dicatat saat perbaikan berlangsung' });
  const { part_id, qty = 1, note = '' } = ctx.body;
  const part = await db.prepare('SELECT * FROM parts WHERE id = ?').get(part_id);
  if (!part) return sendJSON(ctx.res, 400, { error: 'Spare part tidak ditemukan' });
  const q = Number(qty);
  if (!q || q <= 0) return sendJSON(ctx.res, 400, { error: 'Jumlah tidak valid' });
  if (part.stock < q) return sendJSON(ctx.res, 400, { error: `Stok tidak mencukupi (tersisa ${part.stock} ${part.unit})` });
  const updated = await db.prepare('UPDATE parts SET stock = stock - ? WHERE id = ? AND stock >= ?').run(q, part.id, q);
  if (!updated.changes) return sendJSON(ctx.res, 400, { error: `Stok tidak mencukupi (tersisa ${part.stock} ${part.unit})` });
  await db.prepare('INSERT INTO part_usages (id, work_order_id, part_id, qty, unit_price, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(uid(), wo.id, part.id, q, part.price, note, now());
  await db.prepare('UPDATE work_orders SET updated_at = ? WHERE id = ?').run(now(), wo.id);
  audit(ctx.user, 'CREATE', 'part_usage', wo.id, `Pakai ${q}x ${part.name} di ${wo.number}`, ctx.ip);
  sendJSON(ctx.res, 201, { ok: true, parts_total: await partTotalForWorkOrder(wo.id) });
}

async function removePartUsageHandler(ctx) {
  const wo = await getWorkOrder(ctx.params.id);
  if (!wo) return sendJSON(ctx.res, 404, { error: 'Work order tidak ditemukan' });
  if (ctx.user.role !== 'admin' && wo.technician_id !== ctx.user.id) return sendJSON(ctx.res, 403, { error: 'Work order bukan milik Anda' });
  if (wo.status !== 'REPAIR_STARTED') return sendJSON(ctx.res, 400, { error: 'Spare part hanya dapat diubah saat perbaikan berlangsung' });
  const usage = await db.prepare('SELECT * FROM part_usages WHERE id = ? AND work_order_id = ?').get(ctx.params.usageId, wo.id);
  if (!usage) return sendJSON(ctx.res, 404, { error: 'Penggunaan part tidak ditemukan' });
  await db.prepare('UPDATE parts SET stock = stock + ? WHERE id = ?').run(usage.qty, usage.part_id);
  await db.prepare('DELETE FROM part_usages WHERE id = ?').run(usage.id);
  await db.prepare('UPDATE work_orders SET updated_at = ? WHERE id = ?').run(now(), wo.id);
  audit(ctx.user, 'DELETE', 'part_usage', usage.id, `Batal pakai part di ${wo.number}`, ctx.ip);
  sendJSON(ctx.res, 200, { ok: true, parts_total: await partTotalForWorkOrder(wo.id) });
}

async function rescheduleHandler(ctx) {
  const wo = await getWorkOrder(ctx.params.id);
  if (!wo) return sendJSON(ctx.res, 404, { error: 'Work order tidak ditemukan' });
  if (!['ASSIGNED', 'STARTED', 'WAITING_QUOTATION', 'WAITING_CUSTOMER_APPROVAL', 'REPAIR_AUTHORIZED', 'REPAIR_STARTED'].includes(wo.status)) return sendJSON(ctx.res, 400, { error: 'Work order sudah selesai' });
  const { scheduled_date, time_window } = ctx.body;
  if (!scheduled_date) return sendJSON(ctx.res, 400, { error: 'Tanggal jadwal wajib diisi' });
  await db.prepare('UPDATE work_orders SET scheduled_date = ?, time_window = ?, updated_at = ? WHERE id = ?')
    .run(scheduled_date, time_window || '', now(), wo.id);
  const t = await getTicket(wo.ticket_id);
  timeline(wo.ticket_id, 'SCHEDULE', 'Jadwal diperbarui', `Jadwal baru: ${scheduled_date} ${time_window || ''}`.trim(), 'CUSTOMER_VISIBLE', ctx.user.id);
  if (wo.technician_id) notify({ user_id: wo.technician_id, title: `Jadwal ${wo.number} berubah`, body: `${scheduled_date} ${time_window || ''}`.trim(), type: 'WORK_ORDER', ref_type: 'work_order', ref_id: wo.id });
  if (t) notify({ customer_id: t.customer_id, title: `Jadwal service ${t.number} diperbarui`, body: `${scheduled_date} ${time_window || ''}`.trim(), type: 'WORK_ORDER', ref_type: 'ticket', ref_id: t.id });
  audit(ctx.user, 'UPDATE', 'work_order', wo.id, `Reschedule ${wo.number} → ${scheduled_date}`, ctx.ip);
  sendJSON(ctx.res, 200, { ok: true });
}

async function completeWorkOrderHandler(ctx) {
  const wo = await getWorkOrder(ctx.params.id);
  if (!wo) return sendJSON(ctx.res, 404, { error: 'Work order tidak ditemukan' });
  if (ctx.user.role !== 'admin' && wo.technician_id !== ctx.user.id) return sendJSON(ctx.res, 403, { error: 'Work order bukan milik Anda' });
  if (wo.status !== 'REPAIR_STARTED') return sendJSON(ctx.res, 400, { error: 'Perbaikan harus dimulai setelah proforma disetujui customer' });

  const [checklist, diagnosisRow, performedRow] = await Promise.all([
    buildChecklistState(wo),
    db.prepare('SELECT * FROM diagnoses WHERE work_order_id = ?').get(wo.id),
    db.prepare('SELECT COUNT(*) AS c FROM work_performed WHERE work_order_id = ?').get(wo.id)
  ]);
  const diagnosis = diagnosisRow || null;
  const performed = Number(performedRow ? performedRow.c : 0);
  if (!checklist) return sendJSON(ctx.res, 400, { error: 'Checklist wajib tersedia sebelum menyelesaikan pekerjaan' });
  if (!checklist.complete) {
    return sendJSON(ctx.res, 400, { error: `Checklist wajib belum lengkap (${checklist.required_done}/${checklist.required_total} item wajib diisi)` });
  }
  if (!diagnosis || !diagnosis.findings.trim()) return sendJSON(ctx.res, 400, { error: 'Diagnosis wajib diisi sebelum menyelesaikan pekerjaan' });
  if (!performed) return sendJSON(ctx.res, 400, { error: 'Catat minimal satu pekerjaan yang dilakukan' });
  const { summary } = ctx.body;
  if (!summary || !String(summary).trim()) return sendJSON(ctx.res, 400, { error: 'Ringkasan service report wajib diisi' });

  const completedAt = now();
  const reportId = uid();
  const reportNumber = await nextNumber('SR');
  let t, proforma;
  try {
    await db.transaction(async (tx) => {
      const lockedWo = await tx.prepare('SELECT * FROM work_orders WHERE id = ? FOR UPDATE').get(wo.id);
      if (!lockedWo || lockedWo.status !== 'REPAIR_STARTED') { const e = new Error('Status work order berubah. Muat ulang halaman.'); e.status = 409; throw e; }
      const photoRequirements = await workOrderPhotoRequirements(lockedWo.id, tx);
      if (!photoRequirements.complete) { const e = new Error('Foto wajib belum lengkap'); e.status = 400; e.code = 'REQUIRED_PHOTOS_MISSING'; e.missingPhotoKinds = photoRequirements.missing; throw e; }
      t = await tx.prepare('SELECT * FROM tickets WHERE id = ? FOR UPDATE').get(lockedWo.ticket_id);
      proforma = await tx.prepare("SELECT * FROM invoices WHERE work_order_id = ? AND type = 'PROFORMA' ORDER BY created_at DESC LIMIT 1 FOR UPDATE").get(lockedWo.id);
      if (!t || !proforma || proforma.approval_status !== 'APPROVED') { const e = new Error('Proforma yang disetujui customer tidak ditemukan'); e.status = 409; throw e; }
      await tx.prepare("UPDATE work_orders SET status = 'APPROVED', completed_at = ?, updated_at = ? WHERE id = ?").run(completedAt, completedAt, lockedWo.id);
      await tx.prepare(`INSERT INTO service_reports (id, number, version, work_order_id, summary, technician_note, status, approved_at, approved_by, created_at, updated_at)
        VALUES (?, ?, 1, ?, ?, ?, 'APPROVED', ?, ?, ?, ?)`)
        .run(reportId, reportNumber, lockedWo.id, String(summary).trim(), ctx.body.technician_note || '', completedAt, ctx.user.id, completedAt, completedAt);
      await tx.prepare("UPDATE tickets SET status = 'COMPLETED', updated_at = ? WHERE id = ?").run(completedAt, t.id);
      await tx.prepare('INSERT INTO ticket_status_history (id, ticket_id, from_status, to_status, by_user, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(uid(), t.id, t.status, 'COMPLETED', ctx.user.id, 'Pekerjaan selesai; pembayaran tersedia', completedAt);
    });
  } catch (e) {
    if (e.status) return sendJSON(ctx.res, e.status, { error: e.message, ...(e.code ? { code: e.code } : {}), ...(e.missingPhotoKinds ? { missing_photo_kinds: e.missingPhotoKinds } : {}) });
    throw e;
  }
  timeline(t.id, 'STATUS', 'Service selesai', `Pekerjaan dan laporan ${reportNumber} selesai. Pembayaran ${proforma.number} tersedia.`, 'CUSTOMER_VISIBLE', ctx.user.id);
  notify({ role: 'admin', title: `Pekerjaan ${wo.number} selesai`, body: `${t.number} selesai oleh teknisi; pembayaran customer telah dibuka`, type: 'REPORT', ref_type: 'work_order', ref_id: wo.id });
  notify({ customer_id: t.customer_id, title: `Service ${t.number} selesai`, body: `Silakan bayar ${proforma.number} melalui QRIS atau transfer bank.`, type: 'INVOICE', ref_type: 'invoice', ref_id: proforma.id });
  audit(ctx.user, 'UPDATE', 'work_order', wo.id, `Menyelesaikan ${wo.number}; laporan ${reportNumber} auto-approved dan pembayaran dibuka`, ctx.ip);
  sendJSON(ctx.res, 200, { ok: true, report_id: reportId, report_number: reportNumber, invoice_id: proforma.id, invoice_number: proforma.number });
}

module.exports = {
  listWorkOrdersHandler, getWorkOrderHandler, startWorkOrderHandler, updateEquipmentIdentityHandler, submitDiagnosisHandler, startRepairHandler,
  saveChecklistHandler, saveDiagnosisHandler, addWorkPerformedHandler,
  addPartUsageHandler, removePartUsageHandler, rescheduleHandler, completeWorkOrderHandler,
  buildChecklistState
};
