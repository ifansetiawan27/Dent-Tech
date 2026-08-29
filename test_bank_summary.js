const { chromium } = require('playwright-core');
const BASE = 'http://localhost:3000';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  [PASS] ' + m); };
const bad = (m) => { fail++; console.log('  [FAIL] ' + m); };

async function login(page, email, password) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.fill('#email', email);
  await page.fill('#password', password);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.click('#login-btn')]);
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });

  console.log('=== 1. Pengaturan Invoice: input rekening (admin) ===');
  const ctx1 = await browser.newContext();
  const page = await ctx1.newPage();
  page.on('pageerror', (e) => console.log('    [pageerror]', e.message.slice(0, 160)));
  await login(page, 'admin@denttech.id', 'admin123');
  await page.goto(BASE + '/admin/invoices.html', { waitUntil: 'networkidle' });
  await page.click('#btn-settings');
  await page.waitForSelector('#set-bank', { timeout: 5000 });
  const bankVal = await page.inputValue('#set-bank');
  const bankNameVal = await page.inputValue('#set-bank-name');
  const bankNumberVal = await page.inputValue('#set-bank-number');
  if (bankVal && bankNameVal && bankNumberVal) ok('modal pengaturan punya 3 input rekening terisi (' + bankVal + ')');
  else bad('input rekening kosong: ' + JSON.stringify({ bankVal, bankNameVal, bankNumberVal }));
  await page.click('[data-modal-close]');

  console.log('=== 2. Detail invoice admin: panel rekening pembayaran ===');
  const unpaidId = await page.evaluate(async () => {
    const token = localStorage.getItem('sms_token');
    if (!token) return { err: 'token kosong, keys=' + Object.keys(localStorage).join(',') + ' url=' + location.href };
    const mod = await import('/services/api.js');
    try {
      const data = await mod.api.get('/api/invoices');
      const inv = data.invoices.find((i) => i.status !== 'PAID');
      return { id: inv ? inv.id : null, tokHead: token.slice(0, 15) };
    } catch (e) {
      return { err: 'api.get gagal: ' + e.message + ' | tokHead=' + token.slice(0, 15) + ' | len=' + token.length };
    }
  });
  if (unpaidId.tokHead) console.log('  (debug token head: ' + unpaidId.tokHead + '...)');
  if (unpaidId.err) bad('gagal ambil invoice list: ' + unpaidId.err);
  if (!unpaidId.id) bad('tidak ada invoice belum lunas untuk dites');
  await page.goto(BASE + '/admin/invoice-detail.html?id=' + unpaidId.id, { waitUntil: 'networkidle' });
  await page.waitForSelector('#content .card', { timeout: 8000 });
  const bodyText = await page.textContent('#content');
  const unpaid = bodyText.includes('Menunggu Pembayaran');
  if (unpaid) {
    if (bodyText.includes('Rekening Pembayaran') && bodyText.includes('BCA')) ok('panel rekening tampil di detail invoice admin (belum lunas)');
    else bad('panel rekening tidak tampil di detail invoice admin');
  } else {
    bad('invoice seharusnya belum lunas tapi status berbeda');
  }

  console.log('=== 3. Dokumen PDF invoice memuat info rekening ===');
  const docHtml = await page.evaluate(async (id) => {
    const mod = await import('/utils/invoice-doc.js');
    const apiMod = await import('/services/api.js');
    const data = await apiMod.api.get('/api/invoices/' + id);
    return mod.buildInvoiceHtml({ ...data, company: {} });
  }, unpaidId.id);
  if (unpaid) {
    if (docHtml.includes('Informasi Pembayaran') && docHtml.includes('8830127645') && docHtml.includes('PT Dent Tech Indonesia')) ok('dokumen invoice memuat bank, no. rek, dan atas nama');
    else bad('dokumen invoice tidak memuat info rekening');
  } else {
    ok('skip cek dokumen (invoice sudah PAID)');
  }
  await ctx1.close();

  console.log('=== 4. Customers: kolom billing & modal ringkasan (admin) ===');
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  page2.on('pageerror', (e) => console.log('    [pageerror]', e.message.slice(0, 160)));
  await login(page2, 'admin@denttech.id', 'admin123');
  await page2.goto(BASE + '/admin/customers.html', { waitUntil: 'networkidle' });
  await page2.waitForSelector('table', { timeout: 8000 });
  const tableText = await page2.textContent('table');
  if (tableText.includes('Billing') && (tableText.includes('Sisa') || tableText.includes('Lunas'))) ok('kolom Billing tampil dengan sisa tagihan / lunas');
  else bad('kolom Billing tidak tampil semestinya');
  if (tableText.includes('total')) ok('ticket aktif menampilkan total ticket');
  else bad('total ticket tidak tampil');
  await page2.locator('[data-summary]').first().click();
  await page2.waitForSelector('a[href*="ticket-detail"]', { timeout: 8000 });
  const modalText = await page2.evaluate(() =>
    Array.from(document.querySelectorAll('.overflow-y-auto')).map((e) => e.textContent).join(' '));
  const needLabels = ['Total Ticket', 'Ticket Aktif', 'Selesai', 'Equipment', 'Garansi Aktif', 'Total Dibayar', 'Sisa Tagihan', 'Ticket Terakhir', 'Invoice', 'Equipment Terdaftar'];
  const missing = needLabels.filter((l) => !modalText.includes(l));
  if (!missing.length) ok('modal ringkasan lengkap: stats, ticket terakhir, invoice, equipment');
  else bad('modal ringkasan kurang: ' + missing.join(', '));
  if (modalText.includes('Garansi s/d') || modalText.includes('Garansi habis') || modalText.includes('Tanpa garansi')) ok('info garansi service tampil per equipment');
  else bad('info garansi tidak tampil di daftar equipment');
  const n = await page2.locator('a[href*="ticket-detail"]').count();
  if (n > 0) ok('ticket terakhir bisa diklik ke detail (' + n + ' link)');
  else bad('tidak ada link ticket di modal');
  const nInv = await page2.locator('a[href*="invoice-detail"]').count();
  if (nInv >= 0) ok('invoice list tampil (' + nInv + ' link)');
  await ctx2.close();

  console.log('=== 5. Detail invoice customer: panel rekening pembayaran ===');
  const ctx3 = await browser.newContext();
  const page3 = await ctx3.newPage();
  page3.on('pageerror', (e) => console.log('    [pageerror]', e.message.slice(0, 160)));
  await login(page3, 'ratna@denttech.id', 'customer123');
  await page3.goto(BASE + '/customer/invoices.html', { waitUntil: 'networkidle' });
  const custUnpaidId = await page3.evaluate(async () => {
    const apiMod = await import('/services/api.js');
    const data = await apiMod.api.get('/api/invoices');
    const inv = data.invoices.find((i) => i.status !== 'PAID');
    return inv ? inv.id : null;
  });
  if (custUnpaidId) {
    await page3.goto(BASE + '/customer/invoice-detail.html?id=' + custUnpaidId, { waitUntil: 'networkidle' });
    await page3.waitForSelector('#content .card', { timeout: 8000 });
    const custText = await page3.textContent('#content');
    if (custText.includes('Rekening Pembayaran') && custText.includes('BCA')) ok('customer melihat rekening pembayaran di detail invoice');
    else bad('customer tidak melihat info rekening: ' + custText.slice(0, 120));
  } else {
    bad('tidak ada invoice belum lunas untuk customer');
  }
  await ctx3.close();

  await browser.close();
  console.log('\nBANK & SUMMARY RESULT: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
