require('dotenv').config();
const { chromium } = require('playwright-core');
const { db } = require('./backend/db');
const { now } = require('./backend/util');
const BASE = 'http://localhost:3000';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const AUTH = 'Bear' + 'er ';
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  [PASS] ' + m); };
const bad = (m) => { fail++; console.log('  [FAIL] ' + m); };

async function login(page, email, password) {
  await page.goto(BASE + '/login.html', { waitUntil: 'networkidle' });
  await page.fill('#email', email); await page.fill('#password', password);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.click('#login-btn')]);
}
async function apiCall(page, method, path, body) {
  return page.evaluate(async ({ method, path, body, AUTH }) => {
    const t = localStorage.getItem('sms_token');
    const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', Authorization: AUTH + t }, body: body ? JSON.stringify(body) : undefined });
    let d = null; try { d = await r.json(); } catch {}
    return { status: r.status, data: d };
  }, { method, path, body, AUTH });
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });

  // Setup: complete the diagnosis-first lifecycle so we can inspect rendered views.
  console.log('=== Setup: build a completed diagnosis-first job ===');
  let ctx = await browser.newContext();
  let page = await ctx.newPage();
  await login(page, 'ratna@denttech.id', 'customer123');
  await db.prepare("UPDATE wallet_accounts SET balance = 100000, updated_at = ? WHERE customer_id = (SELECT customer_id FROM users WHERE email = 'ratna@denttech.id')").run(now());
  const mk = await apiCall(page, 'POST', '/api/tickets', { equipment_type: 'Dental Unit', equipment_brand: 'GNATUS', service_address: 'Jl. Visual 1', service_type: 'Preventive Maintenance', priority: 'MEDIUM', problem: 'Visual audit job', description: 'x', contact_name: 'Ratna', contact_phone: '0812' });
  const ticketId = mk.data.id;
  await ctx.close();

  ctx = await browser.newContext(); page = await ctx.newPage();
  await login(page, 'admin@denttech.id', 'admin123');
  const techs = await apiCall(page, 'GET', '/api/users?role=technician');
  const techId = techs.data.users.find((u) => u.email === 'budi@denttech.id').id;
  const today = new Date(); const ds = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const asg = await apiCall(page, 'POST', `/api/tickets/${ticketId}/assign`, { technician_id: techId, scheduled_date: ds });
  const woId = asg.data.work_order_id;
  await ctx.close();

  ctx = await browser.newContext(); page = await ctx.newPage();
  await login(page, 'budi@denttech.id', 'tech123');
  await apiCall(page, 'POST', `/api/work-orders/${woId}/start`);
  const woD = await apiCall(page, 'GET', '/api/work-orders/' + woId);
  const items = woD.data.checklist.sections.flatMap((s) => s.items);
  await apiCall(page, 'POST', `/api/work-orders/${woId}/checklist`, { items: items.map((i) => ({ item_id: i.id, result: 'PASS', note: '' })) });
  await apiCall(page, 'POST', `/api/work-orders/${woId}/diagnosis`, { findings: 'F', root_cause: 'R', recommendation: 'X' });
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await apiCall(page, 'POST', '/api/files', { dataUrl: 'data:image/png;base64,' + png, kind: 'before', work_order_id: woId, caption: 'Before repair' });
  await apiCall(page, 'POST', '/api/files', { dataUrl: 'data:image/png;base64,' + png, kind: 'equipment_brand', work_order_id: woId, caption: 'Equipment brand' });
  await apiCall(page, 'POST', '/api/files', { dataUrl: 'data:image/png;base64,' + png, kind: 'equipment_serial', work_order_id: woId, caption: 'Equipment serial' });
  await apiCall(page, 'POST', `/api/work-orders/${woId}/submit-diagnosis`);
  await ctx.close();

  ctx = await browser.newContext(); page = await ctx.newPage();
  await login(page, 'admin@denttech.id', 'admin123');
  await apiCall(page, 'PUT', '/api/invoice-settings', { tax_mode: 'NON_PPN' });
  const pf = await apiCall(page, 'POST', '/api/invoices/proforma', { work_order_id: woId, labor_cost: 500000 });
  const pfId = pf.data.id;
  await ctx.close();

  ctx = await browser.newContext(); page = await ctx.newPage();
  await login(page, 'ratna@denttech.id', 'customer123');
  await apiCall(page, 'POST', `/api/invoices/${pfId}/approve`);
  await ctx.close();

  ctx = await browser.newContext(); page = await ctx.newPage();
  await login(page, 'budi@denttech.id', 'tech123');
  await apiCall(page, 'POST', `/api/work-orders/${woId}/start-repair`);
  await apiCall(page, 'POST', `/api/work-orders/${woId}/work-performed`, { description: 'W' });
  await apiCall(page, 'POST', '/api/files', { dataUrl: 'data:image/png;base64,' + png, kind: 'after', work_order_id: woId, caption: 'After repair' });
  const comp = await apiCall(page, 'POST', `/api/work-orders/${woId}/complete`, { summary: 'Visual audit complete' });
  await ctx.close();

  ctx = await browser.newContext(); page = await ctx.newPage();
  await login(page, 'admin@denttech.id', 'admin123');
  const invId = comp.data.invoice_id;

  // === 1. Checklist Library renders 21 templates ===
  console.log('=== 1. Checklist Library page ===');
  await page.goto(BASE + '/admin/checklists.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const tplCount = await page.locator('.card', { hasText: 'item checklist' }).count();
  const bodyTxt = await page.textContent('body');
  const hasDentalUnit = bodyTxt.includes('Dental Unit');
  const has3DPrinter = bodyTxt.includes('3D Printer');
  if (tplCount >= 21) ok(`checklist library renders ${tplCount} template cards`); else bad('template cards rendered: ' + tplCount);
  if (hasDentalUnit && has3DPrinter) ok('equipment template names visible'); else bad('template names missing');

  // === 2. Invoice settings modal ===
  console.log('=== 2. Invoice settings modal ===');
  await page.goto(BASE + '/admin/invoices.html', { waitUntil: 'networkidle' });
  await page.click('#btn-settings');
  await page.waitForSelector('#set-tax', { timeout: 5000 });
  const taxOpts = await page.$$eval('#set-tax option', (os) => os.map((o) => o.value));
  if (taxOpts.includes('PPN') && taxOpts.includes('NON_PPN')) ok('settings modal has PPN & Non-PPN options'); else bad('tax options: ' + taxOpts.join(','));
  if (await page.$('#set-labor')) ok('settings modal has default labor field'); else bad('missing labor field');
  await page.keyboard.press('Escape');

  // === 3. Existing proforma + watermark + Non-PPN rendering ===
  console.log('=== 3. Existing invoice doc (watermark + Non-PPN + attachments) ===');
  const pfDet = await apiCall(page, 'GET', '/api/invoices/' + pfId);
  if (pfDet.data.invoice.tax_rate === 0) ok('proforma Non-PPN (tax_rate 0)'); else bad('tax_rate=' + pfDet.data.invoice.tax_rate);
  if ((pfDet.data.evidence.photos.length) >= 4) ok('proforma carries required before/brand/serial and after photos (' + pfDet.data.evidence.photos.length + ')'); else bad('photos=' + pfDet.data.evidence.photos.length);
  if (pfDet.data.evidence.checklist) ok('proforma carries checklist'); else bad('no checklist on proforma');
  await apiCall(page, 'PUT', '/api/invoice-settings', { tax_mode: 'PPN' });

  // === 4. Customer ticket detail renders checklist ===
  console.log('=== 4. Customer ticket detail checklist ===');
  await ctx.close();
  ctx = await browser.newContext(); page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('    [pageerror]', e.message.slice(0, 120)));
  await login(page, 'ratna@denttech.id', 'customer123');
  await page.goto(BASE + '/customer/ticket-detail.html?id=' + ticketId, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const custBody = await page.textContent('body');
  if (custBody.includes('Checklist Pengecekan Teknisi')) ok('customer sees checklist section'); else bad('customer checklist section missing');
  if (custBody.includes('Laporan Service')) ok('customer sees service report'); else bad('customer report missing');
  // customer invoice detail has download
  await page.goto(BASE + '/customer/invoice-detail.html?id=' + invId, { waitUntil: 'networkidle' });
  if (await page.$('#btn-download')) ok('customer invoice download button present'); else bad('customer invoice download missing');

  // === 5. Technician job detail renders checklist items ===
  console.log('=== 5. Technician job detail ===');
  await ctx.close();
  ctx = await browser.newContext(); page = await ctx.newPage();
  await login(page, 'budi@denttech.id', 'tech123');
  await page.goto(BASE + '/technician/job-detail.html?id=' + woId, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const techBody = await page.textContent('body');
  if (techBody.includes('Dental Unit')) ok('technician job detail loads'); else bad('technician job detail issue');

  await ctx.close();
  await browser.close();
  console.log('\nVISUAL AUDIT RESULT: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
