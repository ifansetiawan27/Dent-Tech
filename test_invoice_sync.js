'use strict';
require('dotenv').config();
const { chromium } = require('playwright-core');
const { db } = require('./backend/db');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://localhost:3000';
let passed = 0, failed = 0, invoiceId = null, woId = null, browser = null, fixtureState = null;
const ok = (m) => { passed++; console.log('  [PASS]', m); };
const bad = (m) => { failed++; console.log('  [FAIL]', m); };
async function req(method, path, token, body) { const h = { 'Content-Type': 'application/json' }; if (token) h.Authorization = 'Bearer ' + token; const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }); let data = {}; try { data = await r.json(); } catch {} return { status: r.status, data }; }
async function login(email, password) { const r = await req('POST', '/api/auth/login', null, { email, password }); if (r.status !== 200 || !r.data.token) throw new Error(`Login gagal untuk ${email}: ${r.status}`); return r.data.token; }
async function cleanup() {
  if (browser) { await browser.close().catch(() => {}); browser = null; }
  if (!invoiceId && !fixtureState) return;
  await db.transaction(async (tx) => {
    if (invoiceId) {
      const inv = await tx.prepare('SELECT number FROM invoices WHERE id = ?').get(invoiceId);
      await tx.prepare('DELETE FROM notifications WHERE ref_type = ? AND ref_id = ?').run('invoice', invoiceId);
      await tx.prepare("DELETE FROM audit_logs WHERE entity = 'invoice' AND entity_id = ?").run(invoiceId);
      if (inv) {
        await tx.prepare('DELETE FROM notifications WHERE ref_type = ? AND ref_id = ? AND body LIKE ?').run('work_order', woId, `%${inv.number}%`);
        await tx.prepare("DELETE FROM ticket_timeline WHERE ticket_id = ? AND title LIKE ?").run(fixtureState.ticket_id, `%${inv.number}%`);
        await tx.prepare("DELETE FROM ticket_status_history WHERE ticket_id = ? AND note LIKE ?").run(fixtureState.ticket_id, `%${inv.number}%`);
      }
      await tx.prepare('DELETE FROM invoices WHERE id = ?').run(invoiceId);
    }
    if (fixtureState) {
      await tx.prepare('UPDATE work_orders SET status = ?, updated_at = ? WHERE id = ?').run(fixtureState.wo_status, fixtureState.wo_updated_at, woId);
      await tx.prepare('UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?').run(fixtureState.ticket_status, fixtureState.ticket_updated_at, fixtureState.ticket_id);
    }
  });
}
(async () => {
  console.log('=== INVOICE ITEMS + CUSTOMER AUTO-SYNC ===');
  const admin = await login('admin@denttech.id', 'admin123');
  const customer = await login('ratna@denttech.id', 'customer123');
  const wo = await db.prepare(`SELECT wo.id, wo.status AS wo_status, wo.updated_at AS wo_updated_at,
      t.id AS ticket_id, t.status AS ticket_status, t.updated_at AS ticket_updated_at
    FROM work_orders wo
    JOIN tickets t ON t.id = wo.ticket_id
    JOIN users u ON u.customer_id = t.customer_id
    WHERE wo.status = 'STARTED' AND t.status = 'IN_PROGRESS' AND u.email = 'ratna@denttech.id'
      AND EXISTS (SELECT 1 FROM diagnoses d WHERE d.work_order_id = wo.id AND length(trim(d.findings)) > 0)
      AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.work_order_id = wo.id AND i.type = 'PROFORMA' AND i.status != 'PAID')
    LIMIT 1`).get();
  if (!wo) throw new Error('Seed work order diagnosis untuk fixture proforma tidak ditemukan');
  woId = wo.id;
  fixtureState = wo;
  await db.transaction(async (tx) => {
    const woTransition = await tx.prepare("UPDATE work_orders SET status = 'WAITING_QUOTATION' WHERE id = ? AND status = 'STARTED'").run(woId);
    const ticketTransition = await tx.prepare("UPDATE tickets SET status = 'WAITING_QUOTATION' WHERE id = ? AND status = 'IN_PROGRESS'").run(wo.ticket_id);
    if (woTransition.changes !== 1 || ticketTransition.changes !== 1) throw new Error('Fixture berubah saat menyiapkan status WAITING_QUOTATION');
  });

  const created = await req('POST', '/api/invoices/proforma', admin, { work_order_id: woId, labor_cost: 500000, due_days: 14 });
  invoiceId = created.data.id || null;
  if (created.status !== 201 || !invoiceId || !Array.isArray(created.data.items)) throw new Error(`Pembuatan proforma gagal: ${created.status} ${created.data.error || ''}`);
  if (created.data.items.some((x) => x.item_type === 'LABOR')) ok('proforma snapshots labor item'); else bad('proforma snapshot failed');

  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const adminCtx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const adminPage = await adminCtx.newPage();
  await adminPage.goto(BASE + '/login.html', { waitUntil: 'networkidle' }); await adminPage.fill('#email', 'admin@denttech.id'); await adminPage.fill('#password', 'admin123'); await Promise.all([adminPage.waitForNavigation({ waitUntil: 'networkidle' }), adminPage.click('#login-btn')]);
  await adminPage.goto(BASE + '/admin/invoice-detail.html?id=' + invoiceId, { waitUntil: 'networkidle' });
  await adminPage.click('#btn-edit'); await adminPage.click('#ed-add-item'); await adminPage.fill('[data-field="description"]', 'Biaya transportasi teknisi'); await adminPage.fill('[data-field="qty"]', '2'); await adminPage.fill('[data-field="unit"]', 'trip'); await adminPage.fill('[data-field="unit_price"]', '125000');
  if ((await adminPage.inputValue('[data-field="unit_price"]')) === '125.000') ok('admin custom item price uses Rupiah formatter'); else bad('custom item Rupiah formatter');
  await adminPage.click('#ed-submit');
  await adminPage.waitForSelector('#ed-submit', { state: 'detached', timeout: 10000 });
  await adminPage.waitForTimeout(300);

  let detail = await req('GET', '/api/invoices/' + invoiceId, admin);
  let custom = detail.data.items.filter((x) => x.item_type === 'CUSTOM');
  if (custom.length === 1 && custom[0].description === 'Biaya transportasi teknisi' && custom[0].qty === 2 && custom[0].unit_price === 125000) ok('admin edit stores custom invoice item'); else bad('custom item not stored');
  if (detail.data.invoice.version === 2 && detail.data.totals.custom_total === 250000) ok('invoice revision and totals updated'); else bad('invoice version/total incorrect: version=' + detail.data.invoice.version + ' custom=' + detail.data.totals.custom_total + ' total=' + detail.data.totals.total);

  const stale = await req('PUT', '/api/invoices/' + invoiceId, admin, { version: 1, items: [] });
  if (stale.status === 409) ok('stale invoice edit rejected with 409'); else bad('stale edit status ' + stale.status);
  const missingVersion = await req('PUT', '/api/invoices/' + invoiceId, admin, { items: [] });
  if (missingVersion.status === 400) ok('invoice edit requires revision version'); else bad('missing version status ' + missingVersion.status);

  const custDetail = await req('GET', '/api/invoices/' + invoiceId, customer);
  if (custDetail.status === 200 && custDetail.data.items.some((x) => x.description === 'Biaya transportasi teknisi')) ok('customer API sees custom item'); else bad('customer API custom item missing');

  const customerCtx = await browser.newContext({ viewport: { width: 900, height: 900 } }); const cp = await customerCtx.newPage();
  await cp.goto(BASE + '/login.html', { waitUntil: 'networkidle' }); await cp.fill('#email', 'ratna@denttech.id'); await cp.fill('#password', 'customer123'); await Promise.all([cp.waitForNavigation({ waitUntil: 'networkidle' }), cp.click('#login-btn')]); await cp.goto(BASE + '/customer/invoice-detail.html?id=' + invoiceId, { waitUntil: 'networkidle' });
  if ((await cp.locator('body').innerText()).includes('Biaya transportasi teknisi')) ok('customer portal renders custom item'); else bad('customer UI item missing');
  const customerListPage = await customerCtx.newPage();
  await customerListPage.goto(BASE + '/customer/invoices.html', { waitUntil: 'networkidle' });

  detail = await req('GET', '/api/invoices/' + invoiceId, admin);
  const changed = await req('PUT', '/api/invoices/' + invoiceId, admin, { version: detail.data.invoice.version, items: [{ description: 'Biaya sinkron realtime', qty: 1, unit: 'paket', unit_price: 333000 }] });
  if (changed.status === 200) ok('admin updates invoice while customer page open'); else bad('admin realtime update failed');
  try { await cp.waitForFunction(() => document.body.innerText.includes('Biaya sinkron realtime'), null, { timeout: 15000 }); ok('customer detail auto-syncs without reload'); } catch { bad('customer detail did not auto-sync'); }
  const pageText = await cp.locator('body').innerText(); if (pageText.includes('Rp 333.000')) ok('customer sees updated item amount'); else bad('updated item amount missing');
  const expectedTotal = changed.data.totals.total;
  const expectedText = 'Rp ' + Number(expectedTotal).toLocaleString('id-ID', { maximumFractionDigits: 0 });
  try { await customerListPage.waitForFunction((text) => document.body.innerText.includes(text), expectedText, { timeout: 15000 }); ok('customer invoice list auto-syncs updated total'); } catch { bad(`customer invoice list did not auto-sync total ${expectedText}`); }

  const approved = await req('POST', '/api/invoices/' + invoiceId + '/approve', customer, {});
  if (approved.status === 200 && approved.data.approval_status === 'APPROVED') ok('customer approves proforma before payment-facing document checks'); else bad('customer proforma approval failed: ' + approved.status);

  const html = await cp.evaluate(async () => { const m = await import('/utils/invoice-doc.js'); const d = await fetch('/api/invoices/' + new URLSearchParams(location.search).get('id'), { headers: { Authorization: 'Bearer ' + localStorage.sms_token } }).then((r) => r.json()); return m.buildInvoiceHtml(d); });
  if (html.includes('Biaya sinkron realtime') && html.includes('333.000')) ok('print/PDF invoice includes custom item'); else bad('print invoice missing custom item');

  await cleanup(); invoiceId = null;
  console.log(`\nINVOICE SYNC RESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error('FATAL', e); try { await cleanup(); } catch {} process.exit(2); });
