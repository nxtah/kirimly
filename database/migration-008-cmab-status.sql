-- Migration 008: kolom status eksplisit untuk CMAB (manual_override, reward_status)
-- + tabel evaluation mode (simulasi LinUCB vs baseline, terisolasi dari data kampanye nyata).
-- Additive only — tidak mengubah kolom/tabel yang sudah dipakai modul CMAB. Idempotent.

-- 1. Status eksplisit per keputusan
ALTER TABLE cmab_decisions ADD COLUMN IF NOT EXISTS manual_override BOOLEAN;
ALTER TABLE cmab_decisions ADD COLUMN IF NOT EXISTS reward_status VARCHAR(20) NOT NULL DEFAULT 'pending';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_cmab_decisions_reward_status'
  ) THEN
    ALTER TABLE cmab_decisions
      ADD CONSTRAINT chk_cmab_decisions_reward_status CHECK (reward_status IN ('pending', 'computed'));
  END IF;
END $$;

-- Backfill baris lama dari kolom yang sudah ada (bukan dari asumsi baru)
UPDATE cmab_decisions SET reward_status = 'computed' WHERE reward_computed_at IS NOT NULL AND reward_status <> 'computed';
UPDATE cmab_decisions SET manual_override = (selected_template_id IS DISTINCT FROM recommended_template_id)
  WHERE blast_id IS NOT NULL AND manual_override IS NULL;

-- 2. Evaluation mode: hasil simulasi LinUCB vs baseline statis pada context/arm SINTETIS.
--    Sengaja TANPA foreign key ke templates/cmab_models — tidak boleh tercampur ke data kampanye nyata.

-- Perbaikan tipe kolom `seed` bila migrasi ini sempat dijalankan sebelum diperbaiki ke BIGINT
-- (Date.now() melebihi rentang int4). Aman dijalankan berkali-kali; no-op bila tabel belum ada.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cmab_simulations' AND column_name = 'seed' AND data_type = 'integer'
  ) THEN
    ALTER TABLE cmab_simulations ALTER COLUMN seed TYPE BIGINT;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS cmab_simulations (
    id                          SERIAL PRIMARY KEY,
    user_id                     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    n_contexts                  INTEGER      NOT NULL,
    seed                        BIGINT       NOT NULL,  -- default seed = Date.now(), melebihi rentang int4
    arms                        JSONB        NOT NULL,   -- [{name, ...}] arm sintetis (bukan template asli)
    linucb_cumulative_reward    JSONB        NOT NULL,    -- seri kumulatif per langkah
    baseline_cumulative_reward  JSONB        NOT NULL,
    linucb_total                DOUBLE PRECISION NOT NULL,
    baseline_total               DOUBLE PRECISION NOT NULL,
    regret                       DOUBLE PRECISION NOT NULL,
    created_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cmab_simulations_user ON cmab_simulations(user_id, created_at DESC);
