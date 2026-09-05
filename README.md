# Dent Tech — Service Management System (SMS)

Aplikasi web manajemen operasional service end-to-end dengan **tiga portal** (Admin, Technician, Customer) yang berbagi satu sumber data yang sama. Dibangun berdasarkan `PRD.md` dan `UI_UX_SPECIFICATION.md`.

> **Prinsip utama:** setiap aktivitas service dapat dilacak — dari request customer hingga riwayat service.
> `Customer Request → Ticket → Review → Assignment → Schedule → Technician Visit → Checklist → Photos → Parts → Service Report → Approval → Invoice → Payment → Service History`

---

## Teknologi

| Layer | Teknologi | Catatan |
|---|---|---|
| Frontend | HTML5 + Tailwind CSS (CDN) + Vanilla JS (ES Modules) | Sesuai UI_UX_SPECIFICATION |
| Backend | Node.js (HTTP server bawaan, **tanpa dependensi npm**) | Sesuai arah PRD: JavaScript/Node.js |
| Database | SQLite relasional via `node:sqlite` (built-in Node ≥ 22.5) | File: `data/sms.db` |
| Auth | Token-based + RBAC 3 role | Password di-hash dengan scrypt |

> Catatan: PRD menyebut "Node.js", dokumen UI/UX menyebut "Python REST API". Implementasi ini memilih **Node.js** sesuai PRD (dokumen utama) dan diagram arsitektur PRD, serta agar seluruh stack satu bahasa dan bebas instalasi dependensi.

**Prasyarat:** hanya Node.js v22.5+ (disarankan v24). Tidak perlu `npm install` untuk menjalankan aplikasi.

---

## Menjalankan

```bash
node backend/server.js
# atau: npm start
```

Buka **http://localhost:3000**

Database production (Supabase) **tidak pernah** di-seed otomatis oleh server. Untuk pengembangan lokal dengan data demo, jalankan reset eksplisit (lihat bagian [Testing](#testing)).

### Akun demo

| Role | Email | Password |
|---|---|---|
| Admin | `support@denttech.id` | `admin123` |
| Technician | `budi@denttech.id` | `tech123` |
| Technician | `sari@denttech.id` | `tech123` |
| Customer (Klinik Senyum Sehat) | `ratna@denttech.id` | `customer123` |
| Customer (RS Medika Farma) | `hendra@denttech.id` | `customer123` |

> **Penting:** akun admin ini sama dengan **akun production** (https://denttech.id). Jangan pernah menghapus atau menonaktifkannya.

---

## Struktur Proyek

```
Dent Tech/
├── PRD.md                      # Product Requirements Document
├── UI_UX_SPECIFICATION.md      # Spesifikasi UI/UX
├── backend/
│   ├── server.js               # HTTP server + router + static serving
│   ├── db.js                   # Schema SQLite (relasional)
│   ├── seed.js                 # Seed data demo
│   ├── auth.js                 # Login, token, RBAC
│   ├── util.js                 # Helper (hash, numbering, signed URL, dll)
│   └── handlers/
│       ├── _common.js          # Business rules bersama (status, notify, audit)
│       ├── auth.js             # Auth + users
│       ├── master.js           # Customers, equipment, parts, checklist templates
│       ├── tickets.js          # Ticket lifecycle, timeline, komentar
│       ├── workorders.js       # Eksekusi job teknisi
│       ├── reports.js          # Service report + analytics
│       ├── invoices.js         # Billing & pembayaran
│       ├── dashboard.js        # Dashboard, notifikasi, audit log
│       └── files.js            # Upload/unduh foto (signed URL)
├── frontend/
│   ├── index.html              # Login page
│   ├── admin/                  # Admin Portal (13 halaman)
│   ├── technician/             # Technician Portal (mobile-first)
│   ├── customer/               # Customer Portal (mobile-first)
│   ├── components/             # ui.js (toast/modal/badge), layout.js
│   ├── services/api.js         # API client
│   ├── utils/                  # auth.js, format.js
│   └── styles/app.css
├── data/                       # SQLite + upload files (dibuat otomatis)
├── test_api.ps1                # 27 test API end-to-end
├── test_browser.js             # 31 test halaman (headless Chrome)
└── test_flow.js                # 11 test alur bisnis penuh via UI
```

---

## Fitur per Portal

### Admin Portal (desktop, sidebar)
- **Dashboard** — KPI, grafik status & pendapatan, jadwal hari ini, aktivitas terbaru
- **Tickets** — buat/review/assign/batalkan + **edit/revisi ticket**; detail dengan timeline, komentar customer & catatan internal
- **Work Orders** — monitor pekerjaan, bukti (checklist, diagnosis, part, foto), approve/revisi laporan, **download checklist terisi (PDF)**, **buat Proforma Invoice**
- **Schedule** — jadwal kunjungan per tanggal
- **Customers** — CRUD + multi-kontak
- **Equipment** — CRUD + status unit
- **Technicians & Users** — manajemen akun 3 role
- **Checklist Library** — **21 template checklist sesuai jenis equipment dental** (Dental Unit, Compressor, Autoclave, X-Ray, 3D Printer, dll) dengan item detail & versioning; auto-match template saat assign berdasarkan jenis equipment ticket
- **Spare Parts** — stok, harga, penyesuaian stok, indikator stok menipis
- **Invoices** — dibuat otomatis saat laporan disetujui; edit biaya, tandai dibayar, **download (PDF)**; **Pengaturan Invoice** (mode PPN/Non-PPN + biaya jasa default); **Proforma Invoice (PI)** untuk penagihan dengan lampiran foto & checklist, watermark merah transparan "BELUM LUNAS" → hijau "LUNAS" setelah dibayar
- **Reports** — rekapan keseluruhan (ticket, pendapatan, jenis service/equipment, performa teknisi, part, customer), **filter tanggal/bulan/tahun**, **download laporan (PDF)**
- **Audit Log** — jejak seluruh aktivitas penting
- **Settings** — profil & ubah password

### Technician Portal (mobile-first, bottom nav)
- Job hari ini & mendatang
- Eksekusi job: **Mulai → Checklist (PASS/FAIL/NA) → Diagnosis → Pekerjaan → Spare Part → Foto Before/After → Selesai**
- Checklist yang diisi **tersinkron ke portal admin & customer** (customer melihat setelah laporan disetujui)
- Validasi penyelesaian: checklist wajib lengkap, diagnosis, pekerjaan, foto AFTER
- Kirim laporan ke admin; revisi bila diminta

### Customer Portal (mobile-first, bottom nav)
- Request service — pilih **jenis equipment** dari 21 kategori dental (Dental Unit, Compressor, Autoclave, X-Ray, 3D Printer, dll), isi **Merk/Tipe** bebas, serta **Alamat Service** (otomatis terisi dari alamat customer)
- Pantau progress dengan **status stepper** & timeline
- Lihat teknisi & jadwal
- Lihat **checklist pengecekan teknisi** & service report (setelah disetujui admin)
- Invoice, konfirmasi pembayaran, & **download invoice (PDF)** — invoice sudah berlampiran **foto before/after + checklist pengerjaan teknisi**
- **Ubah foto profil** (tampil sebagai avatar)
- Daftar equipment + riwayat service per unit

---

## Aturan Bisnis & Keamanan (sesuai dokumen)

- **RBAC ketat di server** — customer hanya dapat mengakses data miliknya; endpoint memfilter per role.
- **Visibilitas evidence** — catatan `INTERNAL` tidak pernah bocor ke API customer (diverifikasi test).
- **Service report gate** — customer baru bisa melihat laporan setelah status `APPROVED`.
- **Checklist versioning** — work order menyimpan snapshot item template saat assignment.
- **Nomor urut otomatis** — `TKT-2026-000001`, `WO-…`, `SR-…`, `INV-…`, `PI-…` (Proforma).
- **Stok part** — pemakaian part memotong stok; pembatalan mengembalikan stok; validasi stok kurang.
- **Foto bertanda tangan (signed URL)** — akses file diverifikasi per user/visibility.
- **Audit log** — login, CRUD, perubahan status, pembayaran tercatat.

---

## Testing

> **PERINGATAN:** `.env` menunjuk ke **database production**. Suite yang melakukan reset DB (`node audit.js`, `node reset_db.js --demo`) akan MENGHAPUS semua data production. Hanya jalankan jika `.env` sudah diarahkan ke database testing terpisah.

```bash
# Jalankan SEMUA suite audit (reset DB per suite — HANYA di database testing!)
node audit.js

# Atau per-suite:
powershell -ExecutionPolicy Bypass -File test_api.ps1   # API end-to-end (27)
node test_browser.js      # Render semua halaman 3 portal (31)
node test_flow.js         # Alur bisnis penuh via UI (11)
node test_newfeatures.js  # Fitur portal: request/merk/alamat, foto profil, download (10)
node test_features2.js    # Fitur baru: checklist 21, sync, edit ticket, proforma, filter report (28)
node visual_audit.js      # Audit visual/DOM (11)
node test_wallet_ui.js    # UI wallet (fully mocked, AMAN untuk production)
```

Status terakhir (audit menyeluruh): **97/97 test PASS** — 27 API · 31 halaman · 11 alur · 28 fitur baru (+ 11 audit visual).

> Test browser membutuhkan Google Chrome terpasang (path di-set di tiap file test `CHROME`).

---

## Reset Data Demo

Reset database dan isi ulang data demo — **hanya untuk database testing**, tidak pernah untuk production:

```bash
node reset_db.js --demo
```

Tanpa flag `--demo`, script menolak dijalankan sebagai pengaman terhadap database production.

---

## Batasan MVP (sesuai PRD §10)

- AI out of scope (fase berikutnya).
- Notifikasi masih in-app (email/WhatsApp untuk fase berikutnya).
- Informasi perusahaan pada Settings bersifat read-only dari seed.
#   D e n t T e c h  
 