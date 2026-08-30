'use strict';
const { db } = require('../db');
const { uid, now, sendJSON, localDate } = require('../util');
const { audit } = require('./_common');

const CATEGORIES = ['SPARE_PART', 'OPERATIONAL', 'OTHER'];

// Kondisi filter rentang tanggal untuk kolom bertipe text ISO (dibandingkan 10 char pertama = YYYY-MM-DD)
function dateCond(col, from, to) {
  const where = [];
  const params = [];
  if (from) { where.push(`LEFT(${col},10) >= ?`); params.push(from); }
  if (to) { where.push(`LEFT(${col},10) <= ?`); params.push(to); }
  return { where: where.length ? ' AND ' + where.join(' AND ') : '', params };
}

async function financeSummaryHandler(ctx) {
  const { from, to } = ctx.query;
  const inc = dateCond('p.paid_at', from, to);
  const exp = dateCond('e.expense_date', from, to);

  const incomeAgg = await db.prepare(`SELECT COALESCE(SUM(p.amount),0)::float8 AS total, COUNT(*) AS cnt FROM payments p WHERE 1=1 ${inc.where}`).get(...inc.params);
  const expenseAgg = await db.prepare(`SELECT COALESCE(SUM(e.amount),0)::float8 AS total, COUNT(*) AS cnt FROM expenses e WHERE 1=1 ${exp.where}`).get(...exp.params);

  const byCategory = await db.prepare(`SELECT e.category, COALESCE(SUM(e.amount),0)::float8 AS total, COUNT(*) AS cnt FROM expenses e WHERE 1=1 ${exp.where} GROUP BY e.category ORDER BY total DESC`).all(...exp.params);

  const incMonthly = await db.prepare(`SELECT LEFT(p.paid_at,7) AS month, COALESCE(SUM(p.amount),0)::float8 AS income FROM payments p WHERE 1=1 ${inc.where} GROUP BY LEFT(p.paid_at,7)`).all(...inc.params);
  const expMonthly = await db.prepare(`SELECT LEFT(e.expense_date,7) AS month, COALESCE(SUM(e.amount),0)::float8 AS expense FROM expenses e WHERE 1=1 ${exp.where} GROUP BY LEFT(e.expense_date,7)`).all(...exp.params);
  const monthMap = new Map();
  for (const r of incMonthly) monthMap.set(r.month, { month: r.month, income: r.income, expense: 0 });
  for (const r of expMonthly) {
    const m = monthMap.get(r.month) || { month: r.month, income: 0, expense: 0 };
    m.expense = r.expense;
    monthMap.set(r.month, m);
  }
  const monthly = [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month));

  const income = Math.round(incomeAgg.total);
  const expense = Math.round(expenseAgg.total);
  sendJSON(ctx.res, 200, {
    income,
    expense,
    net: income - expense,
    income_count: incomeAgg.cnt,
    expense_count: expenseAgg.cnt,
    by_category: byCategory,
    monthly
  });
}

async function financeIncomeHandler(ctx) {
  const { from, to } = ctx.query;
  const inc = dateCond('p.paid_at', from, to);
  const payments = await db.prepare(`
    SELECT p.id, p.amount, p.method, p.reference, p.paid_at,
           i.id AS invoice_id, i.number AS invoice_number,
           c.id AS customer_id, c.name AS customer_name, c.code AS customer_code
    FROM payments p
    JOIN invoices i ON i.id = p.invoice_id
    LEFT JOIN customers c ON c.id = i.customer_id
    WHERE 1=1 ${inc.where}
    ORDER BY p.paid_at DESC
  `).all(...inc.params);
  const total = payments.reduce((s, r) => s + r.amount, 0);
  sendJSON(ctx.res, 200, { payments, total });
}

async function listExpensesHandler(ctx) {
  const { from, to, category } = ctx.query;
  const cond = dateCond('e.expense_date', from, to);
  let where = cond.where;
  const params = [...cond.params];
  if (category) { where += ' AND e.category = ?'; params.push(category); }
  const expenses = await db.prepare(`
    SELECT e.*, pt.name AS part_name, pt.code AS part_code, pt.unit AS part_unit
    FROM expenses e
    LEFT JOIN parts pt ON pt.id = e.part_id
    WHERE 1=1 ${where}
    ORDER BY e.expense_date DESC, e.created_at DESC
  `).all(...params);
  const total = expenses.reduce((s, r) => s + r.amount, 0);
  sendJSON(ctx.res, 200, { expenses, total });
}

async function createExpenseHandler(ctx) {
  const { category = 'SPARE_PART', description = '', part_id = null, qty = 0, unit_cost = 0, amount, restock = false, expense_date } = ctx.body;
  if (!CATEGORIES.includes(category)) return sendJSON(ctx.res, 400, { error: 'Kategori tidak valid' });
  const date = expense_date || localDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return sendJSON(ctx.res, 400, { error: 'Tanggal pengeluaran tidak valid' });

  let partId = null;
  let quantity = 0;
  let unitCost = 0;
  let amt = Number(amount);
  const shouldRestock = category === 'SPARE_PART' && !!restock;

  if (category === 'SPARE_PART') {
    if (!part_id) return sendJSON(ctx.res, 400, { error: 'Pilih spare part terlebih dahulu' });
    const part = await db.prepare('SELECT * FROM parts WHERE id = ?').get(part_id);
    if (!part) return sendJSON(ctx.res, 404, { error: 'Spare part tidak ditemukan' });
    partId = part.id;
    quantity = Number(qty) || 0;
    unitCost = Number(unit_cost) || Number(part.cost) || 0;
    if (quantity <= 0) return sendJSON(ctx.res, 400, { error: 'Qty spare part harus lebih dari 0' });
    if (unitCost <= 0) return sendJSON(ctx.res, 400, { error: 'Harga beli spare part harus lebih dari 0' });
    // Nilai pembelian sparepart dihitung server agar tidak dapat dimanipulasi dari client.
    amt = Math.round(quantity * unitCost * 100) / 100;
  }

  if (!amt || amt <= 0) return sendJSON(ctx.res, 400, { error: 'Jumlah pengeluaran harus lebih dari 0' });

  const id = uid();
  await db.transaction(async (tx) => {
    if (shouldRestock) {
      await tx.prepare('UPDATE parts SET stock = stock + ?, cost = ? WHERE id = ?').run(quantity, unitCost, partId);
    }
    await tx.prepare('INSERT INTO expenses (id, category, description, part_id, qty, unit_cost, amount, restocked, expense_date, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, category, description, partId, quantity, unitCost, amt, shouldRestock ? 1 : 0, date, ctx.user.id, now());
  });
  audit(ctx.user, 'CREATE', 'expense', id, `Pengeluaran ${category} Rp ${amt.toLocaleString('id-ID')}`, ctx.ip);
  sendJSON(ctx.res, 201, { id, amount: amt });
}

async function deleteExpenseHandler(ctx) {
  const e = await db.prepare('SELECT * FROM expenses WHERE id = ?').get(ctx.params.id);
  if (!e) return sendJSON(ctx.res, 404, { error: 'Pengeluaran tidak ditemukan' });
  if (e.restocked && e.part_id && e.qty > 0) {
    const part = await db.prepare('SELECT stock FROM parts WHERE id = ?').get(e.part_id);
    if (!part) return sendJSON(ctx.res, 409, { error: 'Spare part terkait tidak ditemukan' });
    if (part.stock < e.qty) return sendJSON(ctx.res, 409, { error: 'Pengeluaran tidak dapat dihapus karena stok part sudah terpakai' });
  }
  await db.transaction(async (tx) => {
    if (e.restocked && e.part_id && e.qty > 0) {
      await tx.prepare('UPDATE parts SET stock = stock - ? WHERE id = ?').run(e.qty, e.part_id);
    }
    await tx.prepare('DELETE FROM expenses WHERE id = ?').run(e.id);
  });
  audit(ctx.user, 'DELETE', 'expense', e.id, `Hapus pengeluaran Rp ${Number(e.amount).toLocaleString('id-ID')}`, ctx.ip);
  sendJSON(ctx.res, 200, { ok: true });
}

module.exports = { financeSummaryHandler, financeIncomeHandler, listExpensesHandler, createExpenseHandler, deleteExpenseHandler };
