-- Migration 004: catat kontak yang DIBUAT oleh import segmentasi
-- Dipakai fitur "Reset Data": hanya kontak yang dibuat oleh import yang boleh ikut dihapus;
-- kontak yang sudah ada sebelumnya tidak pernah disentuh. Penanda ini sengaja terpisah dari
-- tabel prospects supaya tetap ada setelah Reset biasa (kontak dipertahankan) dan masih bisa
-- dibersihkan belakangan. Additive & idempotent.

CREATE TABLE IF NOT EXISTS segmentation_contacts (
    contact_id  INTEGER PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_segmentation_contacts_user ON segmentation_contacts(user_id);

-- Versi awal migrasi ini memakai kolom di prospects; dibuang bila ada (aman dijalankan berulang)
ALTER TABLE prospects DROP COLUMN IF EXISTS contact_created;
