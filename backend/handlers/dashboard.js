'use strict';
const { db } = require('../db');
const { sendJSON, localDate, localMonthKey } = require('../util');

async function dashboardHandler(ctx) {
  const role = ctx.user.role;
  if (role === 'admin') {
    const stat = async (sql, ...p) => (await db.prepare(sql).get(...p)).c;
    const openTickets = await stat("SELECT COUNT(*) AS c FROM tickets WHERE status IN ('OPEN','REVIEWING')");
    const inProgress = await stat("SELECT COUNT(*) AS c FROM tickets WHERE status IN ('ASSIGNED','IN_PROGRESS')");
    const monthKey = localMonthKey();
    const completedMonth = await stat("SELECT COUNT(*) AS c FROM tickets WHERE status IN ('COMPLETED','CLOSED') AND substr(updated_at,1,7) = ?", monthKey);
    const activeCustomers = await stat("SELECT COUNT(*) AS c FROM customers WHERE status = 'ACTIVE'");
    const equipmentCount = await stat('SELECT COUNT(*) AS c FROM equipment');
    const lowStock = await stat('SELECT COUNT(*) AS c FROM parts WHERE stock <= min_stock');
    const pendingReports = await stat("SELECT COUNT(*) AS c FROM service_reports WHERE status = 'SUBMITTED'");
    const unpaid = (await db.prepare(`SELECT COALESCE(SUM(GREATEST(0, COALESCE(ii.items_total,0) - i.discount) * (1 + i.tax_rate/100.0)),0)::float8 AS s
      FROM invoices i LEFT JOIN (SELECT invoice_id, SUM(qty*unit_price) AS items_total FROM invoice_items GROUP BY invoice_id) ii ON ii.invoice_id = i.id
      WHERE i.status IN ('SENT','OVERDUE')`).get()).s;
    const paidMonth = (await db.prepare("SELECT COUNT(*) AS c FROM invoices WHERE status='PAID' AND substr(paid_at,1,7) = ?").get(monthKey)).c;
    const ticketsByStatus = await db.prepare('SELECT status, COUNT(*) AS count FROM tickets GROUP BY status').all();
    const today = new Date().toISOString().slice(0, 10);
    const todaysWorkOrders = await db.prepare(
      `SELECT wo.id, wo.number, wo.scheduled_date, wo.time_window, wo.status, t.number AS ticket_number, t.problem,
         c.name AS customer_name, u.name AS technician_name
       FROM work_orders wo JOIN tickets t ON t.id = wo.ticket_id JOIN customers c ON c.id = t.customer_id
       LEFT JOIN users u ON u.id = wo.technician_id
       WHERE wo.scheduled_date = ? AND wo.status IN ('ASSIGNED','STARTED')
       ORDER BY wo.time_window`
    ).all(today);
    const recentTickets = await db.prepare(
      `SELECT t.id, t.number, t.problem, t.status, t.priority, t.created_at, c.name AS customer_name
       FROM tickets t JOIN customers c ON c.id = t.customer_id ORDER BY t.created_at DESC LIMIT 8`
    ).all();
    const recentActivity = await db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 10').all();
    return sendJSON(ctx.res, 200, {
      stats: { openTickets, inProgress, completedMonth, activeCustomers, equipmentCount, lowStock, pendingReports, unpaidInvoiceTotal: unpaid, paidInvoicesMonth: paidMonth },
      tickets_by_status: ticketsByStatus,
      todays_work_orders: todaysWorkOrders,
      recent_tickets: recentTickets,
      recent_activity: recentActivity
    });
  }

  if (role === 'technician') {
    const today = localDate();
    const jobs = await db.prepare(
      `SELECT wo.*, t.number AS ticket_number, t.problem, t.priority, t.service_type,
         c.name AS customer_name, c.address AS customer_address, c.city AS customer_city, c.phone AS customer_phone,
         e.name AS equipment_name
       FROM work_orders wo JOIN tickets t ON t.id = wo.ticket_id JOIN customers c ON c.id = t.customer_id
       LEFT JOIN equipment e ON e.id = t.equipment_id
       WHERE wo.technician_id = ? AND wo.status IN ('ASSIGNED','STARTED')
       ORDER BY wo.scheduled_date ASC, wo.time_window`
    ).all(ctx.user.id);
    const monthKey = localMonthKey();
    const completedMonth = (await db.prepare(
      "SELECT COUNT(*) AS c FROM work_orders WHERE technician_id = ? AND status IN ('COMPLETED','APPROVED') AND substr(completed_at,1,7) = ?"
    ).get(ctx.user.id, monthKey)).c;
    const doneTotal = (await db.prepare("SELECT COUNT(*) AS c FROM work_orders WHERE technician_id = ? AND status IN ('COMPLETED','APPROVED')").get(ctx.user.id)).c;
    sendJSON(ctx.res, 200, {
      stats: { active: jobs.length, completed_month: completedMonth, completed_total: doneTotal },
      today_jobs: jobs.filter((j) => j.scheduled_date === today),
      upcoming_jobs: jobs.filter((j) => j.scheduled_date > today)
    });
    return;
  }

  // customer
  const cid = ctx.user.customer_id;
  const active = (await db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE customer_id = ? AND status NOT IN ('CLOSED','CANCELLED')").get(cid)).c;
  const equipmentCount = (await db.prepare('SELECT COUNT(*) AS c FROM equipment WHERE customer_id = ?').get(cid)).c;
  const unpaid = (await db.prepare("SELECT COUNT(*) AS c FROM invoices WHERE customer_id = ? AND status IN ('SENT','OVERDUE')").get(cid)).c;
  const recentTickets = await db.prepare(
    `SELECT t.id, t.number, t.problem, t.status, t.priority, t.created_at, e.name AS equipment_name
     FROM tickets t LEFT JOIN equipment e ON e.id = t.equipment_id WHERE t.customer_id = ? ORDER BY t.created_at DESC LIMIT 8`
  ).all(cid);
  const activeTicket = await db.prepare(
    `SELECT t.id, t.number, t.problem, t.status, t.priority, t.service_type, wo.scheduled_date, wo.time_window, u.name AS technician_name, wo.status AS wo_status
     FROM tickets t LEFT JOIN work_orders wo ON wo.ticket_id = t.id LEFT JOIN users u ON u.id = wo.technician_id
     WHERE t.customer_id = ? AND t.status IN ('ASSIGNED','IN_PROGRESS','COMPLETED') ORDER BY t.updated_at DESC LIMIT 1`
  ).get(cid);
  sendJSON(ctx.res, 200, { stats: { active_tickets: active, equipment: equipmentCount, unpaid_invoices: unpaid }, recent_tickets: recentTickets, active_ticket: activeTicket || null });
}

async function listNotificationsHandler(ctx) {
  const rows = await db.prepare(
    `SELECT * FROM notifications
     WHERE user_id = ? OR (user_id IS NULL AND role = ?) OR (user_id IS NULL AND role IS NULL AND customer_id = ?)
     ORDER BY created_at DESC LIMIT 50`
  ).all(ctx.user.id, ctx.user.role, ctx.user.customer_id || '');
  sendJSON(ctx.res, 200, { notifications: rows });
}

async function readNotificationHandler(ctx) {
  await db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL').run(new Date().toISOString(), ctx.params.id);
  sendJSON(ctx.res, 200, { ok: true });
}

async function readAllNotificationsHandler(ctx) {
  await db.prepare(
    `UPDATE notifications SET read_at = ? WHERE read_at IS NULL AND (user_id = ? OR (user_id IS NULL AND role = ?) OR (user_id IS NULL AND role IS NULL AND customer_id = ?))`
  ).run(new Date().toISOString(), ctx.user.id, ctx.user.role, ctx.user.customer_id || '');
  sendJSON(ctx.res, 200, { ok: true });
}

async function auditLogsHandler(ctx) {
  const { entity, search, limit = '200' } = ctx.query;
  const where = [];
  const params = [];
  if (entity) where.push('entity = ?'), params.push(entity);
  if (search) where.push('(details ILIKE ? OR user_name ILIKE ? OR entity_id ILIKE ?)'), params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const rows = await db.prepare(`SELECT * FROM audit_logs ${whereSql} ORDER BY created_at DESC LIMIT ?`).all(...params, Math.min(500, Number(limit) || 200));
  sendJSON(ctx.res, 200, { logs: rows });
}

module.exports = { dashboardHandler, listNotificationsHandler, readNotificationHandler, readAllNotificationsHandler, auditLogsHandler };
