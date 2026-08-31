'use strict';
const { chromium } = require('playwright-core');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const QR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
let passed = 0;
let failed = 0;
function ok(message) { passed++; console.log('  [PASS] ' + message); }
function bad(message) { failed++; console.error('  [FAIL] ' + message); }
async function check(condition, message) { condition ? ok(message) : bad(message); }

const user = { id: 'user-1', customer_id: 'customer-1', role: 'customer', name: 'UI Customer', email: 'ui@example.test' };
const admin = { id: 'admin-1', role: 'admin', name: 'UI Admin', email: 'admin-ui@example.test' };
const invoice = {
  invoice: { id: 'inv-1', number: 'INV-UI-001', type: 'INVOICE', status: 'SENT', version: 1, issued_at: '2026-08-31T10:00:00Z', due_at: '2026-09-07' },
  totals: { items_total: 250000, discount: 0, tax_rate: 0, tax: 0, total: 250000 },
  items: [{ id: 'item-1', item_type: 'LABOR', description: 'Servis unit', qty: 1, unit: 'unit', unit_price: 250000 }],
  customer: { name: 'UI Customer' }, payments: [], ticket: null, work_order: null, evidence: { photos: [] },
  payment_account: { bank_name: 'Bank Jago', bank_account_name: 'Dent Tech', bank_account_number: '1234567890' },
  payment_options: { bank: { bank_name: 'Bank Jago', bank_account_name: 'Dent Tech', bank_account_number: '1234567890' }, pakasir_qris: null }
};
const order = { id: 'order-1', order_id: 'INV-order-1', status: 'PENDING', amount: 250000, gateway_fee: 1750, total_payment: 251750, expired_at: '2026-09-01T10:00:00Z', qr_data_url: QR };

async function installMocks(page, mockUser = user) {
  await page.addInitScript((u) => {
    localStorage.setItem('sms_token', 'mock-token');
    localStorage.setItem('sms_user', JSON.stringify(u));
  }, mockUser);
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    let status = 200;
    let body;
    if (path === '/api/auth/me') body = { user: mockUser, settings: {}, unread_notifications: 0 };
    else if (path === '/api/notifications') body = { notifications: [] };
    else if (path === '/api/dashboard') body = { stats: { active_tickets: 0, equipment: 0, unpaid_invoices: 1 }, wallet: { balance: 0 }, recent_tickets: [], active_ticket: null };
    else if (path === '/api/customers/customer-1') body = { customer: { address: 'Jl. Uji', city: 'Jakarta' } };
    else if (path === '/api/wallet') body = { wallet: { id: 'wallet-1', balance: 0 } };
    else if (path === '/api/wallet/history') body = { wallet: { id: 'wallet-1', balance: 0 }, transactions: [] };
    else if (path === '/api/wallet/topups' && req.method() === 'POST') { status = 201; body = { order: { ...order, id: 'topup-1', order_id: 'WT-topup-1', amount: 100000, total_payment: 101000, gateway_fee: 1000 } }; }
    else if (path === '/api/wallet/topups/topup-1') body = { order: { ...order, id: 'topup-1', order_id: 'WT-topup-1', amount: 100000, total_payment: 101000, gateway_fee: 1000 }, wallet: { balance: 0 } };
    else if (path === '/api/invoices/inv-1' && req.method() === 'GET') body = invoice;
    else if (path === '/api/invoices/inv-1/payment-orders' && req.method() === 'POST') { status = 201; body = { order }; }
    else if (path === '/api/invoices/inv-1/payment-orders/order-1') body = { order };
    else if (path === '/api/parts') body = { parts: [] };
    else if (path === '/api/finance/summary') body = {
      income: 350000, total_cash_inflow: 450000, wallet_topups: 200000, wallet_liability: 125000,
      onsite_fee_revenue: 100000, invoice_payments: 250000, expense: 50000, net: 300000,
      income_count: 2, expense_count: 1, by_category: [],
      monthly: [{ month: '2026-08', income: 350000, cash_inflow: 450000, expense: 50000 }]
    };
    else if (path === '/api/finance/income') body = {
      payments: [], total: 350000, total_cash_inflow: 450000,
      rows: [
        { id: 'payment-1', type: 'INVOICE_PAYMENT', amount: 250000, paid_at: '2026-08-31T10:00:00Z', invoice_number: 'INV-UI-001', customer_name: 'UI Customer', method: 'QRIS', cash_flow: true, revenue: true },
        { id: 'topup-1', type: 'WALLET_TOPUP_CASH', amount: 200000, paid_at: '2026-08-30T10:00:00Z', description: 'Top-up wallet', customer_name: 'UI Customer', cash_flow: true, revenue: false },
        { id: 'onsite-1', type: 'ONSITE_FEE_REVENUE', amount: 100000, paid_at: '2026-08-29T10:00:00Z', description: 'Biaya inspeksi onsite', customer_name: 'UI Customer', cash_flow: false, revenue: true }
      ]
    };
    else if (path === '/api/finance/expenses') body = { expenses: [], total: 50000 };
    else body = {};
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

(async () => {
  console.log('=== WALLET + PAKASIR FRONTEND UI ===');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await installMocks(page);

  await page.goto(BASE + '/customer/', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-wallet-card]');
  await check(await page.locator('#content > :first-child').getAttribute('data-wallet-card') !== null, 'wallet is the first customer home content card');
  await check((await page.locator('[data-wallet-card]').innerText()).includes('Rp 100.000'), 'home wallet explains fixed onsite fee');

  await page.goto(BASE + '/customer/request.html', { waitUntil: 'networkidle' });
  await check(await page.locator('#rq-submit').isDisabled(), 'request submit is blocked when wallet balance is insufficient');
  await check((await page.locator('#wallet-gate').innerText()).includes('Biaya kunjungan onsite Rp 100.000'), 'request clearly explains direct onsite fee');
  await check(await page.locator('#wallet-gate a[href="/customer/wallet.html#topup"]').count() === 1, 'request links to wallet top up');

  await page.goto(BASE + '/customer/wallet.html', { waitUntil: 'networkidle' });
  await page.click('#create-topup');
  await page.waitForSelector('#topup-order img');
  const walletText = await page.locator('#topup-order').innerText();
  await check(walletText.includes('WT-topup-1') && walletText.includes('Rp 101.000') && walletText.includes('Rp 1.000'), 'wallet displays order ID, exact total, and fee');
  await check(walletText.includes('diverifikasi otomatis'), 'wallet warns QRIS verification is automatic');

  await page.goto(BASE + '/customer/invoice-detail.html?id=inv-1', { waitUntil: 'networkidle' });
  await check(await page.locator('text=Transfer Bank').count() > 0 && (await page.locator('body').innerText()).includes('Bank Jago'), 'invoice displays configured Bank Jago transfer information');
  await page.click('#btn-pay');
  await page.waitForSelector('#payment-order img');
  const invoiceText = await page.locator('#payment-order').innerText();
  await check(invoiceText.includes('INV-order-1') && invoiceText.includes('Rp 251.750') && invoiceText.includes('Rp 1.750'), 'invoice QRIS displays order, total, and fee');
  await check(await page.locator('select#cp-method, input#cp-ref').count() === 0, 'manual customer payment confirmation flow is removed');
  const payCalls = [];
  page.on('request', (request) => { if (request.url().includes('/pay')) payCalls.push(request.url()); });
  await page.waitForTimeout(100);
  await check(payCalls.length === 0, 'customer UI never calls insecure /pay endpoint');

  const adminPage = await context.newPage();
  await installMocks(adminPage, admin);
  await adminPage.goto(BASE + '/admin/finance.html', { waitUntil: 'networkidle' });
  await adminPage.waitForSelector('#income-list table');
  const summaryText = await adminPage.locator('#summary').textContent();
  for (const label of ['Pendapatan Diakui', 'Total Kas Masuk', 'Top-up Wallet', 'Liabilitas Wallet', 'Pendapatan Fee Onsite', 'Pembayaran Invoice', 'Pengeluaran', 'Laba / Rugi Bersih']) {
    await check(summaryText.includes(label), 'finance summary displays ' + label);
  }
  const incomeText = await adminPage.locator('#income-list').innerText();
  await check(incomeText.includes('Pembayaran Invoice') && incomeText.includes('Top-up Wallet') && incomeText.includes('Fee Inspeksi Onsite'), 'finance renders all typed data.rows even when payments is empty');
  await check(incomeText.includes('Kas masuk') && incomeText.includes('Pendapatan'), 'finance rows distinguish cash flow from recognized revenue');
  const trendText = await adminPage.locator('#trend').innerText();
  await check(trendText.includes('Pendapatan Diakui') && trendText.includes('Kas Masuk') && trendText.includes('Pengeluaran'), 'monthly trend displays recognized revenue, cash inflow, and expense');

  await browser.close();
  console.log(`\nWALLET UI RESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error('FATAL', error); process.exit(2); });
