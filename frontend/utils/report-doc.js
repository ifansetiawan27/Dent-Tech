import { printHtml, DOC_BASE_CSS } from './print-doc.js';
import { fmtIDR, fmtDateTime, esc } from './format.js';

export function buildReportHtml(an, company, periodLabel) {
  const s = an.summary || {};
  const card = (label, value) => `<div class="kpi"><div class="kpi-v">${value}</div><div class="kpi-l">${label}</div></div>`;

  const simpleTable = (rows, valKey = 'count') => rows && rows.length
    ? `<table class="grid"><tbody>${rows.map((r) => `<tr><td>${esc(r.label)}</td><td class="right">${r[valKey]}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">Tidak ada data.</p>';

  const techRows = (an.technician_performance || []).map((t) =>
    `<tr><td>${esc(t.name)}</td><td class="center">${t.total_wo}</td><td class="center">${t.completed}</td></tr>`).join('');

  const partRows = (an.top_parts || []).map((p) =>
    `<tr><td>${esc(p.name)}</td><td class="center">${p.qty} ${esc(p.unit)}</td><td class="right">${fmtIDR(p.value)}</td></tr>`).join('');

  const custRows = (an.top_customers || []).map((c) =>
    `<tr><td>${esc(c.name)}</td><td class="right">${c.tickets}</td></tr>`).join('');

  return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><title>Laporan Rekapan Service</title>
<style>
${DOC_BASE_CSS}
.kpis { display: flex; gap: 12px; margin: 16px 0; flex-wrap: wrap; }
.kpi { flex: 1; min-width: 130px; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; text-align: center; }
.kpi-v { font-size: 20px; font-weight: 700; color: #1e293b; }
.kpi-l { font-size: 11px; color: #64748b; margin-top: 4px; }
.two-col { display: flex; gap: 20px; }
.two-col > div { flex: 1; }
</style></head><body>
  <div class="head">
    <div class="brand"><img class="logo" src="/assets/logo.png?v=2" alt="Logo">
      <div><div class="co">${esc(company?.company_name || 'Dent Tech.id')}</div>
      <div class="co-sub">${esc(company?.company_address || '')}</div>
      <div class="co-sub">${esc(company?.company_phone || '')}</div></div>
    </div>
    <div class="doc-title">
      <div class="lbl">Laporan Rekapan Service</div>
      <div class="num" style="font-size:15px">${esc(periodLabel)}</div>
      <div class="muted">Dicetak ${fmtDateTime(new Date().toISOString())}</div>
    </div>
  </div>

  <div class="kpis">
    ${card('Total Ticket', s.total_tickets ?? 0)}
    ${card('Selesai', s.completed_tickets ?? 0)}
    ${card('Berjalan / Open', s.open_tickets ?? 0)}
    ${card('Pendapatan', fmtIDR(s.total_revenue ?? 0))}
    ${card('Belum Dibayar', fmtIDR(s.outstanding ?? 0))}
  </div>

  <div class="two-col">
    <div>
      <div class="section-title">Ticket per Jenis Service</div>
      ${simpleTable(an.by_service_type)}
    </div>
    <div>
      <div class="section-title">Ticket per Prioritas</div>
      ${simpleTable(an.by_priority)}
    </div>
  </div>

  <div class="section-title">Ticket per Jenis Equipment</div>
  ${simpleTable(an.by_equipment_type)}

  <div class="section-title">Performa Teknisi</div>
  ${an.technician_performance?.length ? `<table class="grid"><thead><tr><th>Teknisi</th><th class="center">Total WO</th><th class="center">Selesai</th></tr></thead><tbody>${techRows}</tbody></table>` : '<p class="muted">Tidak ada data.</p>'}

  <div class="two-col" style="margin-top:14px">
    <div>
      <div class="section-title">Spare Part Terbanyak</div>
      ${an.top_parts?.length ? `<table class="grid"><thead><tr><th>Part</th><th class="center">Qty</th><th class="right">Nilai</th></tr></thead><tbody>${partRows}</tbody></table>` : '<p class="muted">Tidak ada data.</p>'}
    </div>
    <div>
      <div class="section-title">Customer Terbanyak</div>
      ${an.top_customers?.length ? `<table class="grid"><thead><tr><th>Customer</th><th class="right">Ticket</th></tr></thead><tbody>${custRows}</tbody></table>` : '<p class="muted">Tidak ada data.</p>'}
    </div>
  </div>

  <div class="foot">Laporan ini dibuat otomatis oleh Service Management System ${esc(company?.company_name || 'Dent Tech.id')}.</div>
</body></html>`;
}

export function downloadReport(an, company, periodLabel) {
  printHtml(buildReportHtml(an, company, periodLabel));
}
