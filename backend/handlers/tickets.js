'use strict';
const { db } = require('../db');
const { uid, now, sendJSON, nextNumber, fileSig } = require('../util');
const { scheduleAppointmentEmail, scheduleCustomerEmail, customerRequestEmail } = require('../email');
const {
  audit, timeline, setTicketStatus, getTicket, canAccessTicket,
  notify, TICKET_TRANSITIONS
} = require('./_common');

const SERVICE_TYPES = ['Repair', 'Preventive Maintenance', 'Installation', 'Inspection', 'Emergency'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

function attachmentWithUrl(a) {
  const sig = fileSig(a.id);
  return { ...a, url: `/api/files/${a.id}?exp=${sig.exp}&sig=${sig.sig}` };
}

function ticketSummary(t) {
  return {
    id: t.id, number: t.number, customer_id: t.customer_id, equipment_id: t.equipment_id,
    equipment_type: t.equipment_type, equipment_brand: t.equipment_brand,
    service_type: t.service_type, priority: t.priority, problem: t.problem, status: t.status,
    preferred_date: t.preferred_date, preferred_time: t.preferred_time,
    created_at: t.created_at, updated_at: t.updated_at, closed_at: t.closed_at
  };
}

async function listTicketsHandler(ctx) {
  const { status, priority, search, customer_id, page = '1' } = ctx.query;
  const limit = 50;
  const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
  const offset = (pageNum - 1) * limit;
  const where = [];
  const params = [];
  if (ctx.user.role === 'customer') where.push('t.customer_id = ?'), params.push(ctx.user.customer_id);
  else if (ctx.user.role === 'technician') where.push('t.id IN (SELECT ticket_id FROM work_orders WHERE technician_id = ?)'), params.push(ctx.user.id);
  else {
    if (customer_id) where.push('t.customer_id = ?'), params.push(customer_id);
  }
  if (status) where.push('t.status = ?'), params.push(status);
  if (priority) where.push('t.priority = ?'), params.push(priority);
  if (search) where.push('(t.number ILIKE ? OR t.problem ILIKE ? OR c.name ILIKE ?)'), params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const total = (await db.prepare(`SELECT COUNT(*) AS c FROM tickets t JOIN customers c ON c.id = t.customer_id ${whereSql}`).get(...params)).c;
  const rows = await db.prepare(
    `SELECT t.*, c.name AS customer_name, e.name AS equipment_name,
            (SELECT u.name FROM work_orders wo JOIN users u ON u.id = wo.technician_id
             WHERE wo.ticket_id = t.id ORDER BY wo.created_at ASC LIMIT 1) AS technician_name
     FROM tickets t
     JOIN customers c ON c.id = t.customer_id
     LEFT JOIN equipment e ON e.id = t.equipment_id
     ${whereSql}
     ORDER BY CASE t.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END, t.created_at DESC
     LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);
  sendJSON(ctx.res, 200, { tickets: rows.map(ticketSummary).map((t, i) => ({ ...t, customer_name: rows[i].customer_name, equipment_name: rows[i].equipment_name, technician_name: rows[i].technician_name })), total, page: pageNum, pages: Math.ceil(total / limit) });
}

async function createTicketHandler(ctx) {
  const { equipment_id, equipment_type = '', equipment_brand = '', service_address = '', service_type, priority = 'MEDIUM', problem, description = '', preferred_date = '', preferred_time = '', contact_name = '', contact_phone = '' } = ctx.body;
  if (!problem) return sendJSON(ctx.res, 400, { error: 'Deskripsi masalah wajib diisi' });
  if (!SERVICE_TYPES.includes(service_type)) return sendJSON(ctx.res, 400, { error: 'Jenis service tidak valid' });
  if (!PRIORITIES.includes(priority)) return sendJSON(ctx.res, 400, { error: 'Prioritas tidak valid' });
  let customer_id = ctx.user.customer_id;
  let equipment = null;
  if (equipment_id) {
    equipment = await db.prepare('SELECT * FROM equipment WHERE id = ?').get(equipment_id);
    if (!equipment) return sendJSON(ctx.res, 400, { error: 'Equipment tidak ditemukan' });
    if (ctx.user.role === 'customer' && equipment.customer_id !== customer_id) return sendJSON(ctx.res, 403, { error: 'Equipment bukan milik Anda' });
    customer_id = equipment.customer_id;
  }
  if (!customer_id) return sendJSON(ctx.res, 400, { error: 'Pilih equipment customer' });
  if (ctx.user.role === 'admin' && !equipment_id && !ctx.body.customer_id) return sendJSON(ctx.res, 400, { error: 'Pilih equipment atau customer' });
  if (ctx.user.role === 'admin' && !equipment_id && ctx.body.customer_id) {
    customer_id = ctx.body.customer_id;
    const cust = await db.prepare('SELECT id FROM customers WHERE id = ?').get(customer_id);
    if (!cust) return sendJSON(ctx.res, 400, { error: 'Customer tidak ditemukan' });
  }
  if (ctx.user.role === 'customer' && !equipment_id && !equipment_type) return sendJSON(ctx.res, 400, { error: 'Pilih jenis equipment' });

  const id = uid();
  const number = await nextNumber('TKT');
  const ts = now();
  try {
    await db.transaction(async (tx) => {
      await tx.prepare(`INSERT INTO tickets (id, number, customer_id, equipment_id, equipment_type, equipment_brand, service_address, contact_name, contact_phone, service_type, priority, problem, description, preferred_date, preferred_time, status, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)`)
        .run(id, number, customer_id, equipment_id || null, equipment_type, equipment_brand, service_address, contact_name, contact_phone, service_type, priority, problem, description, preferred_date, preferred_time, ctx.user.id, ts, ts);
      await tx.prepare('INSERT INTO ticket_status_history (id, ticket_id, from_status, to_status, by_user, note, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?)')
        .run(uid(), id, 'OPEN', ctx.user.id, 'Request dibuat', ts);
      await tx.prepare('INSERT INTO ticket_timeline (id, ticket_id, type, title, description, visibility, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(uid(), id, 'REQUEST', 'Service request dibuat', problem, 'CUSTOMER_VISIBLE', ctx.user.id, ts);
    });
  } catch (error) {
    if (error.status) return sendJSON(ctx.res, error.status, { error: error.message, ...(error.code ? { code: error.code } : {}) });
    throw error;
  }
  if (ctx.user.role === 'customer') {
    const customer = await db.prepare('SELECT name, email FROM customers WHERE id = ?').get(customer_id);
    const customerUser = await db.prepare("SELECT email FROM users WHERE customer_id = ? AND active = 1 ORDER BY created_at ASC LIMIT 1").get(customer_id);
    scheduleAppointmentEmail(ctx, {
      id,
      number,
      customerName: customer?.name || '',
      customerEmail: customer?.email || customerUser?.email || ctx.user.email || '',
      actorName: ctx.user.name || '',
      actorRole: ctx.user.role,
      contactName: contact_name,
      contactPhone: contact_phone,
      serviceType: service_type,
      priority,
      equipmentType: equipment?.name || equipment_type,
      equipmentBrand: equipment?.model || equipment_brand,
      problem,
      description,
      serviceAddress: service_address,
      preferredDate: preferred_date,
      preferredTime: preferred_time,
      createdAt: ts,
      adminUrl: `https://denttech.id/admin/ticket-detail.html?id=${encodeURIComponent(id)}`
    });
    scheduleCustomerEmail(ctx, {
      to: customer?.email || customerUser?.email || ctx.user.email || '',
      content: customerRequestEmail({
        number,
        customerName: customer?.name || '',
        serviceType: service_type,
        priority,
        equipmentType: equipment?.name || equipment_type,
        equipmentBrand: equipment?.model || equipment_brand,
        problem,
        serviceAddress: service_address,
        preferredDate: preferred_date,
        preferredTime: preferred_time,
        createdAt: ts,
        customerUrl: `https://denttech.id/customer/ticket-detail.html?id=${encodeURIComponent(id)}`
      })
    });
  }
  notify({ role: 'admin', title: `Ticket baru ${number}`, body: `${problem} (${priority})`, type: 'TICKET', ref_type: 'ticket', ref_id: id });
  audit(ctx.user, 'CREATE', 'ticket', id, `Membuat ticket ${number}`, ctx.ip);
  sendJSON(ctx.res, 201, { id, number });
}

async function updateTicketHandler(ctx) {
  const t = await getTicket(ctx.params.id);
  if (!t) return sendJSON(ctx.res, 404, { error: 'Ticket tidak ditemukan' });
  if (ctx.user.role !== 'admin') return sendJSON(ctx.res, 403, { error: 'Hanya admin yang dapat mengedit ticket' });
  const b = ctx.body;
  if (b.service_type !== undefined && !SERVICE_TYPES.includes(b.service_type)) return sendJSON(ctx.res, 400, { error: 'Jenis service tidak valid' });
  if (b.priority !== undefined && !PRIORITIES.includes(b.priority)) return sendJSON(ctx.res, 400, { error: 'Prioritas tidak valid' });
  if (b.problem !== undefined && !String(b.problem).trim()) return sendJSON(ctx.res, 400, { error: 'Masalah tidak boleh kosong' });
  if (b.equipment_id) {
    const eq = await db.prepare('SELECT * FROM equipment WHERE id = ?').get(b.equipment_id);
    if (!eq) return sendJSON(ctx.res, 400, { error: 'Equipment tidak ditemukan' });
  }
  const fields = ['problem', 'description', 'service_type', 'priority', 'equipment_type', 'equipment_brand', 'service_address', 'preferred_date', 'preferred_time', 'contact_name', 'contact_phone'];
  for (const f of fields) {
    if (b[f] !== undefined) await db.prepare(`UPDATE tickets SET ${f} = ? WHERE id = ?`).run(b[f], t.id);
  }
  if (b.equipment_id !== undefined) await db.prepare('UPDATE tickets SET equipment_id = ? WHERE id = ?').run(b.equipment_id || null, t.id);
  await db.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').run(now(), t.id);
  timeline(t.id, 'NOTE', 'Ticket diperbarui admin', 'Detail ticket direvisi oleh admin', 'INTERNAL', ctx.user.id);
  audit(ctx.user, 'UPDATE', 'ticket', t.id, `Mengedit ticket ${t.number}`, ctx.ip);
  sendJSON(ctx.res, 200, { ok: true });
}

async function getTicketHandler(ctx) {
  const t = await db.prepare(
    `SELECT t.*, c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address, c.city AS customer_city,
       e.name AS equipment_name, e.category AS equipment_category, e.model AS equipment_model, e.serial_number AS equipment_serial, e.location AS equipment_location
     FROM tickets t JOIN customers c ON c.id = t.customer_id LEFT JOIN equipment e ON e.id = t.equipment_id WHERE t.id = ?`
  ).get(ctx.params.id);
  if (!t) return sendJSON(ctx.res, 404, { error: 'Ticket tidak ditemukan' });
  if (!await canAccessTicket(ctx.user, t)) return sendJSON(ctx.res, 403, { error: 'Tidak memiliki akses ke ticket ini' });

  const isCustomer = ctx.user.role === 'customer';
  const visFilter = isCustomer ? " AND visibility != 'INTERNAL'" : '';

  const tl = await db.prepare(`SELECT * FROM ticket_timeline WHERE ticket_id = ? ${visFilter} ORDER BY created_at ASC`).all(t.id);
  const history = await db.prepare('SELECT * FROM ticket_status_history WHERE ticket_id = ? ORDER BY created_at ASC').all(t.id);
  const attachments = (await db.prepare(`SELECT * FROM attachments WHERE ticket_id = ? ${visFilter} ORDER BY created_at ASC`).all(t.id)).map(attachmentWithUrl);

  let workOrders = await db.prepare(
    `SELECT wo.*, u.name AS technician_name, u.phone AS technician_phone FROM work_orders wo LEFT JOIN users u ON u.id = wo.technician_id WHERE wo.ticket_id = ? ORDER BY wo.created_at ASC`
  ).all(t.id);
  if (ctx.user.role === 'technician') workOrders = workOrders.filter((w) => w.technician_id === ctx.user.id);

  const report = await db.prepare(
    `SELECT sr.* FROM service_reports sr JOIN work_orders wo ON wo.id = sr.work_order_id WHERE wo.ticket_id = ? ORDER BY sr.created_at DESC LIMIT 1`
  ).get(t.id);
  const invoice = await db.prepare('SELECT id, number, status, issued_at, due_at, paid_at FROM invoices WHERE ticket_id = ? ORDER BY created_at DESC LIMIT 1').get(t.id);

  const result = {
    ticket: t,
    timeline: tl,
    status_history: isCustomer ? undefined : history,
    attachments,
    work_orders: workOrders,
    service_report: report && (isCustomer ? (report.status === 'APPROVED' ? { id: report.id, number: report.number, status: report.status, summary: report.summary, approved_at: report.approved_at } : { status: report.status, number: report.number }) : report) || null,
    invoice: invoice || null
  };
  sendJSON(ctx.res, 200, result);
}

async function changeStatusHandler(ctx) {
  const t = await getTicket(ctx.params.id);
  if (!t) return sendJSON(ctx.res, 404, { error: 'Ticket tidak ditemukan' });
  const { status, note = '' } = ctx.body;
  const allowed = TICKET_TRANSITIONS[t.status] || [];
  if (!allowed.includes(status)) return sendJSON(ctx.res, 400, { error: `Transisi dari ${t.status} ke ${status} tidak diizinkan` });
  await setTicketStatus(t, status, ctx.user, note);
  await db.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').run(now(), t.id);
  timeline(t.id, 'STATUS', `Status menjadi ${status}`, note, status === 'CANCELLED' ? 'CUSTOMER_VISIBLE' : 'CUSTOMER_VISIBLE', ctx.user.id);
  if (status === 'CANCELLED') notify({ customer_id: t.customer_id, title: `Ticket ${t.number} dibatalkan`, body: note || 'Ticket dibatalkan oleh admin', type: 'TICKET', ref_type: 'ticket', ref_id: t.id });
  audit(ctx.user, 'UPDATE', 'ticket', t.id, `Ubah status ${t.number}: ${t.status} → ${status}`, ctx.ip);
  sendJSON(ctx.res, 200, { ok: true });
}

async function assignTicketHandler(ctx) {
  const t = await getTicket(ctx.params.id);
  if (!t) return sendJSON(ctx.res, 404, { error: 'Ticket tidak ditemukan' });
  if (!['OPEN', 'REVIEWING'].includes(t.status)) return sendJSON(ctx.res, 400, { error: 'Ticket hanya bisa ditugaskan dari status OPEN atau REVIEWING' });
  const { technician_id, scheduled_date, time_window = '', checklist_template_id = null } = ctx.body;
  if (!technician_id || !scheduled_date) return sendJSON(ctx.res, 400, { error: 'Teknisi dan tanggal jadwal wajib diisi' });
  const tech = await db.prepare("SELECT * FROM users WHERE id = ? AND role = 'technician' AND active = 1").get(technician_id);
  if (!tech) return sendJSON(ctx.res, 400, { error: 'Teknisi tidak ditemukan atau nonaktif' });
  let template = null;
  if (checklist_template_id) {
    template = await db.prepare('SELECT * FROM checklist_templates WHERE id = ?').get(checklist_template_id);
    if (!template) return sendJSON(ctx.res, 400, { error: 'Checklist template tidak ditemukan' });
  } else {
    const eq = t.equipment_id ? await db.prepare('SELECT * FROM equipment WHERE id = ?').get(t.equipment_id) : null;
    const targetCategory = t.equipment_type || (eq ? eq.category : '');
    if (targetCategory) {
      template = await db.prepare(
        `SELECT * FROM checklist_templates WHERE status = 'ACTIVE' AND equipment_category = ?
         ORDER BY CASE WHEN service_type = ? THEN 0 ELSE 1 END, created_at DESC LIMIT 1`
      ).get(targetCategory, t.service_type);
    }
    if (!template) {
      template = await db.prepare(
        `SELECT * FROM checklist_templates WHERE status = 'ACTIVE' AND equipment_category IN ('ALL','')
         ORDER BY CASE WHEN service_type = ? THEN 0 ELSE 1 END, created_at DESC LIMIT 1`
      ).get(t.service_type);
    }
    if (!template) {
      template = await db.prepare(
        `SELECT * FROM checklist_templates WHERE status = 'ACTIVE'
         ORDER BY CASE WHEN service_type = ? THEN 0 ELSE 1 END, created_at DESC LIMIT 1`
      ).get(t.service_type);
    }
  }

  const equipment = t.equipment_id ? await db.prepare('SELECT * FROM equipment WHERE id = ?').get(t.equipment_id) : null;
  const servicedName = equipment?.name || t.equipment_brand || t.equipment_type || '';
  const servicedTypeModel = equipment?.model || [t.equipment_type, t.equipment_brand].filter(Boolean).join(' — ') || equipment?.category || '';
  const servicedSerial = equipment?.serial_number || '';
  const woId = uid();
  const woNumber = await nextNumber('WO');
  await db.prepare(`INSERT INTO work_orders (id, number, ticket_id, technician_id, checklist_template_id, scheduled_date, time_window, status,
    serviced_equipment_name, serviced_equipment_type_model, serviced_equipment_serial_number, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'ASSIGNED', ?, ?, ?, ?, ?)`)
    .run(woId, woNumber, t.id, tech.id, template ? template.id : null, scheduled_date, time_window, servicedName, servicedTypeModel, servicedSerial, now(), now());
  await setTicketStatus(t, 'ASSIGNED', ctx.user, `Ditugaskan ke ${tech.name}`);
  await db.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').run(now(), t.id);
  timeline(t.id, 'ASSIGNMENT', 'Teknisi ditugaskan', `${tech.name} dijadwalkan ${scheduled_date} ${time_window}`.trim(), 'CUSTOMER_VISIBLE', ctx.user.id);
  notify({ user_id: tech.id, title: `Work order baru ${woNumber}`, body: `${t.problem} — ${scheduled_date} ${time_window}`.trim(), type: 'WORK_ORDER', ref_type: 'work_order', ref_id: woId });
  notify({ customer_id: t.customer_id, title: `Ticket ${t.number} dijadwalkan`, body: `Teknisi ${tech.name} dijadwalkan ${scheduled_date} ${time_window}`.trim(), type: 'WORK_ORDER', ref_type: 'ticket', ref_id: t.id });
  audit(ctx.user, 'CREATE', 'work_order', woId, `Assignment ${woNumber} ke ${tech.name}`, ctx.ip);
  sendJSON(ctx.res, 201, { work_order_id: woId, number: woNumber });
}

async function commentHandler(ctx) {
  const t = await getTicket(ctx.params.id);
  if (!t) return sendJSON(ctx.res, 404, { error: 'Ticket tidak ditemukan' });
  if (!await canAccessTicket(ctx.user, t)) return sendJSON(ctx.res, 403, { error: 'Tidak memiliki akses ke ticket ini' });
  const { message } = ctx.body;
  if (!message || !String(message).trim()) return sendJSON(ctx.res, 400, { error: 'Pesan tidak boleh kosong' });
  timeline(t.id, 'COMMENT', `${ctx.user.name}`, String(message).trim(), 'CUSTOMER_VISIBLE', ctx.user.id);
  await db.prepare('UPDATE tickets SET updated_at = ? WHERE id = ?').run(now(), t.id);
  if (ctx.user.role === 'customer') {
    notify({ role: 'admin', title: `Pesan baru di ${t.number}`, body: String(message).slice(0, 120), type: 'COMMENT', ref_type: 'ticket', ref_id: t.id });
  } else {
    notify({ customer_id: t.customer_id, title: `Pesan baru di ${t.number}`, body: String(message).slice(0, 120), type: 'COMMENT', ref_type: 'ticket', ref_id: t.id });
  }
  audit(ctx.user, 'CREATE', 'comment', t.id, `Komentar di ${t.number}`, ctx.ip);
  sendJSON(ctx.res, 201, { ok: true });
}

async function internalNoteHandler(ctx) {
  const t = await getTicket(ctx.params.id);
  if (!t) return sendJSON(ctx.res, 404, { error: 'Ticket tidak ditemukan' });
  if (ctx.user.role === 'customer') return sendJSON(ctx.res, 403, { error: 'Tidak memiliki akses' });
  if (ctx.user.role === 'technician' && !await canAccessTicket(ctx.user, t)) return sendJSON(ctx.res, 403, { error: 'Tidak memiliki akses ke ticket ini' });
  const { message } = ctx.body;
  if (!message || !String(message).trim()) return sendJSON(ctx.res, 400, { error: 'Catatan tidak boleh kosong' });
  timeline(t.id, 'NOTE', `Catatan internal — ${ctx.user.name}`, String(message).trim(), 'INTERNAL', ctx.user.id);
  audit(ctx.user, 'CREATE', 'note', t.id, `Catatan internal di ${t.number}`, ctx.ip);
  sendJSON(ctx.res, 201, { ok: true });
}

module.exports = {
  SERVICE_TYPES, PRIORITIES,
  listTicketsHandler, createTicketHandler, updateTicketHandler, getTicketHandler,
  changeStatusHandler, assignTicketHandler, commentHandler, internalNoteHandler
};
