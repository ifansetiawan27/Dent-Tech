'use strict';
const { db, supabaseAdmin } = require('./db');
const { saveFile } = require('./storage');
const { uid, localDate } = require('./util');
const { CHECKLIST_TEMPLATES } = require('./checklist-data');

function iso(daysAgo, hour = 9, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function dateOnly(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return localDate(d);
}

function placeholderSvg(fileId, label, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <rect width="800" height="600" fill="${color}"/>
  <rect x="20" y="20" width="760" height="560" fill="none" stroke="#ffffff" stroke-opacity="0.4" stroke-width="4" rx="16"/>
  <text x="400" y="280" font-family="Arial, sans-serif" font-size="42" font-weight="bold" fill="#ffffff" text-anchor="middle">${label}</text>
  <text x="400" y="330" font-family="Arial, sans-serif" font-size="20" fill="#ffffff" fill-opacity="0.85" text-anchor="middle">Dent Tech - Service Evidence</text>
  <text x="400" y="360" font-family="Arial, sans-serif" font-size="14" fill="#ffffff" fill-opacity="0.7" text-anchor="middle">${fileId}</text>
</svg>`;
}

async function addAttachment({ ticket_id, work_order_id, kind, caption, visibility, created_by, created_at, label, color }) {
  const id = uid();
  const fileName = `${id}.svg`;
  const svgBuf = Buffer.from(placeholderSvg(id, label || kind.toUpperCase(), color || '#334155'), 'utf8');
  await saveFile(fileName, svgBuf, 'image/svg+xml');
  await db.prepare(`INSERT INTO attachments (id, ticket_id, work_order_id, kind, file_path, file_name, mime, size, caption, visibility, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'image/svg+xml', ?, ?, ?, ?, ?)`)
    .run(id, ticket_id || null, work_order_id || null, kind, fileName, fileName, svgBuf.length, caption || '', visibility || 'CUSTOMER_VISIBLE', created_by || null, created_at);
  return id;
}

async function createAuthUser(email, password, name, role) {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { name, role }
  });
  if (error) throw new Error(`Gagal membuat user ${email}: ${error.message}`);
  return data.user.id;
}

async function seed() {
  const count = (await db.prepare('SELECT COUNT(*) AS c FROM users').get()).c;
  if (count > 0) return false;

  await db.prepare("INSERT INTO settings (key, value) VALUES ('company_name', 'Dent Tech') ON CONFLICT (key) DO NOTHING").run();
  await db.prepare("INSERT INTO settings (key, value) VALUES ('company_address', 'Jl. Raya Serpong No. 88, Tangerang Selatan') ON CONFLICT (key) DO NOTHING").run();
  await db.prepare("INSERT INTO settings (key, value) VALUES ('company_phone', '08953-2744-5799') ON CONFLICT (key) DO NOTHING").run();
  await db.prepare("INSERT INTO settings (key, value) VALUES ('company_email', 'support@denttech.id') ON CONFLICT (key) DO NOTHING").run();

  const insUser = (id, email, name, role, phone, customer_id, created_at) =>
    db.prepare('INSERT INTO users (id, email, password_hash, name, role, phone, customer_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)')
      .run(id, email, 'supabase-auth', name, role, phone, customer_id, created_at);

  const uAdmin = await createAuthUser('admin@denttech.id', 'admin123', 'Andi Wijaya', 'admin');
  const uBudi = await createAuthUser('budi@denttech.id', 'tech123', 'Budi Santoso', 'technician');
  const uSari = await createAuthUser('sari@denttech.id', 'tech123', 'Sari Rahma', 'technician');
  const uLia = await createAuthUser('lia@denttech.id', 'tech123', 'Lia Puspita', 'technician');
  await insUser(uAdmin, 'admin@denttech.id', 'Andi Wijaya', 'admin', '+62 812 9000 1001', null, iso(90));
  await insUser(uBudi, 'budi@denttech.id', 'Budi Santoso', 'technician', '+62 812 9000 1002', null, iso(90));
  await insUser(uSari, 'sari@denttech.id', 'Sari Rahma', 'technician', '+62 812 9000 1003', null, iso(80));
  await insUser(uLia, 'lia@denttech.id', 'Lia Puspita', 'technician', '+62 812 9000 1004', null, iso(70));

  const c1 = uid(), c2 = uid(), c3 = uid();
  const insCust = (id, code, name, industry, phone, email, address, city, created_at) =>
    db.prepare('INSERT INTO customers (id, code, name, industry, phone, email, address, city, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, code, name, industry, phone, email, address, city, 'ACTIVE', created_at);
  await insCust(c1, 'CUS-0001', 'Klinik Gigi Senyum Sehat', 'Klinik Gigi', '+62 21 7200 118', 'info@senyumsehat.id', 'Jl. Melati No. 12', 'Jakarta Selatan', iso(85));
  await insCust(c2, 'CUS-0002', 'RS Medika Farma', 'Rumah Sakit', '+62 22 8750 221', 'teknik@medikafarma.co.id', 'Jl. Asia Afrika No. 210', 'Bandung', iso(80));
  await insCust(c3, 'CUS-0003', 'Lab Dental Pro', 'Laboratorium Dental', '+62 31 5500 77', 'halo@dentalpro.id', 'Jl. Tunjungan No. 45', 'Surabaya', iso(60));

  const uRatna = await createAuthUser('ratna@denttech.id', 'customer123', 'Ratna Dewi', 'customer');
  const uHendra = await createAuthUser('hendra@denttech.id', 'customer123', 'Hendra Kusuma', 'customer');
  await insUser(uRatna, 'ratna@denttech.id', 'Ratna Dewi', 'customer', '+62 813 1100 2201', c1, iso(85));
  await insUser(uHendra, 'hendra@denttech.id', 'Hendra Kusuma', 'customer', '+62 813 1100 2202', c2, iso(80));

  const insContact = (id, customer_id, name, role, phone, email) =>
    db.prepare('INSERT INTO customer_contacts (id, customer_id, name, role, phone, email, is_primary) VALUES (?, ?, ?, ?, ?, ?, 1)')
      .run(id, customer_id, name, role, phone, email);
  await insContact(uid(), c1, 'Ratna Dewi', 'Kepala Klinik', '+62 813 1100 2201', 'ratna@senyumsehat.id');
  await insContact(uid(), c2, 'Hendra Kusuma', 'Bagian Teknik', '+62 813 1100 2202', 'hendra@medikafarma.co.id');
  await insContact(uid(), c3, 'Dian Paramita', 'Operasional', '+62 813 1100 2203', 'dian@dentalpro.id');

  const insEq = (id, customer_id, name, category, model, serial_number, location, install_date, warranty_until, status, created_at) =>
    db.prepare('INSERT INTO equipment (id, customer_id, name, category, model, serial_number, location, install_date, warranty_until, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, customer_id, name, category, model, serial_number, location, install_date, warranty_until, status, created_at);
  const e1 = uid(), e2 = uid(), e3 = uid(), e4 = uid(), e5 = uid(), e6 = uid();
  await insEq(e1, c1, 'Dental Chair Unit 1', 'Dental Unit', 'GNATUS S200', 'DC-2021-0091', 'Ruang Praktik 1', dateOnly(400), dateOnly(-30), 'OPERATIONAL', iso(85));
  await insEq(e2, c1, 'Autoclave Sterilizer', 'Autoclave', 'TUTTNAUER 2540M', 'AC-2022-1187', 'Ruang Sterilisasi', dateOnly(300), dateOnly(-120), 'OPERATIONAL', iso(85));
  await insEq(e3, c2, 'Intraoral X-Ray Unit', 'X-Ray', 'VATECH EZRAY', 'XR-2023-0452', 'Radiologi Lt.2', dateOnly(200), dateOnly(-200), 'UNDER_REPAIR', iso(80));
  await insEq(e4, c2, 'Dental Compressor', 'Compressor', 'DUERR DENTAL V120', 'CP-2021-8834', 'Ruang Mesin', dateOnly(500), '', 'OPERATIONAL', iso(80));
  await insEq(e5, c3, 'Dental Scanner', 'Intraoral Scanner 3D', '3SHAPE E4', 'SC-2024-0071', 'Lab Desain', dateOnly(100), dateOnly(-265), 'OPERATIONAL', iso(60));
  await insEq(e6, c3, 'Milling Machine', 'Milling', 'IMES ICORE 350i', 'ML-2023-3392', 'Lab Produksi', dateOnly(150), dateOnly(-215), 'MAINTENANCE', iso(60));

  const insPart = (id, code, name, category, unit, price, stock, min_stock) =>
    db.prepare('INSERT INTO parts (id, code, name, category, unit, price, stock, min_stock, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, code, name, category, unit, price, stock, min_stock, 'ACTIVE', iso(80));
  const p1 = uid(), p2 = uid(), p3 = uid(), p4 = uid(), p5 = uid(), p6 = uid(), p7 = uid(), p8 = uid();
  await insPart(p1, 'PRT-0001', 'Handpiece Bearing 608ZZ', 'Mechanical', 'pcs', 185000, 14, 5);
  await insPart(p2, 'PRT-0002', 'Autoclave Door Gasket', 'Sterilization', 'pcs', 450000, 6, 2);
  await insPart(p3, 'PRT-0003', 'Compressor Air Filter', 'Compressor', 'pcs', 120000, 3, 4);
  await insPart(p4, 'PRT-0004', 'Dental Chair Solenoid Valve', 'Pneumatic', 'pcs', 650000, 4, 2);
  await insPart(p5, 'PRT-0005', 'X-Ray Sensor Cable', 'Electrical', 'pcs', 950000, 2, 2);
  await insPart(p6, 'PRT-0006', 'Sterilization Pouch (box)', 'Consumable', 'box', 95000, 22, 10);
  await insPart(p7, 'PRT-0007', 'O-Ring Set Dental Chair', 'Seal', 'set', 275000, 8, 3);
  await insPart(p8, 'PRT-0008', 'Fuse 2A 250V', 'Electrical', 'pcs', 15000, 40, 15);

  const templateByName = {};
  for (const t of CHECKLIST_TEMPLATES) {
    const tid = uid();
    await db.prepare('INSERT INTO checklist_templates (id, name, service_type, equipment_category, version, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(tid, t.name, t.service_type, t.equipment_category, t.version, 'ACTIVE', iso(70));
    let sort = 0;
    const items = [];
    for (const sec of t.sections) {
      for (const it of sec.items) {
        const iid = uid();
        const req = it.required === false ? 0 : 1;
        items.push({ id: iid, section: sec.section, label: it.label, required: req });
        await db.prepare('INSERT INTO checklist_template_items (id, template_id, section, label, required, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
          .run(iid, tid, sec.section, it.label, req, ++sort);
      }
    }
    templateByName[t.name] = { id: tid, items };
  }
  const tpl1 = templateByName['Dental Unit'].id;
  const tpl1Items = templateByName['Dental Unit'].items;
  const tpl2 = templateByName['Autoclave'].id;
  const tpl2Items = templateByName['Autoclave'].items;

  const insTicket = (...p) => db.prepare(`INSERT INTO tickets (id, number, customer_id, equipment_id, contact_name, contact_phone, service_type, priority, problem, description, preferred_date, preferred_time, status, created_by, created_at, updated_at, closed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...p);
  const insHist = (...p) => db.prepare('INSERT INTO ticket_status_history (id, ticket_id, from_status, to_status, by_user, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(...p);
  const insTl = (...p) => db.prepare('INSERT INTO ticket_timeline (id, ticket_id, type, title, description, visibility, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(...p);

  // ---------- TICKET 1 : full lifecycle CLOSED ----------
  const t1 = uid();
  await insTicket(t1, 'TKT-2026-000001', c1, e1, 'Ratna Dewi', '+62 813 1100 2201', 'Preventive Maintenance', 'MEDIUM',
    'Jadwal preventive maintenance Dental Chair Unit 1', 'Maintenance berkala 3 bulanan sesuai kontrak servis.', dateOnly(30), '09:00 - 12:00', 'CLOSED', uRatna, iso(33, 8, 10), iso(28, 16, 0), iso(28, 16, 0));
  await insHist(uid(), t1, null, 'OPEN', uRatna, 'Request dibuat oleh customer', iso(33, 8, 10));
  await insHist(uid(), t1, 'OPEN', 'REVIEWING', uAdmin, 'Ticket direview admin', iso(32, 9, 0));
  await insHist(uid(), t1, 'REVIEWING', 'ASSIGNED', uAdmin, 'Ditugaskan ke Budi Santoso', iso(32, 10, 0));
  await insHist(uid(), t1, 'ASSIGNED', 'IN_PROGRESS', uBudi, 'Teknisi memulai pekerjaan', iso(30, 9, 15));
  await insHist(uid(), t1, 'IN_PROGRESS', 'COMPLETED', uBudi, 'Pekerjaan selesai, menunggu approval laporan', iso(30, 14, 30));
  await insHist(uid(), t1, 'COMPLETED', 'CLOSED', uAdmin, 'Laporan service disetujui', iso(28, 16, 0));
  await insTl(uid(), t1, 'REQUEST', 'Service request dibuat', 'Preventive maintenance Dental Chair Unit 1', 'CUSTOMER_VISIBLE', uRatna, iso(33, 8, 10));
  await insTl(uid(), t1, 'STATUS', 'Ticket direview', 'Admin memvalidasi request', 'CUSTOMER_VISIBLE', uAdmin, iso(32, 9, 0));
  await insTl(uid(), t1, 'ASSIGNMENT', 'Teknisi ditugaskan', 'Budi Santoso dijadwalkan ' + dateOnly(30) + ' 09:00 - 12:00', 'CUSTOMER_VISIBLE', uAdmin, iso(32, 10, 0));
  await insTl(uid(), t1, 'STATUS', 'Service dimulai', 'Teknisi tiba di lokasi dan memulai pekerjaan', 'CUSTOMER_VISIBLE', uBudi, iso(30, 9, 15));
  await insTl(uid(), t1, 'STATUS', 'Service selesai', 'Semua checklist selesai, laporan dikirim untuk approval', 'CUSTOMER_VISIBLE', uBudi, iso(30, 14, 30));
  await insTl(uid(), t1, 'APPROVAL', 'Laporan disetujui', 'Service report disetujui oleh admin', 'CUSTOMER_VISIBLE', uAdmin, iso(28, 16, 0));

  const wo1 = uid();
  await db.prepare(`INSERT INTO work_orders (id, number, ticket_id, technician_id, checklist_template_id, scheduled_date, time_window, status, started_at, completed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(wo1, 'WO-2026-000001', t1, uBudi, tpl1, dateOnly(30), '09:00 - 12:00', 'APPROVED', iso(30, 9, 15), iso(30, 14, 30), iso(32, 10, 0), iso(28, 16, 0));
  const insResp = (...p) => db.prepare('INSERT INTO checklist_responses (id, work_order_id, item_id, section, label, required, result, note, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(...p);
  for (const it of tpl1Items) await insResp(uid(), wo1, it.id, it.section, it.label, 1, 'PASS', '', iso(30, 12, 0));
  await db.prepare(`INSERT INTO diagnoses (id, work_order_id, findings, root_cause, recommendation, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(uid(), wo1, 'Unit berfungsi normal. Tekanan suction sedikit menurun karena filter kotor.', 'Akumulasi debris pada filter suction.', 'Bersihkan filter suction setiap 2 minggu oleh staf klinik.', 'CUSTOMER_VISIBLE', iso(30, 10, 0), iso(30, 10, 0));
  await db.prepare('INSERT INTO work_performed (id, work_order_id, description, created_at) VALUES (?, ?, ?, ?)')
    .run(uid(), wo1, 'Pembersihan filter suction, pelumasan moving parts, kalibrasi tekanan air, uji seluruh gerakan kursi.', iso(30, 14, 0));
  await db.prepare('INSERT INTO part_usages (id, work_order_id, part_id, qty, unit_price, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(uid(), wo1, p7, 1, 275000, 'Ganti O-ring set', iso(30, 13, 0));
  await addAttachment({ ticket_id: t1, work_order_id: wo1, kind: 'before', caption: 'Kondisi unit sebelum maintenance', created_by: uBudi, created_at: iso(30, 9, 20), label: 'BEFORE', color: '#475569' });
  await addAttachment({ ticket_id: t1, work_order_id: wo1, kind: 'after', caption: 'Unit bersih dan siap digunakan', created_by: uBudi, created_at: iso(30, 14, 20), label: 'AFTER', color: '#16a34a' });

  const sr1 = uid();
  await db.prepare(`INSERT INTO service_reports (id, number, version, work_order_id, summary, technician_note, status, approved_at, approved_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(sr1, 'SR-2026-000001', 1, wo1,
      'Preventive maintenance Dental Chair Unit 1 selesai. Seluruh item checklist PASS. Filter suction dibersihkan, O-ring set diganti, semua fungsi normal.',
      'Jadwalkan maintenance berikutnya dalam 3 bulan.', 'APPROVED', iso(28, 16, 0), uAdmin, iso(30, 15, 0), iso(28, 16, 0));

  const inv1 = uid();
  await db.prepare(`INSERT INTO invoices (id, number, ticket_id, work_order_id, customer_id, labor_cost, discount, tax_rate, status, issued_at, due_at, paid_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(inv1, 'INV-2026-000001', t1, wo1, c1, 750000, 0, 11, 'PAID', iso(28, 16, 30), dateOnly(14), iso(20, 11, 0), iso(28, 16, 30));
  await db.prepare('INSERT INTO payments (id, invoice_id, amount, method, reference, paid_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uid(), inv1, 1135750, 'TRANSFER', 'TRF-BCA-88231', iso(20, 11, 0));

  // ---------- TICKET 2 : IN_PROGRESS, technician demo ----------
  const t2 = uid();
  await insTicket(t2, 'TKT-2026-000002', c1, e2, 'Ratna Dewi', '+62 813 1100 2201', 'Repair', 'HIGH',
    'Autoclave tidak mencapai suhu sterilisasi', 'Saat siklus berjalan, suhu berhenti di 110C dan indikator error E-03 menyala. Sterilisasi instrumen terganggu.', dateOnly(0), '09:00 - 12:00', 'IN_PROGRESS', uRatna, iso(2, 7, 45), iso(0, 9, 10), null);
  await insHist(uid(), t2, null, 'OPEN', uRatna, 'Request dibuat oleh customer', iso(2, 7, 45));
  await insHist(uid(), t2, 'OPEN', 'REVIEWING', uAdmin, 'Ticket direview admin', iso(2, 8, 30));
  await insHist(uid(), t2, 'REVIEWING', 'ASSIGNED', uAdmin, 'Ditugaskan ke Budi Santoso', iso(2, 9, 0));
  await insHist(uid(), t2, 'ASSIGNED', 'IN_PROGRESS', uBudi, 'Teknisi memulai pekerjaan', iso(0, 9, 10));
  await insTl(uid(), t2, 'REQUEST', 'Service request dibuat', 'Autoclave tidak mencapai suhu sterilisasi (E-03)', 'CUSTOMER_VISIBLE', uRatna, iso(2, 7, 45));
  await insTl(uid(), t2, 'STATUS', 'Ticket direview', 'Prioritas HIGH - mengganggu operasional klinik', 'CUSTOMER_VISIBLE', uAdmin, iso(2, 8, 30));
  await insTl(uid(), t2, 'ASSIGNMENT', 'Teknisi ditugaskan', 'Budi Santoso dijadwalkan ' + dateOnly(0) + ' 09:00 - 12:00', 'CUSTOMER_VISIBLE', uAdmin, iso(2, 9, 0));
  await insTl(uid(), t2, 'STATUS', 'Service dimulai', 'Teknisi memulai diagnosis di lokasi', 'CUSTOMER_VISIBLE', uBudi, iso(0, 9, 10));
  await addAttachment({ ticket_id: t2, kind: 'request', caption: 'Indikator error E-03 pada panel autoclave', created_by: uRatna, created_at: iso(2, 7, 50), label: 'REQUEST', color: '#b45309' });

  const wo2 = uid();
  await db.prepare(`INSERT INTO work_orders (id, number, ticket_id, technician_id, checklist_template_id, scheduled_date, time_window, status, started_at, completed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(wo2, 'WO-2026-000002', t2, uBudi, tpl2, dateOnly(0), '09:00 - 12:00', 'STARTED', iso(0, 9, 10), null, iso(2, 9, 0), iso(0, 9, 10));
  for (let i = 0; i < 4; i++) { const it = tpl2Items[i]; await insResp(uid(), wo2, it.id, it.section, it.label, 1, i === 1 ? 'FAIL' : 'PASS', i === 1 ? 'Elemen pemanas terukur 18 ohm, di atas spesifikasi.' : '', iso(0, 9, 40)); }
  await db.prepare(`INSERT INTO diagnoses (id, work_order_id, findings, root_cause, recommendation, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(uid(), wo2, 'Elemen pemanas terukur di luar spesifikasi. Sensor suhu masih baik.', 'Elemen pemanas aus / degradasi.', 'Ganti elemen pemanas dan jalankan siklus kalibrasi.', 'CUSTOMER_VISIBLE', iso(0, 9, 45), iso(0, 9, 45));
  await addAttachment({ ticket_id: t2, work_order_id: wo2, kind: 'before', caption: 'Kondisi chamber sebelum perbaikan', created_by: uBudi, created_at: iso(0, 9, 15), label: 'BEFORE', color: '#475569' });

  // ---------- TICKET 3 : OPEN, admin demo ----------
  const t3 = uid();
  await insTicket(t3, 'TKT-2026-000003', c2, e3, 'Hendra Kusuma', '+62 813 1100 2202', 'Repair', 'HIGH',
    'X-Ray unit mati total setelah pemadaman listrik', 'Unit tidak menyala sama sekali. Tidak ada indikator lampu. Diduga masalah power supply setelah listrik padam kemarin.', dateOnly(-1), '13:00 - 16:00', 'OPEN', uHendra, iso(0, 8, 20), iso(0, 8, 20), null);
  await insHist(uid(), t3, null, 'OPEN', uHendra, 'Request dibuat oleh customer', iso(0, 8, 20));
  await insTl(uid(), t3, 'REQUEST', 'Service request dibuat', 'X-Ray unit mati total setelah pemadaman listrik', 'CUSTOMER_VISIBLE', uHendra, iso(0, 8, 20));
  await addAttachment({ ticket_id: t3, kind: 'request', caption: 'Panel X-Ray tidak menampilkan indikator', created_by: uHendra, created_at: iso(0, 8, 25), label: 'REQUEST', color: '#b45309' });

  // ---------- TICKET 4 : REVIEWING ----------
  const t4 = uid();
  await insTicket(t4, 'TKT-2026-000004', c3, e6, 'Dian Paramita', '+62 813 1100 2203', 'Preventive Maintenance', 'MEDIUM',
    'Maintenance berkala Milling Machine', 'Maintenance rutin sesuai jadwal kontrak servis kuartalan.', dateOnly(-3), '09:00 - 12:00', 'REVIEWING', uHendra, iso(1, 10, 0), iso(0, 7, 30), null);
  await insHist(uid(), t4, null, 'OPEN', uHendra, 'Request dibuat oleh customer', iso(1, 10, 0));
  await insHist(uid(), t4, 'OPEN', 'REVIEWING', uAdmin, 'Ticket direview admin', iso(0, 7, 30));
  await insTl(uid(), t4, 'REQUEST', 'Service request dibuat', 'Maintenance berkala Milling Machine', 'CUSTOMER_VISIBLE', uHendra, iso(1, 10, 0));
  await insTl(uid(), t4, 'STATUS', 'Ticket direview', 'Menunggu penugasan teknisi', 'CUSTOMER_VISIBLE', uAdmin, iso(0, 7, 30));

  // ---------- Notifications ----------
  const insNotif = (...p) => db.prepare('INSERT INTO notifications (id, user_id, role, customer_id, title, body, type, ref_type, ref_id, read_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(...p);
  await insNotif(uid(), null, 'admin', null, 'Ticket baru TKT-2026-000003', 'X-Ray unit mati total - RS Medika Farma (prioritas HIGH)', 'TICKET', 'ticket', t3, null, iso(0, 8, 20));
  await insNotif(uid(), null, 'admin', null, 'Ticket TKT-2026-000004 menunggu review', 'Maintenance Milling Machine - Lab Dental Pro', 'TICKET', 'ticket', t4, iso(0, 7, 35), iso(1, 10, 0));
  await insNotif(uid(), uBudi, null, null, 'Work order WO-2026-000002 dijadwalkan hari ini', 'Perbaikan Autoclave - Klinik Gigi Senyum Sehat, 09:00 - 12:00', 'WORK_ORDER', 'work_order', wo2, null, iso(2, 9, 0));
  await insNotif(uid(), uRatna, null, c1, 'Teknisi sedang bekerja', 'Perbaikan autoclave sedang berlangsung di lokasi Anda', 'WORK_ORDER', 'ticket', t2, null, iso(0, 9, 10));
  await insNotif(uid(), uRatna, null, c1, 'Invoice INV-2026-000001 telah dibayar', 'Terima kasih, pembayaran maintenance Dental Chair telah dikonfirmasi', 'INVOICE', 'invoice', inv1, null, iso(20, 11, 0));

  // ---------- Audit logs ----------
  const insAudit = (...p) => db.prepare('INSERT INTO audit_logs (id, user_id, user_name, role, action, entity, entity_id, details, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(...p);
  await insAudit(uid(), uRatna, 'Ratna Dewi', 'customer', 'CREATE', 'ticket', t3, 'Membuat ticket TKT-2026-000003', '127.0.0.1', iso(0, 8, 20));
  await insAudit(uid(), uAdmin, 'Andi Wijaya', 'admin', 'UPDATE', 'ticket', t4, 'Review ticket TKT-2026-000004', '127.0.0.1', iso(0, 7, 30));
  await insAudit(uid(), uBudi, 'Budi Santoso', 'technician', 'UPDATE', 'work_order', wo2, 'Memulai work order WO-2026-000002', '127.0.0.1', iso(0, 9, 10));

  // ---------- Sequence counters ----------
  const year = new Date().getFullYear();
  const setSeq = (key, val) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = ?').run(key, val, val);
  await setSeq(`seq:TKT:${year}`, '4');
  await setSeq(`seq:WO:${year}`, '2');
  await setSeq(`seq:SR:${year}`, '1');
  await setSeq(`seq:INV:${year}`, '1');
  await setSeq(`seq:CUS:${year}`, '3');
  await setSeq(`seq:PRT:${year}`, '8');

  return true;
}

module.exports = { seed };
