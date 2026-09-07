'use strict';

const SUPPORT_EMAIL = 'support@denttech.id';
const FORWARD_DESTINATION = 'ifansetiawan64@gmail.com';
const SENDER_EMAIL = 'notifications@denttech.id';

function htmlEscape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function singleLine(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

function appointmentEmail(snapshot) {
  const subject = `[Appointment Baru] ${singleLine(snapshot.number)} — ${singleLine(snapshot.priority)}`;
  const fields = [
    ['Nomor ticket', snapshot.number],
    ['Customer / Klinik', snapshot.customerName],
    ['Dibuat oleh', `${snapshot.actorName} (${snapshot.actorRole})`],
    ['Kontak', snapshot.contactName],
    ['Nomor telepon', snapshot.contactPhone],
    ['Jenis service', snapshot.serviceType],
    ['Prioritas', snapshot.priority],
    ['Alat', [snapshot.equipmentType, snapshot.equipmentBrand].filter(Boolean).join(' — ')],
    ['Masalah', snapshot.problem],
    ['Deskripsi', snapshot.description],
    ['Alamat service', snapshot.serviceAddress],
    ['Jadwal pilihan', [snapshot.preferredDate, snapshot.preferredTime].filter(Boolean).join(' ')],
    ['Dibuat', snapshot.createdAt],
  ];
  const textRows = fields.map(([label, value]) => `${label}: ${singleLine(value) || '-'}`).join('\n');
  const htmlRows = fields.map(([label, value]) => `<tr><td style="padding:7px 12px;color:#64748b;vertical-align:top">${htmlEscape(label)}</td><td style="padding:7px 12px;color:#0f172a;font-weight:600">${htmlEscape(value || '-')}</td></tr>`).join('');
  return {
    subject,
    text: `Appointment/service request baru telah dibuat.\n\n${textRows}\n\nBuka: ${snapshot.adminUrl}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#0f172a"><h2 style="color:#1d4ed8">Appointment Baru</h2><p>Request service baru telah tersimpan di Dent Tech.id.</p><table style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:12px">${htmlRows}</table><p style="margin-top:20px"><a href="${htmlEscape(snapshot.adminUrl)}" style="display:inline-block;padding:11px 18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-weight:700">Buka Ticket di Admin Portal</a></p><p style="font-size:12px;color:#94a3b8">Pesan otomatis dari Dent Tech.id Service Management System.</p></div>`,
  };
}

async function sendAppointmentEmail(env, snapshot, dependencies = {}) {
  if (!env?.EMAIL?.send) {
    console.info(`[appointment-email] disabled ticket=${snapshot.id}`);
    return { skipped: true };
  }
  const EmailMessage = dependencies.EmailMessage || (await import('cloudflare:email')).EmailMessage;
  const createMimeMessage = dependencies.createMimeMessage || (await import('mimetext')).createMimeMessage;
  const content = appointmentEmail(snapshot);
  const mime = createMimeMessage();
  mime.setSender({ name: 'Dent Tech.id Notification', addr: SENDER_EMAIL });
  mime.setRecipient({ name: 'Dent Tech.id Support', addr: SUPPORT_EMAIL });
  mime.setSubject(content.subject);
  mime.addMessage({ contentType: 'text/plain', data: content.text });
  mime.addMessage({ contentType: 'text/html', data: content.html });
  await env.EMAIL.send(new EmailMessage(SENDER_EMAIL, FORWARD_DESTINATION, mime.asRaw()));
  console.info(`[appointment-email] sent ticket=${snapshot.id}`);
  return { sent: true };
}

function customerRequestEmail(snapshot) {
  const subject = `[Dent Tech.id] Request Service ${singleLine(snapshot.number)} telah kami terima`;
  const fields = [
    ['Nomor ticket', snapshot.number],
    ['Customer / Klinik', snapshot.customerName],
    ['Jenis service', snapshot.serviceType],
    ['Prioritas', snapshot.priority],
    ['Alat', [snapshot.equipmentType, snapshot.equipmentBrand].filter(Boolean).join(' — ')],
    ['Masalah', snapshot.problem],
    ['Alamat service', snapshot.serviceAddress],
    ['Jadwal pilihan', [snapshot.preferredDate, snapshot.preferredTime].filter(Boolean).join(' ')],
    ['Dibuat', snapshot.createdAt],
  ];
  const textRows = fields.map(([label, value]) => `${label}: ${singleLine(value) || '-'}`).join('\n');
  const htmlRows = fields.map(([label, value]) => `<tr><td style="padding:7px 12px;color:#64748b;vertical-align:top">${htmlEscape(label)}</td><td style="padding:7px 12px;color:#0f172a;font-weight:600">${htmlEscape(value || '-')}</td></tr>`).join('');
  return {
    subject,
    text: `Terima kasih, request service Anda telah kami terima dan sedang diproses tim kami.\n\n${textRows}\n\nPantau status service Anda di portal customer: ${snapshot.customerUrl}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#0f172a"><h2 style="color:#1d4ed8">Request Service Diterima</h2><p>Terima kasih, <b>${htmlEscape(snapshot.customerName)}</b>. Request service Anda telah kami terima dan sedang diproses oleh tim Dent Tech.id.</p><table style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:12px">${htmlRows}</table><p style="margin-top:20px"><a href="${htmlEscape(snapshot.customerUrl)}" style="display:inline-block;padding:11px 18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-weight:700">Pantau Status Service</a></p><p style="font-size:12px;color:#94a3b8">Pesan otomatis dari Dent Tech.id Service Management System.</p></div>`,
  };
}

function invoicePaidEmail(snapshot) {
  const subject = `[Dent Tech.id] Pembayaran lunas untuk invoice ${singleLine(snapshot.invoiceNumber)}`;
  const fields = [
    ['Nomor invoice', snapshot.invoiceNumber],
    ['Customer / Klinik', snapshot.customerName],
    ['Ticket', snapshot.ticketNumber],
    ['Total dibayar', snapshot.totalFormatted],
    ['Metode', snapshot.method],
    ['Dibayar pada', snapshot.paidAt],
  ];
  const textRows = fields.map(([label, value]) => `${label}: ${singleLine(value) || '-'}`).join('\n');
  const htmlRows = fields.map(([label, value]) => `<tr><td style="padding:7px 12px;color:#64748b;vertical-align:top">${htmlEscape(label)}</td><td style="padding:7px 12px;color:#0f172a;font-weight:600">${htmlEscape(value || '-')}</td></tr>`).join('');
  return {
    subject,
    text: `Pembayaran invoice Anda telah kami terima secara lengkap. Terima kasih.\n\n${textRows}\n\nLihat invoice di portal customer: ${snapshot.customerUrl}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#0f172a"><h2 style="color:#059669">Pembayaran Lunas Diterima</h2><p>Terima kasih, <b>${htmlEscape(snapshot.customerName)}</b>. Pembayaran invoice Anda telah kami terima secara lengkap.</p><table style="width:100%;border-collapse:collapse;background:#f0fdf4;border-radius:12px">${htmlRows}</table><p style="margin-top:20px"><a href="${htmlEscape(snapshot.customerUrl)}" style="display:inline-block;padding:11px 18px;background:#059669;color:#fff;text-decoration:none;border-radius:8px;font-weight:700">Lihat Invoice di Portal Customer</a></p><p style="font-size:12px;color:#94a3b8">Pesan otomatis dari Dent Tech.id Service Management System.</p></div>`,
  };
}

async function sendNotificationEmail(env, { to, content }, dependencies = {}) {
  if (!env?.EMAIL?.send) {
    console.info(`[customer-email] disabled to=${to || '-'} subject=${content.subject}`);
    return { skipped: true };
  }
  if (!to) {
    console.warn('[customer-email] no recipient email available');
    return { skipped: true };
  }
  const EmailMessage = dependencies.EmailMessage || (await import('cloudflare:email')).EmailMessage;
  const createMimeMessage = dependencies.createMimeMessage || (await import('mimetext')).createMimeMessage;
  const mime = createMimeMessage();
  mime.setSender({ name: 'Dent Tech.id Notification', addr: SENDER_EMAIL });
  mime.setRecipient({ name: 'Dent Tech.id Customer', addr: to });
  mime.setSubject(content.subject);
  mime.addMessage({ contentType: 'text/plain', data: content.text });
  mime.addMessage({ contentType: 'text/html', data: content.html });
  await env.EMAIL.send(new EmailMessage(SENDER_EMAIL, to, mime.asRaw()));
  console.info(`[customer-email] sent to=${to} subject=${content.subject}`);
  return { sent: true };
}

function scheduleCustomerEmail(ctx, { to, content }) {
  if (!ctx.runtimeEnv?.EMAIL?.send) {
    console.info(`[customer-email] disabled to=${to || '-'} subject=${content.subject}`);
    return null;
  }
  const task = sendNotificationEmail(ctx.runtimeEnv, { to, content }).catch((error) => {
    console.error(`[customer-email] to=${to || '-'} code=${error?.code || 'UNKNOWN'} message=${error?.message || error}`);
  });
  if (ctx.executionCtx?.waitUntil) ctx.executionCtx.waitUntil(task);
  return task;
}

function scheduleAppointmentEmail(ctx, snapshot, dependencies = {}) {
  if (!ctx.runtimeEnv?.EMAIL?.send) {
    console.info(`[appointment-email] disabled ticket=${snapshot.id}`);
    return null;
  }
  const task = sendAppointmentEmail(ctx.runtimeEnv, snapshot, dependencies).catch((error) => {
    console.error(`[appointment-email] ticket=${snapshot.id} code=${error?.code || 'UNKNOWN'} message=${error?.message || error}`);
  });
  if (ctx.executionCtx?.waitUntil) ctx.executionCtx.waitUntil(task);
  return task;
}

module.exports = { SUPPORT_EMAIL, FORWARD_DESTINATION, SENDER_EMAIL, appointmentEmail, customerRequestEmail, invoicePaidEmail, sendAppointmentEmail, sendNotificationEmail, scheduleAppointmentEmail, scheduleCustomerEmail };
