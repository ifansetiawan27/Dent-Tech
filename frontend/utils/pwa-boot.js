import { initPwa } from './pwa.js';
import { initInstallButton } from '../components/pwa-install.js';

initPwa();
const path = window.location.pathname;
if (path === '/' || path === '/index.html') {
  document.querySelectorAll('[data-install-slot]').forEach((slot) => {
    initInstallButton({ position: 'inline', target: slot, btnClass: 'pwa-install-btn-outline' });
  });
}
