'use strict';
const QRCode = require('qrcode');
const { db } = require('../db');
const { uid, now, sendJSON } = require('../util');
const defaultPakasir = require('../pakasir');
const { getEnv } = require('../runtime');
const { getInvoiceItems, invoiceTotals, audit, notify, timeline, getTicket } = require('./_common');

const TOPUP_AMOUNT = 100000;
const INVOICE_PAYABLE_STATUSES = new Set(['SENT', 'OVERDUE']);
const ORDER_TERMINAL_STATUSES = new Set(['COMPLETED', 'EXPIRED', 'FAILED']);
const callbackHits = new Map();
const CALLBACK_WINDOW_MS = 60000;
const CALLBACK_LIMIT = 60;
let pakasir = defaultPakasir;

function setPakasirClient(client) { pakasir = client || defaultPakasir; }
function appError(message, code, status) { const error = new Error(message); error.code = code; error.status = status; return error; }
function safePaymentError(error) {
  const allowed = new Set(['PAYMENT_SERVICE_UNAVAILABLE', 'PAYMENT_TIMEOUT', 'PAYMENT_RESPONSE_MISMATCH', 'PAYMENT_PROJECT_MISMATCH', 'INVALID_PAYMENT_DATA', 'PAYMENT_MISMATCH', 'PAYMENT_NOT_COMPLETED', 'CUSTOMER_QRIS_FEE_NOT_ALLOWED', 'INVOICE_AMOUNT_CHANGED', 'INVOICE_ALREADY_PAID', 'INVOICE_NOT_PAYABLE', 'ACTIVE_PAYMENT_ORDER']);
  if (error && allowed.has(error.code)) return { status: Math.min(599, Math.max(400, Number(error.status) || 400)), error: error.message, code: error.code };
  return { status: 502, error: 'Layanan pembayaran gagal', code: 'PAYMENT_GATEWAY_ERROR' };
}
function paymentError(ctx, error) {
  const safe = safePaymentError(error);
  console.error(`[payment-error] path=${ctx.req?.url || '-'} code=${error?.code || 'UNKNOWN'} status=${error?.status || 0} message=${error?.message || error}`);
  sendJSON(ctx.res, safe.status, { error: safe.error, code: safe.code });
}
function callbackInvalid(ctx, status = 400) { sendJSON(ctx.res, status, { error: 'Callback tidak valid', code: 'INVALID_CALLBACK' }); }
function callbackAllowed(ip) {
  const key = String(ip || 'unknown');
  const current = Date.now();
  if (callbackHits.size > 10000) {
    for (const [candidate, hit] of callbackHits) if (current - hit.startedAt >= CALLBACK_WINDOW_MS) callbackHits.delete(candidate);
  }
  const entry = callbackHits.get(key);
  if (!entry || current - entry.startedAt >= CALLBACK_WINDOW_MS) { callbackHits.set(key, { startedAt: current, count: 1 }); return true; }
  entry.count++;
  return entry.count <= CALLBACK_LIMIT;
}
async function walletFor(customerId, executor = db) {
  return executor.prepare('SELECT id, customer_id, balance, created_at, updated_at FROM wallet_accounts WHERE customer_id = ?').get(customerId);
}
async function ensureWallet(customerId, executor = db) {
  let wallet = await walletFor(customerId, executor);
  if (wallet) return wallet;
  const ts = now();
  await executor.prepare('INSERT INTO wallet_accounts (id, customer_id, balance, created_at, updated_at) VALUES (?, ?, 0, ?, ?) ON CONFLICT (customer_id) DO NOTHING').run(uid(), customerId, ts, ts);
  return walletFor(customerId, executor);
}
function publicOrder(order) {
  if (!order) return null;
  return {
    id: order.id, order_id: order.order_id, kind: order.kind, invoice_id: order.invoice_id,
    amount: Number(order.amount), status: order.status, payment_method: order.payment_method,
    total_payment: order.total_payment === null ? null : Number(order.total_payment),
    expired_at: order.expired_at, completed_at: order.gateway_completed_at, settled_at: order.settled_at, created_at: order.created_at
  };
}
async function orderWithQr(order) {
  const result = publicOrder(order);
  if (order && order.payment_number && order.status === 'PENDING') {
    const svg = await QRCode.toString(order.payment_number, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, width: 360 });
    result.qr_data_url = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  }
  return result;
}
async function insertPendingOrder(executor, { kind, customerId, invoiceId = null, amount }) {
  const project = getEnv('PAKASIR_PROJECT', 'dent-tech');
  const id = uid();
  const orderId = `${kind === 'WALLET_TOPUP' ? 'WT' : 'INV'}-${id}`;
  const ts = now();
  await executor.prepare(`INSERT INTO payment_orders
    (id, order_id, kind, customer_id, invoice_id, project, amount, status, payment_method, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', 'qris', ?, ?)`).run(id, orderId, kind, customerId, invoiceId, project, amount, ts, ts);
  return { id, order_id: orderId, kind, customer_id: customerId, invoice_id: invoiceId, project, amount, status: 'PENDING' };
}
async function provisionQris(order, executor = db) {
  try {
    const payment = await pakasir.createQris({ orderId: order.order_id, amount: Number(order.amount) });
    const totalPayment = payment.total_payment == null ? Number(order.amount) : Number(payment.total_payment);
    if (!Number.isSafeInteger(totalPayment) || totalPayment !== Number(order.amount)) {
      throw appError('Konfigurasi QRIS masih membebankan biaya kepada customer. Ubah fee payer Pakasir menjadi merchant.', 'CUSTOMER_QRIS_FEE_NOT_ALLOWED', 409);
    }
    await executor.prepare(`UPDATE payment_orders SET payment_number = ?, gateway_fee = ?, total_payment = ?, expired_at = ?, updated_at = ? WHERE id = ? AND status = 'PENDING'`)
      .run(payment.payment_number, payment.fee == null ? null : Number(payment.fee), totalPayment, payment.expired_at || null, now(), order.id);
  } catch (error) {
    try { await transitionOrder(order.id, 'FAILED', executor); }
    catch (transitionError) { console.error(`[payment-transition] order=${order.order_id} code=${transitionError?.code || 'UNKNOWN'} message=${transitionError?.message || transitionError}`); }
    throw error;
  }
  return executor.prepare('SELECT * FROM payment_orders WHERE id = ?').get(order.id);
}
async function createOrder(args) { return provisionQris(await insertPendingOrder(db, args)); }
async function waitForProvisionedOrder(id, attempts = 20, delayMs = 100) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const order = await db.prepare('SELECT * FROM payment_orders WHERE id = ?').get(id);
    if (!order || order.status !== 'PENDING' || order.payment_number) return order;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return db.prepare('SELECT * FROM payment_orders WHERE id = ?').get(id);
}
async function transitionOrder(id, status, executor = db, extra = {}) {
  if (!ORDER_TERMINAL_STATUSES.has(status)) throw appError('Status pembayaran tidak valid', 'INVALID_PAYMENT_STATE', 400);
  const fields = ['status = ?', 'updated_at = ?'];
  const values = [status, now()];
  if (status === 'COMPLETED') { fields.push('gateway_completed_at = ?', 'settled_at = ?'); values.push(extra.completedAt || now(), extra.settledAt || now()); }
  values.push(id);
  await executor.prepare(`UPDATE payment_orders SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

async function settleVerifiedOrder(orderId, transaction) {
  if (!transaction || String(transaction.status).toLowerCase() !== 'completed') return { settled: false, status: transaction ? String(transaction.status).toUpperCase() : 'PENDING' };
  return db.transaction(async (tx) => {
    const order = await tx.prepare('SELECT * FROM payment_orders WHERE order_id = ? FOR UPDATE').get(orderId);
    if (!order) throw appError('Order pembayaran tidak ditemukan', 'PAYMENT_MISMATCH', 404);
    if (transaction.project !== order.project || transaction.order_id !== order.order_id || Number(transaction.amount) !== Number(order.amount)) throw appError('Data transaksi gateway tidak sesuai dengan order lokal', 'PAYMENT_MISMATCH', 400);
    if (order.status === 'COMPLETED') return { settled: false, already_settled: true, status: order.status, order };
    if (!['PENDING', 'EXPIRED', 'FAILED'].includes(order.status)) throw appError('Status order pembayaran tidak dapat diselesaikan', 'INVALID_PAYMENT_STATE', 409);
    const ts = transaction.completed_at || now();
    if (order.kind === 'WALLET_TOPUP') {
      const wallet = await tx.prepare('SELECT * FROM wallet_accounts WHERE customer_id = ? FOR UPDATE').get(order.customer_id);
      if (!wallet) throw appError('Wallet customer tidak ditemukan', 'PAYMENT_MISMATCH', 409);
      const balance = Number(wallet.balance) + Number(order.amount);
      await tx.prepare('UPDATE wallet_accounts SET balance = ?, updated_at = ? WHERE id = ?').run(balance, ts, wallet.id);
      await tx.prepare(`INSERT INTO wallet_transactions (id, wallet_id, customer_id, type, amount, balance_after, payment_order_id, description, created_at)
        VALUES (?, ?, ?, 'CREDIT_TOPUP', ?, ?, ?, ?, ?)`).run(uid(), wallet.id, order.customer_id, order.amount, balance, order.id, `Top up QRIS ${order.order_id}`, ts);
      await tx.prepare(`INSERT INTO finance_income (id, income_type, amount, customer_id, payment_order_id, occurred_at, description, created_at)
        VALUES (?, 'WALLET_TOPUP_CASH', ?, ?, ?, ?, ?, ?)`).run(uid(), order.amount, order.customer_id, order.id, ts, `Top up wallet ${order.order_id}`, ts);
    } else {
      const invoice = await tx.prepare('SELECT * FROM invoices WHERE id = ? FOR UPDATE').get(order.invoice_id);
      if (!invoice || invoice.customer_id !== order.customer_id) throw appError('Invoice pembayaran tidak sesuai', 'PAYMENT_MISMATCH', 409);
      if (INVOICE_PAYABLE_STATUSES.has(invoice.status)) {
        if (invoice.type === 'PROFORMA' && invoice.approval_status !== 'APPROVED') throw appError('Proforma belum disetujui customer', 'INVOICE_NOT_PAYABLE', 409);
        const wo = invoice.work_order_id ? await tx.prepare('SELECT status FROM work_orders WHERE id = ?').get(invoice.work_order_id) : null;
        const report = invoice.work_order_id ? await tx.prepare("SELECT status FROM service_reports WHERE work_order_id = ? ORDER BY created_at DESC LIMIT 1").get(invoice.work_order_id) : null;
        if (invoice.type === 'PROFORMA' && (!wo || wo.status !== 'APPROVED' || !report || report.status !== 'APPROVED')) throw appError('Pembayaran tersedia setelah teknisi menyelesaikan pekerjaan', 'INVOICE_NOT_PAYABLE', 409);
        const expected = Math.round(invoiceTotals(invoice, await getInvoiceItems(invoice.id, tx)).total);
        if (expected !== Number(order.amount)) throw appError('Total invoice telah berubah', 'INVOICE_AMOUNT_CHANGED', 409);
        await tx.prepare('INSERT INTO payments (id, invoice_id, amount, method, reference, paid_at) VALUES (?, ?, ?, ?, ?, ?)').run(uid(), invoice.id, order.amount, 'PAKASIR_QRIS', order.order_id, ts);
        if (invoice.type === 'PROFORMA') {
          const { convertPaidProforma } = require('./invoices');
          const invoiceNumber = await convertPaidProforma(tx, invoice, ts);
          if (invoice.ticket_id) {
            const ticket = await tx.prepare('SELECT status FROM tickets WHERE id = ? FOR UPDATE').get(invoice.ticket_id);
            if (ticket && ticket.status !== 'CLOSED') {
              await tx.prepare("UPDATE tickets SET status = 'CLOSED', closed_at = ?, updated_at = ? WHERE id = ?").run(ts, ts, invoice.ticket_id);
              await tx.prepare('INSERT INTO ticket_status_history (id, ticket_id, from_status, to_status, by_user, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
                .run(uid(), invoice.ticket_id, ticket.status, 'CLOSED', null, `Pembayaran terverifikasi; ${invoice.number} menjadi ${invoiceNumber}`, ts);
            }
          }
        } else await tx.prepare("UPDATE invoices SET status = 'PAID', paid_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(ts, ts, invoice.id);
      } else if (invoice.status === 'PAID') {
        const existing = await tx.prepare("SELECT id FROM payments WHERE invoice_id = ? AND method = 'PAKASIR_QRIS' AND reference = ?").get(invoice.id, order.order_id);
        if (!existing) throw appError('Invoice telah dibayar melalui metode lain', 'INVOICE_ALREADY_PAID', 409);
      } else throw appError('Status invoice tidak dapat dibayar', 'INVOICE_NOT_PAYABLE', 409);
    }
    await transitionOrder(order.id, 'COMPLETED', tx, { completedAt: transaction.completed_at || ts, settledAt: now() });
    return { settled: true, status: 'COMPLETED', order: { ...order, status: 'COMPLETED', settled_at: ts } };
  });
}

async function reconcileOrder(order) {
  if (order.status === 'COMPLETED') return { settled: false, already_settled: true, status: order.status, order };
  const transaction = await pakasir.transactionDetail({ orderId: order.order_id, amount: Number(order.amount), project: order.project });
  const status = String(transaction.status).toLowerCase();
  if (status === 'completed') return settleVerifiedOrder(order.order_id, transaction);
  if (order.status === 'PENDING' && ['expired', 'failed'].includes(status)) await transitionOrder(order.id, status.toUpperCase());
  return { settled: false, status: status.toUpperCase(), order };
}

async function getWalletHandler(ctx) {
  const wallet = await ensureWallet(ctx.user.customer_id);
  sendJSON(ctx.res, 200, { wallet: { ...wallet, balance: Number(wallet.balance) } });
}
async function walletHistoryHandler(ctx) {
  await ensureWallet(ctx.user.customer_id);
  let activeOrder = await db.prepare("SELECT * FROM payment_orders WHERE customer_id = ? AND kind = 'WALLET_TOPUP' AND status = 'PENDING' ORDER BY created_at DESC LIMIT 1").get(ctx.user.customer_id);
  if (activeOrder) {
    try {
      await reconcileOrder(activeOrder);
      activeOrder = await db.prepare('SELECT * FROM payment_orders WHERE id = ?').get(activeOrder.id);
    } catch (error) {
      console.error(`[wallet-reconcile] order=${activeOrder.order_id} code=${error?.code || 'UNKNOWN'} message=${error?.message || error}`);
    }
  }
  const currentWallet = await walletFor(ctx.user.customer_id);
  const transactions = await db.prepare(`SELECT id, type, amount, balance_after, payment_order_id, ticket_id, description, created_at FROM wallet_transactions WHERE customer_id = ? ORDER BY created_at DESC LIMIT 100`).all(ctx.user.customer_id);
  sendJSON(ctx.res, 200, {
    wallet: { ...currentWallet, balance: Number(currentWallet.balance) },
    transactions: transactions.map((row) => ({ ...row, amount: Number(row.amount), balance_after: Number(row.balance_after) })),
    active_order: activeOrder?.status === 'PENDING' ? await orderWithQr(activeOrder) : null
  });
}
async function createTopupHandler(ctx) {
  await ensureWallet(ctx.user.customer_id);
  try {
    let existing = await db.prepare("SELECT * FROM payment_orders WHERE customer_id = ? AND kind = 'WALLET_TOPUP' AND status = 'PENDING' ORDER BY created_at DESC LIMIT 1").get(ctx.user.customer_id);
    if (existing) {
      try {
        await reconcileOrder(existing);
      } catch (error) {
        console.error(`[wallet-reconcile] order=${existing.order_id} code=${error?.code || 'UNKNOWN'} message=${error?.message || error}`);
      }
    }

    const choice = await db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`wallet-topup:${ctx.user.customer_id}`]);
      const pending = await tx.prepare("SELECT * FROM payment_orders WHERE customer_id = ? AND kind = 'WALLET_TOPUP' AND status = 'PENDING' ORDER BY created_at DESC LIMIT 1 FOR UPDATE").get(ctx.user.customer_id);
      if (pending) return { created: false, order: pending };
      return { created: true, order: await insertPendingOrder(tx, { kind: 'WALLET_TOPUP', customerId: ctx.user.customer_id, amount: TOPUP_AMOUNT }) };
    });
    const order = choice.created
      ? await provisionQris(choice.order)
      : choice.order.payment_number ? choice.order : await waitForProvisionedOrder(choice.order.id);
    if (!order?.payment_number || order.status !== 'PENDING') throw appError('QRIS gagal disiapkan. Silakan buat QRIS baru.', 'PAYMENT_SERVICE_UNAVAILABLE', 503);
    sendJSON(ctx.res, choice.created ? 201 : 200, { order: await orderWithQr(order) });
  } catch (error) {
    if (error?.code === '23505') {
      const pending = await db.prepare("SELECT * FROM payment_orders WHERE customer_id = ? AND kind = 'WALLET_TOPUP' AND status = 'PENDING' ORDER BY created_at DESC LIMIT 1").get(ctx.user.customer_id);
      if (pending?.payment_number) return sendJSON(ctx.res, 200, { order: await orderWithQr(pending) });
    }
    paymentError(ctx, error);
  }
}
async function topupStatusHandler(ctx) {
  const order = await db.prepare("SELECT * FROM payment_orders WHERE id = ? AND customer_id = ? AND kind = 'WALLET_TOPUP'").get(ctx.params.id, ctx.user.customer_id);
  if (!order) return sendJSON(ctx.res, 404, { error: 'Top up tidak ditemukan' });
  try {
    await reconcileOrder(order);
    const current = await db.prepare('SELECT * FROM payment_orders WHERE id = ?').get(order.id);
    const wallet = await walletFor(ctx.user.customer_id);
    sendJSON(ctx.res, 200, { order: await orderWithQr(current), wallet: { ...wallet, balance: Number(wallet.balance) } });
  } catch (error) { paymentError(ctx, error); }
}
async function createInvoicePaymentHandler(ctx) {
  let choice;
  try {
    choice = await db.transaction(async (tx) => {
      const invoice = await tx.prepare('SELECT * FROM invoices WHERE id = ? FOR UPDATE').get(ctx.params.id);
      if (!invoice) throw appError('Invoice tidak ditemukan', 'INVOICE_NOT_PAYABLE', 404);
      if (invoice.customer_id !== ctx.user.customer_id) throw appError('Tidak memiliki akses', 'INVOICE_NOT_PAYABLE', 403);
      if (!INVOICE_PAYABLE_STATUSES.has(invoice.status)) throw appError('Status invoice tidak dapat dibayar', 'INVOICE_NOT_PAYABLE', 409);
      if (invoice.type === 'PROFORMA' && invoice.approval_status !== 'APPROVED') throw appError('Setujui proforma terlebih dahulu', 'INVOICE_NOT_PAYABLE', 409);
      const wo = invoice.work_order_id ? await tx.prepare('SELECT status FROM work_orders WHERE id = ?').get(invoice.work_order_id) : null;
      const report = invoice.work_order_id ? await tx.prepare("SELECT status FROM service_reports WHERE work_order_id = ? ORDER BY created_at DESC LIMIT 1").get(invoice.work_order_id) : null;
      if (invoice.type === 'PROFORMA' && (!wo || wo.status !== 'APPROVED' || !report || report.status !== 'APPROVED')) throw appError('Pembayaran tersedia setelah teknisi menyelesaikan pekerjaan', 'INVOICE_NOT_PAYABLE', 409);
      const pending = await tx.prepare("SELECT * FROM payment_orders WHERE invoice_id = ? AND kind = 'INVOICE' AND status = 'PENDING'").get(invoice.id);
      if (pending) return { existing: true, order: pending };
      const amount = Math.round(invoiceTotals(invoice, await getInvoiceItems(invoice.id, tx)).total);
      if (amount <= 0) throw appError('Total invoice tidak valid', 'INVALID_PAYMENT_DATA', 400);
      return { existing: false, order: await insertPendingOrder(tx, { kind: 'INVOICE', customerId: ctx.user.customer_id, invoiceId: invoice.id, amount }) };
    });
    if (choice.existing) return sendJSON(ctx.res, 200, { order: await orderWithQr(choice.order) });
    sendJSON(ctx.res, 201, { order: await orderWithQr(await provisionQris(choice.order)) });
  } catch (error) {
    if (error && error.code === '23505') {
      const pending = await db.prepare("SELECT * FROM payment_orders WHERE invoice_id = ? AND kind = 'INVOICE' AND status = 'PENDING'").get(ctx.params.id);
      if (pending) return sendJSON(ctx.res, 200, { order: await orderWithQr(pending) });
    }
    paymentError(ctx, error);
  }
}
async function invoicePaymentStatusHandler(ctx) {
  const order = await db.prepare("SELECT * FROM payment_orders WHERE id = ? AND invoice_id = ? AND customer_id = ? AND kind = 'INVOICE'").get(ctx.params.orderId, ctx.params.id, ctx.user.customer_id);
  if (!order) return sendJSON(ctx.res, 404, { error: 'Order pembayaran invoice tidak ditemukan' });
  try {
    const result = await reconcileOrder(order);
    const current = await db.prepare('SELECT * FROM payment_orders WHERE id = ?').get(order.id);
    if (result.settled) {
      const invoice = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(order.invoice_id);
      if (invoice.ticket_id) { const ticket = await getTicket(invoice.ticket_id); if (ticket) timeline(ticket.id, 'PAYMENT', `Invoice ${invoice.number} dibayar`, `Pembayaran QRIS ${order.order_id}`, 'CUSTOMER_VISIBLE', ctx.user.id); }
      notify({ role: 'admin', title: `Invoice ${invoice.number} dibayar`, body: `Rp ${Number(order.amount).toLocaleString('id-ID')} via Pakasir QRIS`, type: 'INVOICE', ref_type: 'invoice', ref_id: invoice.id });
      audit(ctx.user, 'UPDATE', 'invoice', invoice.id, `Pembayaran Pakasir QRIS ${order.order_id}`, ctx.ip);
    }
    sendJSON(ctx.res, 200, { order: await orderWithQr(current) });
  } catch (error) { paymentError(ctx, error); }
}
async function callbackHandler(ctx) {
  if (!callbackAllowed(ctx.ip)) return callbackInvalid(ctx, 429);
  const body = ctx.body || {};
  if (typeof body.order_id !== 'string' || typeof body.project !== 'string' || !Number.isSafeInteger(Number(body.amount)) || Number(body.amount) <= 0) return callbackInvalid(ctx);
  const order = await db.prepare('SELECT * FROM payment_orders WHERE order_id = ?').get(body.order_id);
  if (!order || body.project !== order.project || Number(body.amount) !== Number(order.amount)) return callbackInvalid(ctx);
  try {
    const transaction = await pakasir.transactionDetail({ orderId: order.order_id, amount: Number(order.amount), project: order.project });
    if (String(transaction.status).toLowerCase() !== 'completed') return callbackInvalid(ctx, 409);
    const result = await settleVerifiedOrder(order.order_id, transaction);
    sendJSON(ctx.res, 200, { ok: true, settled: result.settled, already_settled: !!result.already_settled });
  } catch (error) {
    if (error && ['PAYMENT_MISMATCH', 'PAYMENT_RESPONSE_MISMATCH', 'PAYMENT_PROJECT_MISMATCH'].includes(error.code)) return callbackInvalid(ctx);
    paymentError(ctx, error);
  }
}

module.exports = {
  TOPUP_AMOUNT, setPakasirClient, ensureWallet, createOrder, settleVerifiedOrder, reconcileOrder,
  getWalletHandler, walletHistoryHandler, createTopupHandler, topupStatusHandler,
  createInvoicePaymentHandler, invoicePaymentStatusHandler, callbackHandler, orderWithQr
};
