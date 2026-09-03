'use strict';
const path = require('path');
const { db } = require('../db');
const { saveFile, readFile } = require('../storage');
const { uid, now, sendJSON, verifyFileSig } = require('../util');
const { audit, getTicket, getWorkOrder, canAccessTicket, canAccessWorkOrder } = require('./_common');

const ALLOWED_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf'
};
const ATTACHMENT_KINDS = new Set(['request', 'before', 'after', 'equipment_brand', 'equipment_serial', 'part_replacement', 'other']);
const EVIDENCE_KINDS = new Set(['before', 'after', 'equipment_brand', 'equipment_serial', 'part_replacement']);
const EVIDENCE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

async function uploadFileHandler(ctx) {
  const { dataUrl, file_name = '', caption = '', kind = 'other', visibility = 'CUSTOMER_VISIBLE', ticket_id = null, work_order_id = null } = ctx.body;
  const normalizedVisibility = ['CUSTOMER_VISIBLE', 'INTERNAL'].includes(visibility) ? visibility : null;
  if (!normalizedVisibility) return sendJSON(ctx.res, 400, { error: 'Visibility lampiran tidak valid' });
  if (!dataUrl || typeof dataUrl !== 'string') return sendJSON(ctx.res, 400, { error: 'File tidak valid' });
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!m) return sendJSON(ctx.res, 400, { error: 'Format file harus base64 data URL' });
  const mime = m[1];
  if (!ALLOWED_MIME[mime]) return sendJSON(ctx.res, 400, { error: 'Tipe file tidak didukung (jpg/png/webp/gif/pdf)' });
  if (!ATTACHMENT_KINDS.has(kind)) return sendJSON(ctx.res, 400, { error: 'Jenis lampiran tidak valid' });
  if (EVIDENCE_KINDS.has(kind) && !EVIDENCE_MIME.has(mime)) return sendJSON(ctx.res, 400, { error: 'Bukti pekerjaan harus berupa JPG, PNG, atau WebP' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 10 * 1024 * 1024) return sendJSON(ctx.res, 400, { error: 'Ukuran file maksimal 10MB' });

  let resolvedTicketId = ticket_id;
  if (work_order_id) {
    const wo = await getWorkOrder(work_order_id);
    if (!wo) return sendJSON(ctx.res, 404, { error: 'Work order tidak ditemukan' });
    if (!await canAccessWorkOrder(ctx.user, wo)) return sendJSON(ctx.res, 403, { error: 'Tidak memiliki akses' });
    if (ctx.user.role === 'technician' && wo.technician_id !== ctx.user.id) return sendJSON(ctx.res, 403, { error: 'Work order bukan milik Anda' });
    if (ctx.user.role === 'customer' && EVIDENCE_KINDS.has(kind)) return sendJSON(ctx.res, 403, { error: 'Bukti pekerjaan hanya dapat diupload teknisi' });
    if (ctx.user.role === 'technician') {
      const inspectionKind = ['before', 'equipment_brand', 'equipment_serial'].includes(kind);
      const repairKind = ['after', 'part_replacement', 'other'].includes(kind);
      if (inspectionKind && wo.status !== 'STARTED') return sendJSON(ctx.res, 400, { error: 'Bukti inspeksi hanya dapat diupload saat inspeksi berlangsung' });
      if (repairKind && wo.status !== 'REPAIR_STARTED') return sendJSON(ctx.res, 400, { error: 'Bukti perbaikan hanya dapat diupload saat perbaikan berlangsung' });
    }
    resolvedTicketId = wo.ticket_id;
  } else if (ticket_id) {
    const t = await getTicket(ticket_id);
    if (!t) return sendJSON(ctx.res, 404, { error: 'Ticket tidak ditemukan' });
    if (!await canAccessTicket(ctx.user, t)) return sendJSON(ctx.res, 403, { error: 'Tidak memiliki akses' });
  } else {
    return sendJSON(ctx.res, 400, { error: 'ticket_id atau work_order_id wajib diisi' });
  }

  const id = uid();
  const fileName = `${id}${ALLOWED_MIME[mime]}`;
  await saveFile(fileName, buf, mime);
  const resolvedVisibility = EVIDENCE_KINDS.has(kind) ? 'CUSTOMER_VISIBLE' : normalizedVisibility;
  await db.prepare(`INSERT INTO attachments (id, ticket_id, work_order_id, kind, file_path, file_name, mime, size, caption, visibility, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, resolvedTicketId || null, work_order_id || null, kind, fileName, file_name || fileName, mime, buf.length, caption, resolvedVisibility, ctx.user.id, now());
  audit(ctx.user, 'CREATE', 'attachment', id, `Upload ${kind} (${mime})`, ctx.ip);
  sendJSON(ctx.res, 201, { id, file_name: fileName });
}

async function getFileHandler(ctx) {
  const a = await db.prepare('SELECT * FROM attachments WHERE id = ?').get(ctx.params.id);
  if (!a) return sendJSON(ctx.res, 404, { error: 'File tidak ditemukan' });
  let allowed = verifyFileSig(a.id, ctx.query.exp, ctx.query.sig);
  if (!allowed && ctx.user) {
    if (ctx.user.role === 'admin') allowed = true;
    else if (a.work_order_id) {
      const wo = await getWorkOrder(a.work_order_id);
      allowed = !!wo && await canAccessWorkOrder(ctx.user, wo) && (ctx.user.role !== 'customer' || a.visibility !== 'INTERNAL');
    } else if (a.ticket_id) {
      const t = await getTicket(a.ticket_id);
      allowed = !!t && await canAccessTicket(ctx.user, t) && (ctx.user.role !== 'customer' || a.visibility !== 'INTERNAL');
    }
  }
  if (!allowed) return sendJSON(ctx.res, 403, { error: 'Tidak memiliki akses ke file ini' });

  const data = await readFile(path.basename(a.file_path));
  if (!data) return sendJSON(ctx.res, 404, { error: 'File tidak ditemukan di storage' });
  ctx.res.writeHead(200, {
    'Content-Type': a.mime || 'application/octet-stream',
    'Content-Length': data.length,
    'Cache-Control': 'private, max-age=3600'
  });
  ctx.res.end(data);
}

module.exports = { uploadFileHandler, getFileHandler };
