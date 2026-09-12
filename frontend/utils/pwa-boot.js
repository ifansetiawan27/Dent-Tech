import { initPwa } from './pwa.js';
import { initInstallButton } from '../components/pwa-install.js';

initPwa();
if (window.location.pathname === '/login.html') initInstallButton();
