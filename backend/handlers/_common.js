'use strict';
const { db } = require('../db');
const { trackTask } = require('../runtime');
const { uid, now, fileSig } = require('../util');
const { pushNotify } = require('../push');

const TICKET_TRANSITIONS = {
  OPEN: ['REVIEWING', 'CANCELLED'],
  // 'ASSIGNED' tidak diizinkan lewat endpoint status: assignment harus lewat
  // assignTicketHandler agar work order selalu ikut dibuat (hindari ticket yatim).
  REVIEWING: ['OPEN', 'CANCELLED'],
  ASSIGNED: ['CANCELLED'],
  IN_PROGRESS: ['CANCELLED'],
  WAITING_QUOTATION: ['WAITING_CUSTOMER_APPROVAL', 'CANCELLED'],
  WAITING_CUSTOMER_APPROVAL: ['REPAIR_AUTHORIZED', 'CANCELLED'],
  REPAIR_AUTHORIZED: ['REPAIR_IN_PROGRESS', 'CANCELLED'],
  REPAIR_IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: []
};

// Notifikasi in-app (tabel notifications) + Web Push (bunyi/banner OS saat
// aplikasi tertutup) ke user yang masih memiliki push subscription (login).
// Insert in-app dulu, lalu push — badge unread di payload sudah mencakup notif baru.
function notify({ user_id = null, role = null, customer_id = null, title, body = '', type = 'INFO', ref_type = '', ref_id = '' }) {
  trackTask((async () => {
    await db.prepare('INSERT INTO notifications (id, user_id, role, customer_id, title, body, type, ref_type, ref_id, read_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)')
      .run(uid(), user_id, role, customer_id, title, body, type, ref_type, ref_id, now());
    const userIds = await pushRecipients({ user_id, role, customer_id });
    if (userIds.length) await pushNotify(userIds, { title, body, type, ref_type, ref_id });
  })(), 'push');
}

async function pushRecipients({ user_id, role, customer_id }) {
  try {
    if (user_id) {
      const rows = await db.prepare('SELECT DISTINCT user_id FROM push_subscriptions WHERE user_id = ?').all(user_id);
      return rows.map((r) => r.user_id);
    }
    if (customer_id) {
      const rows = await db.prepare('SELECT DISTINCT user_id FROM push_subscriptions WHERE user_id IN (SELECT id FROM users WHERE customer_id = ? AND active = 1)').all(customer_id);
      return rows.map((r) => r.user_id);
    }
    if (role) {
      const rows = await db.prepare('SELECT DISTINCT user_id FROM push_subscriptions WHERE user_id IN (SELECT id FROM users WHERE role = ? AND active = 1)').all(role);
      return rows.map((r) => r.user_id);
    }
    return [];
  } catch {
    return [];
  }
}

function audit(user, action, entity, entityId, details, ip = '') {
  return trackTask(db.prepare('INSERT INTO audit_logs (id, user_id, user_name, role, action, entity, entity_id, details, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(uid(), user ? user.id : null, user ? user.name : '', user ? user.role : '', action, entity, entityId, details, ip, now()), 'audit');
}

function timeline(ticketId, type, title, description, visibility, createdBy) {
  return trackTask(db.prepare('INSERT INTO ticket_timeline (id, ticket_id, type, title, description, visibility, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(uid(), ticketId, type, title, description || '', visibility || 'CUSTOMER_VISIBLE', createdBy || null, now()), 'timeline');
}

async function setTicketStatus(ticket, toStatus, user, note = '', { executor = db, ts = null } = {}) {
  const at = ts || now();
  await executor.prepare('UPDATE tickets SET status = ?, updated_at = ?, closed_at = CASE WHEN ? IN (\'CLOSED\',\'CANCELLED\') THEN ? ELSE closed_at END WHERE id = ?')
    .run(toStatus, at, toStatus, at, ticket.id);
  await executor.prepare('INSERT INTO ticket_status_history (id, ticket_id, from_status, to_status, by_user, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(uid(), ticket.id, ticket.status, toStatus, user ? user.id : null, note, at);
}

async function getTicket(id) {
  return (await db.prepare('SELECT * FROM tickets WHERE id = ?').get(id)) || null;
}

function attachmentWithUrl(a) {
  const sig = fileSig(a.id);
  return { ...a, url: `/api/files/${a.id}?exp=${sig.exp}&sig=${sig.sig}` };
}

// Rate limiter sliding-window sederhana per isolate.
const rateHits = new Map();
function rateAllowed(key, limit, windowMs) {
  const nowMs = Date.now();
  if (rateHits.size > 10000) {
    for (const [candidate, hit] of rateHits) if (nowMs - hit.startedAt >= windowMs) rateHits.delete(candidate);
  }
  const entry = rateHits.get(key);
  if (!entry || nowMs - entry.startedAt >= windowMs) { rateHits.set(key, { startedAt: nowMs, count: 1 }); return true; }
  entry.count++;
  return entry.count <= limit;
}

async function getWorkOrder(id) {
  return (await db.prepare('SELECT * FROM work_orders WHERE id = ?').get(id)) || null;
}

async function canAccessTicket(user, ticket) {
  if (!user || !ticket) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'customer') return ticket.customer_id === user.customer_id;
  if (user.role === 'technician') {
    const wo = await db.prepare('SELECT id FROM work_orders WHERE ticket_id = ? AND technician_id = ?').get(ticket.id, user.id);
    return !!wo;
  }
  return false;
}

async function canAccessWorkOrder(user, wo) {
  if (!user || !wo) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'technician') return wo.technician_id === user.id;
  if (user.role === 'customer') {
    const t = await getTicket(wo.ticket_id);
    return !!t && t.customer_id === user.customer_id;
  }
  return false;
}

async function partTotalForWorkOrder(woId) {
  const row = await db.prepare('SELECT COALESCE(SUM(qty * unit_price), 0)::float8 AS total FROM part_usages WHERE work_order_id = ?').get(woId);
  return row.total;
}

async function getInvoiceItems(invoiceId, executor = db) {
  return executor.prepare(`SELECT id, invoice_id, item_type, description,
    qty::float8 AS qty, unit, unit_price::float8 AS unit_price,
    sort_order, source_id, created_at, updated_at
    FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order, created_at, id`).all(invoiceId);
}

function invoiceItemsTotal(items) {
  return Math.round((items || []).reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.unit_price || 0), 0) * 100) / 100;
}

async function snapshotWorkOrderInvoiceItems(executor, invoiceId, workOrderId, laborCost, laborDescription) {
  const ts = now();
  await executor.prepare(`INSERT INTO invoice_items (id, invoice_id, item_type, description, qty, unit, unit_price, sort_order, source_id, created_at, updated_at)
    VALUES (?, ?, 'LABOR', ?, 1, 'jasa', ?, 0, 'labor', ?, ?)`)
    .run(uid(), invoiceId, laborDescription || 'Biaya Jasa', laborCost, ts, ts);
  if (!workOrderId) return;
  const parts = await executor.prepare(`SELECT pu.id, pu.qty::float8 AS qty, pu.unit_price::float8 AS unit_price, p.name, p.code, p.unit
    FROM part_usages pu JOIN parts p ON p.id = pu.part_id
    WHERE pu.work_order_id = ? ORDER BY pu.created_at, pu.id`).all(workOrderId);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    await executor.prepare(`INSERT INTO invoice_items (id, invoice_id, item_type, description, qty, unit, unit_price, sort_order, source_id, created_at, updated_at)
      VALUES (?, ?, 'PART', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(uid(), invoiceId, `Spare Part: ${p.name}${p.code ? ` (${p.code})` : ''}`, p.qty, p.unit || 'pcs', p.unit_price, 100 + i, p.id, ts, ts);
  }
}

// Sinkronkan ulang baris PART invoice dengan part_usages work order.
// Dipakai saat pekerjaan selesai: part baru dicatat setelah proforma disetujui,
// sehingga snapshot awal (saat proforma dibuat) selalu kosong.
async function resyncWorkOrderParts(executor, invoiceId, workOrderId) {
  const ts = now();
  await executor.prepare("DELETE FROM invoice_items WHERE invoice_id = ? AND item_type = 'PART'").run(invoiceId);
  if (!workOrderId) return 0;
  const parts = await executor.prepare(`SELECT pu.id, pu.qty::float8 AS qty, pu.unit_price::float8 AS unit_price, p.name, p.code, p.unit
    FROM part_usages pu JOIN parts p ON p.id = pu.part_id
    WHERE pu.work_order_id = ? ORDER BY pu.created_at, pu.id`).all(workOrderId);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    await executor.prepare(`INSERT INTO invoice_items (id, invoice_id, item_type, description, qty, unit, unit_price, sort_order, source_id, created_at, updated_at)
      VALUES (?, ?, 'PART', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(uid(), invoiceId, `Spare Part: ${p.name}${p.code ? ` (${p.code})` : ''}`, p.qty, p.unit || 'pcs', p.unit_price, 100 + i, p.id, ts, ts);
  }
  return parts.length;
}

function invoiceTotals(inv, itemsOrPartTotal) {
  const items = Array.isArray(itemsOrPartTotal) ? itemsOrPartTotal : null;
  const labor = items ? invoiceItemsTotal(items.filter((x) => x.item_type === 'LABOR')) : Number(inv.labor_cost || 0);
  const parts = items ? invoiceItemsTotal(items.filter((x) => x.item_type === 'PART')) : Math.round(Number(itemsOrPartTotal || 0) * 100) / 100;
  const custom = items ? invoiceItemsTotal(items.filter((x) => x.item_type === 'CUSTOM')) : 0;
  const itemsTotal = items ? invoiceItemsTotal(items) : labor + parts;
  const discount = Number(inv.discount || 0);
  const subtotal = Math.max(0, itemsTotal - discount);
  const taxRate = Number(inv.tax_rate || 0);
  const tax = Math.round(subtotal * taxRate) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;
  return { labor_cost: labor, parts_total: parts, custom_total: custom, items_total: itemsTotal, discount, subtotal: Math.round(subtotal * 100) / 100, tax_rate: taxRate, tax, total };
}

const REQUIRED_PHOTO_KINDS = ['before', 'after', 'equipment_brand', 'equipment_serial'];

async function workOrderPhotoRequirements(workOrderId, executor = db) {
  const rows = await executor.prepare(`SELECT kind, COUNT(*) AS count FROM attachments
    WHERE work_order_id = ? AND kind IN ('before','after','equipment_brand','equipment_serial','part_replacement')
      AND mime IN ('image/jpeg','image/png','image/webp') GROUP BY kind`).all(workOrderId);
  const counts = Object.fromEntries(rows.map((row) => [row.kind, Number(row.count)]));
  const partUsed = !!(await executor.prepare('SELECT id FROM part_usages WHERE work_order_id = ? LIMIT 1').get(workOrderId));
  const required = [...REQUIRED_PHOTO_KINDS, ...(partUsed ? ['part_replacement'] : [])];
  const missing = required.filter((kind) => !counts[kind]);
  return { required, counts, missing, part_used: partUsed, complete: missing.length === 0 };
}

async function buildChecklistState(wo, executor = db) {
  if (!wo || !wo.checklist_template_id) return null;
  const [tpl, items, responses] = await Promise.all([
    executor.prepare('SELECT * FROM checklist_templates WHERE id = ?').get(wo.checklist_template_id),
    executor.prepare('SELECT * FROM checklist_template_items WHERE template_id = ? ORDER BY sort_order').all(wo.checklist_template_id),
    executor.prepare('SELECT * FROM checklist_responses WHERE work_order_id = ?').all(wo.id)
  ]);
  if (!tpl) return null;
  const respByItem = new Map(responses.map((r) => [r.item_id, r]));
  const sections = [];
  const sectionMap = new Map();
  for (const item of items) {
    if (!sectionMap.has(item.section)) {
      const s = { section: item.section, items: [] };
      sectionMap.set(item.section, s);
      sections.push(s);
    }
    const r = respByItem.get(item.id);
    sectionMap.get(item.section).items.push({
      id: item.id, label: item.label, required: !!item.required,
      result: r ? r.result : '', note: r ? r.note : ''
    });
  }
  const requiredItems = items.filter((i) => i.required);
  const answeredRequired = requiredItems.filter((i) => {
    const r = respByItem.get(i.id);
    return r && ['PASS', 'FAIL', 'NA'].includes(r.result);
  });
  return {
    template: { id: tpl.id, name: tpl.name, version: tpl.version },
    sections,
    total_items: items.length,
    answered_items: responses.filter((r) => ['PASS', 'FAIL', 'NA'].includes(r.result)).length,
    required_total: requiredItems.length,
    required_done: answeredRequired.length,
    complete: requiredItems.length === answeredRequired.length
  };
}

module.exports = {
  TICKET_TRANSITIONS,
  notify, audit, timeline, setTicketStatus,
  getTicket, getWorkOrder, canAccessTicket, canAccessWorkOrder, attachmentWithUrl, rateAllowed,
  partTotalForWorkOrder, getInvoiceItems, invoiceItemsTotal, snapshotWorkOrderInvoiceItems, resyncWorkOrderParts, invoiceTotals,
  REQUIRED_PHOTO_KINDS, workOrderPhotoRequirements, buildChecklistState
};
