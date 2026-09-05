import { printHtml, DOC_BASE_CSS } from './print-doc.js';
import { fmtIDR, fmtDate, fmtDateTime, esc } from './format.js';

const TYPE_LABEL = {
  INVOICE_PAYMENT: 'Pembayaran Invoice',
  WALLET_TOPUP_CASH: 'Top-up Wallet',
  ONSITE_FEE_REVENUE: 'Fee Inspeksi Onsite'
};
const CATEGORY_LABEL = { SPARE_PART: 'Spare Part', OPERATIONAL: 'Operasional', OTHER: 'Lainnya' };

export function financePeriodLabel(period = {}) {
  if (period.from && period.to) return `${fmtDate(period.from)} – ${fmtDate(period.to)}`;
  if (period.from) return `Mulai ${fmtDate(period.from)}`;
  if (period.to) return `Sampai ${fmtDate(period.to)}`;
  return 'Semua Periode';
}

function moneyCell(value) { return `<td class="money">${fmtIDR(Number(value || 0))}</td>`; }
function emptyRow(columns, message) { return `<tr><td colspan="${columns}" class="empty">${esc(message)}</td></tr>`; }

export function buildFinanceHtml(data, company = {}, period = {}) {
  const summary = data?.summary || {};
  const incomeRows = data?.income?.rows || [];
  const expenses = data?.expenses?.expenses || [];
  const monthly = summary.monthly || [];
  const categories = summary.by_category || [];
  const generatedAt = new Date().toISOString();
  return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><title>Laporan Keuangan — ${esc(financePeriodLabel(period))}</title>
  <style>${DOC_BASE_CSS}
    @page { size: A4 landscape; margin: 10mm; }
    body { padding: 0; font-size: 10px; }
    .period { color:#475569; margin-top:4px; }
    .kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin:16px 0; }
    .kpi { border:1px solid #e2e8f0; border-radius:8px; padding:9px; break-inside:avoid; }
    .kpi span { display:block; color:#64748b; font-size:9px; text-transform:uppercase; }
    .kpi b { display:block; color:#0f172a; font-size:14px; margin-top:3px; }
    .note { border:1px solid #bae6fd; background:#f0f9ff; color:#0c4a6e; border-radius:8px; padding:8px 10px; margin:10px 0 16px; }
    table.grid { margin-bottom:14px; font-size:8px; }
    table.grid thead { display:table-header-group; }
    table.grid th, table.grid td { padding:5px 6px; vertical-align:top; }
    tr { break-inside:avoid; }
    .money { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
    .nowrap { white-space:nowrap; }
    .empty { text-align:center; color:#94a3b8; padding:12px !important; }
    .page-break { page-break-before:always; }
  </style></head><body>
    <div class="head"><div class="brand"><img class="logo" src="/assets/logo.png?v=2" alt="Logo"><div><div class="co">${esc(company.company_name || 'Dent Tech.id')}</div><div class="co-sub">${esc(company.company_address || '')}</div><div class="co-sub">${esc(company.company_phone || '')}${company.company_email ? ` · ${esc(company.company_email)}` : ''}</div></div></div><div class="doc-title"><div class="lbl">Laporan Keuangan Rinci</div><div class="period">${esc(financePeriodLabel(period))}</div><div class="co-sub">Dibuat ${fmtDateTime(generatedAt)}</div></div></div>
    <div class="kpis">
      <div class="kpi"><span>Pendapatan Diakui</span><b>${fmtIDR(summary.income)}</b></div>
      <div class="kpi"><span>Total Kas Masuk</span><b>${fmtIDR(summary.total_cash_inflow)}</b></div>
      <div class="kpi"><span>Pembayaran Invoice</span><b>${fmtIDR(summary.invoice_payments)}</b></div>
      <div class="kpi"><span>Top-up Wallet</span><b>${fmtIDR(summary.wallet_topups)}</b></div>
      <div class="kpi"><span>Fee Onsite</span><b>${fmtIDR(summary.onsite_fee_revenue)}</b></div>
      <div class="kpi"><span>Pengeluaran</span><b>${fmtIDR(summary.expense)}</b></div>
      <div class="kpi"><span>Laba / Rugi Bersih</span><b>${fmtIDR(summary.net)}</b></div>
      <div class="kpi"><span>Liabilitas Wallet Saat Ini</span><b>${fmtIDR(summary.wallet_liability)}</b></div>
    </div>
    <div class="note">Top-up wallet dicatat sebagai kas masuk dan liabilitas, bukan pendapatan. Fee onsite adalah pendapatan dari pemakaian saldo wallet. Liabilitas wallet merupakan saldo saat laporan dibuat dan tidak mengikuti filter periode.</div>
    <div class="section-title">Rincian Bulanan</div>
    <table class="grid"><thead><tr><th>Bulan</th><th class="money">Invoice</th><th class="money">Top-up</th><th class="money">Fee Onsite</th><th class="money">Pendapatan</th><th class="money">Kas Masuk</th><th class="money">Pengeluaran</th><th class="money">Laba/Rugi</th></tr></thead><tbody>${monthly.length ? monthly.map((row) => `<tr><td class="nowrap">${esc(row.month)}</td>${moneyCell(row.invoice_payments)}${moneyCell(row.wallet_topups)}${moneyCell(row.onsite_fee_revenue)}${moneyCell(row.income)}${moneyCell(row.cash_inflow)}${moneyCell(row.expense)}${moneyCell(Number(row.income || 0) - Number(row.expense || 0))}</tr>`).join('') : emptyRow(8, 'Tidak ada data bulanan')}</tbody></table>
    <div class="section-title">Pengeluaran per Kategori</div>
    <table class="grid"><thead><tr><th>Kategori</th><th class="money">Jumlah Transaksi</th><th class="money">Total</th></tr></thead><tbody>${categories.length ? categories.map((row) => `<tr><td>${esc(CATEGORY_LABEL[row.category] || row.category)}</td><td class="money">${Number(row.cnt || 0)}</td>${moneyCell(row.total)}</tr>`).join('') : emptyRow(3, 'Tidak ada pengeluaran')}</tbody></table>
    <div class="section-title page-break">Aktivitas Pendapatan dan Kas Masuk</div>
    <table class="grid"><thead><tr><th>Tanggal</th><th>Jenis</th><th>Customer</th><th>Invoice</th><th>Referensi</th><th>Order / Ticket</th><th>Metode</th><th class="money">Kas Masuk</th><th class="money">Pendapatan</th></tr></thead><tbody>${incomeRows.length ? incomeRows.map((row) => `<tr><td class="nowrap">${fmtDateTime(row.paid_at)}</td><td>${esc(TYPE_LABEL[row.type] || row.type)}</td><td>${esc([row.customer_code, row.customer_name].filter(Boolean).join(' — ') || '-')}</td><td>${esc(row.invoice_number || '-')}</td><td>${esc(row.reference || row.description || '-')}</td><td>${esc(row.payment_order_id || row.ticket_id || '-')}</td><td>${esc(row.method || '-')}</td>${moneyCell(row.cash_flow ? row.amount : 0)}${moneyCell(row.revenue ? row.amount : 0)}</tr>`).join('') : emptyRow(9, 'Tidak ada aktivitas pendapatan atau kas masuk')}</tbody></table>
    <div class="section-title page-break">Rincian Pengeluaran</div>
    <table class="grid"><thead><tr><th>Tanggal</th><th>Kategori</th><th>Keterangan</th><th>Kode Part</th><th>Nama Part</th><th class="money">Qty</th><th>Satuan</th><th class="money">Harga Unit</th><th class="money">Jumlah</th><th>Restock</th></tr></thead><tbody>${expenses.length ? expenses.map((row) => `<tr><td class="nowrap">${fmtDate(row.expense_date)}</td><td>${esc(CATEGORY_LABEL[row.category] || row.category)}</td><td>${esc(row.description || '-')}</td><td>${esc(row.part_code || '-')}</td><td>${esc(row.part_name || '-')}</td><td class="money">${Number(row.qty || 0)}</td><td>${esc(row.part_unit || '-')}</td>${moneyCell(row.unit_cost)}${moneyCell(row.amount)}<td>${row.restocked ? 'Ya' : 'Tidak'}</td></tr>`).join('') : emptyRow(10, 'Tidak ada pengeluaran')}</tbody></table>
    <div class="foot">Dokumen ini dibuat otomatis oleh Service Management System ${esc(company.company_name || 'Dent Tech.id')}.</div>
  </body></html>`;
}

export function downloadFinancePdf(data, company, period) { printHtml(buildFinanceHtml(data, company, period)); }

function csvValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  let text = value == null ? '' : String(value);
  if (/^[\t\r\n=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
function csvRow(values) { return values.map(csvValue).join(','); }

export function buildFinanceCsv(data, period = {}) {
  const summary = data?.summary || {};
  const lines = [csvRow(['LAPORAN KEUANGAN RINCI', financePeriodLabel(period)]), ''];
  lines.push(csvRow(['RINGKASAN', 'NILAI']),
    csvRow(['Pendapatan Diakui', Number(summary.income || 0)]),
    csvRow(['Total Kas Masuk', Number(summary.total_cash_inflow || 0)]),
    csvRow(['Pembayaran Invoice', Number(summary.invoice_payments || 0)]),
    csvRow(['Top-up Wallet', Number(summary.wallet_topups || 0)]),
    csvRow(['Fee Onsite', Number(summary.onsite_fee_revenue || 0)]),
    csvRow(['Pengeluaran', Number(summary.expense || 0)]),
    csvRow(['Laba / Rugi Bersih', Number(summary.net || 0)]),
    csvRow(['Liabilitas Wallet Saat Ini', Number(summary.wallet_liability || 0)]), '');
  lines.push(csvRow(['AKTIVITAS PENDAPATAN DAN KAS MASUK']), csvRow(['ID', 'Tanggal', 'Jenis', 'Kode Customer', 'Customer', 'Invoice', 'Referensi', 'Payment Order', 'Ticket', 'Metode', 'Kas Masuk', 'Pendapatan']));
  for (const row of data?.income?.rows || []) lines.push(csvRow([row.id, row.paid_at, TYPE_LABEL[row.type] || row.type, row.customer_code, row.customer_name, row.invoice_number, row.reference || row.description, row.payment_order_id, row.ticket_id, row.method, row.cash_flow ? Number(row.amount || 0) : 0, row.revenue ? Number(row.amount || 0) : 0]));
  lines.push('', csvRow(['RINCIAN PENGELUARAN']), csvRow(['ID', 'Tanggal', 'Dibuat', 'Kategori', 'Keterangan', 'Kode Part', 'Nama Part', 'Qty', 'Satuan', 'Harga Unit', 'Jumlah', 'Restock', 'Dibuat Oleh']));
  for (const row of data?.expenses?.expenses || []) lines.push(csvRow([row.id, row.expense_date, row.created_at, CATEGORY_LABEL[row.category] || row.category, row.description, row.part_code, row.part_name, Number(row.qty || 0), row.part_unit, Number(row.unit_cost || 0), Number(row.amount || 0), row.restocked ? 'Ya' : 'Tidak', row.created_by]));
  return '\uFEFF' + lines.join('\r\n');
}

export function downloadFinanceCsv(data, period = {}) {
  const suffix = [period.from, period.to].filter(Boolean).join('_') || 'semua-periode';
  const blob = new Blob([buildFinanceCsv(data, period)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `finance-rinci-${suffix}.csv`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
