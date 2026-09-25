-- Migration 007: tandai baris prospek dengan import yang membuatnya, supaya baris ganda
-- antar-batch pada import yang sama terdeteksi & tidak dihitung dua kali. Additive, idempotent.
ALTER TABLE prospects ADD COLUMN IF NOT EXISTS import_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_prospects_import ON prospects (user_id, import_id);
