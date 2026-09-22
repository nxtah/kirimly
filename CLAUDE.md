# Kirimly Project — Developer Notes

## ⚠️ CRITICAL: Frontend CWD rule
Semua perintah Next.js WAJIB dijalankan dari `/mnt/IMPORTANTE/natah/PROJECTS/kirimly/frontend`.
Jangan pernah dari root project — itu bikin `.next/` corrupt & 404 CSS/JS.

```bash
cd /mnt/IMPORTANTE/natah/PROJECTS/kirimly/frontend
npm run dev      # ✅
npx next build   # ✅
```

## Apa ini
Kirimly = broadcast WhatsApp multi-tenant. Backend Express + Baileys + PostgreSQL (`backend/`),
frontend Next.js 14 App Router (`frontend/`). Role `admin` (login `/admin/login`) kelola user & monitoring;
role `user` (login `/login`) connect WhatsApp via QR lalu kirim blast per wave ke kontaknya.

## Run project (dari root repo)
```bash
npm run setup          # sekali: install semua + bikin backend/.env & frontend/.env.local
npm run dev:embedded   # DB (Postgres embedded, tanpa install) + backend :3001 + frontend :3000
npm run dev            # sama, tapi pakai Postgres sendiri (isi DB_* di backend/.env)
npm test               # integration test backend (DB terpisah: kirimly_test, WA socket dipalsukan)
```
Admin default (dev): `admin` / `admin123` (dari `ADMIN_USERNAME`/`ADMIN_PASSWORD` di `backend/.env`).
Schema/migrasi/admin dibuat otomatis oleh `npm run db:setup` (idempotent). Migrasi baru: `database/migration-NNN-*.sql`.

## Gotchas
- Versi WhatsApp Web bawaan Baileys cepat usang → `waSessionManager` ambil versi terbaru via `fetchLatestBaileysVersion`. Kalau QR tidak keluar / `Connection Failure`, cek ini dulu.
- `authMiddleware` cek `users.is_active` ke DB tiap request (user nonaktif langsung kehilangan akses).
- Blast berjalan in-process (tanpa queue): restart server = blast `sending` di-cancel, pesan pending jadi failed. Blast terjadwal aman & jalan lagi begitu sesi WA tersambung.
- Counter `blasts.delivered_count/read_count` di-recount dari `blast_messages` oleh `messageTrackingService` (kumulatif; read ⇒ delivered).
- Kontak `is_blocked` otomatis dilewati saat blast.
- `npm test` berjalan serial (`--test-concurrency=1`): semua file test berbagi DB `kirimly_test`, dan test orphan-cleanup membatalkan semua blast `sending` secara global.
- `npm run dev` tanpa auto-reload (file watcher bisa restart sendiri di folder OneDrive dan memutus sesi WA); pakai `npm run dev:watch` di `backend/` bila butuh hot-reload.

## Segmentasi calon mahasiswa (K-Means) — fitur tambahan, modular
- Halaman `/segmentation` (nav "Segments"): import CSV (termasuk ekspor Google Form) → cleaning → K-Means → kartu cluster (nomor, jumlah anggota, karakteristik dominan) → tombol Kirim Blast → `/blast/new?run=<id>&cluster=<no>` mengisi wave otomatis (maks 3×20, yang belum pernah dikirimi didahulukan).
- Backend terisolasi di `backend/src/segmentation/` (fungsi murni: `normalize`, `validate`, `oneHot`, `kmeans`, `silhouette`, `profile`; DB di `service.js`), route `/api/segmentation/*`, migrasi `database/migration-003-segmentation.sql` (tabel `prospects`, `cluster_runs`, `cluster_segments`, `cluster_members`). Tidak mengubah tabel/route lama.
- Variabel clustering hanya: program studi, asal sekolah, jurusan sekolah, domisili (One-Hot; kategori langka → "Lainnya"). Nama & nomor hanya identitas.
- Import otomatis meng-upsert `contacts` (nama kontak yang sudah ada tidak ditimpa) sehingga pipeline blast dipakai apa adanya. Import dikirim per batch 500 baris (body parser global 1 MB).
- **Reset Data** (`DELETE /api/segmentation/prospects[?delete_contacts=true]`): hapus semua prospek + hasil cluster user; opsional hapus kontak yang DIBUAT oleh import. Kontak hasil import dicatat di tabel `segmentation_contacts` (migrasi 004, sengaja terpisah dari `prospects` agar penanda tidak hilang saat Reset biasa); kontak yang sudah ada sebelum import tidak pernah dihapus, riwayat blast tetap (`blast_messages.contact_id` → NULL). Dialog import punya pilihan tambah / ganti data lama.
- K-Means ber-seed (reproducible), K-Means++ + 10 restart. Silhouette dihitung pada sampel bila n > 1500. K yang mungkin dibatasi jumlah pola unik data.
- Frontend: `frontend/src/lib/segmentation.ts` (tipe + deteksi kolom CSV), komponen di `frontend/src/components/segmentation/`. `useSearchParams` di `blast/new` dibungkus `<Suspense>` (wajib agar `next build` lolos).
