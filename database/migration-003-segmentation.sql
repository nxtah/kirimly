-- Migration 003: Segmentasi calon mahasiswa (K-Means)
-- Additive only — tidak menyentuh tabel yang sudah ada. Idempotent (aman dijalankan berulang).
-- Run: psql -U postgres -d kirimly -f database/migration-003-segmentation.sql
--      (atau otomatis lewat: cd backend && npm run db:setup)

-- 1. PROSPECTS — calon mahasiswa beserta atribut clustering (nilai sudah dibersihkan/distandarisasi)
CREATE TABLE IF NOT EXISTS prospects (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_id      INTEGER      REFERENCES contacts(id) ON DELETE SET NULL,
    phone_number    VARCHAR(20)  NOT NULL,
    name            VARCHAR(150) NOT NULL,
    program_studi   VARCHAR(150) NOT NULL,
    asal_sekolah    VARCHAR(150) NOT NULL,
    jurusan_sekolah VARCHAR(150) NOT NULL,
    domisili        VARCHAR(150) NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_prospects_user_phone UNIQUE (user_id, phone_number)
);

CREATE INDEX IF NOT EXISTS idx_prospects_user_id    ON prospects(user_id);
CREATE INDEX IF NOT EXISTS idx_prospects_contact_id ON prospects(contact_id);

-- 2. CLUSTER RUNS — satu baris per eksekusi K-Means (riwayat/snapshot)
CREATE TABLE IF NOT EXISTS cluster_runs (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        VARCHAR(150),
    k           INTEGER      NOT NULL,
    n_samples   INTEGER      NOT NULL,
    inertia     DOUBLE PRECISION,
    silhouette  DOUBLE PRECISION,
    iterations  INTEGER,
    seed        INTEGER,
    params      JSONB,       -- atribut & kategori one-hot yang dipakai
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cluster_runs_user_id ON cluster_runs(user_id, created_at DESC);

-- 3. CLUSTER SEGMENTS — satu baris per cluster dalam sebuah run
CREATE TABLE IF NOT EXISTS cluster_segments (
    id          SERIAL PRIMARY KEY,
    run_id      INTEGER      NOT NULL REFERENCES cluster_runs(id) ON DELETE CASCADE,
    cluster_no  INTEGER      NOT NULL,
    size        INTEGER      NOT NULL,
    profile     JSONB        NOT NULL,   -- karakteristik dominan per atribut

    CONSTRAINT uq_cluster_segments_run_no UNIQUE (run_id, cluster_no)
);

-- 4. CLUSTER MEMBERS — anggota tiap cluster
CREATE TABLE IF NOT EXISTS cluster_members (
    segment_id  INTEGER NOT NULL REFERENCES cluster_segments(id) ON DELETE CASCADE,
    prospect_id INTEGER NOT NULL REFERENCES prospects(id)        ON DELETE CASCADE,
    PRIMARY KEY (segment_id, prospect_id)
);

CREATE INDEX IF NOT EXISTS idx_cluster_members_prospect ON cluster_members(prospect_id);

-- 5. Trigger updated_at (fungsi update_updated_at() dibuat oleh schema.sql)
DROP TRIGGER IF EXISTS trg_prospects_updated_at ON prospects;
CREATE TRIGGER trg_prospects_updated_at
    BEFORE UPDATE ON prospects FOR EACH ROW EXECUTE FUNCTION update_updated_at();
