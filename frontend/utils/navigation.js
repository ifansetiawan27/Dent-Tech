// Manajemen navigasi stack untuk PWA terinstall (aplikasi Android/iOS).
// Setelah form disubmit, entri history halaman form diganti dengan halaman
// tujuan (location.replace) sehingga tombol back tidak kembali ke form lama.

export function isAppMode() {
  try {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.matchMedia('(display-mode: minimal-ui)').matches
      || window.navigator.standalone === true
      || (document.referrer || '').startsWith('android-app://');
  } catch (e) {
    return false;
  }
}

export function navigateAfterSubmit(dest) {
  if (!dest) return;
  if (isAppMode()) window.location.replace(dest);
  else window.location.href = dest;
}
