-- ============================================================
-- Kirimly — Multi-Tenant WhatsApp Broadcast Database Schema
-- ============================================================

-- 1. USERS
CREATE TABLE users (
    id              SERIAL PRIMARY KEY,
    username        VARCHAR(50)  NOT NULL UNIQUE,
    password_hash   TEXT         NOT NULL,
    display_name    VARCHAR(100),
    role            VARCHAR(10)  NOT NULL DEFAULT 'user'
                    CHECK (role IN ('admin', 'user')),
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_is_active ON users(is_active);

-- 2. LOGIN LOGS
CREATE TABLE login_logs (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip_address  INET,
    user_agent  TEXT,
    success     BOOLEAN      NOT NULL,
    fail_reason VARCHAR(100),
    logout_at   TIMESTAMPTZ,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_login_logs_user_id   ON login_logs(user_id);
CREATE INDEX idx_login_logs_created_at ON login_logs(created_at DESC);

-- 3. WA SESSIONS (satu user maksimal punya satu sesi aktif)
CREATE TABLE wa_sessions (
    id                 SERIAL PRIMARY KEY,
    user_id            INTEGER      NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    phone_number       VARCHAR(20),
    status             VARCHAR(20)  NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'connected', 'disconnected', 'expired')),
    qr_code            TEXT,
    qr_expires_at      TIMESTAMPTZ,
    credentials_json   TEXT,        -- Baileys auth state (JSON terenkripsi)
    last_connected_at  TIMESTAMPTZ,
    error_message      TEXT,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wa_sessions_status ON wa_sessions(status);

-- 4. CONTACTS (terisolasi per user_id)
CREATE TABLE contacts (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    phone_number    VARCHAR(20)  NOT NULL,
    name            VARCHAR(150),
    notes           TEXT,
    is_blocked      BOOLEAN      NOT NULL DEFAULT FALSE,
    last_sent_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_contacts_user_phone UNIQUE (user_id, phone_number)
);

CREATE INDEX idx_contacts_user_id ON contacts(user_id);

-- 5. TEMPLATES (terisolasi per user_id)
CREATE TABLE templates (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    category    VARCHAR(50)  DEFAULT 'general',
    body        TEXT         NOT NULL,
    variables   JSONB,       -- daftar variable name yg bisa di-replace, misal ["{nama}","{alamat}"]
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_templates_user_name UNIQUE (user_id, name)
);

CREATE INDEX idx_templates_user_id   ON templates(user_id);
CREATE INDEX idx_templates_category  ON templates(category);

-- 6. BLASTS (riwayat pengiriman broadcast)
CREATE TABLE blasts (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_id     INTEGER      REFERENCES templates(id) ON DELETE SET NULL,
    name            VARCHAR(150),
    total_contacts  INTEGER      NOT NULL DEFAULT 0,
    sent_count      INTEGER      NOT NULL DEFAULT 0,
    delivered_count INTEGER      NOT NULL DEFAULT 0,
    read_count      INTEGER      NOT NULL DEFAULT 0,
    replied_count   INTEGER      NOT NULL DEFAULT 0,
    failed_count    INTEGER      NOT NULL DEFAULT 0,
    status          VARCHAR(20)  NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'scheduled', 'sending', 'completed', 'cancelled')),
    scheduled_at    TIMESTAMPTZ,
    sent_at         TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_blasts_user_id   ON blasts(user_id);
CREATE INDEX idx_blasts_status    ON blasts(status);
CREATE INDEX idx_blasts_scheduled ON blasts(scheduled_at) WHERE scheduled_at IS NOT NULL;

-- 7. BLAST MESSAGES (detail per nomor tujuan dalam satu blast)
CREATE TABLE blast_messages (
    id            SERIAL PRIMARY KEY,
    blast_id      INTEGER      NOT NULL REFERENCES blasts(id) ON DELETE CASCADE,
    contact_id    INTEGER      REFERENCES contacts(id) ON DELETE SET NULL,
    phone_number  VARCHAR(20)  NOT NULL,
    message_body  TEXT         NOT NULL,
    status        VARCHAR(20)  NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'replied', 'failed')),
    error_message TEXT,
    wa_message_id TEXT,        -- Baileys message key.id untuk mapping event update
    reply_body    TEXT,        -- isi balasan kontak (dari messages.upsert)
    wave_number   INTEGER      NOT NULL DEFAULT 1, -- gelombang ke-berapa (1-3)
    sent_at       TIMESTAMPTZ,
    delivered_at  TIMESTAMPTZ,
    read_at       TIMESTAMPTZ,
    replied_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_blast_messages_blast_id   ON blast_messages(blast_id);
CREATE INDEX idx_blast_messages_status     ON blast_messages(status);
CREATE INDEX idx_blast_messages_phone      ON blast_messages(phone_number);
CREATE INDEX idx_blast_messages_wa_msg_id  ON blast_messages(wa_message_id);

-- ============================================================
-- TRIGGER: auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_wa_sessions_updated_at
    BEFORE UPDATE ON wa_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_contacts_updated_at
    BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_templates_updated_at
    BEFORE UPDATE ON templates FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_blasts_updated_at
    BEFORE UPDATE ON blasts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
