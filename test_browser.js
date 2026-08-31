const { chromium } = require('playwright-core');
const path = require('path');

const BASE = 'http://localhost:3000';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const AUTH = 'Bear' + 'er ';

const results = { pass: 0, fail: 0, errors: [] };
function ok(m) { results.pass++; console.log('  [PASS] ' + m); }
function bad(m) { results.fail++; results.errors.push(m); console.log('  [FAIL] ' + m); }

async function collectErrors(page, label, navFn) {
  const errs = [];
  const onConsole = (msg) => { if (msg.type() === 'error') errs.push(msg.text()); };
  const onPageError = (e) => errs.push('PAGEERROR: ' + e.message);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  try {
    await navFn();
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(600);
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }
  const real = errs.filter((e) => !e.includes('favicon') && !e.includes('Failed to load resource'));
  if (real.length) { bad(`${label}: ${real[0].slice(0, 160)}`); }
  else ok(label);
  return real;
}

async function login(page, email, password) {
  await page.goto(BASE + '/login.html', { waitUntil: 'networkidle' });
  await page.fill('#email', email);
  await page.fill('#password', password);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.click('#login-btn')]);
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });

  // ---------- ADMIN ----------
  console.log('=== ADMIN PORTAL ===');
  let ctx = await browser.newContext();
  let page = await ctx.newPage();
  await collectErrors(page, 'admin login', () => login(page, 'admin@denttech.id', 'admin123'));
  if (!page.url().includes('/admin/')) bad('admin not redirected to /admin/ (url=' + page.url() + ')');

  const adminPages = [
    ['admin dashboard', '/admin/'],
    ['admin tickets', '/admin/tickets.html'],
    ['admin workorders', '/admin/workorders.html'],
    ['admin schedule', '/admin/schedule.html'],
    ['admin customers', '/admin/customers.html'],
    ['admin equipment', '/admin/equipment.html'],
    ['admin technicians', '/admin/technicians.html'],
    ['admin checklists', '/admin/checklists.html'],
    ['admin inventory', '/admin/inventory.html'],
    ['admin invoices', '/admin/invoices.html'],
    ['admin finance', '/admin/finance.html'],
    ['admin reports', '/admin/reports.html'],
    ['admin audit', '/admin/audit.html'],
    ['admin settings', '/admin/settings.html']
  ];
  for (const [label, p] of adminPages) await collectErrors(page, label, () => page.goto(BASE + p, { waitUntil: 'networkidle' }));

  // admin ticket detail — need a real ticket id
  const ticketId = await page.evaluate(async () => {
    const t = localStorage.getItem('sms_token');
    const r = await fetch('/api/tickets', { headers: { Authorization: ('Bear' + 'er ') + t } });
    const d = await r.json();
    return d.tickets[0].id;
  });
  await collectErrors(page, 'admin ticket-detail', () => page.goto(BASE + '/admin/ticket-detail.html?id=' + ticketId, { waitUntil: 'networkidle' }));
  const woId = await page.evaluate(async () => {
    const t = localStorage.getItem('sms_token');
    const r = await fetch('/api/work-orders', { headers: { Authorization: ('Bear' + 'er ') + t } });
    const d = await r.json();
    return d.work_orders[0].id;
  });
  await collectErrors(page, 'admin workorder-detail', () => page.goto(BASE + '/admin/workorder-detail.html?id=' + woId, { waitUntil: 'networkidle' }));
  const invId = await page.evaluate(async () => {
    const t = localStorage.getItem('sms_token');
    const r = await fetch('/api/invoices', { headers: { Authorization: ('Bear' + 'er ') + t } });
    const d = await r.json();
    return d.invoices[0].id;
  });
  await collectErrors(page, 'admin invoice-detail', () => page.goto(BASE + '/admin/invoice-detail.html?id=' + invId, { waitUntil: 'networkidle' }));
  await ctx.close();

  // ---------- TECHNICIAN ----------
  console.log('=== TECHNICIAN PORTAL ===');
  ctx = await browser.newContext();
  page = await ctx.newPage();
  await collectErrors(page, 'tech login', () => login(page, 'budi@denttech.id', 'tech123'));
  if (!page.url().includes('/technician/')) bad('tech not redirected (url=' + page.url() + ')');
  for (const [label, p] of [
    ['tech home', '/technician/'],
    ['tech jobs', '/technician/jobs.html'],
    ['tech profile', '/technician/profile.html']
  ]) await collectErrors(page, label, () => page.goto(BASE + p, { waitUntil: 'networkidle' }));
  const techWoId = await page.evaluate(async () => {
    const t = localStorage.getItem('sms_token');
    const r = await fetch('/api/work-orders', { headers: { Authorization: ('Bear' + 'er ') + t } });
    const d = await r.json();
    return d.work_orders.length ? d.work_orders[0].id : null;
  });
  if (techWoId) await collectErrors(page, 'tech job-detail', () => page.goto(BASE + '/technician/job-detail.html?id=' + techWoId, { waitUntil: 'networkidle' }));
  else bad('tech has no work order to test job-detail');
  await ctx.close();

  // ---------- CUSTOMER ----------
  console.log('=== CUSTOMER PORTAL ===');
  ctx = await browser.newContext();
  page = await ctx.newPage();
  await collectErrors(page, 'customer login', () => login(page, 'ratna@denttech.id', 'customer123'));
  if (!page.url().includes('/customer/')) bad('customer not redirected (url=' + page.url() + ')');
  for (const [label, p] of [
    ['customer home', '/customer/'],
    ['customer wallet', '/customer/wallet.html'],
    ['customer request', '/customer/request.html'],
    ['customer tickets', '/customer/tickets.html'],
    ['customer equipment', '/customer/equipment.html'],
    ['customer invoices', '/customer/invoices.html'],
    ['customer profile', '/customer/profile.html']
  ]) await collectErrors(page, label, () => page.goto(BASE + p, { waitUntil: 'networkidle' }));
  const custTicket = await page.evaluate(async () => {
    const t = localStorage.getItem('sms_token');
    const r = await fetch('/api/tickets', { headers: { Authorization: ('Bear' + 'er ') + t } });
    const d = await r.json();
    return d.tickets.length ? d.tickets[0].id : null;
  });
  if (custTicket) await collectErrors(page, 'customer ticket-detail', () => page.goto(BASE + '/customer/ticket-detail.html?id=' + custTicket, { waitUntil: 'networkidle' }));
  const custInv = await page.evaluate(async () => {
    const t = localStorage.getItem('sms_token');
    const r = await fetch('/api/invoices', { headers: { Authorization: ('Bear' + 'er ') + t } });
    const d = await r.json();
    return d.invoices.length ? d.invoices[0].id : null;
  });
  if (custInv) await collectErrors(page, 'customer invoice-detail', () => page.goto(BASE + '/customer/invoice-detail.html?id=' + custInv, { waitUntil: 'networkidle' }));
  await ctx.close();

  await browser.close();
  console.log('\nRESULT: ' + results.pass + ' passed, ' + results.fail + ' failed');
  if (results.fail > 0) process.exit(1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
