'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { sendJSON, readBody } = require('./util');
const auth = require('./auth');
const { seed } = require('./seed');

const authH = require('./handlers/auth');
const masterH = require('./handlers/master');
const ticketsH = require('./handlers/tickets');
const woH = require('./handlers/workorders');
const reportsH = require('./handlers/reports');
const invoicesH = require('./handlers/invoices');
const dashH = require('./handlers/dashboard');
const filesH = require('./handlers/files');

seed();

const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const PORT = Number(process.env.PORT) || 3000;

// ---------------- Router ----------------
const routes = [];
function route(method, pattern, roles, handler) {
  routes.push({ method, segs: pattern.split('/').filter(Boolean), roles, handler });
}

function matchRoute(method, pathname) {
  const pSegs = pathname.split('/').filter(Boolean);
  for (const r of routes) {
    if (r.method !== method) continue;
    if (r.segs.length !== pSegs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < r.segs.length; i++) {
      if (r.segs[i].startsWith(':')) params[r.segs[i].slice(1)] = decodeURIComponent(pSegs[i]);
      else if (r.segs[i] !== pSegs[i]) { ok = false; break; }
    }
    if (ok) return { route: r, params };
  }
  return null;
}

// ---------------- API route table ----------------
// roles: null = public, [] = any authenticated, otherwise specific roles
route('POST', '/api/auth/login', null, authH.loginHandler);
route('GET', '/api/public/settings', null, authH.publicSettingsHandler);
route('POST', '/api/auth/logout', [], authH.logoutHandler);
route('GET', '/api/auth/me', [], authH.meHandler);
route('PUT', '/api/auth/password', [], authH.changePasswordHandler);
route('POST', '/api/auth/photo', [], authH.uploadPhotoHandler);
route('GET', '/api/auth/photo', null, authH.getPhotoHandler);
route('GET', '/api/users', ['admin'], authH.listUsersHandler);
route('POST', '/api/users', ['admin'], authH.createUserHandler);
route('PUT', '/api/users/:id', ['admin'], authH.updateUserHandler);

route('GET', '/api/customers', ['admin'], masterH.listCustomersHandler);
route('POST', '/api/customers', ['admin'], masterH.createCustomerHandler);
route('GET', '/api/customers/:id', ['admin', 'customer'], masterH.getCustomerHandler);
route('PUT', '/api/customers/:id', ['admin'], masterH.updateCustomerHandler);
route('DELETE', '/api/customers/:id', ['admin'], masterH.deleteCustomerHandler);

route('GET', '/api/equipment', ['admin', 'customer'], masterH.listEquipmentHandler);
route('POST', '/api/equipment', ['admin'], masterH.createEquipmentHandler);
route('GET', '/api/equipment/:id', ['admin', 'customer'], masterH.getEquipmentHandler);
route('PUT', '/api/equipment/:id', ['admin'], masterH.updateEquipmentHandler);
route('DELETE', '/api/equipment/:id', ['admin'], masterH.deleteEquipmentHandler);

route('GET', '/api/parts', ['admin', 'technician'], masterH.listPartsHandler);
route('POST', '/api/parts', ['admin'], masterH.createPartHandler);
route('PUT', '/api/parts/:id', ['admin'], masterH.updatePartHandler);
route('POST', '/api/parts/:id/adjust', ['admin'], masterH.adjustStockHandler);

route('GET', '/api/checklist-templates', ['admin', 'technician'], masterH.listTemplatesHandler);
route('GET', '/api/checklist-templates/:id', ['admin', 'technician'], masterH.getTemplateHandler);
route('POST', '/api/checklist-templates', ['admin'], masterH.createTemplateHandler);
route('PUT', '/api/checklist-templates/:id', ['admin'], masterH.updateTemplateHandler);
route('POST', '/api/checklist-templates/:id/duplicate', ['admin'], masterH.duplicateTemplateHandler);

route('GET', '/api/tickets', [], ticketsH.listTicketsHandler);
route('POST', '/api/tickets', ['admin', 'customer'], ticketsH.createTicketHandler);
route('GET', '/api/tickets/:id', [], ticketsH.getTicketHandler);
route('PUT', '/api/tickets/:id', ['admin'], ticketsH.updateTicketHandler);
route('POST', '/api/tickets/:id/status', ['admin'], ticketsH.changeStatusHandler);
route('POST', '/api/tickets/:id/assign', ['admin'], ticketsH.assignTicketHandler);
route('POST', '/api/tickets/:id/comments', [], ticketsH.commentHandler);
route('POST', '/api/tickets/:id/internal-notes', ['admin', 'technician'], ticketsH.internalNoteHandler);

route('GET', '/api/work-orders', ['admin', 'technician'], woH.listWorkOrdersHandler);
route('GET', '/api/work-orders/:id', [], woH.getWorkOrderHandler);
route('POST', '/api/work-orders/:id/start', ['admin', 'technician'], woH.startWorkOrderHandler);
route('POST', '/api/work-orders/:id/checklist', ['admin', 'technician'], woH.saveChecklistHandler);
route('POST', '/api/work-orders/:id/diagnosis', ['admin', 'technician'], woH.saveDiagnosisHandler);
route('POST', '/api/work-orders/:id/work-performed', ['admin', 'technician'], woH.addWorkPerformedHandler);
route('POST', '/api/work-orders/:id/parts', ['admin', 'technician'], woH.addPartUsageHandler);
route('DELETE', '/api/work-orders/:id/parts/:usageId', ['admin', 'technician'], woH.removePartUsageHandler);
route('POST', '/api/work-orders/:id/reschedule', ['admin'], woH.rescheduleHandler);
route('POST', '/api/work-orders/:id/complete', ['admin', 'technician'], woH.completeWorkOrderHandler);

route('GET', '/api/service-reports', [], reportsH.listReportsHandler);
route('GET', '/api/service-reports/:id', [], reportsH.getReportHandler);
route('POST', '/api/service-reports/:id/approve', ['admin'], reportsH.approveReportHandler);
route('POST', '/api/service-reports/:id/reject', ['admin'], reportsH.rejectReportHandler);
route('POST', '/api/service-reports/:id/resubmit', ['admin', 'technician'], reportsH.resubmitReportHandler);
route('GET', '/api/reports/analytics', ['admin'], reportsH.analyticsHandler);

route('GET', '/api/invoices', ['admin', 'customer'], invoicesH.listInvoicesHandler);
route('GET', '/api/invoice-settings', ['admin'], invoicesH.getInvoiceSettingsHandler);
route('PUT', '/api/invoice-settings', ['admin'], invoicesH.updateInvoiceSettingsHandler);
route('POST', '/api/invoices/proforma', ['admin'], invoicesH.createProformaHandler);
route('GET', '/api/invoices/:id', ['admin', 'customer'], invoicesH.getInvoiceHandler);
route('PUT', '/api/invoices/:id', ['admin'], invoicesH.updateInvoiceHandler);
route('POST', '/api/invoices/:id/pay', ['admin', 'customer'], invoicesH.payInvoiceHandler);

route('GET', '/api/dashboard', [], dashH.dashboardHandler);
route('GET', '/api/notifications', [], dashH.listNotificationsHandler);
route('POST', '/api/notifications/:id/read', [], dashH.readNotificationHandler);
route('POST', '/api/notifications/read-all', [], dashH.readAllNotificationsHandler);
route('GET', '/api/audit', ['admin'], dashH.auditLogsHandler);

route('POST', '/api/files', [], filesH.uploadFileHandler);
route('GET', '/api/files/:id', null, filesH.getFileHandler);

// ---------------- Static ----------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  if (!path.extname(rel)) rel = rel.replace(/\/?$/, '/index.html');
  const filePath = path.normalize(path.join(FRONTEND_DIR, rel));
  if (!filePath.startsWith(FRONTEND_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('404 Not Found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

// ---------------- Server ----------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const ip = req.socket.remoteAddress || '';

  if (pathname.startsWith('/api/')) {
    const matched = matchRoute(req.method, pathname);
    if (!matched) return sendJSON(res, 404, { error: 'Endpoint tidak ditemukan' });
    const { route: r, params } = matched;
    try {
      const user = auth.currentUser(req);
      if (r.roles !== null && !user) return sendJSON(res, 401, { error: 'Silakan login terlebih dahulu' });
      if (r.roles && r.roles.length > 0 && user && !r.roles.includes(user.role)) {
        return sendJSON(res, 403, { error: 'Anda tidak memiliki akses untuk aksi ini' });
      }
      const query = Object.fromEntries(url.searchParams.entries());
      let body = {};
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && (req.headers['content-type'] || '').includes('application/json')) {
        body = await readBody(req);
      }
      await r.handler({ req, res, user, params, query, body, ip });
    } catch (e) {
      console.error(`[API ERROR] ${req.method} ${pathname}:`, e);
      if (!res.headersSent) sendJSON(res, e.message === 'Payload too large' ? 413 : 500, { error: e.message === 'Invalid JSON body' ? 'Format request tidak valid' : 'Terjadi kesalahan pada server' });
    }
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log('====================================================');
  console.log('  Service Management System - Dent Tech');
  console.log(`  Server berjalan di http://localhost:${PORT}`);
  console.log('====================================================');
});
