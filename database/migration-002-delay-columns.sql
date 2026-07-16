-- Migration 002: Add delay columns to blasts table
-- Run: psql -U postgres -d kirimly -f database/migration-002-delay-columns.sql

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'blasts' AND column_name = 'delay_per_contact_ms'
    ) THEN
        ALTER TABLE blasts ADD COLUMN delay_per_contact_ms INTEGER;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'blasts' AND column_name = 'delay_per_wave_ms'
    ) THEN
        ALTER TABLE blasts ADD COLUMN delay_per_wave_ms INTEGER;
    END IF;
END $$;
