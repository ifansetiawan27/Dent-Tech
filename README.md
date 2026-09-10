# Dent Tech — Service Management System (SMS)

Aplikasi web manajemen operasional service end-to-end dengan **tiga portal** (Admin, Technician, Customer) yang berbagi satu sumber data yang sama. Dibangun berdasarkan `PRD.md` dan `UI_UX_SPECIFICATION.md`.

> **Prinsip utama:** setiap aktivitas service dapat dilacak — dari request customer hingga riwayat service.
> 
> **Alur:** Customer Request → Ticket → Review → Assignment → Schedule → Technician Visit → Checklist → Diagnosis → Photos → Parts → Service Report → Approval → Invoice → Payment → Service History

🔗 **[Production](https://denttech.id)** · 📖 [PRD](./PRD.md) · 📋 [UI/UX Spec](./UI_UX_SPECIFICATION.md)

---

## Table of Contents

- [Teknologi](#teknologi)
- [Prasyarat & Setup](#prasyarat--setup)
- [Menjalankan](#menjalankan)
- [Akun Demo](#akun-demo)
- [Struktur Proyek](#struktur-proyek)
- [Fitur per Portal](#fitur-per-portal)
- [Aturan Bisnis & Keamanan](#aturan-bisnis--keamanan)
- [Testing](#testing)
- [Reset Data Demo](#reset-data-demo)
- [Batasan MVP](#batasan-mvp)

---

## Teknologi

| Layer | Teknologi | Catatan |
|---|---|---|
| Frontend | HTML5 + Tailwind CSS (CDN) + Vanilla JS (ES Modules) | Sesuai UI_UX_SPECIFICATION |
| Backend | Node.js (HTTP server bawaan, **tanpa dependensi npm**) | Sesuai arah PRD: JavaScript/Node.js |
| Database | SQLite relasional via `node:sqlite` (built-in Node ≥ 22.5) | File: `data/sms.db` |
| Auth | Token-based + RBAC 3 role | Password di-hash dengan scrypt |

> **Catatan:** PRD menyebut "Node.js", dokumen UI/UX menyebut "Python REST API". Implementasi ini memilih **Node.js** sesuai PRD (dokumen utama) dan diagram arsitektur PRD, agar seluruh stack sama-bahasa, serta deployment & maintenance lebih sederhana.

---

## Prasyarat & Setup

**Persyaratan:**
- Node.js v22.5+ (disarankan v24)
- Tidak perlu `npm install` — semua built-in modules

**Clone & install:**
```bash
git clone https://github.com/ifansetiawan27/Dent-Tech.git
cd Dent-Tech
```

---

## Menjalankan

```bash
node backend/server.js
# atau: npm start
```

Buka **http://localhost:3000** di browser.

> **Database production (Supabase):** tidak pernah di-seed otomatis. Untuk pengembangan lokal dengan data demo, jalankan reset eksplisit (lihat [Reset Data Demo](#reset-data-demo)).

---

## Akun Demo

| Role | Email | Password |
|---|---|---|
| Admin | `support@denttech.id` | `admin123` |
| Technician | `budi@denttech.id` | `tech123` |
| Technician | `sari@denttech.id` | `tech123` |
| Customer (Klinik Senyum Sehat) | `ratna@denttech.id` | `customer123` |
| Customer (RS Medika Farma) | `hendra@denttech.id` | `customer123` |

⚠️ **PERHATIAN:** Akun admin (`support@denttech.id`) sama dengan **akun production** (https://denttech.id). **Jangan pernah** menghapus atau menonaktifkannya.

---

## Struktur Proyek

```
Dent Tech/
├── PRD.md                      # Product Requirements Document
├── UI_UX_SPECIFICATION.md      # Spesifikasi UI/UX
├── README.md                   # File ini
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
├── test_flow.js                # 11 test alur bisnis penuh via UI
├── test_newfeatures.js         # 10 test fitur portal
├── test_features2.js           # 28 test fitur baru
├── visual_audit.js             # 11 audit visual/DOM
├── test_wallet_ui.js           # UI wallet (fully mocked, AMAN untuk production)
├── audit.js                    # Runner semua test suite
├── reset_db.js                 # Reset database & seed demo
└── package.json
```

---

## Fitur per Portal

### 📊 Admin Portal (Desktop, Sidebar)

- **Dashboard** — KPI, grafik status & pendapatan, jadwal hari ini, aktivitas terbaru
- **Tickets** — buat/review/assign/batalkan + edit/revisi ticket; detail dengan timeline, komentar customer & catatan internal
- **Work Orders** — monitor pekerjaan, bukti (checklist, diagnosis, part, foto), approve/revisi laporan, download checklist terisi (PDF), buat Proforma Invoice
- **Schedule** — jadwal kunjungan per tanggal
- **Customers** — CRUD + multi-kontak
- **Equipment** — CRUD + status unit
- **Technicians & Users** — manajemen akun 3 role
- **Checklist Library** — 21 template checklist sesuai jenis equipment dental (Dental Unit, Compressor, Autoclave, X-Ray, 3D Printer, dll) dengan item detail & versioning; auto-match template ke equipment
- **Spare Parts** — stok, harga, penyesuaian stok, indikator stok menipis
- **Invoices** — dibuat otomatis saat laporan disetujui; edit biaya, tandai dibayar, download (PDF); Pengaturan Invoice (mode PPN/Non-PPN + biaya jasa default); Proforma Invoice (PI)
- **Reports** — rekapan keseluruhan (ticket, pendapatan, jenis service/equipment, performa teknisi, part, customer), filter tanggal/bulan/tahun, download laporan (PDF)
- **Audit Log** — jejak seluruh aktivitas penting
- **Settings** — profil & ubah password

### 📱 Technician Portal (Mobile-First, Bottom Nav)

- Job hari ini & mendatang
- Eksekusi job: **Mulai → Checklist (PASS/FAIL/NA) → Diagnosis → Pekerjaan → Spare Part → Foto Before/After → Selesai**
- Checklist yang diisi tersinkron ke portal admin & customer (customer melihat setelah laporan disetujui)
- Validasi penyelesaian: checklist wajib lengkap, diagnosis, pekerjaan, foto AFTER
- Kirim laporan ke admin; revisi bila diminta

### 👥 Customer Portal (Mobile-First, Bottom Nav)

- Request service — pilih jenis equipment dari 21 kategori dental (Dental Unit, Compressor, Autoclave, X-Ray, 3D Printer, dll), isi Merk/Tipe bebas, serta Alamat Service (otomatis tersimpan)
- Pantau progress dengan status stepper & timeline
- Lihat teknisi & jadwal
- Lihat checklist pengecekan teknisi & service report (setelah disetujui admin)
- Invoice, konfirmasi pembayaran, download invoice (PDF) — invoice berlampiran foto before/after + checklist pengerjaan teknisi
- Ubah foto profil (tampil sebagai avatar)
- Daftar equipment + riwayat service per unit

---

## Aturan Bisnis & Keamanan

✅ Sesuai dokumen PRD & UI_UX_SPECIFICATION

- **RBAC ketat di server** — customer hanya dapat mengakses data miliknya; endpoint memfilter per role
- **Visibilitas evidence** — catatan `INTERNAL` tidak pernah bocor ke API customer (diverifikasi test)
- **Service report gate** — customer baru bisa melihat laporan setelah status `APPROVED`
- **Checklist versioning** — work order menyimpan snapshot item template saat assignment
- **Nomor urut otomatis** — `TKT-2026-000001`, `WO-…`, `SR-…`, `INV-…`, `PI-…` (Proforma)
- **Stok part** — pemakaian part memotong stok; pembatalan mengembalikan stok; validasi stok kurang
- **Foto bertanda tangan (signed URL)** — akses file diverifikasi per user/visibility
- **Audit log** — login, CRUD, perubahan status, pembayaran tercatat

---

## Testing

### ⚠️ PERINGATAN PENTING

`.env` menunjuk ke **database production**. Suite yang melakukan reset DB (`node audit.js`, `node reset_db.js --demo`) akan **MENGHAPUS SEMUA DATA PRODUCTION**. Hanya jalankan di environment testing atau local development dengan database terpisah.

### Jalankan Test

```bash
# Jalankan SEMUA suite audit (reset DB per suite — HANYA di database testing!)
node audit.js

# Atau per-suite individual:
powershell -ExecutionPolicy Bypass -File test_api.ps1   # 27 API end-to-end
node test_browser.js       # 31 render halaman 3 portal
node test_flow.js          # 11 alur bisnis penuh via UI
node test_newfeatures.js   # 10 fitur portal
node test_features2.js     # 28 fitur baru
node visual_audit.js       # 11 audit visual/DOM
node test_wallet_ui.js     # UI wallet (fully mocked, AMAN untuk production)
```

**Status terakhir (audit menyeluruh):** ✅ **97/97 test PASS**
- 27 API end-to-end
- 31 render halaman
- 11 alur bisnis
- 28 fitur baru
- 11 audit visual

> Test browser membutuhkan Google Chrome terpasang (path di-set di tiap file test).

---

## Reset Data Demo

Reset database dan isi ulang data demo — **HANYA untuk database testing**, tidak pernah untuk production:

```bash
node reset_db.js --demo
```

Tanpa flag `--demo`, script menolak dijalankan sebagai pengaman terhadap database production.

---

## Batasan MVP

Sesuai PRD §10:

- ❌ AI out of scope (fase berikutnya)
- ❌ Notifikasi masih in-app (email/WhatsApp untuk fase berikutnya)
- ℹ️ Informasi perusahaan pada Settings bersifat read-only dari seed

---

**Last Updated:** 2026-09-10  
**Status:** MVP Production-Ready
