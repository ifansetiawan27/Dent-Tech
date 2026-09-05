# AGENTS.md — Dent Tech.id

Catatan kerja untuk agent/developer. Ikuti aturan di bawah sebelum mengubah apapun.

## Production

- Production berjalan di **https://denttech.id** (Cloudflare Workers, deploy otomatis via GitHub Actions saat push ke `main`).
- `.env` lokal menunjuk ke **database Supabase yang sama dengan production**. Semua operasi DB via script lokal berdampak langsung ke production.

## Akun admin production

- **Email:** `support@denttech.id`
- **Password:** `admin123`
- **Role:** `admin` (Supabase Auth + tabel `users`, `password_hash = 'supabase-auth'`)
- Ini adalah SATU-SATUNYA akun production. Jangan menghapus, menonaktifkan, mengganti email/password tanpa instruksi eksplisit user.
- Akun admin di `backend/seed.js` (environment demo/test) menggunakan akun yang sama agar konsisten.

## Database demo — DILARANG di production

- Production berfokus pada data nyata. Jangan pernah membuat, men-seed, atau memunculkan data demo di production.
- `reset_db.js` (menghapus seluruh database) kini **menolak berjalan** tanpa flag `--demo`. Flag hanya boleh dipakai ketika `.env` menunjuk ke database testing terpisah.
- `node audit.js` memanggil `reset_db.js --demo` antar-suite — sama berbahayanya. Hanya jalankan di database testing.
- `test_wallet_ui.js` sepenuhnya mock (tidak menulis DB) — aman dijalankan kapan pun.
- Suite lain (test_flow, test_features2, test_browser, dll.) memerlukan data demo dan menulis data — hanya di database testing.
- Jika production perlu dibersihkan dari data uji, gunakan purge yang menyisakan: akun `support@denttech.id`, checklist templates, master parts, settings (minta user/konfirmasi dulu).

## Verifikasi perubahan

1. `node --check` semua file yang diubah.
2. `npm run deploy:worker:dry` untuk memvalidasi bundle Worker (CI juga menjalankan ini sebelum deploy).
3. Untuk cek UI 3 portal secara aman: `node test_wallet_ui.js` (mock) + smoke test read-only di https://denttech.id.
