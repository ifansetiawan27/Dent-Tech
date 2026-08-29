const { chromium } = require('playwright-core');
const BASE = 'http://localhost:3000';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const AUTH = 'Bear' + 'er ';
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  [PASS] ' + m); };
const bad = (m) => { fail++; console.log('  [FAIL] ' + m); };

async function login(page, email, password) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
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
  await custCtx.close();

  // ===== 3. Technician fills checklist -> sync to customer =====
  console.log('=== 3. Technician fills checklist, syncs to customer ===');
  const techCtx = await browser.newContext();
  const techPage = await techCtx.newPage();
  await login(techPage, 'budi@denttech.id', 'tech123');
  await apiCall(techPage, 'POST', `/api/work-orders/${woId}/start`);
  const woForChk = await apiCall(techPage, 'GET', '/api/work-orders/' + woId);
  const allItems = woForChk.data.checklist.sections.flatMap((s) => s.items);
  const fill = allItems.map((it) => ({ item_id: it.id, result: 'PASS', note: '' }));
  await apiCall(techPage, 'POST', `/api/work-orders/${woId}/checklist`, { items: fill });
  await apiCall(techPage, 'POST', `/api/work-orders/${woId}/diagnosis`, { findings: 'Test finding', root_cause: 'rc', recommendation: 'rec' });
  await apiCall(techPage, 'POST', `/api/work-orders/${woId}/work-performed`, { description: 'Test work' });
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await apiCall(techPage, 'POST', '/api/files', { dataUrl: 'data:image/png;base64,' + png, kind: 'after', work_order_id: woId, caption: 'after' });
  const comp = await apiCall(techPage, 'POST', `/api/work-orders/${woId}/complete`, { summary: 'Test complete' });
  if (comp.status === 200) ok('technician completed job'); else bad('complete failed: ' + JSON.stringify(comp.data));
  await techCtx.close();

  // admin approves -> invoice with evidence
  const reportId = comp.data.report_id;
  const appr = await apiCall(page, 'POST', `/api/service-reports/${reportId}/approve`, { labor_cost: 400000, due_days: 14 });
  const invId = appr.data.invoice_id;
  if (invId) ok('invoice created on approval'); else bad('no invoice created');
  const invDet = await apiCall(page, 'GET', '/api/invoices/' + invId);
  const evPhotos = invDet.data.evidence?.photos?.length || 0;
  const evChk = invDet.data.evidence?.checklist?.total_items || 0;
  if (evPhotos > 0) ok(`invoice evidence has ${evPhotos} photo(s) for attachment`); else bad('no photos in invoice evidence');
  if (evChk > 0) ok(`invoice evidence has checklist (${evChk} items) for attachment`); else bad('no checklist in invoice evidence');

  // customer sees checklist on ticket detail
  const custCtx2 = await browser.newContext();
  const custPage2 = await custCtx2.newPage();
  await login(custPage2, 'ratna@denttech.id', 'customer123');
  const custWo = await apiCall(custPage2, 'GET', '/api/work-orders/' + woId);
  const custChk = custWo.data.checklist?.total_items || 0;
  if (custChk > 0) ok(`customer sees filled checklist (${custChk} items) after approval`); else bad('customer cannot see checklist');
  await custCtx2.close();
  await ctx.close();

  // ===== 4. Admin UI buttons (checklist PDF, proforma, edit, downloads) =====
  console.log('=== 4. Admin UI buttons ===');
  ctx = await browser.newContext();
  page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('    [pageerror]', e.message.slice(0, 120)));
  await login(page, 'admin@denttech.id', 'admin123');
  await page.goto(BASE + '/admin/workorder-detail.html?id=' + woId, { waitUntil: 'networkidle' });
  if (await page.$('#btn-dl-checklist')) ok('Download Checklist (PDF) button present'); else bad('missing checklist download button');
  if (await page.$('#btn-proforma')) ok('Buat Proforma Invoice button present'); else bad('missing proforma button');
  await page.goto(BASE + '/admin/tickets.html', { waitUntil: 'networkidle' });
  if (await page.$('[data-edit]')) ok('Edit button present on tickets list'); else bad('missing edit button on tickets');
  await page.goto(BASE + '/admin/ticket-detail.html?id=' + newTicketId, { waitUntil: 'networkidle' });
  if (await page.$('#btn-edit')) ok('Edit button present on ticket detail'); else bad('missing edit on ticket detail');
  await page.goto(BASE + '/admin/reports.html', { waitUntil: 'networkidle' });
  if (await page.$('#btn-download-report')) ok('Download Report button present'); else bad('missing report download');
  if (await page.$('#f-preset')) ok('report date filter present'); else bad('missing report date filter');
  await page.goto(BASE + '/admin/invoice-detail.html?id=' + invId, { waitUntil: 'networkidle' });
  if (await page.$('#btn-download')) ok('Download Invoice button present (admin)'); else bad('missing admin invoice download');
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

  // ===== 6. Invoice settings + Proforma + watermark =====
  console.log('=== 6. Invoice settings + Proforma ===');
  const setRes = await apiCall(page, 'PUT', '/api/invoice-settings', { tax_mode: 'NON_PPN', default_labor: 350000 });
  if (setRes.data.tax_mode === 'NON_PPN') ok('invoice settings saved (Non-PPN)'); else bad('settings save failed');
  const pf = await apiCall(page, 'POST', '/api/invoices/proforma', { work_order_id: woId, labor_cost: 350000, due_days: 14 });
  if (pf.status === 201) ok('proforma invoice created: ' + pf.data.number); else bad('proforma failed: ' + JSON.stringify(pf.data));
  const pfDet = await apiCall(page, 'GET', '/api/invoices/' + pf.data.id);
  if (pfDet.data.invoice.type === 'PROFORMA') ok('invoice marked as PROFORMA'); else bad('type not PROFORMA');
  if (pfDet.data.invoice.tax_rate === 0) ok('Non-PPN applied (tax_rate 0)'); else bad('tax_rate should be 0, got ' + pfDet.data.invoice.tax_rate);
  const pfPhotos = pfDet.data.evidence?.photos?.length || 0;
  if (pfPhotos > 0) ok('proforma carries photo attachments'); else bad('proforma has no photo attachments');
  // pay the proforma -> status PAID (watermark LUNAS)
  const pay = await apiCall(page, 'POST', `/api/invoices/${pf.data.id}/pay`, { method: 'TRANSFER', reference: 'PF-1' });
  if (pay.status === 200) ok('proforma paid (watermark -> LUNAS)'); else bad('pay proforma failed');
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
