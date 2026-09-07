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
  invoice: { id: 'inv-1', number: 'INV-UI-001', type: 'INVOICE', status: 'SENT', approval_status: 'NOT_REQUIRED', version: 1, issued_at: '2026-08-31T10:00:00Z', due_at: '2026-09-07' },
  totals: { items_total: 250000, discount: 0, tax_rate: 0, tax: 0, total: 250000 },
  items: [{ id: 'item-1', item_type: 'LABOR', description: 'Servis unit', qty: 1, unit: 'unit', unit_price: 250000 }],
  customer: { name: 'UI Customer' }, payments: [], ticket: null, work_order: null,
  evidence: { photos: [], diagnosis: { findings: '<Temuan teknisi>', root_cause: 'Seal aus', recommendation: 'Ganti seal' } },
  payment_account: { bank_name: 'Bank Jago', bank_account_name: 'Dent Tech', bank_account_number: '1234567890' },
  payment_options: { bank: { bank_name: 'Bank Jago', bank_account_name: 'Dent Tech', bank_account_number: '1234567890' }, pakasir_qris: null }
};
const order = { id: 'order-1', order_id: 'INV-order-1', status: 'PENDING', amount: 250000, total_payment: 250000, expired_at: '2026-09-01T10:00:00Z', qr_data_url: QR };

async function installMocks(page, mockUser = user, options = {}) {
  await page.addInitScript((u) => {
    localStorage.setItem('sms_token', 'mock-token');
    localStorage.setItem('sms_user', JSON.stringify(u));
  }, mockUser);
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    let status = 200;
    let body;
    if (path === '/api/auth/me') body = { user: mockUser, settings: { company_name: 'Dent Tech.id', company_address: 'Jakarta', company_phone: '021', company_email: 'support@denttech.id' }, unread_notifications: 0 };
    else if (path === '/api/notifications') body = { notifications: [] };
    else if (path === '/api/dashboard') body = { stats: { active_tickets: 0, equipment: 0, unpaid_invoices: 1 }, wallet: { balance: 0 }, recent_tickets: [], active_ticket: null };
    else if (path === '/api/customers/customer-1') body = { customer: { address: 'Jl. Uji', city: 'Jakarta' } };
    else if (path === '/api/wallet') body = { wallet: { id: 'wallet-1', balance: 0 } };
    else if (path === '/api/wallet/history') body = { wallet: { id: 'wallet-1', balance: 0 }, transactions: [], active_order: options.activeTopup || null };
    else if (path === '/api/wallet/topups' && req.method() === 'POST') { status = 201; body = { order: { ...order, id: 'topup-1', order_id: 'WT-topup-1', amount: 100000, total_payment: 100000 } }; }
    else if (path === '/api/wallet/topups/topup-1') body = { order: { ...order, id: 'topup-1', order_id: 'WT-topup-1', amount: 100000, total_payment: 100000 }, wallet: { balance: 0 } };
    else if (path === '/api/invoices/inv-1' && req.method() === 'GET') body = invoice;
    else if (path === '/api/invoices/inv-1/payment-orders' && req.method() === 'POST') { status = 201; body = { order }; }
    else if (path === '/api/invoices/inv-1/payment-orders/order-1') body = { order };
    else if (path === '/api/parts') body = { parts: [] };
    else if (path === '/api/finance/summary') body = {
      income: 350000, total_cash_inflow: 450000, wallet_topups: 200000, wallet_liability: 125000,
      onsite_fee_revenue: 100000, invoice_payments: 250000, expense: 50000, net: 300000,
      income_count: 2, expense_count: 1, by_category: [{ category: 'SPARE_PART', total: 50000, cnt: 1 }],
      monthly: [{ month: '2026-08', invoice_payments: 250000, wallet_topups: 200000, onsite_fee_revenue: 100000, income: 350000, cash_inflow: 450000, expense: 50000 }]
    };
    else if (path === '/api/finance/income') body = {
      payments: [], total: 350000, total_cash_inflow: 450000,
      rows: [
        { id: 'payment-1', type: 'INVOICE_PAYMENT', amount: 250000, paid_at: '2026-08-31T10:00:00Z', invoice_id: 'inv-1', invoice_number: 'INV-UI-001', customer_id: 'customer-1', customer_code: 'CUS-001', customer_name: 'UI Customer', reference: '\t=unsafe', method: 'QRIS', cash_flow: true, revenue: true },
        { id: 'topup-1', type: 'WALLET_TOPUP_CASH', amount: 200000, paid_at: '2026-08-30T10:00:00Z', description: 'Top-up wallet', customer_name: 'UI Customer', cash_flow: true, revenue: false },
        { id: 'onsite-1', type: 'ONSITE_FEE_REVENUE', amount: 100000, paid_at: '2026-08-29T10:00:00Z', description: 'Biaya inspeksi onsite', customer_name: 'UI Customer', cash_flow: false, revenue: true }
      ]
    };
    else if (path === '/api/finance/expenses') body = { expenses: [{ id: 'expense-1', category: 'SPARE_PART', description: '<Pembelian, seal>', part_id: 'part-1', part_code: 'PRT-001', part_name: 'Seal', part_unit: 'pcs', qty: 2, unit_cost: 25000, amount: 50000, restocked: 1, expense_date: '2026-08-31', created_by: 'admin-1', created_at: '2026-08-31T11:00:00Z' }], total: 50000 };
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
  await check(!(await page.locator('[data-wallet-card]').innerText()).includes('onsite'), 'home wallet no longer requires onsite fee top up');
  await check((await page.locator('body').innerText()).includes('Dent Tech.id'), 'customer portal uses current company branding');

  await page.goto(BASE + '/customer/request.html', { waitUntil: 'networkidle' });
  await check(!(await page.locator('#rq-submit').isDisabled()), 'request submit is allowed without wallet top up');
  await check(await page.locator('#wallet-gate').count() === 0, 'request form no longer shows wallet gate');
  await check((await page.locator('#rq-submit').innerText()).includes('Kirim Request Service'), 'request submit button uses neutral label');

  await page.goto(BASE + '/customer/wallet.html', { waitUntil: 'networkidle' });
  await check(await page.locator('#topup').count() === 0, 'wallet page no longer shows top up section');
  await check(await page.locator('#create-topup').count() === 0, 'wallet page has no top up button');
  await check(await page.locator('#wallet-balance').count() === 1, 'wallet page shows balance card');
  await check(await page.locator('#history').count() === 1, 'wallet page keeps transaction history');

  const restoredPage = await context.newPage();
  const restoredTopup = { ...order, id: 'topup-1', order_id: 'WT-topup-1', amount: 100000, total_payment: 100000 };
  await installMocks(restoredPage, user, { activeTopup: restoredTopup });
  let restoredPolls = 0;
  restoredPage.on('request', (request) => { if (new URL(request.url()).pathname === '/api/wallet/topups/topup-1') restoredPolls++; });
  await restoredPage.goto(BASE + '/customer/wallet.html', { waitUntil: 'networkidle' });
  await restoredPage.waitForSelector('#topup-order img');
  await check((await restoredPage.locator('#topup-order').innerText()).includes('WT-topup-1'), 'wallet restores the active QRIS order after reload');
  await restoredPage.waitForTimeout(4500);
  await check(restoredPolls > 0, 'wallet resumes status polling for the restored QRIS order');
  await restoredPage.close();

  await page.goto(BASE + '/customer/invoice-detail.html?id=inv-1', { waitUntil: 'networkidle' });
  await check(await page.locator('text=Transfer Bank').count() > 0 && (await page.locator('body').innerText()).includes('Bank Jago'), 'invoice displays configured Bank Jago transfer information');
  const invoiceDocument = await page.evaluate(async (invoiceData) => {
    const { buildInvoiceHtml } = await import('/utils/invoice-doc.js');
    return buildInvoiceHtml({ ...invoiceData, company: { company_name: '' } });
  }, invoice);
  await check(invoiceDocument.includes('Dent Tech.id') && !invoiceDocument.includes('Dent Tech Service Management System'), 'invoice document fallback uses current company branding');
  await check(invoiceDocument.includes('Catatan Diagnosis Teknisi') && invoiceDocument.includes('&lt;Temuan teknisi&gt;') && invoiceDocument.includes('Seal aus') && invoiceDocument.includes('Ganti seal') && !invoiceDocument.includes('<Temuan teknisi>'), 'customer invoice PDF includes escaped technician diagnosis');
  await page.click('#btn-pay');
  await page.waitForSelector('#payment-order img');
  const invoiceText = await page.locator('#payment-order').innerText();
  await check(invoiceText.includes('INV-order-1') && invoiceText.includes('Rp 250.000') && !invoiceText.includes('Biaya QRIS') && !invoiceText.includes('Rp 1.750'), 'invoice QRIS displays zero-fee total and hides fee');
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
  await check(!(await adminPage.locator('#btn-finance-pdf').isDisabled()) && !(await adminPage.locator('#btn-finance-csv').isDisabled()), 'finance detailed download buttons enable after complete data load');
  const financeDocument = await adminPage.evaluate(async () => {
    const mod = await import('/utils/finance-doc.js');
    const summary = await fetch('/api/finance/summary').then((response) => response.json());
    const income = await fetch('/api/finance/income').then((response) => response.json());
    const expenses = await fetch('/api/finance/expenses').then((response) => response.json());
    return {
      html: mod.buildFinanceHtml({ summary, income, expenses }, { company_name: 'Dent Tech.id' }, { from: '2026-08-01', to: '2026-08-31' }),
      csv: mod.buildFinanceCsv({ summary, income, expenses }, { from: '2026-08-01', to: '2026-08-31' })
    };
  });
  await check(financeDocument.html.includes('Laporan Keuangan Rinci') && financeDocument.html.includes('Liabilitas Wallet Saat Ini') && financeDocument.html.includes('PRT-001') && financeDocument.html.includes('&lt;Pembelian, seal&gt;'), 'finance PDF includes detailed escaped summary, income, and expense data');
  await check(financeDocument.csv.charCodeAt(0) === 0xFEFF && financeDocument.csv.includes("'\t=unsafe") && financeDocument.csv.includes('PRT-001') && financeDocument.csv.includes(',25000,') && financeDocument.csv.includes(',300000\r\n'), 'finance CSV is Excel-compatible, detailed, formula-safe, and preserves numeric values');

  await browser.close();
  console.log(`\nWALLET UI RESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error('FATAL', error); process.exit(2); });
