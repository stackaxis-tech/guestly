-- +goose NO TRANSACTION
-- PAN cards can be recorded as a guest ID (with on-device auto-fill).

-- +goose Up
ALTER TYPE id_doc_type ADD VALUE IF NOT EXISTS 'pan' BEFORE 'other';

-- +goose Down
-- Postgres can't drop an enum value. Move PAN documents to 'other' so the
-- value is unused; it stays in the type harmlessly.
UPDATE guest_documents SET doc_type = 'other' WHERE doc_type = 'pan';
