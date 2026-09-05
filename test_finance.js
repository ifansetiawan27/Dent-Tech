'use strict';
const BASE = 'http://localhost:3000';
let passed = 0, failed = 0;
function ok(msg) { passed++; console.log('  [PASS]', msg); }
function bad(msg) { failed++; console.log('  [FAIL]', msg); }

async function req(method, path, token, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

async function login(email, password) {
  const r = await req('POST', '/api/auth/login', null, { email, password });
  return r.data && r.data.token;
}

(async () => {
  console.log('=== FINANCE MODULE ===');
  const admin = await login('support@denttech.id', 'admin123');
  if (!admin) throw new Error('Admin login failed');

  const summary = await req('GET', '/api/finance/summary', admin);
  if (summary.status === 200 && typeof summary.data.income === 'number' && typeof summary.data.expense === 'number' && typeof summary.data.net === 'number') ok('finance summary returns totals');
  else bad('finance summary failed: ' + JSON.stringify(summary.data));

  const income = await req('GET', '/api/finance/income', admin);
  if (income.status === 200 && Array.isArray(income.data.payments)) ok('income list linked to invoice payments');
  else bad('income list failed: ' + JSON.stringify(income.data));

  const partList = await req('GET', '/api/parts', admin);
  const part = (partList.data.parts || [])[0];
  if (!part) throw new Error('No spare part found');
  const stockBefore = part.stock;
  const costBefore = part.cost || 0;
  const expectedAmount = 2 * 12345;

  const created = await req('POST', '/api/finance/expenses', admin, {
    category: 'SPARE_PART', description: 'Finance test purchase', part_id: part.id,
    qty: 2, unit_cost: 12345, amount: 1, restock: true
  });
  if (created.status === 201 && created.data.amount === expectedAmount) ok('server calculates spare-part expense amount');
  else bad('create expense failed: ' + JSON.stringify(created.data));

  const updatedParts = await req('GET', '/api/parts', admin);
  const updatedPart = updatedParts.data.parts.find((p) => p.id === part.id);
  if (updatedPart && updatedPart.stock === stockBefore + 2 && updatedPart.cost === 12345) ok('spare-part purchase updates stock and cost');
  else bad('stock/cost not updated');

  const expenses = await req('GET', '/api/finance/expenses', admin);
  const row = (expenses.data.expenses || []).find((e) => e.id === created.data.id);
  if (row && row.amount === expectedAmount && row.part_id === part.id) ok('expense detail is linked to spare part');
  else bad('expense detail missing');

  const deleted = await req('DELETE', '/api/finance/expenses/' + created.data.id, admin);
  if (deleted.status === 200 && deleted.data.ok) ok('expense deletion succeeds');
  else bad('expense deletion failed');

  await req('PUT', '/api/parts/' + part.id, admin, { cost: costBefore });
  const restoredParts = await req('GET', '/api/parts', admin);
  const restored = restoredParts.data.parts.find((p) => p.id === part.id);
  if (restored && restored.stock === stockBefore && restored.cost === costBefore) ok('expense deletion rolls stock back');
  else bad('stock rollback failed');

  const adjusted = await req('POST', '/api/parts/' + part.id + '/adjust', admin, {
    delta: 3, reason: 'Finance restock test', record_expense: true,
    unit_cost: 20000, expense_date: new Date().toISOString().slice(0, 10)
  });
  const adjustedExpenses = await req('GET', '/api/finance/expenses', admin);
  const adjustedExpense = (adjustedExpenses.data.expenses || []).find((e) => e.id === adjusted.data.expense_id);
  if (adjusted.status === 200 && adjusted.data.stock === stockBefore + 3 && adjustedExpense && adjustedExpense.amount === 60000) ok('inventory stock-in creates Finance expense');
  else bad('inventory-to-Finance integration failed');
  if (adjustedExpense) await req('DELETE', '/api/finance/expenses/' + adjustedExpense.id, admin);
  await req('PUT', '/api/parts/' + part.id, admin, { cost: costBefore });

  const customer = await login('hendra@denttech.id', 'customer123');
  const forbidden = await req('GET', '/api/finance/summary', customer);
  if (forbidden.status === 403) ok('non-admin cannot access Finance');
  else bad('Finance RBAC failed: ' + forbidden.status);

  console.log(`\nFINANCE RESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
