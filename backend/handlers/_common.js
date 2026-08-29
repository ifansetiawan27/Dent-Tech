'use strict';
const { db } = require('../db');
const { uid, now } = require('../util');

const TICKET_STATUSES = ['OPEN', 'REVIEWING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED', 'CANCELLED'];
const WO_STATUSES = ['ASSIGNED', 'STARTED', 'COMPLETED', 'APPROVED', 'CANCELLED'];

const TICKET_TRANSITIONS = {
  OPEN: ['REVIEWING', 'CANCELLED'],
  REVIEWING: ['ASSIGNED', 'OPEN', 'CANCELLED'],
  ASSIGNED: ['CANCELLED'],
  IN_PROGRESS: ['CANCELLED'],
  COMPLETED: [],
  CLOSED: [],
  CANCELLED: []
};

function notify({ user_id = null, role = null, customer_id = null, title, body = '', type = 'INFO', ref_type = '', ref_id = '' }) {
  db.prepare('INSERT INTO notifications (id, user_id, role, customer_id, title, body, type, ref_type, ref_id, read_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)')
    .run(uid(), user_id, role, customer_id, title, body, type, ref_type, ref_id, now())
    .catch((e) => console.error('[notify]', e.message));
}

function audit(user, action, entity, entityId, details, ip = '') {
  db.prepare('INSERT INTO audit_logs (id, user_id, user_name, role, action, entity, entity_id, details, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(uid(), user ? user.id : null, user ? user.name : '', user ? user.role : '', action, entity, entityId, details, ip, now())
    .catch((e) => console.error('[audit]', e.message));
}

function timeline(ticketId, type, title, description, visibility, createdBy) {
  db.prepare('INSERT INTO ticket_timeline (id, ticket_id, type, title, description, visibility, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(uid(), ticketId, type, title, description || '', visibility || 'CUSTOMER_VISIBLE', createdBy || null, now())
    .catch((e) => console.error('[timeline]', e.message));
}

async function setTicketStatus(ticket, toStatus, user, note = '') {
  await db.prepare('UPDATE tickets SET status = ?, updated_at = ?, closed_at = CASE WHEN ? IN (\'CLOSED\',\'CANCELLED\') THEN ? ELSE closed_at END WHERE id = ?')
    .run(toStatus, now(), toStatus, now(), ticket.id);
  await db.prepare('INSERT INTO ticket_status_history (id, ticket_id, from_status, to_status, by_user, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(uid(), ticket.id, ticket.status, toStatus, user ? user.id : null, note, now());
}

async function getTicket(id) {
  return (await db.prepare('SELECT * FROM tickets WHERE id = ?').get(id)) || null;
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
  const row = await db.prepare('SELECT COALESCE(SUM(qty * unit_price), 0) AS total FROM part_usages WHERE work_order_id = ?').get(woId);
  return row.total;
}

function invoiceTotals(inv, partTotal) {
  const parts = Math.round(partTotal * 100) / 100;
  const subtotal = Math.max(0, inv.labor_cost + parts - inv.discount);
  const tax = Math.round(subtotal * inv.tax_rate) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;
  return { labor_cost: inv.labor_cost, parts_total: parts, discount: inv.discount, subtotal: Math.round(subtotal * 100) / 100, tax_rate: inv.tax_rate, tax, total };
}

function customerVisible(obj, allowedKeys) {
  const out = {};
  for (const k of allowedKeys) if (k in obj) out[k] = obj[k];
  return out;
}

async function buildChecklistState(wo) {
  if (!wo || !wo.checklist_template_id) return null;
  const tpl = await db.prepare('SELECT * FROM checklist_templates WHERE id = ?').get(wo.checklist_template_id);
  if (!tpl) return null;
  const items = await db.prepare('SELECT * FROM checklist_template_items WHERE template_id = ? ORDER BY sort_order').all(tpl.id);
  const responses = await db.prepare('SELECT * FROM checklist_responses WHERE work_order_id = ?').all(wo.id);
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
  TICKET_STATUSES, WO_STATUSES, TICKET_TRANSITIONS,
  notify, audit, timeline, setTicketStatus,
  getTicket, getWorkOrder, canAccessTicket, canAccessWorkOrder,
  partTotalForWorkOrder, invoiceTotals, customerVisible, buildChecklistState
};
