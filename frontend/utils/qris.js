// Helper bersama untuk render info order pembayaran QRIS (Pakasir).

export function safeQrDataUrl(value) {
  const src = String(value || '');
  return /^data:image\/(?:png|jpeg|webp|svg\+xml);base64,[a-z0-9+/=]+$/i.test(src) ? src : '';
}

export function orderStatusBadgeClass(status) {
  const s = String(status || 'PENDING').toUpperCase();
  return s === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' : s === 'PENDING' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
}

export function orderPanelClass(status) {
  const s = String(status || 'PENDING').toUpperCase();
  return s === 'COMPLETED' ? 'border-emerald-300 bg-emerald-50' : 'border-blue-200';
}
