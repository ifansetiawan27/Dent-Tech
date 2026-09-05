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
  await page.fill('#email', email);
  await page.fill('#password', password);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.click('#login-btn')]);
}
async function apiCall(page, method, path, body) {
  return page.evaluate(async ({ method, path, body, AUTH }) => {
    const t = localStorage.getItem('sms_token');
    const r = await fetch(path, {
      method, headers: { 'Content-Type': 'application/json', Authorization: AUTH + t },
      body: body ? JSON.stringify(body) : undefined
    });
    let d = null; try { d = await r.json(); } catch {}
    return { status: r.status, data: d };
  }, { method, path, body, AUTH });
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });

  // ===== 1. Checklist library: 21 templates matching equipment list =====
  console.log('=== 1. Checklist Library (21 equipment templates) ===');
  let ctx = await browser.newContext();
  let page = await ctx.newPage();
  await login(page, 'admin@denttech.id', 'admin123');
  const tpl = await apiCall(page, 'GET', '/api/checklist-templates');
  if (tpl.data.templates.length === 21) ok('21 checklist templates exist');
  else bad('expected 21 templates, got ' + tpl.data.templates.length);
  const names = tpl.data.templates.map((t) => t.name);
  const expected = ['Dental Unit', 'Compressor', 'Motor Suction', 'Autoclave', 'Handpiece', 'X-Ray', '3D Printer', 'Intraoral Scanner 3D'];
  const allPresent = expected.every((n) => names.includes(n));
  if (allPresent) ok('key equipment templates present'); else bad('missing some templates: ' + names.join(','));
  const withItems = tpl.data.templates.every((t) => t.item_count > 0);
  if (withItems) ok('all templates have checklist items'); else bad('some templates have no items');

  // ===== 2. Auto-match checklist by equipment type =====
  console.log('=== 2. Auto-match checklist by equipment type ===');
  // create a customer ticket with equipment_type Autoclave
  const custCtx = await browser.newContext();
  const custPage = await custCtx.newPage();
  await login(custPage, 'ratna@denttech.id', 'customer123');
  await db.prepare("UPDATE wallet_accounts SET balance = 100000, updated_at = ? WHERE customer_id = (SELECT customer_id FROM users WHERE email = 'ratna@denttech.id')").run(now());
  const mk = await apiCall(custPage, 'POST', '/api/tickets', {
    equipment_type: 'Autoclave', equipment_brand: 'TUTTNAUER', service_address: 'Jl. Test 1',
    service_type: 'Repair', priority: 'HIGH', problem: 'Autoclave test auto-match', description: 'x',
    contact_name: 'Ratna', contact_phone: '0812'
  });
  const newTicketId = mk.data.id;
  // admin assigns (auto template)
  const techs = await apiCall(page, 'GET', '/api/users?role=technician');
  const techId = techs.data.users.find((u) => u.email === 'budi@denttech.id').id;
  const today = new Date(); const ds = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const asg = await apiCall(page, 'POST', `/api/tickets/${newTicketId}/assign`, { technician_id: techId, scheduled_date: ds, time_window: '09:00 - 12:00' });
  const woId = asg.data.work_order_id;
  const woDet = await apiCall(page, 'GET', '/api/work-orders/' + woId);
  const tplName = woDet.data.checklist?.template?.name;
  if (tplName === 'Autoclave') ok('auto-matched Autoclave checklist template');
  else bad('auto-match got: ' + tplName);
  const itemCount = woDet.data.checklist?.total_items || 0;
  if (itemCount > 0) ok(`checklist has ${itemCount} items (synced to admin view)`); else bad('no checklist items on WO');

  // ===== 3. Diagnosis-first quotation lifecycle =====
  console.log('=== 3. Diagnosis-first quotation lifecycle ===');
  const techCtx = await browser.newContext();
  const techPage = await techCtx.newPage();
  await login(techPage, 'budi@denttech.id', 'tech123');
  const started = await apiCall(techPage, 'POST', `/api/work-orders/${woId}/start`);
  if (started.status === 200) ok('technician started inspection'); else bad('start inspection failed: ' + JSON.stringify(started.data));
  const woForChk = await apiCall(techPage, 'GET', '/api/work-orders/' + woId);
  const identity = await apiCall(techPage, 'PUT', `/api/work-orders/${woId}/equipment-identity`, {
    name: 'Autoclave Test Unit',
    type_model: 'TUTTNAUER 2540M',
    serial_number: 'AUTO-FEATURES2-001',
    version: woForChk.data.work_order.equipment_identity_version
  });
  if (woForChk.data.work_order.status === 'STARTED' && identity.status === 200 && identity.data.equipment_identity.version === woForChk.data.work_order.equipment_identity_version + 1) ok('equipment identity confirmed while STARTED using current version');
  else bad('equipment identity confirmation failed: ' + JSON.stringify({ status: woForChk.data.work_order.status, identity: identity.data }));
  const allItems = woForChk.data.checklist.sections.flatMap((s) => s.items);
  const fill = allItems.map((it) => ({ item_id: it.id, result: 'PASS', note: '' }));
  const checklistSaved = await apiCall(techPage, 'POST', `/api/work-orders/${woId}/checklist`, { items: fill });
  if (checklistSaved.status === 200 && checklistSaved.data.checklist.complete) ok('inspection checklist completed'); else bad('checklist save failed: ' + JSON.stringify(checklistSaved.data));
  const diagnosisSaved = await apiCall(techPage, 'POST', `/api/work-orders/${woId}/diagnosis`, { findings: 'Test finding', root_cause: 'rc', recommendation: 'rec' });
  if (diagnosisSaved.status === 200) ok('diagnosis recorded'); else bad('diagnosis save failed: ' + JSON.stringify(diagnosisSaved.data));
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  let removablePhotoId = null;
  for (const kind of ['before', 'equipment_brand', 'equipment_serial']) {
    const upload = await apiCall(techPage, 'POST', '/api/files', { dataUrl: 'data:image/png;base64,' + png, kind, work_order_id: woId, caption: kind });
    if (upload.status === 201) ok(`${kind} inspection photo uploaded`); else bad(`${kind} upload failed: ` + JSON.stringify(upload.data));
    if (kind === 'before') removablePhotoId = upload.data.id;
  }
  const deletedPhoto = await apiCall(techPage, 'DELETE', `/api/files/${removablePhotoId}`);
  const afterDelete = await apiCall(techPage, 'GET', '/api/work-orders/' + woId);
  if (deletedPhoto.status === 200 && !afterDelete.data.photos.some((photo) => photo.id === removablePhotoId) && afterDelete.data.photo_requirements.missing.includes('before')) ok('technician deletes own photo and requirements resync'); else bad('technician photo deletion failed: ' + JSON.stringify({ deletedPhoto, requirements: afterDelete.data.photo_requirements }));
  const replacement = await apiCall(techPage, 'POST', '/api/files', { dataUrl: 'data:image/png;base64,' + png, kind: 'before', work_order_id: woId, caption: 'before replacement' });
  if (replacement.status === 201) ok('technician reuploads required photo after deletion'); else bad('replacement upload failed: ' + JSON.stringify(replacement.data));
  const submitted = await apiCall(techPage, 'POST', `/api/work-orders/${woId}/submit-diagnosis`);
  if (submitted.status === 200 && submitted.data.status === 'WAITING_QUOTATION') ok('diagnosis submitted for quotation'); else bad('submit diagnosis failed: ' + JSON.stringify(submitted.data));

  // Preserve proforma UI formatting coverage while the action is available.
  await page.goto(BASE + '/admin/workorder-detail.html?id=' + woId, { waitUntil: 'networkidle' });
  if (await page.$('#btn-dl-checklist')) ok('Download Checklist (PDF) button present'); else bad('missing checklist download button');
  if (await page.$('#btn-proforma')) {
    ok('Buat Proforma Invoice button present after diagnosis');
    await page.click('#btn-proforma');
    await page.waitForTimeout(200);
    if ((await page.inputValue('#pf-labor')).includes('.')) ok('proforma labor input uses Rupiah separators'); else bad('proforma labor input not formatted');
    await page.click('[data-modal-close]');
  } else bad('missing proforma button after diagnosis');

  const setRes = await apiCall(page, 'PUT', '/api/invoice-settings', { tax_mode: 'NON_PPN', default_labor: 350000 });
  if (setRes.data.tax_mode === 'NON_PPN') ok('invoice settings saved (Non-PPN)'); else bad('settings save failed');
  const pf = await apiCall(page, 'POST', '/api/invoices/proforma', { work_order_id: woId, labor_cost: 350000, due_days: 14 });
  if (pf.status === 201) ok('admin created proforma: ' + pf.data.number); else bad('proforma failed: ' + JSON.stringify(pf.data));
  const pfId = pf.data.id;

  const customerApproval = await apiCall(custPage, 'POST', `/api/invoices/${pfId}/approve`);
  if (customerApproval.status === 200 && customerApproval.data.approval_status === 'APPROVED') ok('customer approved proforma'); else bad('proforma approval failed: ' + JSON.stringify(customerApproval.data));

  const repairStarted = await apiCall(techPage, 'POST', `/api/work-orders/${woId}/start-repair`);
  if (repairStarted.status === 200 && repairStarted.data.status === 'REPAIR_STARTED') ok('technician started approved repair'); else bad('start repair failed: ' + JSON.stringify(repairStarted.data));
  const work = await apiCall(techPage, 'POST', `/api/work-orders/${woId}/work-performed`, { description: 'Test work' });
  if (work.status === 201) ok('repair work recorded without part usage'); else bad('work record failed: ' + JSON.stringify(work.data));
  const afterUpload = await apiCall(techPage, 'POST', '/api/files', { dataUrl: 'data:image/png;base64,' + png, kind: 'after', work_order_id: woId, caption: 'after' });
  if (afterUpload.status === 201) ok('after repair photo uploaded'); else bad('after upload failed: ' + JSON.stringify(afterUpload.data));
  const comp = await apiCall(techPage, 'POST', `/api/work-orders/${woId}/complete`, { summary: 'Test complete' });
  if (comp.status === 200) ok('technician completed job'); else bad('complete failed: ' + JSON.stringify(comp.data));
  await techCtx.close();

  const invId = comp.data.invoice_id;
  if (comp.status === 200 && invId === pfId) ok('technician completion auto-approves report and reuses existing proforma'); else bad('completion did not reuse proforma: ' + JSON.stringify(comp.data));
  const invoicesBeforePayment = await db.prepare('SELECT id, type, status FROM invoices WHERE work_order_id = ? ORDER BY created_at').all(woId);
  if (invoicesBeforePayment.length === 1 && invoicesBeforePayment[0].id === pfId && invoicesBeforePayment[0].type === 'PROFORMA') ok('no duplicate final invoice exists before payment');
  else bad('unexpected invoices before payment: ' + JSON.stringify(invoicesBeforePayment));

  const invDet = await apiCall(page, 'GET', '/api/invoices/' + invId);
  const evPhotos = invDet.data.evidence?.photos?.length || 0;
  const evChk = invDet.data.evidence?.checklist?.total_items || 0;
  if (evPhotos >= 4) ok(`invoice evidence has ${evPhotos} required photos`); else bad('invoice evidence is missing required photos');
  if (evChk > 0) ok(`invoice evidence has checklist (${evChk} items) for attachment`); else bad('no checklist in invoice evidence');
  if (invDet.data.evidence?.diagnosis?.findings === 'Test finding' && invDet.data.evidence.diagnosis.root_cause === 'rc' && invDet.data.evidence.diagnosis.recommendation === 'rec') ok('invoice evidence synchronizes technician diagnosis for customer PDF'); else bad('invoice evidence is missing technician diagnosis');

  // customer sees checklist and diagnosis immediately after technician completion
  const custWo = await apiCall(custPage, 'GET', '/api/work-orders/' + woId);
  const custChk = custWo.data.checklist?.total_items || 0;
  if (custChk > 0) ok(`customer sees filled checklist (${custChk} items) after approval`); else bad('customer cannot see checklist');
  if (custWo.data.diagnosis?.findings === 'Test finding') ok('customer portal receives approved technician diagnosis'); else bad('customer portal cannot see approved diagnosis');
  await custCtx.close();
  await ctx.close();

  // ===== 4. Admin UI buttons (checklist PDF, edit, downloads) =====
  console.log('=== 4. Admin UI buttons ===');
  ctx = await browser.newContext();
  page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('    [pageerror]', e.message.slice(0, 120)));
  await login(page, 'admin@denttech.id', 'admin123');
  await page.goto(BASE + '/admin/workorder-detail.html?id=' + woId, { waitUntil: 'networkidle' });
  if (await page.$('#btn-dl-checklist')) ok('Download Checklist (PDF) button present'); else bad('missing checklist download button');
  await page.goto(BASE + '/admin/tickets.html', { waitUntil: 'networkidle' });
  if (await page.$('[data-edit]')) ok('Edit button present on tickets list'); else bad('missing edit button on tickets');
  await page.goto(BASE + '/admin/ticket-detail.html?id=' + newTicketId, { waitUntil: 'networkidle' });
  if (await page.$('#btn-edit')) ok('Edit button present on ticket detail'); else bad('missing edit on ticket detail');
  await page.goto(BASE + '/admin/reports.html', { waitUntil: 'networkidle' });
  if (await page.$('#btn-download-report')) ok('Download Report button present'); else bad('missing report download');
  if (await page.$('#f-preset')) ok('report date filter present'); else bad('missing report date filter');
  await page.goto(BASE + '/admin/invoice-detail.html?id=' + invId, { waitUntil: 'networkidle' });
  if (await page.$('#btn-download')) ok('Download Invoice button present (admin)'); else bad('missing admin invoice download');
  if (await page.$('#btn-edit')) {
    await page.click('#btn-edit');
    await page.waitForTimeout(200);
    const laborFormatted = (await page.inputValue('#ed-labor')).includes('.');
    const discountFormatted = /^\d{1,3}(\.\d{3})*$/.test(await page.inputValue('#ed-disc'));
    if (laborFormatted && discountFormatted) ok('invoice edit inputs use Rupiah separators'); else bad('invoice edit inputs not formatted');
    await page.click('[data-modal-close]');
  }
  await page.goto(BASE + '/admin/invoices.html', { waitUntil: 'networkidle' });
  if (await page.$('#btn-settings')) ok('Invoice settings button present'); else bad('missing invoice settings');
  await ctx.close();

  // ===== 5. Ticket edit endpoint =====
  console.log('=== 5. Ticket edit ===');
  ctx = await browser.newContext();
  page = await ctx.newPage();
  await login(page, 'admin@denttech.id', 'admin123');
  const upd = await apiCall(page, 'PUT', '/api/tickets/' + newTicketId, { problem: 'Edited problem', priority: 'URGENT', equipment_brand: 'TUTTNAUER 2540M-EDITED' });
  if (upd.status === 200) ok('ticket edit endpoint works'); else bad('ticket edit failed: ' + JSON.stringify(upd.data));
  const after = await apiCall(page, 'GET', '/api/tickets/' + newTicketId);
  if (after.data.ticket.problem === 'Edited problem' && after.data.ticket.equipment_brand === 'TUTTNAUER 2540M-EDITED') ok('ticket fields updated'); else bad('ticket fields not updated');

  // ===== 6. Existing proforma payment conversion + watermark =====
  console.log('=== 6. Existing Proforma Payment ===');
  const pfDet = await apiCall(page, 'GET', '/api/invoices/' + pfId);
  if (pfDet.data.invoice.type === 'PROFORMA') ok('invoice remains PROFORMA before payment'); else bad('type not PROFORMA before payment');
  if (pfDet.data.invoice.tax_rate === 0) ok('Non-PPN applied (tax_rate 0)'); else bad('tax_rate should be 0, got ' + pfDet.data.invoice.tax_rate);
  const pfPhotos = pfDet.data.evidence?.photos?.length || 0;
  if (pfPhotos >= 4) ok('proforma carries all required photo attachments'); else bad('proforma is missing photo attachments');
  // Payment converts this same record to FINAL/PAID; no second invoice is created.
  const pay = await apiCall(page, 'POST', `/api/invoices/${pfId}/pay`, { method: 'TRANSFER', reference: 'PF-1' });
  if (pay.status === 200) ok('proforma paid (watermark -> LUNAS)'); else bad('pay proforma failed: ' + JSON.stringify(pay.data));
  const invoicesAfterPayment = await db.prepare('SELECT id, type, status, proforma_number FROM invoices WHERE work_order_id = ? ORDER BY created_at').all(woId);
  if (invoicesAfterPayment.length === 1 && invoicesAfterPayment[0].id === pfId && invoicesAfterPayment[0].type === 'FINAL' && invoicesAfterPayment[0].status === 'PAID') ok('payment converts the existing proforma without duplication');
  else bad('unexpected invoices after payment: ' + JSON.stringify(invoicesAfterPayment));
  // restore settings to PPN
  await apiCall(page, 'PUT', '/api/invoice-settings', { tax_mode: 'PPN' });
  await ctx.close();

  // ===== 7. Reports date filter =====
  console.log('=== 7. Reports date filter ===');
  ctx = await browser.newContext();
  page = await ctx.newPage();
  await login(page, 'admin@denttech.id', 'admin123');
  const an = await apiCall(page, 'GET', '/api/reports/analytics?from=' + ds + '&to=' + ds);
  if (an.data.summary && typeof an.data.summary.total_tickets === 'number') ok('analytics with date filter returns summary'); else bad('analytics filter failed');
  if (an.data.by_equipment_type) ok('analytics includes by_equipment_type'); else bad('missing by_equipment_type');
  await ctx.close();

  await browser.close();
  console.log('\nNEW FEATURES RESULT: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
