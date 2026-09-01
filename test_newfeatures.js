const { chromium } = require('playwright-core');
const BASE = 'http://localhost:3000';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log('  [PASS] ' + m); };
const bad = (m) => { fail++; console.log('  [FAIL] ' + m); };

async function login(page, email, password) {
  await page.goto(BASE + '/login.html', { waitUntil: 'networkidle' });
  await page.fill('#email', email);
  await page.fill('#password', password);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.click('#login-btn')]);
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('    [pageerror]', e.message.slice(0, 120)));

  console.log('=== 1. Request form: equipment type dropdown + Merk + Alamat ===');
  await login(page, 'ratna@denttech.id', 'customer123');
  await page.goto(BASE + '/customer/request.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('#rq-eqtype');
  const opts = await page.$$eval('#rq-eqtype option', (os) => os.map((o) => o.value).filter(Boolean));
  if (opts.length === 21) ok('equipment type dropdown has 21 options');
  else bad('equipment type options count = ' + opts.length);
  const hasKey = ['Dental Unit', 'Compressor', 'Autoclave', 'X-Ray', '3D Printer', 'Handpiece', 'Laser'].every((k) => opts.includes(k));
  if (hasKey) ok('key equipment types present (Dental Unit, Compressor, Autoclave, X-Ray, 3D Printer, ...)');
  else bad('some key equipment types missing');
  if (await page.$('#rq-brand')) ok('Merk field present'); else bad('Merk field missing');
  if (await page.$('#rq-address')) ok('Alamat field present'); else bad('Alamat field missing');
  const addrVal = await page.$eval('#rq-address', (el) => el.value.trim());
  if (addrVal.length > 0) ok('Alamat prefilled from customer address: "' + addrVal.slice(0, 40) + '..."');
  else bad('Alamat not prefilled');

  console.log('=== 2. Profile photo upload (UI) ===');
  await page.goto(BASE + '/customer/profile.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('#pf-photo-file', { state: 'attached' });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#pf-photo-btn')]);
  await chooser.setFiles({ name: 'me.png', mimeType: 'image/png', buffer: png });
  await page.waitForFunction(() => {
    const u = JSON.parse(localStorage.getItem('sms_user') || '{}');
    return !!u.photo_url;
  }, null, { timeout: 10000 });
  const photoSet = await page.evaluate(() => {
    const u = JSON.parse(localStorage.getItem('sms_user') || '{}');
    return !!u.photo_url;
  });
  if (photoSet) ok('profile photo uploaded & stored in session');
  else bad('profile photo not stored');
  const avatarImg = await page.$eval('#pf-photo-preview', (el) => el.innerHTML.includes('<img'));
  if (avatarImg) ok('profile page shows <img> avatar');
  else bad('profile avatar not an image');

  console.log('=== 3. Avatar appears in topbar ===');
  await page.waitForTimeout(900);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForSelector('#user-menu-btn', { state: 'visible' });
  const topbarImg = await page.locator('#user-menu-btn img').count() > 0;
  if (topbarImg) ok('topbar avatar shows photo');
  else bad('topbar avatar not updated');

  console.log('=== 4. Invoice download button ===');
  const invId = await page.evaluate(async () => {
    const t = localStorage.getItem('sms_token');
    const r = await fetch('/api/invoices', { headers: { Authorization: ('Bear' + 'er ') + t } });
    const d = await r.json();
    return d.invoices.length ? d.invoices[0].id : null;
  });
  if (invId) {
    await page.goto(BASE + '/customer/invoice-detail.html?id=' + invId, { waitUntil: 'networkidle' });
    await page.waitForSelector('#btn-download');
    ok('customer invoice download button present');
  } else bad('no invoice to test download');

  // admin invoice download
  await ctx.close();
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await login(page2, 'admin@denttech.id', 'admin123');
  const adminInv = await page2.evaluate(async () => {
    const t = localStorage.getItem('sms_token');
    const r = await fetch('/api/invoices', { headers: { Authorization: ('Bear' + 'er ') + t } });
    const d = await r.json();
    return d.invoices.length ? d.invoices[0].id : null;
  });
  if (adminInv) {
    await page2.goto(BASE + '/admin/invoice-detail.html?id=' + adminInv, { waitUntil: 'networkidle' });
    await page2.waitForSelector('#btn-download');
    ok('admin invoice download button present');
  } else bad('no admin invoice to test');
  await ctx2.close();

  await browser.close();
  console.log('\nNEW FEATURES RESULT: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
