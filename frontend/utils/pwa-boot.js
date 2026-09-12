import { initPwa } from './pwa.js';
import { initInstallButton } from '../components/pwa-install.js';

initPwa();
const path = window.location.pathname;
if (path === '/' || path === '/index.html') {
  const slot = document.querySelector('[data-install-slot="hero"]');
  if (slot) initInstallButton({ position: 'inline', target: slot, btnClass: 'pwa-install-btn-outline' });
}
