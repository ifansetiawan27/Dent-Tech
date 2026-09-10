import { esc } from '../utils/format.js';

// ---------- Status / priority styling maps ----------
export const TICKET_STATUS = {
  OPEN: { label: 'Open', cls: 'bg-blue-50 text-blue-700 ring-blue-200', dot: 'bg-blue-500' },
  REVIEWING: { label: 'Reviewing', cls: 'bg-amber-50 text-amber-700 ring-amber-200', dot: 'bg-amber-500' },
  ASSIGNED: { label: 'Assigned', cls: 'bg-violet-50 text-violet-700 ring-violet-200', dot: 'bg-violet-500' },
  IN_PROGRESS: { label: 'Inspection', cls: 'bg-sky-50 text-sky-700 ring-sky-200', dot: 'bg-sky-500' },
  WAITING_QUOTATION: { label: 'Menunggu Proforma', cls: 'bg-amber-50 text-amber-700 ring-amber-200', dot: 'bg-amber-500' },
  WAITING_CUSTOMER_APPROVAL: { label: 'Menunggu Approval', cls: 'bg-violet-50 text-violet-700 ring-violet-200', dot: 'bg-violet-500' },
  REPAIR_AUTHORIZED: { label: 'Perbaikan Disetujui', cls: 'bg-teal-50 text-teal-700 ring-teal-200', dot: 'bg-teal-500' },
  REPAIR_IN_PROGRESS: { label: 'Perbaikan Berlangsung', cls: 'bg-sky-50 text-sky-700 ring-sky-200', dot: 'bg-sky-500' },
  COMPLETED: { label: 'Completed', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  CLOSED: { label: 'Closed', cls: 'bg-slate-100 text-slate-600 ring-slate-200', dot: 'bg-slate-400' },
  CANCELLED: { label: 'Cancelled', cls: 'bg-red-50 text-red-700 ring-red-200', dot: 'bg-red-500' }
};

export const WO_STATUS = {
  ASSIGNED: { label: 'Assigned', cls: 'bg-violet-50 text-violet-700 ring-violet-200' },
  STARTED: { label: 'Inspection', cls: 'bg-sky-50 text-sky-700 ring-sky-200' },
  WAITING_QUOTATION: { label: 'Menunggu Proforma', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  WAITING_CUSTOMER_APPROVAL: { label: 'Menunggu Approval Customer', cls: 'bg-violet-50 text-violet-700 ring-violet-200' },
  REPAIR_AUTHORIZED: { label: 'Perbaikan Disetujui', cls: 'bg-teal-50 text-teal-700 ring-teal-200' },
  REPAIR_STARTED: { label: 'Perbaikan Berlangsung', cls: 'bg-sky-50 text-sky-700 ring-sky-200' },
  COMPLETED: { label: 'Completed', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  APPROVED: { label: 'Approved', cls: 'bg-teal-50 text-teal-700 ring-teal-200' },
  CANCELLED: { label: 'Cancelled', cls: 'bg-red-50 text-red-700 ring-red-200' }
};

export const PRIORITY = {
  LOW: { label: 'Low', cls: 'bg-slate-100 text-slate-600 ring-slate-200' },
  MEDIUM: { label: 'Medium', cls: 'bg-blue-50 text-blue-700 ring-blue-200' },
  HIGH: { label: 'High', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  URGENT: { label: 'Urgent', cls: 'bg-red-50 text-red-700 ring-red-200' }
};

export const REPORT_STATUS = {
  SUBMITTED: { label: 'Menunggu Approval', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  APPROVED: { label: 'Disetujui', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  REJECTED: { label: 'Perlu Revisi', cls: 'bg-red-50 text-red-700 ring-red-200' }
};

export const INVOICE_STATUS = {
  DRAFT: { label: 'Draft', cls: 'bg-slate-100 text-slate-600 ring-slate-200' },
  SENT: { label: 'Menunggu Pembayaran', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  PAID: { label: 'Lunas', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  OVERDUE: { label: 'Terlambat', cls: 'bg-red-50 text-red-700 ring-red-200' }
};

export const EQUIPMENT_STATUS = {
  OPERATIONAL: { label: 'Operational', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  UNDER_REPAIR: { label: 'Under Repair', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  MAINTENANCE: { label: 'Maintenance', cls: 'bg-sky-50 text-sky-700 ring-sky-200' },
  RETIRED: { label: 'Retired', cls: 'bg-slate-100 text-slate-600 ring-slate-200' }
};

export function statusBadge(status, map = TICKET_STATUS) {
  const s = map[status] || { label: status || '-', cls: 'bg-slate-100 text-slate-600 ring-slate-200' };
  return `<span class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${s.cls}">${esc(s.label)}</span>`;
}

// ---------- Toast ----------
export function toast(message, type = 'success') {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    host.className = 'fixed top-4 right-4 z-[100] flex flex-col gap-2 w-[calc(100%-2rem)] max-w-sm';
    document.body.appendChild(host);
  }
  const colors = {
    success: 'bg-emerald-600',
    error: 'bg-red-600',
    info: 'bg-slate-800',
    warning: 'bg-amber-500'
  };
  const icons = { success: 'check-circle', error: 'alert-circle', info: 'info', warning: 'alert-triangle' };
  const el = document.createElement('div');
  el.className = `${colors[type] || colors.info} text-white rounded-lg shadow-lg px-4 py-3 flex items-start gap-2 text-sm animate-[slideIn_.2s_ease-out]`;
  el.innerHTML = `<i data-lucide="${icons[type] || 'info'}" class="w-4 h-4 mt-0.5 shrink-0"></i><div class="flex-1">${esc(message)}</div>`;
  host.appendChild(el);
  if (window.lucide) window.lucide.createIcons();
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 320); }, 3800);
}

// ---------- Spinner / loading / empty ----------
export function spinner(label = 'Memuat...') {
  return `<div class="flex flex-col items-center justify-center py-16 text-slate-400">
    <svg class="animate-spin h-8 w-8 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
    </svg>
    <p class="mt-3 text-sm">${esc(label)}</p>
  </div>`;
}

export function emptyState(icon, title, desc = '', actionHtml = '') {
  return `<div class="flex flex-col items-center justify-center py-16 px-6 text-center">
    <div class="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-4">
      <i data-lucide="${icon}" class="w-7 h-7 text-slate-400"></i>
    </div>
    <h3 class="text-sm font-semibold text-slate-700">${esc(title)}</h3>
    ${desc ? `<p class="mt-1 text-sm text-slate-500 max-w-sm">${esc(desc)}</p>` : ''}
    ${actionHtml ? `<div class="mt-4">${actionHtml}</div>` : ''}
  </div>`;
}

export function errorState(message, retryFnName = '') {
  return `<div class="flex flex-col items-center justify-center py-16 px-6 text-center">
    <div class="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mb-4">
      <i data-lucide="alert-circle" class="w-7 h-7 text-red-500"></i>
    </div>
    <h3 class="text-sm font-semibold text-slate-700">Terjadi Kesalahan</h3>
    <p class="mt-1 text-sm text-slate-500 max-w-sm">${esc(message)}</p>
    ${retryFnName ? `<button onclick="${retryFnName}" class="mt-4 btn-secondary text-sm">Coba Lagi</button>` : ''}
  </div>`;
}

// ---------- Modal ----------
export function openModal({ title, body, footer = '', size = 'md', onClose = null }) {
  const sizes = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };
  const state = { onClose };
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-0 sm:p-4';
  overlay.innerHTML = `
    <div class="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" data-modal-backdrop></div>
    <div class="relative bg-white w-full ${sizes[size] || sizes.md} rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col animate-[popIn_.18s_ease-out]">
      <div class="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <h3 class="text-base font-semibold text-slate-800">${title}</h3>
        <button data-modal-close class="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><i data-lucide="x" class="w-5 h-5"></i></button>
      </div>
      <div class="px-5 py-4 overflow-y-auto flex-1">${body}</div>
      ${footer ? `<div class="px-5 py-4 border-t border-slate-100 flex justify-end gap-2">${footer}</div>` : ''}
    </div>`;
  document.body.appendChild(overlay);
  if (window.lucide) window.lucide.createIcons();
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); if (state.onClose) state.onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.querySelector('[data-modal-backdrop]').addEventListener('click', close);
  overlay.querySelectorAll('[data-modal-close]').forEach((b) => b.addEventListener('click', close));
  return { el: overlay, close, setOnClose: (fn) => { state.onClose = fn; } };
}

export function confirmDialog({ title = 'Konfirmasi', message, confirmLabel = 'Ya, lanjutkan', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const m = openModal({
      title,
      size: 'sm',
      body: `<p class="text-sm text-slate-600">${esc(message)}</p>`,
      footer: `
        <button class="btn-secondary" data-act="cancel">Batal</button>
        <button class="${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${esc(confirmLabel)}</button>`,
      onClose: () => done(false)
    });
    m.el.querySelector('[data-act="cancel"]').addEventListener('click', () => { m.close(); });
    m.el.querySelector('[data-act="ok"]').addEventListener('click', () => { m.setOnClose(null); m.close(); done(true); });
  });
}

// ---------- Photo upload helper (compress to JPEG dataURL) ----------
export function fileToDataUrl(file, maxDim = 1400, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (file.type === 'application/pdf') {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Gagal membaca gambar')); };
    img.src = url;
  });
}

// ---------- Photo grid + lightbox ----------
export function photoGrid(photos, { showKind = true, deletable = false } = {}) {
  if (!photos || !photos.length) return '';
  const kindLabel = { before: 'BEFORE', after: 'AFTER', request: 'REQUEST', equipment_brand: 'MEREK', equipment_serial: 'SERIAL', part_replacement: 'PENGGANTIAN PART', other: 'FOTO' };
  const kindCls = { before: 'bg-slate-700', after: 'bg-emerald-600', request: 'bg-amber-600', equipment_brand: 'bg-blue-600', equipment_serial: 'bg-violet-600', part_replacement: 'bg-red-600', other: 'bg-slate-500' };
  return `<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
    ${photos.map((p) => `
      <figure class="group relative rounded-xl overflow-hidden border border-slate-200 bg-slate-50 cursor-pointer" data-photo="${esc(p.url)}" data-caption="${esc(p.caption || '')}">
        <img src="${esc(p.url)}" alt="${esc(p.caption || p.kind)}" loading="lazy" class="w-full h-32 object-cover group-hover:scale-105 transition-transform">
        ${showKind ? `<span class="absolute top-2 left-2 text-[10px] font-bold text-white px-1.5 py-0.5 rounded ${kindCls[p.kind] || kindCls.other}">${kindLabel[p.kind] || 'FOTO'}</span>` : ''}
        ${(typeof deletable === 'function' ? deletable(p) : deletable) ? `<button type="button" data-photo-delete="${esc(p.id)}" aria-label="Hapus foto" class="absolute top-2 right-2 w-8 h-8 rounded-full bg-red-600 text-white flex items-center justify-center shadow hover:bg-red-700"><i data-lucide="trash-2" class="w-4 h-4"></i></button>` : ''}
        ${p.caption ? `<figcaption class="text-[11px] text-slate-500 px-2 py-1 truncate">${esc(p.caption)}</figcaption>` : ''}
      </figure>`).join('')}
  </div>`;
}

export function bindLightbox(root = document) {
  root.querySelectorAll('[data-photo]').forEach((el) => {
    el.addEventListener('click', (event) => {
      if (event.target.closest('[data-photo-delete]')) return;
      const url = el.getAttribute('data-photo');
      const caption = el.getAttribute('data-caption') || '';
      const m = openModal({
        title: 'Foto',
        size: 'xl',
        body: `<img src="${esc(url)}" class="w-full rounded-lg" alt="foto"><p class="text-sm text-slate-500 mt-2">${esc(caption)}</p>`
      });
      void m;
    });
  });
}

// ---------- Simple table builder ----------
export function table(headers, rowsHtml, emptyHtml = '') {
  return `<div class="overflow-x-auto rounded-xl border border-slate-200 bg-white">
    <table class="min-w-full text-sm">
      <thead><tr class="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
        ${headers.map((h) => `<th class="px-4 py-3 font-semibold whitespace-nowrap">${h}</th>`).join('')}
      </tr></thead>
      <tbody class="divide-y divide-slate-100">
        ${rowsHtml.length ? rowsHtml.join('') : `<tr><td colspan="${headers.length}">${emptyHtml || emptyState('inbox', 'Belum ada data')}</td></tr>`}
      </tbody>
    </table>
  </div>`;
}

export function refreshIcons() { if (window.lucide) window.lucide.createIcons(); }
