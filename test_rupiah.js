'use strict';
const { chromium } = require('playwright-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://localhost:3000';
let passed = 0, failed = 0;
function ok(m) { passed++; console.log('  [PASS]', m); }
function bad(m) { failed++; console.log('  [FAIL]', m); }

async function login(page) {
  await page.goto(BASE + '/login.html', { waitUntil: 'networkidle' });
  await page.fill('#email', 'admin@denttech.id');
  await page.fill('#password', 'admin123');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.click('#login-btn')]);
}
async function assertFormatted(page, selector, label) {
  await page.fill(selector, '1250000');
  await page.waitForTimeout(80);
  const value = await page.inputValue(selector);
  if (value === '1.250.000') ok(label); else bad(`${label}: ${value}`);
}

(async () => {
  console.log('=== RUPIAH INPUT FORMAT ===');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);

  await page.goto(BASE + '/admin/inventory.html', { waitUntil: 'networkidle' });
  await page.click('#btn-new');
  await assertFormatted(page, '#p-price', 'Harga jual spare part otomatis memakai titik');
  await assertFormatted(page, '#p-cost', 'Harga beli spare part otomatis memakai titik');
  await page.click('[data-modal-close]');

  await page.click('[data-adjust]');
  await page.fill('#adj-delta', '2');
  await assertFormatted(page, '#adj-unit-cost', 'Harga beli restock otomatis memakai titik');
  const total = await page.locator('#adj-total').innerText();
  if (total.includes('Rp 2.500.000')) ok('Total pembelian restock dihitung dan diformat'); else bad('Total restock: ' + total);
  await page.click('[data-modal-close]');

  await page.goto(BASE + '/admin/finance.html', { waitUntil: 'networkidle' });
  await page.click('#btn-expense');
  await page.selectOption('#e-part', { index: 1 });
  await page.fill('#e-qty', '2');
  await assertFormatted(page, '#e-unit', 'Harga beli Finance otomatis memakai titik');
  const amount = await page.inputValue('#e-amount');
  if (amount === '2.500.000') ok('Jumlah Finance otomatis memakai titik'); else bad('Jumlah Finance: ' + amount);
  await page.selectOption('#e-category', 'OTHER');
  await assertFormatted(page, '#e-amount', 'Input pengeluaran manual otomatis memakai titik');
  await page.click('[data-modal-close]');

  await page.goto(BASE + '/admin/invoices.html', { waitUntil: 'networkidle' });
  await page.click('#btn-settings');
  await assertFormatted(page, '#set-labor', 'Biaya jasa default otomatis memakai titik');
  await page.click('[data-modal-close]');

  if (errors.length) bad('Page errors: ' + errors.join(' | '));
  console.log(`\nRUPIAH RESULT: ${passed} passed, ${failed} failed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
