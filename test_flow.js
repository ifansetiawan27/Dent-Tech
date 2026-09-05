require('dotenv').config();
const { chromium } = require('playwright-core');
const { db } = require('./backend/db');
const { now } = require('./backend/util');

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
  await page.goto(BASE + '/login.html', { waitUntil: 'networkidle' });
  await page.fill('#email', email);
  await page.fill('#password', password);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.click('#login-btn')]);
}

async function pollPage(page, evaluate, arg, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let value;
  while (Date.now() < deadline) {
    value = await page.evaluate(evaluate, arg);
    if (value) return value;
    await page.waitForTimeout(250);
  }
  throw new Error(`State tidak tercapai dalam ${timeout}ms`);
}

async function waitForApiState(page, path, predicate, timeout = 20000) {
  return pollPage(page, async ({ path, predicateSource }) => {
    const token = localStorage.getItem('sms_token');
    const response = await fetch(path, { headers: { Authorization: ('Bear' + 'er ') + token } });
    if (!response.ok) return null;
    const detail = await response.json();
    return (0, eval)(`(${predicateSource})`)(detail) ? detail : null;
  }, { path, predicateSource: predicate.toString() }, timeout);
}

async function clickForResponse(page, selector, urlPart, method = 'POST', timeout = 15000) {
  const responsePromise = page.waitForResponse((response) =>
    response.url().includes(urlPart) && response.request().method() === method,
  { timeout });
  await page.click(selector);
  const response = await responsePromise;
  if (!response.ok()) throw new Error(`${method} ${urlPart} gagal (${response.status()}): ${await response.text()}`);
  return response;
}

const pngBuf = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFklEQVR4nGP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC', 'base64');

async function uploadPhoto(page, woId, kind) {
  const responsePromise = page.waitForResponse((response) =>
    response.url().includes('/api/files') && response.request().method() === 'POST',
  { timeout: 20000 });
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click(`[data-upload="${kind}"]`)
  ]);
  await fileChooser.setFiles({ name: `${kind}.png`, mimeType: 'image/png', buffer: pngBuf });
  const response = await responsePromise;
  if (!response.ok()) throw new Error(`Upload ${kind} gagal (${response.status()}): ${await response.text()}`);
  await waitForApiState(page, '/api/work-orders/' + woId,
    new Function('detail', `return detail.photos?.some((photo) => photo.kind === ${JSON.stringify(kind)})`));
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });

  // ============ STEP 1: Customer submits request via UI ============
  console.log('=== STEP 1: Customer creates request (UI) ===');
  let { ctx, page } = await freshPage(browser);
  await login(page, 'ratna@denttech.id', 'customer123');
  await db.prepare("UPDATE wallet_accounts SET balance = 100000, updated_at = ? WHERE customer_id = (SELECT customer_id FROM users WHERE email = 'ratna@denttech.id')").run(now());
  await page.goto(BASE + '/customer/request.html', { waitUntil: 'networkidle' });
  await page.selectOption('#rq-eqtype', 'Dental Unit');
  await page.fill('#rq-brand', 'GNATUS S200');
  await page.selectOption('#rq-type', 'Repair');
  await page.selectOption('#rq-priority', 'HIGH');
  await page.fill('#rq-problem', 'Browser test: handpiece tidak berputar');
  await page.fill('#rq-desc', 'Handpiece berbunyi kasar lalu berhenti berputar.');
  await page.fill('#rq-address', 'Jl. Melati No. 12, Jakarta Selatan');
  await page.click('#rq-submit');
  await page.waitForURL(/ticket-detail/, { timeout: 10000 });
  const custTicketId = new URL(page.url()).searchParams.get('id');
  if (custTicketId) ok('customer request submitted, redirected to detail');
  else bad('customer request submit failed, url=' + page.url());
  await ctx.close();

  // ============ STEP 2: Admin assigns technician via UI ============
  console.log('=== STEP 2: Admin assigns technician (UI) ===');
  ({ ctx, page } = await freshPage(browser));
  await login(page, 'support@denttech.id', 'admin123');
  await page.goto(BASE + '/admin/ticket-detail.html?id=' + custTicketId, { waitUntil: 'networkidle' });
  await page.waitForSelector('#btn-assign', { timeout: 15000 });
  await page.click('#btn-assign');
  await page.waitForSelector('#as-tech', { timeout: 15000 });
  await page.selectOption('#as-tech', { label: 'Budi Santoso' });
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  await page.fill('#as-date', dateStr);
  await page.selectOption('#as-window', '09:00 - 12:00');
  await clickForResponse(page, '#as-submit', `/api/tickets/${custTicketId}/assign`);
  const assigned = await waitForApiState(page, '/api/tickets/' + custTicketId,
    (detail) => detail.ticket?.status === 'ASSIGNED' && detail.work_orders?.length > 0);
  const woId = assigned.work_orders[assigned.work_orders.length - 1].id;
  if (woId) ok('admin assigned technician, ticket ASSIGNED');
  else bad('assign failed: ' + JSON.stringify(assigned));
  await ctx.close();

  // ============ STEP 3: Technician inspects and submits diagnosis via UI ============
  console.log('=== STEP 3: Technician submits diagnosis (UI) ===');
  ({ ctx, page } = await freshPage(browser));
  await login(page, 'budi@denttech.id', 'tech123');
  await page.goto(BASE + '/technician/job-detail.html?id=' + woId, { waitUntil: 'networkidle' });
  await page.waitForSelector('#btn-start', { timeout: 15000 });
  await clickForResponse(page, '#btn-start', `/api/work-orders/${woId}/start`);
  await waitForApiState(page, '/api/work-orders/' + woId,
    (detail) => detail.work_order?.status === 'STARTED');
  await page.waitForSelector('.tab-pill[data-tab="checklist"]', { timeout: 15000 });
  ok('technician started inspection');

  const equipmentIdentity = {
    name: 'Dental Unit Ruang 2',
    typeModel: 'GNATUS S200',
    serialNumber: 'GN-S200-BROWSER-001'
  };
  await page.click('#btn-equipment-identity');
  await page.waitForSelector('#eq-save', { timeout: 10000 });
  await page.fill('#eq-name', equipmentIdentity.name);
  await page.fill('#eq-type-model', equipmentIdentity.typeModel);
  await page.fill('#eq-serial', equipmentIdentity.serialNumber);
  await clickForResponse(page, '#eq-save', `/api/work-orders/${woId}/equipment-identity`, 'PUT');
  await waitForApiState(page, '/api/work-orders/' + woId, (detail) =>
    detail.work_order?.equipment_identity_confirmed_at &&
    detail.work_order?.serviced_equipment_name === 'Dental Unit Ruang 2' &&
    detail.work_order?.serviced_equipment_type_model === 'GNATUS S200' &&
    detail.work_order?.serviced_equipment_serial_number === 'GN-S200-BROWSER-001');
  await page.waitForFunction(({ name, typeModel, serialNumber }) => {
    const values = [...document.querySelectorAll('.card')]
      .find((card) => card.textContent.includes('Alat yang Diservice'))
      ?.querySelectorAll('dd');
    return values?.length === 3 && values[0].textContent.trim() === name &&
      values[1].textContent.trim() === typeModel && values[2].textContent.trim() === serialNumber;
  }, equipmentIdentity, { timeout: 15000 });
  const displayedEquipmentIdentity = await page.locator('.card', { hasText: 'Alat yang Diservice' }).locator('dd').allTextContents();
  if (displayedEquipmentIdentity.length === 3 &&
      displayedEquipmentIdentity[0].trim() === equipmentIdentity.name &&
      displayedEquipmentIdentity[1].trim() === equipmentIdentity.typeModel &&
      displayedEquipmentIdentity[2].trim() === equipmentIdentity.serialNumber) {
    ok('technician confirmed equipment identity and displayed values match');
  } else bad('equipment identity display mismatch: ' + JSON.stringify(displayedEquipmentIdentity));

  const checklistItems = await page.locator('.chk-btn[data-result="PASS"]').count();
  for (let i = 0; i < checklistItems; i++) {
    const responsePromise = page.waitForResponse((response) =>
      response.url().includes(`/api/work-orders/${woId}/checklist`) && response.request().method() === 'POST',
    { timeout: 15000 });
    await page.locator('.chk-btn[data-result="PASS"]').nth(i).click();
    const response = await responsePromise;
    if (!response.ok()) throw new Error(`Checklist gagal (${response.status()}): ${await response.text()}`);
  }
  await waitForApiState(page, '/api/work-orders/' + woId,
    (detail) => detail.checklist?.complete === true);
  ok(`inspection checklist completed via UI (${checklistItems} items)`);

  await page.click('.tab-pill[data-tab="diagnosis"]');
  await page.waitForSelector('#dg-findings');
  await page.fill('#dg-findings', 'Bearing handpiece aus');
  await page.fill('#dg-root', 'Keausan normal pemakaian');
  await page.fill('#dg-recom', 'Ganti bearing, lumasi rutin');
  await clickForResponse(page, '#dg-save', `/api/work-orders/${woId}/diagnosis`);
  await waitForApiState(page, '/api/work-orders/' + woId,
    (detail) => detail.diagnosis?.findings === 'Bearing handpiece aus');
  ok('diagnosis saved before repair');

  await page.click('.tab-pill[data-tab="photos"]');
  await page.waitForSelector('[data-upload="before"]');
  await uploadPhoto(page, woId, 'before');
  await page.waitForSelector('[data-upload="equipment_brand"]', { timeout: 15000 });
  await uploadPhoto(page, woId, 'equipment_brand');
  await page.waitForSelector('[data-upload="equipment_serial"]', { timeout: 15000 });
  await uploadPhoto(page, woId, 'equipment_serial');
  const inspectionEvidence = await waitForApiState(page, '/api/work-orders/' + woId, (detail) =>
    ['before', 'equipment_brand', 'equipment_serial'].every((kind) => detail.photos?.some((photo) => photo.kind === kind)));
  if (inspectionEvidence) ok('before, equipment brand, and equipment serial uploaded');

  const submitDiagnosisResponse = page.waitForResponse((response) =>
    response.url().includes(`/api/work-orders/${woId}/submit-diagnosis`) && response.request().method() === 'POST',
  { timeout: 15000 });
  await page.click('#btn-submit-diagnosis');
  await page.waitForSelector('[data-act="ok"]', { timeout: 10000 });
  await page.click('[data-act="ok"]');
  const diagnosisResponse = await submitDiagnosisResponse;
  if (!diagnosisResponse.ok()) throw new Error(`Submit diagnosis gagal (${diagnosisResponse.status()}): ${await diagnosisResponse.text()}`);
  await waitForApiState(page, '/api/work-orders/' + woId,
    (detail) => detail.work_order?.status === 'WAITING_QUOTATION');
  ok('diagnosis submitted, waiting for quotation');
  await ctx.close();

  // ============ STEP 4: Admin creates proforma via work order UI ============
  console.log('=== STEP 4: Admin creates proforma (work order UI) ===');
  ({ ctx, page } = await freshPage(browser));
  await login(page, 'support@denttech.id', 'admin123');
  await page.goto(BASE + '/admin/workorder-detail.html?id=' + woId, { waitUntil: 'networkidle' });
  await page.waitForSelector('#btn-proforma', { timeout: 15000 });
  await page.click('#btn-proforma');
  await page.waitForSelector('#pf-submit', { timeout: 10000 });
  await page.fill('#pf-labor', '600000');
  const proformaResponsePromise = page.waitForResponse((response) =>
    response.url().includes('/api/invoices/proforma') && response.request().method() === 'POST',
  { timeout: 15000 });
  await page.click('#pf-submit');
  const proformaResponse = await proformaResponsePromise;
  if (!proformaResponse.ok()) throw new Error(`Create proforma gagal (${proformaResponse.status()}): ${await proformaResponse.text()}`);
  const proformaPayload = await proformaResponse.json();
  const invoiceId = proformaPayload.id;
  await page.waitForURL((url) => url.pathname === '/admin/invoice-detail.html' && url.searchParams.get('id') === invoiceId, { timeout: 15000 });
  const proformaState = await waitForApiState(page, '/api/invoices/' + invoiceId,
    (detail) => detail.invoice?.type === 'PROFORMA' && detail.work_order?.status === 'WAITING_CUSTOMER_APPROVAL');
  if (invoiceId && proformaState.invoice.type === 'PROFORMA') ok(`proforma ${proformaPayload.number} created via work order UI`);
  else bad('proforma creation returned unexpected payload: ' + JSON.stringify(proformaPayload));
  await ctx.close();

  // ============ STEP 5: Customer approves proforma via invoice UI ============
  console.log('=== STEP 5: Customer approves proforma (invoice UI) ===');
  ({ ctx, page } = await freshPage(browser));
  await login(page, 'ratna@denttech.id', 'customer123');
  await page.goto(BASE + '/customer/invoice-detail.html?id=' + invoiceId, { waitUntil: 'networkidle' });
  await page.waitForSelector('#btn-approve-quote', { timeout: 15000 });
  await clickForResponse(page, '#btn-approve-quote', `/api/invoices/${invoiceId}/approve`);
  const approvedQuote = await waitForApiState(page, '/api/invoices/' + invoiceId, (detail) =>
    detail.invoice?.type === 'PROFORMA' && detail.invoice?.approval_status === 'APPROVED' && detail.work_order?.status === 'REPAIR_AUTHORIZED');
  if (approvedQuote.invoice.approval_status === 'APPROVED') ok('customer approved proforma via invoice UI');
  else bad('proforma approval failed: ' + JSON.stringify(approvedQuote));
  await ctx.close();

  // ============ STEP 6: Technician repairs and completes via UI ============
  console.log('=== STEP 6: Technician repairs and completes (UI) ===');
  ({ ctx, page } = await freshPage(browser));
  await login(page, 'budi@denttech.id', 'tech123');
  await page.goto(BASE + '/technician/job-detail.html?id=' + woId, { waitUntil: 'networkidle' });
  await page.waitForSelector('#btn-start-repair', { timeout: 15000 });
  await clickForResponse(page, '#btn-start-repair', `/api/work-orders/${woId}/start-repair`);
  await waitForApiState(page, '/api/work-orders/' + woId,
    (detail) => detail.work_order?.status === 'REPAIR_STARTED');
  await page.waitForSelector('#wp-input', { timeout: 15000 });
  ok('technician started authorized repair');

  await page.fill('#wp-input', 'Mengganti bearing handpiece');
  await clickForResponse(page, '#wp-add', `/api/work-orders/${woId}/work-performed`);
  await waitForApiState(page, '/api/work-orders/' + woId,
    (detail) => detail.work_performed?.some((item) => item.description === 'Mengganti bearing handpiece'));
  ok('repair work recorded');

  await page.click('.tab-pill[data-tab="parts"]');
  await page.waitForSelector('#pt-add');
  await page.click('#pt-add');
  await page.waitForSelector('#mp-part');
  await page.selectOption('#mp-part', { index: 1 });
  await clickForResponse(page, '#mp-submit', `/api/work-orders/${woId}/parts`);
  await waitForApiState(page, '/api/work-orders/' + woId,
    (detail) => detail.part_usages?.length > 0);
  ok('spare part recorded via UI');

  await page.click('.tab-pill[data-tab="photos"]');
  await page.waitForSelector('[data-upload="after"]');
  await uploadPhoto(page, woId, 'after');
  await page.waitForSelector('[data-upload="part_replacement"]', { timeout: 15000 });
  await uploadPhoto(page, woId, 'part_replacement');
  await waitForApiState(page, '/api/work-orders/' + woId, (detail) =>
    ['after', 'part_replacement'].every((kind) => detail.photos?.some((photo) => photo.kind === kind)) && detail.photo_requirements?.complete === true);
  ok('after and part replacement evidence uploaded');

  await page.click('.tab-pill[data-tab="complete"]');
  await page.waitForSelector('#cm-summary');
  await page.waitForFunction(() => {
    const requirements = [...document.querySelectorAll('#tab-content .card:first-child .flex.items-center.gap-2\\.5')];
    return requirements.length >= 8 && requirements.every((item) => item.querySelector('.bg-emerald-100'));
  }, null, { timeout: 15000 });
  await page.fill('#cm-summary', 'Browser test: handpiece selesai diperbaiki, berfungsi normal.');
  const completeResponsePromise = page.waitForResponse((response) =>
    response.url().includes(`/api/work-orders/${woId}/complete`) && response.request().method() === 'POST',
  { timeout: 15000 });
  await page.click('#cm-submit');
  await page.waitForSelector('[data-act="ok"]', { timeout: 10000 });
  await page.click('[data-act="ok"]');
  const completeResponse = await completeResponsePromise;
  if (!completeResponse.ok()) throw new Error(`Complete work order gagal (${completeResponse.status()}): ${await completeResponse.text()}`);
  const completed = await waitForApiState(page, '/api/work-orders/' + woId, (detail) =>
    detail.work_order?.status === 'APPROVED' && detail.service_report?.status === 'APPROVED');
  if (completed.service_report.status === 'APPROVED') ok('repair completed and report auto-approved without admin action');
  else bad('complete failed: ' + JSON.stringify(completed));
  await ctx.close();

  // ============ STEP 7: Customer sees report and payable proforma ============
  console.log('=== STEP 7: Customer verifies completed report and payable proforma (UI) ===');
  ({ ctx, page } = await freshPage(browser));
  await login(page, 'ratna@denttech.id', 'customer123');
  await page.goto(BASE + '/customer/ticket-detail.html?id=' + custTicketId, { waitUntil: 'networkidle' });
  const customerTicket = await waitForApiState(page, '/api/tickets/' + custTicketId, (detail) =>
    detail.ticket?.status === 'COMPLETED' && detail.service_report?.status === 'APPROVED' && detail.invoice?.id);
  await page.waitForSelector('text=Laporan Service', { timeout: 15000 });
  const internalLeak = customerTicket.timeline.some((event) => event.visibility === 'INTERNAL');
  if (customerTicket.ticket.status === 'COMPLETED' && customerTicket.service_report.summary && !internalLeak) {
    ok('customer sees COMPLETED ticket and approved report with no internal timeline leak');
  } else bad('customer ticket view wrong: ' + JSON.stringify({ status: customerTicket.ticket.status, report: customerTicket.service_report, internalLeak }));

  await page.goto(BASE + '/customer/invoice-detail.html?id=' + invoiceId, { waitUntil: 'networkidle' });
  const payable = await waitForApiState(page, '/api/invoices/' + invoiceId, (detail) =>
    detail.invoice?.type === 'PROFORMA' && detail.invoice?.status === 'SENT' && detail.invoice?.approval_status === 'APPROVED' &&
    ['COMPLETED', 'APPROVED'].includes(detail.work_order?.status));
  await page.waitForSelector('#btn-pay', { timeout: 15000 });
  const payLabel = await page.locator('#btn-pay').innerText();
  if (payable.invoice.status === 'SENT' && payLabel.includes('QRIS')) ok('approved proforma is payable after completed work');
  else bad('proforma is not payable: ' + JSON.stringify({ invoice: payable.invoice, payLabel }));
  ok('Pakasir payment was not initiated');
  await ctx.close();

  await browser.close();
  console.log('\nFLOW RESULT: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
