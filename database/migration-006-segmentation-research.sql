-- Migration 006: dukungan penelitian segmentasi (metrik lengkap + riwayat preprocessing)
-- Additive only — tidak mengubah kolom/tabel yang sudah dipakai modul Campaign. Idempotent.

-- 1. Metrik & snapshot per eksekusi clustering
ALTER TABLE cluster_runs ADD COLUMN IF NOT EXISTS davies_bouldin DOUBLE PRECISION;
ALTER TABLE cluster_runs ADD COLUMN IF NOT EXISTS evaluation     JSONB;  -- tabel K 2..6 (SSE, Silhouette, DBI) + rekomendasi saat run
ALTER TABLE cluster_runs ADD COLUMN IF NOT EXISTS preprocessing  JSONB;  -- ringkasan preprocessing saat run

-- 2. Riwayat import (bukti preprocessing: total awal, valid, invalid, duplikat, missing, normalisasi)
CREATE TABLE IF NOT EXISTS segmentation_imports (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_name     VARCHAR(255),
    sheets          JSONB,                         -- [{name, rows, used}]
    total_rows      INTEGER      NOT NULL DEFAULT 0,
    valid_rows      INTEGER      NOT NULL DEFAULT 0,
    invalid_rows    INTEGER      NOT NULL DEFAULT 0,
    duplicate_rows  INTEGER      NOT NULL DEFAULT 0,
    missing         JSONB,                         -- {program_studi: n, asal_sekolah: n, ...}
    normalization   JSONB,                         -- laporan normalisasi (asli -> baku, jumlah, status)
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_segmentation_imports_user ON segmentation_imports(user_id, created_at DESC);
