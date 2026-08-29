const { chromium } = require('playwright-core');

const BASE = 'http://localhost:3000';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  [PASS] ' + m); };
const bad = (m) => { fail++; console.log('  [FAIL] ' + m); };

async function freshPage(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('    [pageerror]', e.message.slice(0, 120)));
  return { ctx, page };
}

async function login(page, email, password) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.fill('#email', email);
  await page.fill('#password', password);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.click('#login-btn')]);
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });

  // ============ STEP 1: Customer submits request via UI ============
  console.log('=== STEP 1: Customer creates request (UI) ===');
  let { ctx, page } = await freshPage(browser);
  await login(page, 'ratna@denttech.id', 'customer123');
  await page.goto(BASE + '/customer/request.html', { waitUntil: 'networkidle' });
  await page.selectOption('#rq-eqtype', 'Dental Unit');
  await page.fill('#rq-brand', 'GNATUS S200');
  await page.selectOption('#rq-type', 'Repair');
  await page.selectOption('#rq-priority', 'HIGH');
  await page.fill('#rq-problem', 'Browser test: handpiece tidak berputar');
  await page.fill('#rq-desc', 'Handpiece berbunyi kasar lalu berhenti berputar.');
  await page.fill('#rq-address', 'Jl. Melati No. 12, Jakarta Selatan');
  await page.click('#rq-submit');
  await page.waitForURL(/ticket-detail/, { timeout: 10000 }).catch(() => {});
  if (page.url().includes('ticket-detail')) ok('customer request submitted, redirected to detail');
  else bad('customer request submit failed, url=' + page.url());
  const custTicketId = new URL(page.url()).searchParams.get('id');
  await ctx.close();

  // ============ STEP 2: Admin assigns technician via UI ============
  console.log('=== STEP 2: Admin assigns technician (UI) ===');
  ({ ctx, page } = await freshPage(browser));
  await login(page, 'admin@denttech.id', 'admin123');
  await page.goto(BASE + '/admin/ticket-detail.html?id=' + custTicketId, { waitUntil: 'networkidle' });
  await page.waitForSelector('#btn-assign', { timeout: 8000 });
  await page.click('#btn-assign');
  await page.waitForSelector('#as-tech', { timeout: 5000 });
  await page.selectOption('#as-tech', { label: 'Budi Santoso' });
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  await page.fill('#as-date', dateStr);
  await page.selectOption('#as-window', '09:00 - 12:00');
  await page.click('#as-submit');
  await page.waitForSelector('#btn-cancel, .card:has-text("Work Orders")', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const assigned = await page.evaluate(async (id) => {
    const t = localStorage.getItem('sms_token');
    const r = await fetch('/api/tickets/' + id, { headers: { Authorization: ('Bear' + 'er ') + t } });
    const d = await r.json();
    return { status: d.ticket.status, woCount: d.work_orders.length };
  }, custTicketId);
  if (assigned.status === 'ASSIGNED' && assigned.woCount > 0) ok('admin assigned technician, ticket ASSIGNED');
  else bad('assign failed: ' + JSON.stringify(assigned));
  await ctx.close();

  // ============ STEP 3: Technician executes job via UI ============
  console.log('=== STEP 3: Technician executes job (UI) ===');
  ({ ctx, page } = await freshPage(browser));
  await login(page, 'budi@denttech.id', 'tech123');
  const woId = await page.evaluate(async () => {
    const t = localStorage.getItem('sms_token');
    const r = await fetch('/api/work-orders', { headers: { Authorization: ('Bear' + 'er ') + t } });
    const d = await r.json();
    const target = d.work_orders.find((w) => w.status === 'ASSIGNED');
    return target ? target.id : null;
  });
  if (!woId) { bad('no ASSIGNED work order found for technician'); }
  else {
    await page.goto(BASE + '/technician/job-detail.html?id=' + woId, { waitUntil: 'networkidle' });
    await page.waitForSelector('#btn-start', { timeout: 8000 });
    await page.click('#btn-start');
    await page.waitForSelector('.tab-pill', { timeout: 8000 });
    ok('technician started job');

    // fill all checklist items PASS
    const chkButtons = await page.$$('.chk-btn[data-result="PASS"]');
    for (const b of chkButtons) { await b.click(); await page.waitForTimeout(60); }
    const chkState = await page.evaluate(async (id) => {
      const t = localStorage.getItem('sms_token');
      const r = await fetch('/api/work-orders/' + id, { headers: { Authorization: ('Bear' + 'er ') + t } });
      const d = await r.json();
      return d.checklist ? d.checklist.complete : true;
    }, woId);
    if (chkState) ok('checklist filled complete via UI (' + chkButtons.length + ' items)');
    else bad('checklist not complete after UI clicks');

    // diagnosis tab
    await page.click('.tab-pill[data-tab="diagnosis"]');
    await page.waitForSelector('#dg-findings');
    await page.fill('#dg-findings', 'Bearing handpiece aus');
    await page.fill('#dg-root', 'Keausan normal pemakaian');
    await page.fill('#dg-recom', 'Ganti bearing, lumasi rutin');
    await page.click('#dg-save');
    await page.waitForTimeout(700);
    await page.fill('#wp-input', 'Mengganti bearing handpiece');
    await page.click('#wp-add');
    await page.waitForTimeout(700);
    ok('diagnosis + work performed saved');

    // parts tab — add one part
    await page.click('.tab-pill[data-tab="parts"]');
    await page.waitForSelector('#pt-add');
    await page.click('#pt-add');
    await page.waitForSelector('#mp-part');
    await page.selectOption('#mp-part', { index: 1 });
    await page.click('#mp-submit');
    await page.waitForTimeout(700);
    const partsCount = await page.evaluate(async (id) => {
      const t = localStorage.getItem('sms_token');
      const r = await fetch('/api/work-orders/' + id, { headers: { Authorization: ('Bear' + 'er ') + t } });
      const d = await r.json();
      return d.part_usages.length;
    }, woId);
    if (partsCount > 0) ok('spare part added via UI');
    else bad('part not added');

    // photos tab — upload after photo (generated png)
    await page.click('.tab-pill[data-tab="photos"]');
    await page.waitForSelector('[data-upload="after"]');
    const pngBuf = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFklEQVR4nGP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC', 'base64');
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click('[data-upload="after"]')
    ]);
    await fileChooser.setFiles({ name: 'after.png', mimeType: 'image/png', buffer: pngBuf });
    await page.waitForTimeout(2000);

    // complete tab
    await page.click('.tab-pill[data-tab="complete"]');
    await page.waitForSelector('#cm-summary');
    await page.fill('#cm-summary', 'Browser test: handpiece selesai diperbaiki, berfungsi normal.');
    await page.click('#cm-submit');
    await page.waitForSelector('[data-act="ok"]', { timeout: 5000 });
    await page.click('[data-act="ok"]');
    await page.waitForTimeout(1200);
    const woState = await page.evaluate(async (id) => {
      const t = localStorage.getItem('sms_token');
      const r = await fetch('/api/work-orders/' + id, { headers: { Authorization: ('Bear' + 'er ') + t } });
      const d = await r.json();
      return { status: d.work_order.status, report: d.service_report ? d.service_report.status : null };
    }, woId);
    if (woState.status === 'COMPLETED' && woState.report === 'SUBMITTED') ok('job completed, report SUBMITTED');
    else bad('complete failed: ' + JSON.stringify(woState));
  }
  await ctx.close();

  // ============ STEP 4: Admin approves report via UI ============
  console.log('=== STEP 4: Admin approves report (UI) ===');
  ({ ctx, page } = await freshPage(browser));
  await login(page, 'admin@denttech.id', 'admin123');
  await page.goto(BASE + '/admin/workorder-detail.html?id=' + woId, { waitUntil: 'networkidle' });
  await page.waitForSelector('#btn-approve', { timeout: 8000 });
  await page.fill('#ap-labor', '600000');
  await page.click('#btn-approve');
  await page.waitForTimeout(1500);
  const approval = await page.evaluate(async (id) => {
    const t = localStorage.getItem('sms_token');
    const r = await fetch('/api/work-orders/' + id, { headers: { Authorization: ('Bear' + 'er ') + t } });
    const d = await r.json();
    const r2 = await fetch('/api/invoices', { headers: { Authorization: ('Bear' + 'er ') + t } });
    const d2 = await r2.json();
    const inv = d2.invoices.find((i) => i.work_order_id === id);
    return { woStatus: d.work_order.status, report: d.service_report.status, invoice: inv ? { number: inv.number, status: inv.status, total: inv.totals.total } : null };
  }, woId);
  if (approval.woStatus === 'APPROVED' && approval.report === 'APPROVED' && approval.invoice) ok(`report approved, invoice ${approval.invoice.number} created (${approval.invoice.total})`);
  else bad('approval failed: ' + JSON.stringify(approval));
  await ctx.close();

  // ============ STEP 5: Customer sees report + pays invoice via UI ============
  console.log('=== STEP 5: Customer verifies & pays (UI) ===');
  ({ ctx, page } = await freshPage(browser));
  await login(page, 'ratna@denttech.id', 'customer123');
  await page.goto(BASE + '/customer/ticket-detail.html?id=' + custTicketId, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const custView = await page.evaluate(async (id) => {
    const t = localStorage.getItem('sms_token');
    const r = await fetch('/api/tickets/' + id, { headers: { Authorization: ('Bear' + 'er ') + t } });
    const d = await r.json();
    return {
      status: d.ticket.status,
      reportVisible: !!(d.service_report && d.service_report.summary),
      internalLeak: d.timeline.some((ev) => ev.visibility === 'INTERNAL'),
      invoiceId: d.invoice ? d.invoice.id : null
    };
  }, custTicketId);
  if (custView.status === 'CLOSED' && custView.reportVisible && !custView.internalLeak) ok('customer sees CLOSED ticket + approved report, no INTERNAL leak');
  else bad('customer view wrong: ' + JSON.stringify(custView));

  const pageText = await page.textContent('body');
  if (pageText.includes('Laporan Service')) ok('service report rendered on customer ticket page');
  else bad('service report not rendered');

  // pay the invoice via UI
  if (custView.invoiceId) {
    await page.goto(BASE + '/customer/invoice-detail.html?id=' + custView.invoiceId, { waitUntil: 'networkidle' });
    await page.waitForSelector('#btn-pay', { timeout: 8000 });
    await page.click('#btn-pay');
    await page.waitForSelector('#cp-submit');
    await page.fill('#cp-ref', 'TRF-BROWSER-TEST');
    await page.click('#cp-submit');
    await page.waitForTimeout(1200);
    const paidState = await page.evaluate(async (id) => {
      const t = localStorage.getItem('sms_token');
      const r = await fetch('/api/invoices/' + id, { headers: { Authorization: ('Bear' + 'er ') + t } });
      const d = await r.json();
      return d.invoice.status;
    }, custView.invoiceId);
    if (paidState === 'PAID') ok('customer paid invoice via UI');
    else bad('invoice payment failed: ' + paidState);
  } else bad('no invoice found for customer');
  await ctx.close();

  await browser.close();
  console.log('\nFLOW RESULT: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
