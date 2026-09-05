import { api } from '../services/api.js';
import { getUser, logout } from '../utils/auth.js';
import { esc, timeAgo } from '../utils/format.js';
import { refreshIcons } from './ui.js';
import { avatarHtml } from './avatar.js';
import { bindThemeToggle } from '../utils/theme.js';

function initials(name = '') {
  return name.split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();
}

async function notifDropdownHtml() {
  try {
    const data = await api.get('/api/notifications');
    const items = data.notifications || [];
    if (!items.length) return `<div class="p-6 text-center text-sm text-slate-400">Belum ada notifikasi</div>`;
    return `<div class="max-h-96 overflow-y-auto divide-y divide-slate-100">
      ${items.slice(0, 20).map((n) => `
        <div class="px-4 py-3 hover:bg-slate-50 cursor-pointer ${n.read_at ? 'opacity-60' : ''}" data-notif-id="${n.id}" data-ref-type="${n.ref_type || ''}" data-ref-id="${n.ref_id || ''}">
          <div class="flex items-start gap-2">
            ${n.read_at ? '' : '<span class="mt-1.5 w-2 h-2 rounded-full bg-blue-500 shrink-0"></span>'}
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-slate-700 leading-snug">${esc(n.title)}</p>
              <p class="text-xs text-slate-500 mt-0.5 line-clamp-2">${esc(n.body || '')}</p>
              <p class="text-[11px] text-slate-400 mt-1">${timeAgo(n.created_at)}</p>
            </div>
          </div>
        </div>`).join('')}
    </div>
    <div class="px-4 py-2.5 border-t border-slate-100 text-center">
      <button id="notif-read-all" class="text-xs font-medium text-blue-600 hover:underline">Tandai semua dibaca</button>
    </div>`;
  } catch {
    return `<div class="p-6 text-center text-sm text-slate-400">Gagal memuat notifikasi</div>`;
  }
}

function refPath(type, id, role) {
  if (!type || !id) return null;
  if (role === 'admin') {
    if (type === 'ticket') return `/admin/ticket-detail.html?id=${id}`;
    if (type === 'work_order') return `/admin/workorder-detail.html?id=${id}`;
    if (type === 'service_report') return `/admin/workorders.html`;
    if (type === 'invoice') return `/admin/invoice-detail.html?id=${id}`;
  }
  if (role === 'technician') {
    if (type === 'work_order') return `/technician/job-detail.html?id=${id}`;
    if (type === 'service_report') return `/technician/`;
  }
  if (role === 'customer') {
    if (type === 'ticket') return `/customer/ticket-detail.html?id=${id}`;
    if (type === 'invoice') return `/customer/invoice-detail.html?id=${id}`;
  }
  return null;
}

export function setupNotifBell(bellEl, role) {
  if (!bellEl) return;
  const panel = document.createElement('div');
  panel.className = 'hidden fixed z-[80] w-[calc(100%-1.5rem)] max-w-sm right-3 top-14 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden';
  document.body.appendChild(panel);

  const refreshBadge = async () => {
    try {
      const me = await api.get('/api/auth/me');
      const badge = bellEl.querySelector('[data-notif-badge]');
      if (badge) {
        badge.textContent = me.unread_notifications > 0 ? String(me.unread_notifications) : '';
        badge.classList.toggle('hidden', me.unread_notifications === 0);
      }
    } catch {}
  };

  bellEl.addEventListener('click', async (e) => {
    e.stopPropagation();
    const willOpen = panel.classList.contains('hidden');
    panel.classList.toggle('hidden');
    if (willOpen) {
      panel.innerHTML = `<div class="p-6 text-center text-sm text-slate-400">Memuat...</div>`;
      panel.innerHTML = await notifDropdownHtml();
      panel.querySelectorAll('[data-notif-id]').forEach((el) => {
        el.addEventListener('click', async () => {
          const id = el.getAttribute('data-notif-id');
          const type = el.getAttribute('data-ref-type');
          const refId = el.getAttribute('data-ref-id');
          try { await api.post(`/api/notifications/${id}/read`); } catch {}
          const dest = refPath(type, refId, role);
          if (dest) window.location.href = dest;
          else { panel.classList.add('hidden'); refreshBadge(); panel.innerHTML = await notifDropdownHtml(); bindInner(); }
        });
      });
      bindInner();
    }
  });

  function bindInner() {
    const readAll = panel.querySelector('#notif-read-all');
    if (readAll) readAll.addEventListener('click', async () => {
      try { await api.post('/api/notifications/read-all'); } catch {}
      panel.innerHTML = await notifDropdownHtml();
      bindInner();
      refreshBadge();
    });
  }

  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && !bellEl.contains(e.target)) panel.classList.add('hidden');
  });
  refreshBadge();
}

function userMenu(btnEl, user) {
  const menu = document.createElement('div');
  menu.className = 'hidden fixed z-[80] right-3 top-14 w-60 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden';
  const profileHref = user.role === 'admin' ? '/admin/settings.html' : user.role === 'technician' ? '/technician/profile.html' : '/customer/profile.html';
  menu.innerHTML = `
    <div class="px-4 py-3 border-b border-slate-100">
      <p class="text-sm font-semibold text-slate-800">${esc(user.name)}</p>
      <p class="text-xs text-slate-500">${esc(user.email)}</p>
      <span class="inline-block mt-1 text-[10px] font-bold uppercase tracking-wide bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">${esc(user.role)}</span>
    </div>
    <a href="${profileHref}" class="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50"><i data-lucide="user" class="w-4 h-4"></i> Profil & Pengaturan</a>
    <button id="usermenu-logout" class="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50"><i data-lucide="log-out" class="w-4 h-4"></i> Keluar</button>`;
  document.body.appendChild(menu);
  btnEl.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); refreshIcons(); });
  document.addEventListener('click', (e) => { if (!menu.contains(e.target) && !btnEl.contains(e.target)) menu.classList.add('hidden'); });
  menu.querySelector('#usermenu-logout').addEventListener('click', logout);
}

// ---------------- Admin layout (desktop sidebar) ----------------
export function initAdminLayout(activeKey) {
  const user = getUser();
  const nav = [
    { key: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard', href: '/admin/' },
    { key: 'tickets', label: 'Tickets', icon: 'ticket', href: '/admin/tickets.html' },
    { key: 'workorders', label: 'Work Orders', icon: 'clipboard-list', href: '/admin/workorders.html' },
    { key: 'schedule', label: 'Schedule', icon: 'calendar-days', href: '/admin/schedule.html' },
    { key: 'customers', label: 'Customers', icon: 'building-2', href: '/admin/customers.html' },
    { key: 'equipment', label: 'Equipment', icon: 'cog', href: '/admin/equipment.html' },
    { key: 'technicians', label: 'Technicians', icon: 'users', href: '/admin/technicians.html' },
    { key: 'checklists', label: 'Checklist Library', icon: 'list-checks', href: '/admin/checklists.html' },
    { key: 'inventory', label: 'Spare Parts', icon: 'package', href: '/admin/inventory.html' },
    { key: 'invoices', label: 'Invoices', icon: 'receipt', href: '/admin/invoices.html' },
    { key: 'finance', label: 'Finance', icon: 'wallet', href: '/admin/finance.html' },
    { key: 'reports', label: 'Reports', icon: 'bar-chart-3', href: '/admin/reports.html' },
    { key: 'audit', label: 'Audit Log', icon: 'shield-check', href: '/admin/audit.html' }
  ];
  const sidebar = document.createElement('aside');
  sidebar.className = 'hidden lg:flex fixed inset-y-0 left-0 w-64 flex-col bg-slate-900 text-slate-300 z-40';
  sidebar.innerHTML = `
    <div class="flex items-center gap-3 px-5 h-16 border-b border-slate-800">
      <img src="/assets/logo.png?v=2" alt="Logo" class="w-9 h-9 object-contain">
      <div>
        <p class="text-white font-bold leading-tight">Dent Tech.id</p>
        <p class="text-[11px] text-slate-400 leading-tight">Admin Portal</p>
      </div>
    </div>
    <nav class="flex-1 overflow-y-auto py-4 px-3 space-y-1">
      ${nav.map((n) => `
        <a href="${n.href}" class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${n.key === activeKey ? 'bg-blue-600 text-white font-medium' : 'hover:bg-slate-800 hover:text-white'}">
          <i data-lucide="${n.icon}" class="w-[18px] h-[18px]"></i> ${n.label}
        </a>`).join('')}
    </nav>
    <div class="p-3 border-t border-slate-800">
      <div class="flex items-center gap-3 px-2 py-2">
        <div class="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center overflow-hidden">${avatarHtml(user, 'w-9 h-9', 'text-xs')}</div>
        <div class="min-w-0">
          <p class="text-sm text-white truncate">${esc(user?.name || '')}</p>
          <p class="text-[11px] text-slate-400 truncate">${esc(user?.email || '')}</p>
        </div>
      </div>
    </div>`;
  document.body.prepend(sidebar);

  const topbar = document.createElement('header');
  topbar.className = 'sticky top-0 z-30 h-16 bg-white/90 backdrop-blur border-b border-slate-200 flex items-center gap-3 px-4 sm:px-6 lg:pl-[18.5rem]';
  topbar.innerHTML = `
    <button id="mobile-menu-btn" class="lg:hidden p-2 rounded-lg hover:bg-slate-100 text-slate-600"><i data-lucide="menu" class="w-5 h-5"></i></button>
    <div class="lg:hidden flex items-center gap-2">
      <img src="/assets/logo.png?v=2" alt="Logo" class="w-8 h-8 object-contain">
      <span class="font-bold text-slate-800">Dent Tech.id</span>
    </div>
    <div class="flex-1"></div>
    <button id="theme-toggle" class="p-2 rounded-lg hover:bg-slate-100 text-slate-600" type="button"></button>
    <button id="notif-bell" class="relative p-2 rounded-lg hover:bg-slate-100 text-slate-600">
      <i data-lucide="bell" class="w-5 h-5"></i>
      <span data-notif-badge class="hidden absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center"></span>
    </button>
    <button id="user-menu-btn" class="flex items-center gap-2 p-1.5 rounded-lg hover:bg-slate-100">
      <div class="overflow-hidden rounded-full">${avatarHtml(user, 'w-8 h-8', 'text-xs')}</div>
    </button>`;
  const main = document.querySelector('main');
  main.classList.add('lg:pl-[19rem]');
  main.parentElement.insertBefore(topbar, main);
  bindThemeToggle(document.getElementById('theme-toggle'));
  // mobile drawer
  const drawer = document.createElement('div');
  drawer.className = 'hidden fixed inset-0 z-50 lg:hidden';
  drawer.innerHTML = `
    <div class="absolute inset-0 bg-slate-900/60" data-drawer-backdrop></div>
    <div class="absolute inset-y-0 left-0 w-72 bg-slate-900 text-slate-300 flex flex-col">
      <div class="flex items-center justify-between px-5 h-16 border-b border-slate-800">
        <div class="flex items-center gap-2">
          <img src="/assets/logo.png?v=2" alt="Logo" class="w-8 h-8 object-contain">
          <span class="text-white font-bold">Dent Tech.id</span>
        </div>
        <button data-drawer-close class="p-2 text-slate-400"><i data-lucide="x" class="w-5 h-5"></i></button>
      </div>
      <nav class="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        ${nav.map((n) => `
          <a href="${n.href}" class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm ${n.key === activeKey ? 'bg-blue-600 text-white font-medium' : 'hover:bg-slate-800 hover:text-white'}">
            <i data-lucide="${n.icon}" class="w-[18px] h-[18px]"></i> ${n.label}
          </a>`).join('')}
      </nav>
    </div>`;
  document.body.appendChild(drawer);
  drawer.querySelector('[data-drawer-backdrop]').addEventListener('click', () => drawer.classList.add('hidden'));
  drawer.querySelector('[data-drawer-close]').addEventListener('click', () => drawer.classList.add('hidden'));

  document.getElementById('mobile-menu-btn').addEventListener('click', () => { drawer.classList.remove('hidden'); refreshIcons(); });
  setupNotifBell(document.getElementById('notif-bell'), 'admin');
  userMenu(document.getElementById('user-menu-btn'), user);
  refreshIcons();
}

// ---------------- Mobile-first layout (technician & customer) ----------------
export function initMobileLayout(activeKey, role) {
  const user = getUser();
  const navTech = [
    { key: 'home', label: 'Beranda', icon: 'home', href: '/technician/' },
    { key: 'jobs', label: 'Jobs', icon: 'clipboard-list', href: '/technician/jobs.html' },
    { key: 'profile', label: 'Profil', icon: 'user', href: '/technician/profile.html' }
  ];
  const navCust = [
    { key: 'home', label: 'Beranda', icon: 'home', href: '/customer/' },
    { key: 'tickets', label: 'Service', icon: 'ticket', href: '/customer/tickets.html' },
    { key: 'request', label: 'Request', icon: 'plus-circle', href: '/customer/request.html', fab: true },
    { key: 'equipment', label: 'Equipment', icon: 'cog', href: '/customer/equipment.html' },
    { key: 'invoices', label: 'Invoice', icon: 'receipt', href: '/customer/invoices.html' }
  ];
  const nav = role === 'technician' ? navTech : navCust;
  const portalLabel = role === 'technician' ? 'Technician Portal' : 'Customer Portal';

  const topbar = document.createElement('header');
  topbar.className = 'sticky top-0 z-30 h-16 bg-white/95 backdrop-blur border-b border-slate-200 flex items-center gap-3 px-4';
  topbar.innerHTML = `
    <img src="/assets/logo.png?v=2" alt="Logo" class="w-9 h-9 object-contain">
    <div>
      <p class="font-bold text-slate-800 leading-tight">Dent Tech.id</p>
      <p class="text-[11px] text-slate-400 leading-tight">${portalLabel}</p>
    </div>
    <div class="flex-1"></div>
    <button id="theme-toggle" class="p-2 rounded-lg hover:bg-slate-100 text-slate-600" type="button"></button>
    <button id="notif-bell" class="relative p-2 rounded-lg hover:bg-slate-100 text-slate-600">
      <i data-lucide="bell" class="w-5 h-5"></i>
      <span data-notif-badge class="hidden absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center"></span>
    </button>
    <button id="user-menu-btn" class="flex items-center gap-2 p-1.5 rounded-lg hover:bg-slate-100">
      <div class="overflow-hidden rounded-full">${avatarHtml(user, 'w-8 h-8', 'text-xs')}</div>
    </button>`;
  const main = document.querySelector('main');
  main.parentElement.insertBefore(topbar, main);
  bindThemeToggle(document.getElementById('theme-toggle'));

  const bottom = document.createElement('nav');
  bottom.className = 'fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 pb-[env(safe-area-inset-bottom)]';
  bottom.innerHTML = `<div class="max-w-2xl mx-auto grid ${role === 'technician' ? 'grid-cols-3' : 'grid-cols-5'}">
    ${nav.map((n) => n.fab ? `
      <a href="${n.href}" class="flex flex-col items-center justify-center py-2 -mt-5">
        <span class="w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-lg shadow-blue-600/30"><i data-lucide="plus" class="w-6 h-6"></i></span>
        <span class="text-[10px] mt-1 font-medium ${n.key === activeKey ? 'text-blue-600' : 'text-slate-500'}">${n.label}</span>
      </a>` : `
      <a href="${n.href}" class="flex flex-col items-center justify-center py-2.5 gap-1 ${n.key === activeKey ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}">
        <i data-lucide="${n.icon}" class="w-5 h-5"></i>
        <span class="text-[10px] font-medium">${n.label}</span>
      </a>`).join('')}
  </div>`;
  document.body.appendChild(bottom);
  main.classList.add('pb-24');

  setupNotifBell(document.getElementById('notif-bell'), role);
  userMenu(document.getElementById('user-menu-btn'), user);
  refreshIcons();
}
