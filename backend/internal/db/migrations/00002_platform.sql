-- +goose Up

-- Guestly staff who manage hotel clients. Deliberately separate from hotel `users`
-- so no hotel account can ever be promoted into platform access.
CREATE TABLE platform_admins (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name           text NOT NULL,
    email          text NOT NULL,
    password_hash  text NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX platform_admins_email_key ON platform_admins (lower(email));

CREATE TABLE admin_refresh_tokens (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id    uuid NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE,
    token_hash  bytea NOT NULL UNIQUE,
    expires_at  timestamptz NOT NULL,
    revoked_at  timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE org_status AS ENUM ('active', 'suspended');

ALTER TABLE organizations
    ADD COLUMN status         org_status NOT NULL DEFAULT 'active',
    ADD COLUMN contact_name   text NOT NULL DEFAULT '',
    ADD COLUMN contact_phone  text NOT NULL DEFAULT '',
    ADD COLUMN contact_email  text NOT NULL DEFAULT '',
    ADD COLUMN billing_gstin  text NOT NULL DEFAULT '',
    ADD COLUMN notes          text NOT NULL DEFAULT '';

-- Invited users have no password until they accept their invite.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE invites (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  bytea NOT NULL UNIQUE,
    expires_at  timestamptz NOT NULL,
    used_at     timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE plan_kind AS ENUM ('monthly', 'annual', 'custom');

-- One current subscription per property (pricing is per property).
CREATE TABLE subscriptions (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id    uuid NOT NULL UNIQUE REFERENCES properties(id) ON DELETE CASCADE,
    plan           plan_kind NOT NULL,
    amount         bigint NOT NULL CHECK (amount >= 0),          -- paise per period
    period_months  int NOT NULL CHECK (period_months BETWEEN 1 AND 36),
    is_trial       boolean NOT NULL DEFAULT false,
    starts_on      date NOT NULL,
    ends_on        date NOT NULL,
    grace_days     int NOT NULL DEFAULT 7 CHECK (grace_days BETWEEN 0 AND 60),
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_on >= starts_on)
);

CREATE TYPE payment_mode AS ENUM ('upi', 'bank', 'cash', 'other');

CREATE TABLE client_payments (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    property_id      uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    amount           bigint NOT NULL CHECK (amount > 0),
    mode             payment_mode NOT NULL,
    reference        text NOT NULL DEFAULT '',
    paid_on          date NOT NULL,
    receipt_no       text NOT NULL UNIQUE,
    period_from      date NOT NULL,
    period_to        date NOT NULL,
    notes            text NOT NULL DEFAULT '',
    recorded_by      uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX client_payments_org_idx ON client_payments (organization_id, paid_on DESC);
CREATE INDEX client_payments_paid_on_idx ON client_payments (paid_on);

-- Sequential receipt numbers per Indian financial year (April to March).
CREATE TABLE receipt_counters (
    financial_year  text PRIMARY KEY,
    last_no         int NOT NULL
);

CREATE TABLE admin_audit_log (
    id           bigserial PRIMARY KEY,
    admin_id     uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
    action       text NOT NULL,
    target_type  text NOT NULL,
    target_id    uuid,
    details      jsonb NOT NULL DEFAULT '{}',
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_log_created_idx ON admin_audit_log (created_at DESC);

-- Properties created before this phase get a 30-day trial so nothing locks immediately.
INSERT INTO subscriptions (property_id, plan, amount, period_months, is_trial, starts_on, ends_on)
SELECT id, 'annual', 89900, 12, true, current_date, current_date + 30 FROM properties;

-- +goose Down
DROP TABLE admin_audit_log;
DROP TABLE receipt_counters;
DROP TABLE client_payments;
DROP TYPE payment_mode;
DROP TABLE subscriptions;
DROP TYPE plan_kind;
DROP TABLE invites;
ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;
ALTER TABLE organizations DROP COLUMN status, DROP COLUMN contact_name, DROP COLUMN contact_phone,
    DROP COLUMN contact_email, DROP COLUMN billing_gstin, DROP COLUMN notes;
DROP TYPE org_status;
DROP TABLE admin_refresh_tokens;
DROP TABLE platform_admins;
