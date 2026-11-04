-- +goose Up
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE organizations (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE user_role AS ENUM ('owner', 'manager', 'front_desk', 'housekeeping');

CREATE TABLE users (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name            text NOT NULL,
    email           text NOT NULL,
    phone           text,
    password_hash   text NOT NULL,
    role            user_role NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE refresh_tokens (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  bytea NOT NULL UNIQUE,
    expires_at  timestamptz NOT NULL,
    revoked_at  timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE properties (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name               text NOT NULL,
    address            text NOT NULL DEFAULT '',
    city               text NOT NULL DEFAULT '',
    state              text NOT NULL DEFAULT '',
    pincode            text NOT NULL DEFAULT '',
    phone              text NOT NULL DEFAULT '',
    email              text NOT NULL DEFAULT '',
    gstin              text NOT NULL DEFAULT '',
    logo_key           text,
    google_review_url  text NOT NULL DEFAULT '',
    invoice_prefix     text NOT NULL DEFAULT 'INV',
    check_in_time      time NOT NULL DEFAULT '12:00',
    check_out_time     time NOT NULL DEFAULT '11:00',
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Owners can access every property in their organization; other roles need a membership row.
CREATE TABLE property_members (
    property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (property_id, user_id)
);

CREATE TABLE room_types (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id  uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    name         text NOT NULL,
    bed_type     text NOT NULL DEFAULT '',
    base_rate    bigint NOT NULL CHECK (base_rate >= 0), -- paise
    max_guests   int NOT NULL DEFAULT 2 CHECK (max_guests > 0),
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (property_id, name)
);

CREATE TYPE room_status AS ENUM ('ready', 'occupied', 'cleaning', 'maintenance');

CREATE TABLE rooms (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id   uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    room_type_id  uuid NOT NULL REFERENCES room_types(id) ON DELETE RESTRICT,
    number        text NOT NULL,
    floor         int NOT NULL DEFAULT 1,
    status        room_status NOT NULL DEFAULT 'ready',
    notes         text NOT NULL DEFAULT '',
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (property_id, number)
);
CREATE INDEX rooms_property_idx ON rooms (property_id, floor, number);

-- +goose Down
DROP TABLE rooms;
DROP TYPE room_status;
DROP TABLE room_types;
DROP TABLE property_members;
DROP TABLE properties;
DROP TABLE refresh_tokens;
DROP TABLE users;
DROP TYPE user_role;
DROP TABLE organizations;
