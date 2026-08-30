import { printHtml, DOC_BASE_CSS } from './print-doc.js';
import { fmtDate, fmtDateTime, esc } from './format.js';

const RESULT_LABEL = { PASS: 'PASS', FAIL: 'FAIL', NA: 'N/A' };

export function buildChecklistHtml(data) {
  const { checklist, work_order, ticket, customer, technician, company, diagnosis } = data;
  const rows = (checklist?.sections || []).map((sec) => {
    const items = sec.items.map((it) => {
      const badge = it.result
        ? `<span class="badge ${it.result}">${RESULT_LABEL[it.result] || esc(it.result)}</span>`
        : `<span class="badge EMPTY">—</span>`;
      return `<tr>
        <td style="width:55%">${esc(it.label)}${it.required ? ' <span class="muted">*</span>' : ''}</td>
        <td class="center" style="width:15%">${badge}</td>
        <td class="muted">${esc(it.note || '')}</td>
      </tr>`;
    }).join('');
    return `<div class="section-title">${esc(sec.section)}</div>
      <table class="grid"><thead><tr><th>Item Pemeriksaan</th><th class="center">Hasil</th><th>Catatan</th></tr></thead>
      <tbody>${items}</tbody></table>`;
  }).join('');

  return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><title>Checklist ${esc(work_order?.number || '')}</title>
<style>${DOC_BASE_CSS}</style></head><body>
  <div class="head">
    <div class="brand"><img class="logo" src="/assets/logo.png?v=2" alt="Logo">
      <div><div class="co">${esc(company?.company_name || 'Dent Tech')}</div>
      <div class="co-sub">${esc(company?.company_address || '')}</div>
      <div class="co-sub">${esc(company?.company_phone || '')}</div></div>
    </div>
    <div class="doc-title">
      <div class="lbl">Form Checklist Service</div>
      <div class="num">${esc(work_order?.number || '-')}</div>
      <div class="muted">${esc(checklist?.template?.name || '')} v${esc(checklist?.template?.version || '')}</div>
    </div>
  </div>

  <div class="meta">
    <div class="col"><h4>Customer</h4>
      <div><b>${esc(customer?.name || '-')}</b></div>
      <div class="muted">${esc([customer?.address, customer?.city].filter(Boolean).join(', '))}</div>
    </div>
    <div class="col"><h4>Ticket / Jadwal</h4>
      <div>${esc(ticket?.number || '-')}</div>
      <div class="muted">${work_order?.scheduled_date ? fmtDate(work_order.scheduled_date) : '-'}</div>
    </div>
    <div class="col"><h4>Teknisi</h4>
      <div>${esc(technician?.name || '-')}</div>
      <div class="muted">${esc(ticket?.problem || '')}</div>
    </div>
  </div>

  ${rows || '<p class="muted">Tidak ada checklist pada work order ini.</p>'}

  ${diagnosis ? `
    <div class="section-title">Diagnosis Teknisi</div>
    <table class="grid"><tbody>
      <tr><td style="width:25%" class="muted">Temuan</td><td>${esc(diagnosis.findings || '-')}</td></tr>
      ${diagnosis.root_cause ? `<tr><td class="muted">Akar Masalah</td><td>${esc(diagnosis.root_cause)}</td></tr>` : ''}
      ${diagnosis.recommendation ? `<tr><td class="muted">Rekomendasi</td><td>${esc(diagnosis.recommendation)}</td></tr>` : ''}
    </tbody></table>` : ''}

  <div class="meta" style="margin-top:26px">
    <div class="col"><h4>Progres</h4>
      <div>${checklist ? `${checklist.answered_items}/${checklist.total_items} item terisi` : '-'}</div>
      <div class="muted">${checklist?.complete ? 'Checklist lengkap' : 'Checklist belum lengkap'}</div>
    </div>
    <div class="col"><h4>Dicetak</h4><div>${fmtDateTime(new Date().toISOString())}</div></div>
  </div>

  <div class="foot">Dokumen ini dibuat otomatis oleh Service Management System ${esc(company?.company_name || 'Dent Tech')}.</div>
</body></html>`;
}

export function downloadChecklist(data) {
  printHtml(buildChecklistHtml(data));
}
