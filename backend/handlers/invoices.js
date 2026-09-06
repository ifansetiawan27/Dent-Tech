'use strict';
const { db } = require('../db');
const { uid, now, sendJSON, nextNumber, fileSig, localDate, getSetting, setSetting } = require('../util');
const { audit, timeline, notify, getInvoiceItems, snapshotWorkOrderInvoiceItems, invoiceTotals, getTicket, buildChecklistState } = require('./_common');

function attachmentWithUrl(a) {
  const sig = fileSig(a.id);
  return { ...a, url: `/api/files/${a.id}?exp=${sig.exp}&sig=${sig.sig}` };
}

function validateEditableItems(items) {
  if (!Array.isArray(items)) return null;
  if (items.length > 50) throw new Error('Maksimal 50 item per invoice');
  return items.map((item, index) => {
    const description = String(item.description || '').trim().slice(0, 300);
    const qty = Number(item.qty);
    const unitPrice = Number(item.unit_price);
    const unit = String(item.unit || 'unit').trim().slice(0, 30) || 'unit';
    const itemType = ['LABOR', 'PART', 'CUSTOM'].includes(item.item_type) ? item.item_type : 'CUSTOM';
    if (!description) throw new Error(`Deskripsi item ke-${index + 1} wajib diisi`);
    if (!Number.isFinite(qty) || qty <= 0 || qty > 1000000) throw new Error(`Qty item ke-${index + 1} tidak valid`);
    if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 1000000000000) throw new Error(`Harga item ke-${index + 1} tidak valid`);
    return { id: item.id || uid(), item_type: itemType, description, qty, unit, unit_price: unitPrice, sort_order: index * 10, source_id: item.source_id || null };
  });
}

async function snapshotInvoiceItems(tx, invoiceId, workOrderId, laborCost, laborDescription, customItems = []) {
  const ts = now();
  await snapshotWorkOrderInvoiceItems(tx, invoiceId, workOrderId, laborCost, laborDescription);
  const normalized = validateEditableItems(customItems) || [];
  for (let i = 0; i < normalized.length; i++) {
    const item = normalized[i];
    await tx.prepare(`INSERT INTO invoice_items (id, invoice_id, item_type, description, qty, unit, unit_price, sort_order, source_id, created_at, updated_at)
      VALUES (?, ?, 'CUSTOM', ?, ?, ?, ?, ?, NULL, ?, ?)`)
      .run(uid(), invoiceId, item.description, item.qty, item.unit, item.unit_price, 1000 + i, ts, ts);
  }
}

async function invoiceDetail(inv, user, executor = db) {
  const [items, customer, payments, wo, ticket, paymentOrder] = await Promise.all([
    getInvoiceItems(inv.id, executor),
    executor.prepare('SELECT id, code, name, address, city, phone, email FROM customers WHERE id = ?').get(inv.customer_id),
    executor.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_at').all(inv.id),
    inv.work_order_id ? executor.prepare('SELECT * FROM work_orders WHERE id = ?').get(inv.work_order_id) : Promise.resolve(null),
    inv.ticket_id ? executor.prepare('SELECT number, problem, service_type FROM tickets WHERE id = ?').get(inv.ticket_id) : Promise.resolve(null),
    executor.prepare("SELECT * FROM payment_orders WHERE invoice_id = ? AND kind = 'INVOICE' ORDER BY (status = 'PENDING') DESC, created_at DESC LIMIT 1").get(inv.id)
  ]);
  const totals = invoiceTotals(inv, items);

  let evidence = { photos: [], checklist: null, diagnosis: null };
  if (wo) {
    const diagnosisSql = user?.role === 'customer'
      ? "SELECT findings, root_cause, recommendation FROM diagnoses WHERE work_order_id = ? AND visibility != 'INTERNAL' ORDER BY updated_at DESC LIMIT 1"
      : 'SELECT findings, root_cause, recommendation FROM diagnoses WHERE work_order_id = ? ORDER BY updated_at DESC LIMIT 1';
    const [rawPhotos, checklist, approvedReport, diagnosisRow] = await Promise.all([
      executor.prepare('SELECT * FROM attachments WHERE work_order_id = ? ORDER BY created_at').all(wo.id),
      buildChecklistState(wo, executor),
      user?.role === 'customer'
        ? executor.prepare("SELECT id FROM service_reports WHERE work_order_id = ? AND status = 'APPROVED' ORDER BY created_at DESC LIMIT 1").get(wo.id)
        : Promise.resolve(true),
      executor.prepare(diagnosisSql).get(wo.id)
    ]);
    const visible = (user && user.role === 'customer') ? rawPhotos.filter((p) => p.visibility !== 'INTERNAL') : rawPhotos;
    evidence.photos = visible.map(attachmentWithUrl);
    evidence.checklist = checklist;
    evidence.diagnosis = approvedReport ? diagnosisRow || null : null;
  }

  let pakasirQris = null;
  if (paymentOrder) {
    const { orderWithQr } = require('./wallet');
    try { pakasirQris = await orderWithQr(paymentOrder); }
    catch (error) {
      console.error(`[invoice-qris] invoice=${inv.id} order=${paymentOrder.id} message=${error?.message || error}`);
      pakasirQris = { id: paymentOrder.id, order_id: paymentOrder.order_id, amount: Number(paymentOrder.amount), status: paymentOrder.status, expired_at: paymentOrder.expired_at };
    }
  }
  const bankSettings = await readBankSettings();
  return {
    invoice: inv, totals, items, customer, payments,
    payment_account: bankSettings,
    payment_options: { bank: bankSettings, pakasir_qris: pakasirQris },
    work_order: wo ? {
      id: wo.id, number: wo.number, status: wo.status, scheduled_date: wo.scheduled_date,
      equipment_name: wo.serviced_equipment_name,
      equipment_type_model: wo.serviced_equipment_type_model,
      equipment_serial_number: wo.serviced_equipment_serial_number,
      equipment_identity_confirmed_at: wo.equipment_identity_confirmed_at
    } : null,
    ticket, evidence
  };
}

async function listInvoicesHandler(ctx) {
  const { status, customer_id, type } = ctx.query;
  const where = [];
  const params = [];
  if (ctx.user.role === 'customer') where.push('i.customer_id = ?'), params.push(ctx.user.customer_id);
  else if (customer_id) where.push('i.customer_id = ?'), params.push(customer_id);
  if (status) where.push('i.status = ?'), params.push(status);
  if (type) where.push('i.type = ?'), params.push(type);
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const rows = await db.prepare(
    `SELECT i.*, c.name AS customer_name, t.number AS ticket_number, wo.number AS wo_number,
            COALESCE(ii.items_total,0)::float8 AS items_total,
            COALESCE(ii.labor_total,0)::float8 AS labor_total,
            COALESCE(ii.parts_total,0)::float8 AS parts_total,
            COALESCE(ii.custom_total,0)::float8 AS custom_total
     FROM invoices i
     LEFT JOIN customers c ON c.id = i.customer_id
     LEFT JOIN tickets t ON t.id = i.ticket_id
     LEFT JOIN work_orders wo ON wo.id = i.work_order_id
     LEFT JOIN (
       SELECT invoice_id,
         SUM(qty*unit_price) AS items_total,
         SUM(CASE WHEN item_type='LABOR' THEN qty*unit_price ELSE 0 END) AS labor_total,
         SUM(CASE WHEN item_type='PART' THEN qty*unit_price ELSE 0 END) AS parts_total,
         SUM(CASE WHEN item_type='CUSTOM' THEN qty*unit_price ELSE 0 END) AS custom_total
       FROM invoice_items GROUP BY invoice_id
     ) ii ON ii.invoice_id = i.id
     ${whereSql} ORDER BY i.created_at DESC`
  ).all(...params);
  for (const inv of rows) {
    const itemsSubtotal = Number(inv.items_total || 0);
    const subtotal = Math.max(0, itemsSubtotal - Number(inv.discount || 0));
    const tax = Math.round(subtotal * Number(inv.tax_rate || 0)) / 100;
    inv.totals = {
      labor_cost: Number(inv.labor_total || 0), parts_total: Number(inv.parts_total || 0), custom_total: Number(inv.custom_total || 0),
      items_total: itemsSubtotal, discount: Number(inv.discount || 0), subtotal,
      tax_rate: Number(inv.tax_rate || 0), tax, total: Math.round((subtotal + tax) * 100) / 100
    };
  }
  sendJSON(ctx.res, 200, { invoices: rows });
}

async function getInvoiceHandler(ctx) {
  let result;
  try {
    result = await db.transaction(async (tx) => {
      // FOR SHARE membuat header dan line items terbaca sebagai satu revisi konsisten
      // saat admin sedang melakukan update atomik dengan FOR UPDATE.
      const inv = await tx.prepare('SELECT * FROM invoices WHERE id = ? FOR SHARE').get(ctx.params.id);
      if (!inv) { const e = new Error('Invoice tidak ditemukan'); e.status = 404; throw e; }
      if (ctx.user.role === 'customer' && inv.customer_id !== ctx.user.customer_id) { const e = new Error('Tidak memiliki akses'); e.status = 403; throw e; }
      if (ctx.query.revision === '1') return { revisionOnly: true, invoice: { id: inv.id, status: inv.status, version: inv.version, updated_at: inv.updated_at } };
      return { revisionOnly: false, detail: await invoiceDetail(inv, ctx.user, tx) };
    });
  } catch (e) {
    if (e.status) return sendJSON(ctx.res, e.status, { error: e.message });
    throw e;
  }
  if (result.revisionOnly) return sendJSON(ctx.res, 200, { invoice: result.invoice });
  sendJSON(ctx.res, 200, result.detail);
}

async function updateInvoiceHandler(ctx) {
  const { labor_cost, discount, tax_rate, due_at, items, version } = ctx.body;
  if (!Number.isInteger(Number(version)) || Number(version) < 1) return sendJSON(ctx.res, 400, { error: 'Versi invoice wajib diisi' });
  let normalizedItems;
  try { normalizedItems = validateEditableItems(items); }
  catch (e) { return sendJSON(ctx.res, 400, { error: e.message }); }
  const labor = labor_cost === undefined ? undefined : Number(labor_cost);
  const disc = discount === undefined ? undefined : Number(discount);
  const tax = tax_rate === undefined ? undefined : Number(tax_rate);
  if (labor !== undefined && (!Number.isFinite(labor) || labor < 0)) return sendJSON(ctx.res, 400, { error: 'Biaya jasa tidak valid' });
  if (disc !== undefined && (!Number.isFinite(disc) || disc < 0)) return sendJSON(ctx.res, 400, { error: 'Diskon tidak valid' });
  if (tax !== undefined && (!Number.isFinite(tax) || tax < 0 || tax > 100)) return sendJSON(ctx.res, 400, { error: 'PPN tidak valid' });

  let updated;
  try {
    updated = await db.transaction(async (tx) => {
      const inv = await tx.prepare('SELECT * FROM invoices WHERE id = ? FOR UPDATE').get(ctx.params.id);
      if (!inv) { const e = new Error('Invoice tidak ditemukan'); e.status = 404; throw e; }
      if (inv.status === 'PAID') { const e = new Error('Invoice sudah dibayar'); e.status = 400; throw e; }
      if (inv.type === 'PROFORMA' && inv.approval_status === 'APPROVED') { const e = new Error('Proforma yang sudah disetujui customer tidak dapat diubah'); e.status = 409; throw e; }
      const activeOrder = await tx.prepare("SELECT id FROM payment_orders WHERE invoice_id = ? AND kind = 'INVOICE' AND status = 'PENDING'").get(inv.id);
      if (activeOrder) { const e = new Error('Invoice memiliki order pembayaran gateway aktif'); e.status = 409; e.code = 'ACTIVE_PAYMENT_ORDER'; throw e; }
      if (Number(version) !== Number(inv.version)) { const e = new Error('Invoice sudah berubah. Muat ulang sebelum menyimpan.'); e.status = 409; throw e; }
      const ts = now();
      await tx.prepare(`UPDATE invoices SET labor_cost = ?, discount = ?, tax_rate = ?, due_at = ?, updated_at = ?, version = version + 1 WHERE id = ?`)
        .run(labor === undefined ? inv.labor_cost : labor, disc === undefined ? inv.discount : disc,
          tax === undefined ? inv.tax_rate : tax, due_at === undefined ? inv.due_at : due_at, ts, inv.id);
      if (labor !== undefined) {
        await tx.prepare("UPDATE invoice_items SET unit_price = ?, updated_at = ? WHERE invoice_id = ? AND item_type = 'LABOR'")
          .run(labor, ts, inv.id);
      }
      if (normalizedItems !== null) {
        await tx.prepare("DELETE FROM invoice_items WHERE invoice_id = ? AND item_type = 'CUSTOM'").run(inv.id);
        for (let i = 0; i < normalizedItems.length; i++) {
          const item = normalizedItems[i];
          await tx.prepare(`INSERT INTO invoice_items (id, invoice_id, item_type, description, qty, unit, unit_price, sort_order, source_id, created_at, updated_at)
            VALUES (?, ?, 'CUSTOM', ?, ?, ?, ?, ?, NULL, ?, ?)`)
            .run(uid(), inv.id, item.description, item.qty, item.unit, item.unit_price, 1000 + i, ts, ts);
        }
      }
      return tx.prepare('SELECT * FROM invoices WHERE id = ?').get(inv.id);
    });
  } catch (e) {
    if (e.status) return sendJSON(ctx.res, e.status, { error: e.message, ...(e.code ? { code: e.code } : {}) });
    throw e;
  }
  const detail = await invoiceDetail(updated, ctx.user);
  notify({ customer_id: updated.customer_id, title: `${updated.type === 'PROFORMA' ? 'Proforma' : 'Invoice'} ${updated.number} diperbarui`, body: `Data dan rincian invoice telah diperbarui. Total terbaru Rp ${detail.totals.total.toLocaleString('id-ID')}`, type: 'INVOICE', ref_type: 'invoice', ref_id: updated.id });
  audit(ctx.user, 'UPDATE', 'invoice', updated.id, `Memperbarui invoice ${updated.number} versi ${updated.version}`, ctx.ip);
  sendJSON(ctx.res, 200, { ok: true, ...detail });
}

async function convertPaidProforma(tx, invoice, paidAt) {
  if (invoice.type !== 'PROFORMA') return invoice.number;
  const invoiceNumber = await nextNumber('INV');
  await tx.prepare(`UPDATE invoices SET number = ?, proforma_number = ?, type = 'FINAL', status = 'PAID', paid_at = ?, converted_at = ?, updated_at = ?, version = version + 1 WHERE id = ?`)
    .run(invoiceNumber, invoice.number, paidAt, paidAt, paidAt, invoice.id);
  return invoiceNumber;
}

async function payInvoiceHandler(ctx) {
  const inv = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(ctx.params.id);
  if (!inv) return sendJSON(ctx.res, 404, { error: 'Invoice tidak ditemukan' });
  if (ctx.user.role === 'customer' && inv.customer_id !== ctx.user.customer_id) return sendJSON(ctx.res, 403, { error: 'Tidak memiliki akses' });
  if (inv.status === 'PAID') return sendJSON(ctx.res, 400, { error: 'Invoice sudah dibayar' });
  const { method = 'TRANSFER', reference = '' } = ctx.body;
  const paidAt = now();
  let totals;
  let paidDocumentNumber = inv.number;
  try {
    await db.transaction(async (tx) => {
      const locked = await tx.prepare('SELECT * FROM invoices WHERE id = ? FOR UPDATE').get(inv.id);
      if (!locked || locked.status === 'PAID') { const e = new Error('Invoice sudah dibayar'); e.status = 409; throw e; }
      if (!['SENT', 'OVERDUE'].includes(locked.status)) { const e = new Error('Status invoice tidak dapat dibayar'); e.status = 409; e.code = 'INVOICE_NOT_PAYABLE'; throw e; }
      if (locked.type === 'PROFORMA' && locked.approval_status !== 'APPROVED') { const e = new Error('Proforma belum disetujui customer'); e.status = 409; e.code = 'INVOICE_NOT_PAYABLE'; throw e; }
      const wo = locked.work_order_id ? await tx.prepare('SELECT status FROM work_orders WHERE id = ?').get(locked.work_order_id) : null;
      const report = locked.work_order_id ? await tx.prepare("SELECT status FROM service_reports WHERE work_order_id = ? ORDER BY created_at DESC LIMIT 1").get(locked.work_order_id) : null;
      if (locked.type === 'PROFORMA' && (!wo || wo.status !== 'APPROVED' || !report || report.status !== 'APPROVED')) { const e = new Error('Pembayaran tersedia setelah teknisi menyelesaikan pekerjaan'); e.status = 409; e.code = 'INVOICE_NOT_PAYABLE'; throw e; }
      const activeOrder = await tx.prepare("SELECT id FROM payment_orders WHERE invoice_id = ? AND kind = 'INVOICE' AND status = 'PENDING'").get(inv.id);
      if (activeOrder) { const e = new Error('Invoice memiliki order pembayaran gateway aktif'); e.status = 409; e.code = 'ACTIVE_PAYMENT_ORDER'; throw e; }
      const items = await getInvoiceItems(inv.id, tx);
      totals = invoiceTotals(locked, items);
      await tx.prepare('INSERT INTO payments (id, invoice_id, amount, method, reference, paid_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(uid(), inv.id, totals.total, method, reference, paidAt);
      if (locked.type === 'PROFORMA') {
        paidDocumentNumber = await convertPaidProforma(tx, locked, paidAt);
        if (locked.ticket_id) {
          const ticket = await tx.prepare('SELECT status FROM tickets WHERE id = ? FOR UPDATE').get(locked.ticket_id);
          if (ticket && ticket.status !== 'CLOSED') {
            await tx.prepare("UPDATE tickets SET status = 'CLOSED', closed_at = ?, updated_at = ? WHERE id = ?").run(paidAt, paidAt, locked.ticket_id);
            await tx.prepare('INSERT INTO ticket_status_history (id, ticket_id, from_status, to_status, by_user, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
              .run(uid(), locked.ticket_id, ticket.status, 'CLOSED', ctx.user.id, `Pembayaran terverifikasi; ${locked.number} menjadi ${paidDocumentNumber}`, paidAt);
          }
        }
      } else await tx.prepare("UPDATE invoices SET status = 'PAID', paid_at = ?, updated_at = ?, version = version + 1 WHERE id = ?")
        .run(paidAt, paidAt, inv.id);
    });
  } catch (e) {
    if (e.status) return sendJSON(ctx.res, e.status, { error: e.message, ...(e.code ? { code: e.code } : {}) });
    throw e;
  }
  if (inv.ticket_id) {
    const t = await getTicket(inv.ticket_id);
    if (t) timeline(t.id, 'PAYMENT', `Invoice ${inv.number} dibayar`, `Pembayaran ${method} ${reference}`.trim(), 'CUSTOMER_VISIBLE', ctx.user.id);
    notify({ role: 'admin', title: `Invoice ${inv.number} dibayar`, body: `Rp ${totals.total.toLocaleString('id-ID')} via ${method}`, type: 'INVOICE', ref_type: 'invoice', ref_id: inv.id });
  }
  audit(ctx.user, 'UPDATE', 'invoice', inv.id, `Pembayaran invoice ${inv.number} Rp ${totals.total}`, ctx.ip);
  sendJSON(ctx.res, 200, { ok: true, paid_amount: totals.total, invoice_number: paidDocumentNumber });
}

// ---------- Invoice settings (PPN / Non-PPN, default labor, rekening pembayaran) ----------
async function readBankSettings() {
  return {
    bank_name: await getSetting('invoice_bank_name', ''),
    bank_account_name: await getSetting('invoice_bank_account_name', ''),
    bank_account_number: await getSetting('invoice_bank_account_number', '')
  };
}

async function getInvoiceSettingsHandler(ctx) {
  sendJSON(ctx.res, 200, {
    tax_mode: await getSetting('invoice_tax_mode', 'PPN'),
    default_labor: Number(await getSetting('invoice_default_labor', '500000')),
    ...(await readBankSettings())
  });
}

async function updateInvoiceSettingsHandler(ctx) {
  const { tax_mode, default_labor, bank_name, bank_account_name, bank_account_number } = ctx.body;
  if (tax_mode !== undefined) {
    if (!['PPN', 'NON_PPN'].includes(tax_mode)) return sendJSON(ctx.res, 400, { error: 'Mode PPN tidak valid' });
    await setSetting('invoice_tax_mode', tax_mode);
  }
  if (default_labor !== undefined) {
    const v = Number(default_labor);
    if (isNaN(v) || v < 0) return sendJSON(ctx.res, 400, { error: 'Biaya jasa default tidak valid' });
    await setSetting('invoice_default_labor', String(v));
  }
  if (bank_name !== undefined) await setSetting('invoice_bank_name', String(bank_name).trim().slice(0, 100));
  if (bank_account_name !== undefined) await setSetting('invoice_bank_account_name', String(bank_account_name).trim().slice(0, 100));
  if (bank_account_number !== undefined) await setSetting('invoice_bank_account_number', String(bank_account_number).trim().slice(0, 50));
  audit(ctx.user, 'UPDATE', 'settings', 'invoice', 'Memperbarui pengaturan invoice', ctx.ip);
  sendJSON(ctx.res, 200, {
    ok: true,
    tax_mode: await getSetting('invoice_tax_mode', 'PPN'),
    default_labor: Number(await getSetting('invoice_default_labor', '500000')),
    ...(await readBankSettings())
  });
}

// ---------- Proforma Invoice ----------
async function approveProformaHandler(ctx) {
  let inv, wo, ticket;
  const approvedAt = now();
  try {
    await db.transaction(async (tx) => {
      inv = await tx.prepare('SELECT * FROM invoices WHERE id = ? FOR UPDATE').get(ctx.params.id);
      if (!inv) { const e = new Error('Proforma tidak ditemukan'); e.status = 404; throw e; }
      if (inv.customer_id !== ctx.user.customer_id) { const e = new Error('Tidak memiliki akses'); e.status = 403; throw e; }
      if (inv.type !== 'PROFORMA' || inv.approval_status !== 'SENT') { const e = new Error('Proforma tidak dapat disetujui pada status ini'); e.status = 409; throw e; }
      wo = await tx.prepare('SELECT * FROM work_orders WHERE id = ? FOR UPDATE').get(inv.work_order_id);
      ticket = wo ? await tx.prepare('SELECT * FROM tickets WHERE id = ? FOR UPDATE').get(wo.ticket_id) : null;
      if (!wo || !ticket || wo.status !== 'WAITING_CUSTOMER_APPROVAL') { const e = new Error('Status pekerjaan tidak sesuai untuk approval'); e.status = 409; throw e; }
      await tx.prepare("UPDATE invoices SET approval_status = 'APPROVED', approved_at = ?, approved_by = ?, updated_at = ?, version = version + 1 WHERE id = ?")
        .run(approvedAt, ctx.user.id, approvedAt, inv.id);
      await tx.prepare("UPDATE work_orders SET status = 'REPAIR_AUTHORIZED', updated_at = ? WHERE id = ?").run(approvedAt, wo.id);
      await tx.prepare("UPDATE tickets SET status = 'REPAIR_AUTHORIZED', updated_at = ? WHERE id = ?").run(approvedAt, ticket.id);
      await tx.prepare('INSERT INTO ticket_status_history (id, ticket_id, from_status, to_status, by_user, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(uid(), ticket.id, ticket.status, 'REPAIR_AUTHORIZED', ctx.user.id, `Customer menyetujui proforma ${inv.number}`, approvedAt);
    });
  } catch (e) {
    if (e.status) return sendJSON(ctx.res, e.status, { error: e.message });
    throw e;
  }
  timeline(ticket.id, 'APPROVAL', `Proforma ${inv.number} disetujui`, 'Customer menyetujui biaya perbaikan. Teknisi dapat memulai pekerjaan.', 'CUSTOMER_VISIBLE', ctx.user.id);
  notify({ user_id: wo.technician_id, title: `Perbaikan ${wo.number} disetujui`, body: `Customer menyetujui proforma ${inv.number}. Silakan mulai perbaikan.`, type: 'WORK_ORDER', ref_type: 'work_order', ref_id: wo.id });
  notify({ role: 'admin', title: `Proforma ${inv.number} disetujui`, body: `${ticket.number} siap dikerjakan teknisi`, type: 'INVOICE', ref_type: 'invoice', ref_id: inv.id });
  audit(ctx.user, 'UPDATE', 'invoice', inv.id, `Menyetujui proforma ${inv.number}`, ctx.ip);
  sendJSON(ctx.res, 200, { ok: true, approval_status: 'APPROVED' });
}

async function createProformaHandler(ctx) {
  const { work_order_id, labor_cost, discount, tax_rate, due_days = 14, items = [] } = ctx.body;
  if (!work_order_id) return sendJSON(ctx.res, 400, { error: 'work_order_id wajib diisi' });
  const labor = labor_cost !== undefined ? Number(labor_cost) : Number(await getSetting('invoice_default_labor', '500000'));
  const disc = discount === undefined ? 0 : Number(discount);
  const dueDays = Number(due_days);
  if (!Number.isFinite(labor) || labor < 0) return sendJSON(ctx.res, 400, { error: 'Biaya jasa tidak valid' });
  if (!Number.isFinite(disc) || disc < 0) return sendJSON(ctx.res, 400, { error: 'Diskon tidak valid' });
  if (!Number.isInteger(dueDays) || dueDays < 1 || dueDays > 365) return sendJSON(ctx.res, 400, { error: 'Jatuh tempo harus 1–365 hari' });
  let customItems;
  try { customItems = validateEditableItems(items) || []; }
  catch (e) { return sendJSON(ctx.res, 400, { error: e.message }); }
  let taxRate;
  if (tax_rate !== undefined) {
    taxRate = Number(tax_rate);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) return sendJSON(ctx.res, 400, { error: 'PPN tidak valid' });
  } else {
    taxRate = (await getSetting('invoice_tax_mode', 'PPN')) === 'NON_PPN' ? 0 : 11;
  }
  const invId = uid();
  const invNumber = await nextNumber('PI');
  const issued = now();
  const due = localDate(new Date(Date.now() + dueDays * 24 * 3600 * 1000));
  let t;
  try {
    await db.transaction(async (tx) => {
      const wo = await tx.prepare('SELECT * FROM work_orders WHERE id = ? FOR UPDATE').get(work_order_id);
      if (!wo) { const e = new Error('Work order tidak ditemukan'); e.status = 404; throw e; }
       if (wo.status !== 'WAITING_QUOTATION') { const e = new Error('Proforma hanya bisa dibuat setelah diagnosis dikirim teknisi'); e.status = 400; throw e; }
      t = await tx.prepare('SELECT * FROM tickets WHERE id = ?').get(wo.ticket_id);
      if (!t) { const e = new Error('Ticket tidak ditemukan'); e.status = 404; throw e; }
      const existing = await tx.prepare("SELECT id, number FROM invoices WHERE work_order_id = ? AND type = 'PROFORMA' AND status != 'PAID'").get(wo.id);
      if (existing) { const e = new Error(`Proforma ${existing.number} sudah ada untuk work order ini`); e.status = 409; throw e; }
       await tx.prepare(`INSERT INTO invoices (id, number, ticket_id, work_order_id, customer_id, labor_cost, discount, tax_rate, status, type, approval_status, issued_at, due_at, created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SENT', 'PROFORMA', 'SENT', ?, ?, ?, ?, 1)`)
         .run(invId, invNumber, t.id, wo.id, t.customer_id, labor, disc, taxRate, issued, due, issued, issued);
       await snapshotInvoiceItems(tx, invId, wo.id, labor, t.problem ? `Biaya Jasa — ${t.problem}` : 'Biaya Jasa', customItems);
       await tx.prepare("UPDATE work_orders SET status = 'WAITING_CUSTOMER_APPROVAL', updated_at = ? WHERE id = ?").run(issued, wo.id);
       await tx.prepare("UPDATE tickets SET status = 'WAITING_CUSTOMER_APPROVAL', updated_at = ? WHERE id = ?").run(issued, t.id);
       await tx.prepare('INSERT INTO ticket_status_history (id, ticket_id, from_status, to_status, by_user, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
         .run(uid(), t.id, t.status, 'WAITING_CUSTOMER_APPROVAL', ctx.user.id, `Proforma ${invNumber} dikirim`, issued);
    });
  } catch (e) {
    if (e.status) return sendJSON(ctx.res, e.status, { error: e.message });
    throw e;
  }
  const inv = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(invId);
  const detail = await invoiceDetail(inv, ctx.user);
  timeline(t.id, 'STATUS', `Proforma Invoice ${invNumber} diterbitkan`, `Penagihan ke customer (Total Rp ${detail.totals.total.toLocaleString('id-ID')})`, 'CUSTOMER_VISIBLE', ctx.user.id);
  notify({ customer_id: t.customer_id, title: `Proforma Invoice ${invNumber} diterbitkan`, body: `Total Rp ${detail.totals.total.toLocaleString('id-ID')} · Jatuh tempo ${due}`, type: 'INVOICE', ref_type: 'invoice', ref_id: invId });
  audit(ctx.user, 'CREATE', 'invoice', invId, `Membuat proforma invoice ${invNumber}`, ctx.ip);
  sendJSON(ctx.res, 201, { id: invId, number: invNumber, ...detail });
}

module.exports = {
  listInvoicesHandler, getInvoiceHandler, updateInvoiceHandler, payInvoiceHandler, approveProformaHandler, convertPaidProforma,
  getInvoiceSettingsHandler, updateInvoiceSettingsHandler, createProformaHandler
};
