-- Migration 009: Evaluation Mode multi-trial (alpha/seed/n_contexts/n_trials terkonfigurasi,
-- statistik mean/std/CI95/regret rata-rata di seluruh percobaan). Additive only — tidak
-- mengubah cmab_models/cmab_decisions/tabel modul lain. Idempotent.

ALTER TABLE cmab_simulations ADD COLUMN IF NOT EXISTS alpha DOUBLE PRECISION;
ALTER TABLE cmab_simulations ADD COLUMN IF NOT EXISTS n_trials INTEGER NOT NULL DEFAULT 1;
ALTER TABLE cmab_simulations ADD COLUMN IF NOT EXISTS trials JSONB;              -- [{trial_index, seed, linucb_total, baseline_total, regret}]
ALTER TABLE cmab_simulations ADD COLUMN IF NOT EXISTS linucb_std DOUBLE PRECISION;
ALTER TABLE cmab_simulations ADD COLUMN IF NOT EXISTS linucb_ci_low DOUBLE PRECISION;
ALTER TABLE cmab_simulations ADD COLUMN IF NOT EXISTS linucb_ci_high DOUBLE PRECISION;
ALTER TABLE cmab_simulations ADD COLUMN IF NOT EXISTS baseline_std DOUBLE PRECISION;
ALTER TABLE cmab_simulations ADD COLUMN IF NOT EXISTS baseline_ci_low DOUBLE PRECISION;
ALTER TABLE cmab_simulations ADD COLUMN IF NOT EXISTS baseline_ci_high DOUBLE PRECISION;
ALTER TABLE cmab_simulations ADD COLUMN IF NOT EXISTS improvement_pct DOUBLE PRECISION;
ALTER TABLE cmab_simulations ADD COLUMN IF NOT EXISTS std_regret DOUBLE PRECISION;

-- Kolom lama (linucb_total, baseline_total, regret) tetap ada dan sekarang diisi dengan
-- nilai RATA-RATA di seluruh trial (konsisten dengan linucb_std/baseline_std di atas), supaya
-- baris lama (single-trial, dari sebelum migrasi ini) tetap terbaca dengan makna yang sama.
