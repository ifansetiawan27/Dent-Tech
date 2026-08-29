export function fmtIDR(n) {
  const v = Number(n) || 0;
  return 'Rp ' + v.toLocaleString('id-ID', { maximumFractionDigits: 0 });
}

export function fmtDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function fmtDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' +
    d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

export function fmtTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function timeAgo(iso) {
  if (!iso) return '-';
  const then = new Date(iso).getTime();
  if (isNaN(then)) return iso;
  const diff = Date.now() - then;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'baru saja';
  if (m < 60) return `${m} menit lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  const dd = Math.floor(h / 24);
  if (dd < 30) return `${dd} hari lalu`;
  return fmtDate(iso);
}
