'use strict';
require('dotenv').config();
const { db } = require('./backend/db');
const { uid, now } = require('./backend/util');
const walletH = require('./backend/handlers/wallet');
const ticketsH = require('./backend/handlers/tickets');
const invoicesH = require('./backend/handlers/invoices');
const financeH = require('./backend/handlers/finance');
const { snapshotWorkOrderInvoiceItems } = require('./backend/handlers/_common');
const { SUPPORT_EMAIL, FORWARD_DESTINATION, appointmentEmail, sendAppointmentEmail, scheduleAppointmentEmail } = require('./backend/email');

let passed = 0, failed = 0, createCalls = 0, scheduledEmails = 0;
const created = { customer: null, otherCustomer: null, user: null, invoice: null, ticket: null };
const ok = (condition, message) => { if (condition) { passed++; console.log('  [PASS]', message); } else { failed++; console.log('  [FAIL]', message); } };
function response() { return { status: 0, data: null, headersSent: false, writeHead(code) { this.status = code; this.headersSent = true; }, end(body) { this.data = JSON.parse(body); } }; }
async function invoke(handler, { user, params = {}, query = {}, body = {}, ip = 'test' }) {
  const res = response();
  await handler({ res, user, params, query, body, ip, runtimeEnv: {}, executionCtx: { waitUntil() { scheduledEmails++; } } });
  return res;
}

const completed = new Set();
walletH.setPakasirClient({
  async createQris({ orderId, amount }) {
    createCalls++;
    await new Promise((resolve) => setTimeout(resolve, 25));
    return { project: process.env.PAKASIR_PROJECT || 'dent-tech', order_id: orderId, amount, fee: 0, total_payment: amount, payment_method: 'qris', payment_number: `QR-${orderId}`, expired_at: new Date(Date.now() + 3600000).toISOString() };
  },
  async transactionDetail({ orderId, amount, project }) {
    return { project, order_id: orderId, amount, status: completed.has(orderId) ? 'completed' : 'pending', payment_method: 'qris', completed_at: now() };
  }
});

async function cleanup() {
  if (!created.customer) return;
  await db.transaction(async (tx) => {
    await tx.prepare("DELETE FROM audit_logs WHERE ip = 'test'").run();
    await tx.prepare('DELETE FROM notifications WHERE customer_id = ?').run(created.customer);
    await tx.prepare('DELETE FROM payments WHERE invoice_id = ?').run(created.invoice);
    await tx.prepare('DELETE FROM finance_income WHERE customer_id = ?').run(created.customer);
    await tx.prepare('DELETE FROM wallet_transactions WHERE customer_id = ?').run(created.customer);
    await tx.prepare('DELETE FROM payment_orders WHERE customer_id = ?').run(created.customer);
    await tx.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(created.invoice);
    await tx.prepare('DELETE FROM invoices WHERE customer_id = ?').run(created.customer);
    await tx.prepare('DELETE FROM ticket_timeline WHERE ticket_id IN (SELECT id FROM tickets WHERE customer_id = ?)').run(created.customer);
    await tx.prepare('DELETE FROM ticket_status_history WHERE ticket_id IN (SELECT id FROM tickets WHERE customer_id = ?)').run(created.customer);
    await tx.prepare('DELETE FROM tickets WHERE customer_id = ?').run(created.customer);
    await tx.prepare('DELETE FROM wallet_accounts WHERE customer_id = ?').run(created.customer);
    await tx.prepare('DELETE FROM users WHERE id = ?').run(created.user);
    await tx.prepare('DELETE FROM customers WHERE id = ?').run(created.customer);
    if (created.otherCustomer) await tx.prepare('DELETE FROM customers WHERE id = ?').run(created.otherCustomer);
  });
}
async function financeTotals() {
  const invoice = await db.prepare('SELECT COALESCE(SUM(amount),0)::float8 AS total FROM payments').get();
  const topup = await db.prepare("SELECT COALESCE(SUM(amount),0)::float8 AS total FROM finance_income WHERE income_type = 'WALLET_TOPUP_CASH'").get();
  const onsite = await db.prepare("SELECT COALESCE(SUM(amount),0)::float8 AS total FROM finance_income WHERE income_type = 'ONSITE_FEE_REVENUE'").get();
  const liability = await db.prepare('SELECT COALESCE(SUM(balance),0)::float8 AS total FROM wallet_accounts').get();
  return { invoice: Number(invoice.total), topup: Number(topup.total), onsite: Number(onsite.total), liability: Number(liability.total) };
}

(async () => {
  console.log('=== WALLET + PAKASIR BACKEND ===');
  await cleanup();
  const baseline = await financeTotals();
  const ts = now(); created.customer = uid(); created.otherCustomer = uid(); created.user = uid();
  await db.prepare("INSERT INTO customers (id, code, name, status, created_at) VALUES (?, ?, 'Wallet Test', 'ACTIVE', ?)").run(created.customer, `TEST-${created.customer.slice(0, 8)}`, ts);
  await db.prepare("INSERT INTO customers (id, code, name, status, created_at) VALUES (?, ?, 'Other Wallet Test', 'ACTIVE', ?)").run(created.otherCustomer, `TEST-${created.otherCustomer.slice(0, 8)}`, ts);
  await db.prepare("INSERT INTO users (id, email, name, role, customer_id, active, created_at) VALUES (?, ?, 'Wallet Test', 'customer', ?, 1, ?)").run(created.user, `${created.user}@test.invalid`, created.customer, ts);
  await walletH.ensureWallet(created.customer);
  const user = { id: created.user, name: 'Wallet Test', role: 'customer', customer_id: created.customer };
  const admin = { id: 'test-admin', name: 'Test Admin', role: 'admin', customer_id: null };
  const ticketBody = { equipment_type: 'Dental Unit', service_type: 'Repair', priority: 'MEDIUM', problem: 'Focused wallet test' };
  const emailPreview = appointmentEmail({ id: 'ticket-test', number: 'TKT-TEST', customerName: '<Clinic>', actorName: 'Test', actorRole: 'customer', serviceType: 'Repair', priority: 'MEDIUM', problem: '<script>alert(1)</script>', adminUrl: 'https://denttech.id/admin/ticket-detail.html?id=ticket-test' });
  ok(SUPPORT_EMAIL === 'support@denttech.id' && FORWARD_DESTINATION === 'ifansetiawan64@gmail.com', 'appointment email recipients are fixed');
  ok(emailPreview.html.includes('&lt;script&gt;') && !emailPreview.html.includes('<script>'), 'appointment email escapes customer HTML');
  ok(emailPreview.html.includes('Dent Tech.id') && !emailPreview.html.includes('Dent Tech Service Management System'), 'appointment email uses current company branding');
  let sentMessage = null;
  class FakeEmailMessage {
    constructor(from, to, raw) { Object.assign(this, { from, to, raw }); }
  }
  const fakeMime = {
    sender: null, recipient: null, subject: '', messages: [],
    setSender(value) { this.sender = value; },
    setRecipient(value) { this.recipient = value; },
    setSubject(value) { this.subject = value; },
    addMessage(value) { this.messages.push(value); },
    asRaw() { return JSON.stringify(this); }
  };
  const emailResult = await sendAppointmentEmail({ EMAIL: { async send(message) { sentMessage = message; } } },
    { id: 'ticket-test', number: 'TKT-TEST', customerName: 'Clinic', actorName: 'Test', actorRole: 'customer', serviceType: 'Repair', priority: 'MEDIUM', problem: 'Problem', adminUrl: 'https://denttech.id/admin/ticket-detail.html?id=ticket-test' },
    { EmailMessage: FakeEmailMessage, createMimeMessage: () => fakeMime });
  ok(emailResult.sent && sentMessage.from === 'notifications@denttech.id' && sentMessage.to === FORWARD_DESTINATION && fakeMime.recipient.addr === SUPPORT_EMAIL && fakeMime.messages.length === 2, 'appointment email builds and sends multipart message');
  let waitedTask = null;
  const scheduled = scheduleAppointmentEmail({ runtimeEnv: { EMAIL: { async send() {} } }, executionCtx: { waitUntil(task) { waitedTask = task; } } },
    { id: 'scheduled-test', number: 'TKT-SCHEDULED', priority: 'LOW', adminUrl: 'https://denttech.id' },
    { EmailMessage: FakeEmailMessage, createMimeMessage: () => ({ ...fakeMime, messages: [] }) });
  ok(scheduled && waitedTask === scheduled, 'appointment email registers Worker waitUntil task');
  await scheduled;

  let r = await invoke(ticketsH.createTicketHandler, { user, body: ticketBody });
  ok(r.status === 409 && r.data.code === 'INSUFFICIENT_WALLET_BALANCE' && r.data.required === 100000, 'insufficient balance returns structured 409');
  ok(scheduledEmails === 0, 'failed appointment schedules no email');

  r = await invoke(walletH.createTopupHandler, { user });
  const topup = r.data.order;
  ok(r.status === 201 && topup.amount === 100000 && /^data:image\/png;base64,/.test(topup.qr_data_url), 'topup creates server-side QR data URL');
  completed.add(topup.order_id);
  await Promise.all([
    walletH.settleVerifiedOrder(topup.order_id, { project: 'dent-tech', order_id: topup.order_id, amount: 100000, status: 'completed', completed_at: now() }),
    walletH.settleVerifiedOrder(topup.order_id, { project: 'dent-tech', order_id: topup.order_id, amount: 100000, status: 'completed', completed_at: now() })
  ]);
  const wallet = await db.prepare('SELECT balance FROM wallet_accounts WHERE customer_id = ?').get(created.customer);
  const credits = (await db.prepare('SELECT COUNT(*) AS c FROM wallet_transactions WHERE payment_order_id = ?').get(topup.id)).c;
  ok(Number(wallet.balance) === 100000 && credits === 1, 'concurrent topup settlement credits exactly once');

  r = await invoke(ticketsH.createTicketHandler, { user, body: ticketBody }); created.ticket = r.data.id;
  const debit = await db.prepare('SELECT amount, balance_after FROM wallet_transactions WHERE ticket_id = ?').get(created.ticket);
  const onsite = await db.prepare('SELECT amount FROM finance_income WHERE ticket_id = ?').get(created.ticket);
  ok(r.status === 201 && Number(debit.amount) === 100000 && Number(debit.balance_after) === 0 && Number(onsite.amount) === 100000, 'customer ticket atomically debits onsite fee and recognizes revenue');
  ok(scheduledEmails === 0, 'local tests do not send real appointment email');

  created.invoice = uid();
  await db.prepare(`INSERT INTO invoices (id, number, customer_id, labor_cost, discount, tax_rate, status, type, issued_at, created_at, updated_at, version)
    VALUES (?, ?, ?, 250000, 0, 0, 'SENT', 'FINAL', ?, ?, ?, 1)`).run(created.invoice, `INV-TEST-${created.invoice.slice(0, 8)}`, created.customer, ts, ts, ts);
  await snapshotWorkOrderInvoiceItems(db, created.invoice, null, 250000, 'Focused invoice');

  createCalls = 0;
  const [createA, createB] = await Promise.all([
    invoke(walletH.createInvoicePaymentHandler, { user, params: { id: created.invoice } }),
    invoke(walletH.createInvoicePaymentHandler, { user, params: { id: created.invoice } })
  ]);
  const invoiceOrder = createA.data.order;
  const activeCount = (await db.prepare("SELECT COUNT(*) AS c FROM payment_orders WHERE invoice_id = ? AND status = 'PENDING'").get(created.invoice)).c;
  ok([200, 201].includes(createA.status) && [200, 201].includes(createB.status) && createA.data.order.id === createB.data.order.id && activeCount === 1 && createCalls === 1, 'concurrent invoice order creation returns one active gateway order');
  let ownershipRejected = false;
  try {
    await db.prepare(`INSERT INTO payment_orders (id, order_id, kind, customer_id, invoice_id, project, amount, status, payment_method, created_at, updated_at)
      VALUES (?, ?, 'INVOICE', ?, ?, 'dent-tech', 250000, 'FAILED', 'qris', ?, ?)`).run(uid(), `INV-BAD-${uid()}`, created.otherCustomer, created.invoice, ts, ts);
  } catch (error) { ownershipRejected = error.code === '23503'; }
  ok(ownershipRejected, 'database rejects cross-customer invoice payment order');

  const editConflict = await invoke(invoicesH.updateInvoiceHandler, { user: admin, params: { id: created.invoice }, body: { version: 1, labor_cost: 260000 } });
  const payConflict = await invoke(invoicesH.payInvoiceHandler, { user: admin, params: { id: created.invoice }, body: { method: 'TRANSFER', reference: 'BLOCKED' } });
  ok(editConflict.status === 409 && editConflict.data.code === 'ACTIVE_PAYMENT_ORDER' && payConflict.status === 409 && payConflict.data.code === 'ACTIVE_PAYMENT_ORDER', 'active gateway order blocks invoice edits and manual payment');

  const mismatch = await invoke(walletH.callbackHandler, { body: { order_id: invoiceOrder.order_id, project: 'wrong-project', amount: invoiceOrder.amount }, ip: 'callback-mismatch' });
  const unknown = await invoke(walletH.callbackHandler, { body: { order_id: 'unknown-order', project: 'dent-tech', amount: invoiceOrder.amount }, ip: 'callback-unknown' });
  ok(mismatch.status === 400 && unknown.status === 400 && mismatch.data.code === 'INVALID_CALLBACK' && JSON.stringify(mismatch.data) === JSON.stringify(unknown.data), 'callback mismatch and unknown order have uniform sanitized response');

  completed.add(invoiceOrder.order_id);
  const gatewayTransaction = { project: 'dent-tech', order_id: invoiceOrder.order_id, amount: 250000, status: 'completed', completed_at: now() };
  await Promise.all([walletH.settleVerifiedOrder(invoiceOrder.order_id, gatewayTransaction), walletH.settleVerifiedOrder(invoiceOrder.order_id, gatewayTransaction)]);
  const invoice = await db.prepare('SELECT status FROM invoices WHERE id = ?').get(created.invoice);
  const paymentCount = (await db.prepare('SELECT COUNT(*) AS c FROM payments WHERE invoice_id = ?').get(created.invoice)).c;
  ok(invoice.status === 'PAID' && paymentCount === 1, 'concurrent invoice settlement inserts one payment and marks paid');

  const after = await financeTotals();
  r = await invoke(financeH.financeSummaryHandler, { user: admin, query: {} });
  ok(after.topup - baseline.topup === 100000 && after.onsite - baseline.onsite === 100000 && after.invoice - baseline.invoice === 250000 && after.liability - baseline.liability === 0 && r.data.total_cash_inflow === after.invoice + after.topup && r.data.income === after.invoice + after.onsite, 'finance deltas and accounting identities are exact');

  await cleanup(); created.customer = null;
  console.log(`\nWALLET RESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(async (error) => { console.error('FATAL', error); try { await cleanup(); } catch {} process.exit(2); });
