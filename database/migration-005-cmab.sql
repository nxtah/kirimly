-- Migration 005: CMAB (LinUCB) optimization layer untuk pemilihan template
-- Additive only — tidak menyentuh tabel blast/template/contact yang ada. Idempotent.

-- 1. LinUCB model per (user_id, template_id) = satu "arm". Dibuat lazy saat pertama dipakai.
CREATE TABLE IF NOT EXISTS cmab_models (
    id                  SERIAL PRIMARY KEY,
    user_id             INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_id         INTEGER      NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    dimension           INTEGER      NOT NULL,               -- panjang context vector (19 di MVP ini)
    a_matrix            JSONB        NOT NULL,                -- d×d, array-of-arrays; mulai = identitas
    b_vector            JSONB        NOT NULL,                -- d, array; mulai = nol
    observation_count    INTEGER      NOT NULL DEFAULT 0,      -- jumlah blast selesai yang sudah dipakai untuk update
    cumulative_reward   NUMERIC      NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_cmab_models_user_template UNIQUE (user_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_cmab_models_user ON cmab_models(user_id);

-- 2. Decision log: satu baris per pemanggilan rekomendasi, di-update di tempat
--    seiring lifecycle-nya (recommend -> link ke blast -> reward dihitung).
CREATE TABLE IF NOT EXISTS cmab_decisions (
    id                        SERIAL PRIMARY KEY,
    user_id                   INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blast_id                  INTEGER      REFERENCES blasts(id) ON DELETE SET NULL,
    recommended_template_id   INTEGER      REFERENCES templates(id) ON DELETE SET NULL,
    selected_template_id      INTEGER      REFERENCES templates(id) ON DELETE SET NULL,
    context                   JSONB        NOT NULL,   -- {day_of_week, hour, hour_bucket, audience_label, run_id, cluster_no}
    context_vector            JSONB        NOT NULL,   -- vektor numerik persis yang dipakai saat itu
    candidate_scores          JSONB        NOT NULL,   -- [{template_id, ucb_score, mean_score, exploration_bonus}]
    decided_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    linked_at                 TIMESTAMPTZ,
    reward                    NUMERIC,
    reward_computed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cmab_decisions_user ON cmab_decisions(user_id, decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_cmab_decisions_blast ON cmab_decisions(blast_id);
CREATE INDEX IF NOT EXISTS idx_cmab_decisions_pending_reward
    ON cmab_decisions(blast_id) WHERE reward_computed_at IS NULL AND blast_id IS NOT NULL;
