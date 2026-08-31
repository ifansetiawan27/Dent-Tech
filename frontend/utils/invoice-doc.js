import { printHtml, DOC_BASE_CSS } from './print-doc.js';
import { fmtIDR, fmtDate, fmtDateTime, esc } from './format.js';

const RESULT_LABEL = { PASS: 'PASS', FAIL: 'FAIL', NA: 'N/A' };

function watermarkHtml(inv) {
  const paid = inv.status === 'PAID';
  const cls = paid ? 'paid' : 'unpaid';
  const text = paid ? 'LUNAS' : 'BELUM LUNAS';
  return `<div class="watermark ${cls}">${text}</div>`;
}

function photosHtml(evidence) {
  const photos = evidence?.photos || [];
  if (!photos.length) return '';
  const kindLabel = { before: 'BEFORE', after: 'AFTER', request: 'REQUEST' };
  const figs = photos.map((p) => {
    const k = ['before', 'after', 'request'].includes(p.kind) ? p.kind : 'request';
    return `<figure>
      <span class="photo-label ${k}">${kindLabel[k] || 'FOTO'}</span>
      <img src="${p.url}" alt="${esc(p.caption || p.kind)}">
      <figcaption>${esc(p.caption || '')}</figcaption>
    </figure>`;
  }).join('');
  return `<div class="section-title">Lampiran Foto Pekerjaan</div><div class="photos">${figs}</div>`;
}

function checklistHtml(evidence) {
  const checklist = evidence?.checklist;
  if (!checklist || !checklist.sections?.length) return '';
  const rows = checklist.sections.map((sec) => {
    const items = sec.items.map((it) => {
      const badge = it.result
        ? `<span class="badge ${it.result}">${RESULT_LABEL[it.result] || esc(it.result)}</span>`
        : `<span class="badge EMPTY">—</span>`;
      return `<tr><td style="width:55%">${esc(it.label)}</td><td class="center" style="width:15%">${badge}</td><td class="muted">${esc(it.note || '')}</td></tr>`;
    }).join('');
    return `<div class="section-title">Checklist — ${esc(sec.section)}</div>
      <table class="grid"><thead><tr><th>Item</th><th class="center">Hasil</th><th>Catatan</th></tr></thead><tbody>${items}</tbody></table>`;
  }).join('');
  return `<div style="page-break-before: always;"></div>
    <div class="section-title">Checklist Pengecekan Teknisi (${esc(checklist.template?.name || '')} v${esc(checklist.template?.version || '')})</div>
    ${rows}`;
}

function bankInfoHtml(bank) {
  if (!bank || (!bank.bank_name && !bank.bank_account_name && !bank.bank_account_number)) return '';
  return `
  <div class="bank">
    <h4>Transfer Bank Jago</h4>
    <div class="muted" style="margin-bottom:4px">Silakan lakukan pembayaran melalui transfer ke rekening berikut:</div>
    <table class="bank-table">
      ${bank.bank_name ? `<tr><td>Nama Bank</td><td><b>${esc(bank.bank_name)}</b></td></tr>` : ''}
      ${bank.bank_account_number ? `<tr><td>No. Rekening</td><td><b>${esc(bank.bank_account_number)}</b></td></tr>` : ''}
      ${bank.bank_account_name ? `<tr><td>Atas Nama</td><td><b>${esc(bank.bank_account_name)}</b></td></tr>` : ''}
    </table>
  </div>`;
}

function safeQrDataUrl(value) {
  const src = String(value || '');
  return /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(src) ? src : '';
}

function qrisInfoHtml(order) {
  if (!order) return '';
  const qr = safeQrDataUrl(order.qr_data_url);
  return `<div class="qris">
    <h4>QRIS Pakasir</h4>
    ${qr ? `<img src="${esc(qr)}" alt="Kode QRIS pembayaran">` : ''}
    <table class="bank-table">
      <tr><td>Order ID</td><td><b>${esc(order.order_id || '-')}</b></td></tr>
      <tr><td>Nominal</td><td><b>${fmtIDR(order.amount)}</b></td></tr>
      <tr><td>Biaya QRIS</td><td><b>${fmtIDR(order.gateway_fee || 0)}</b></td></tr>
      <tr><td>Total Bayar</td><td><b>${fmtIDR(order.total_payment ?? order.amount)}</b></td></tr>
      <tr><td>Berlaku Sampai</td><td><b>${order.expired_at ? fmtDateTime(order.expired_at) : '-'}</b></td></tr>
    </table>
    <div class="muted" style="margin-top:6px">Pembayaran diverifikasi otomatis oleh Pakasir.</div>
  </div>`;
}

export function buildInvoiceHtml(data) {
  const { invoice: inv, totals, items, customer, ticket, work_order, payments, company, evidence, payment_account, payment_options } = data;
  const bank = payment_options?.bank || payment_account;
  const qrisOrder = payment_options?.pakasir_qris || null;
  const isProforma = inv.type === 'PROFORMA';
  const docLabel = isProforma ? 'Proforma Invoice' : 'Invoice';

  const itemRows = (items || []).map((it) => `
    <tr>
      <td>${esc(it.description)}${it.item_type === 'CUSTOM' ? ' <span class="muted">(Tambahan)</span>' : ''}</td>
      <td class="center">${it.qty} ${esc(it.unit || '')}</td>
      <td class="right">${fmtIDR(it.unit_price)}</td>
      <td class="right">${fmtIDR(it.qty * it.unit_price)}</td>
    </tr>`).join('');

  const taxRow = inv.tax_rate > 0
    ? `<div class="row"><span>PPN ${inv.tax_rate}%</span><span>${fmtIDR(totals.tax)}</span></div>`
    : `<div class="row"><span>PPN</span><span class="muted">Non-PPN</span></div>`;

  return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><title>${docLabel} ${esc(inv.number)}</title>
<style>
${DOC_BASE_CSS}
.watermark { position: fixed; top: 42%; left: 50%; transform: translate(-50%,-50%) rotate(-28deg);
  font-size: 96px; font-weight: 900; opacity: 0.14; z-index: 999; white-space: nowrap; pointer-events: none; letter-spacing: 8px; }
.watermark.paid { color: #059669; }
.watermark.unpaid { color: #dc2626; }
.status { display: inline-block; margin-top: 4px; padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; background: #e2e8f0; color: #334155; }
.status.PAID { background: #d1fae5; color: #065f46; }
.status.SENT { background: #fef3c7; color: #92400e; }
.status.PROFORMA { background: #ede9fe; color: #5b21b6; }
.totals { margin-top: 16px; margin-left: auto; width: 300px; }
.totals .row { display: flex; justify-content: space-between; padding: 5px 0; color: #475569; }
.totals .grand { border-top: 2px solid #e2e8f0; margin-top: 6px; padding-top: 10px; font-weight: 700; font-size: 16px; color: #1e293b; }
.pay { margin-top: 20px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 12px 16px; }
.pay h4 { color: #065f46; font-size: 11px; text-transform: uppercase; margin-bottom: 6px; }
.bank { margin-top: 20px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 12px 16px; }
.bank h4 { color: #1e40af; font-size: 11px; text-transform: uppercase; margin-bottom: 6px; }
.bank-table td { padding: 2px 0; font-size: 12px; color: #475569; }
.bank-table td:first-child { width: 120px; color: #64748b; }
.bank-table b { color: #1e293b; font-size: 12px; }
.qris { margin-top: 20px; background: #f8fafc; border: 1px solid #bfdbfe; border-radius: 10px; padding: 12px 16px; break-inside: avoid; }
.qris h4 { color: #1e40af; font-size: 11px; text-transform: uppercase; margin-bottom: 6px; }
.qris img { display: block; width: 180px; height: 180px; object-fit: contain; margin: 8px auto 12px; }
</style></head><body>
  ${watermarkHtml(inv)}
  <div class="head">
    <div>
      <div class="brand"><img class="logo" src="/assets/logo.png?v=2" alt="Logo">
        <div><div class="co">${esc(company?.company_name || 'Dent Tech')}</div>
        <div class="co-sub">${esc(company?.company_address || '')}</div>
        <div class="co-sub">${esc(company?.company_phone || '')} · ${esc(company?.company_email || '')}</div></div>
      </div>
    </div>
    <div class="doc-title">
      <div class="lbl">${docLabel}</div>
      <div class="num">${esc(inv.number)}</div>
      <span class="status ${inv.status === 'PAID' ? 'PAID' : (isProforma ? 'PROFORMA' : 'SENT')}">${inv.status === 'PAID' ? 'LUNAS' : (isProforma ? 'PROFORMA' : 'MENUNGGU PEMBAYARAN')}</span>
    </div>
  </div>

  <div class="meta">
    <div class="col"><h4>Ditagihkan Kepada</h4>
      <div><b>${esc(customer?.name || '-')}</b></div>
      <div class="muted">${esc([customer?.address, customer?.city].filter(Boolean).join(', '))}</div>
      <div class="muted">${esc(customer?.phone || '')}</div>
    </div>
    <div class="col" style="text-align:right"><h4>Detail</h4>
      <div>Diterbitkan: <b>${fmtDate(inv.issued_at)}</b></div>
      <div>Jatuh tempo: <b>${inv.due_at ? fmtDate(inv.due_at) : '-'}</b></div>
      ${ticket ? `<div>Ref: <b>${esc(ticket.number)}</b></div>` : ''}
      ${work_order ? `<div>Work Order: <b>${esc(work_order.number)}</b></div>` : ''}
    </div>
  </div>

  <table class="grid">
    <thead><tr><th>Deskripsi</th><th class="center">Qty</th><th class="right">Harga</th><th class="right">Jumlah</th></tr></thead>
     <tbody>${itemRows}</tbody>
  </table>

  <div class="totals">
    <div class="row"><span>Subtotal Item</span><span>${fmtIDR(totals.items_total)}</span></div>
    ${totals.discount > 0 ? `<div class="row"><span>Diskon</span><span>-${fmtIDR(totals.discount)}</span></div>` : ''}
    ${taxRow}
    <div class="row grand"><span>Total</span><span>${fmtIDR(totals.total)}</span></div>
  </div>

  ${inv.status !== 'PAID' ? `${qrisInfoHtml(qrisOrder)}${bankInfoHtml(bank)}` : ''}

  ${(payments && payments.length) ? `
  <div class="pay"><h4>Pembayaran</h4>
    ${payments.map((p) => `<div>${fmtIDR(p.amount)} via ${esc(p.method)}${p.reference ? ' (' + esc(p.reference) + ')' : ''} — ${fmtDateTime(p.paid_at)}</div>`).join('')}
  </div>` : ''}

  ${photosHtml(evidence)}
  ${checklistHtml(evidence)}

  <div class="foot">Dokumen ini dibuat otomatis oleh Service Management System ${esc(company?.company_name || 'Dent Tech')}.</div>
</body></html>`;
}

export function downloadInvoice(data) {
  printHtml(buildInvoiceHtml(data));
}
