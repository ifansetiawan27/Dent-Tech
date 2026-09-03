'use strict';
// Tabel route + matcher, dipisahkan agar bisa dipakai oleh server lokal (server.js)
// maupun Vercel serverless function (api/[...all].js).
const authH = require('./handlers/auth');
const masterH = require('./handlers/master');
const ticketsH = require('./handlers/tickets');
const woH = require('./handlers/workorders');
const reportsH = require('./handlers/reports');
const invoicesH = require('./handlers/invoices');
const dashH = require('./handlers/dashboard');
const filesH = require('./handlers/files');
const finH = require('./handlers/finance');
const walletH = require('./handlers/wallet');

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

// roles: null = public, [] = any authenticated, otherwise specific roles
route('POST', '/api/auth/login', null, authH.loginHandler);
route('POST', '/api/auth/signup', null, authH.signupHandler);
route('GET', '/api/public/settings', null, authH.publicSettingsHandler);
route('POST', '/api/auth/logout', [], authH.logoutHandler);
route('GET', '/api/auth/me', [], authH.meHandler);
route('PUT', '/api/auth/password', [], authH.changePasswordHandler);
route('POST', '/api/auth/photo', [], authH.uploadPhotoHandler);
route('GET', '/api/auth/photo', null, authH.getPhotoHandler);
route('GET', '/api/users', ['admin'], authH.listUsersHandler);
route('POST', '/api/users', ['admin'], authH.createUserHandler);
route('PUT', '/api/users/:id', ['admin'], authH.updateUserHandler);
route('DELETE', '/api/users/:id', ['admin'], authH.deleteTechnicianHandler);

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
route('POST', '/api/work-orders/:id/submit-diagnosis', ['admin', 'technician'], woH.submitDiagnosisHandler);
route('POST', '/api/work-orders/:id/start-repair', ['admin', 'technician'], woH.startRepairHandler);
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
route('POST', '/api/invoices/:id/approve', ['customer'], invoicesH.approveProformaHandler);
route('POST', '/api/invoices/:id/pay', ['admin'], invoicesH.payInvoiceHandler);
route('POST', '/api/invoices/:id/payment-orders', ['customer'], walletH.createInvoicePaymentHandler);
route('GET', '/api/invoices/:id/payment-orders/:orderId', ['customer'], walletH.invoicePaymentStatusHandler);

route('GET', '/api/wallet', ['customer'], walletH.getWalletHandler);
route('GET', '/api/wallet/history', ['customer'], walletH.walletHistoryHandler);
route('POST', '/api/wallet/topups', ['customer'], walletH.createTopupHandler);
route('GET', '/api/wallet/topups/:id', ['customer'], walletH.topupStatusHandler);
route('POST', '/api/payments/pakasir/callback', null, walletH.callbackHandler);

route('GET', '/api/dashboard', [], dashH.dashboardHandler);
route('GET', '/api/notifications', [], dashH.listNotificationsHandler);
route('POST', '/api/notifications/:id/read', [], dashH.readNotificationHandler);
route('POST', '/api/notifications/read-all', [], dashH.readAllNotificationsHandler);
route('GET', '/api/audit', ['admin'], dashH.auditLogsHandler);

route('POST', '/api/files', [], filesH.uploadFileHandler);
route('GET', '/api/files/:id', null, filesH.getFileHandler);

route('GET', '/api/finance/summary', ['admin'], finH.financeSummaryHandler);
route('GET', '/api/finance/income', ['admin'], finH.financeIncomeHandler);
route('GET', '/api/finance/expenses', ['admin'], finH.listExpensesHandler);
route('POST', '/api/finance/expenses', ['admin'], finH.createExpenseHandler);
route('DELETE', '/api/finance/expenses/:id', ['admin'], finH.deleteExpenseHandler);

module.exports = { routes, matchRoute };
