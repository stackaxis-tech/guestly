-- +goose Up
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE reservation_status AS ENUM ('booked', 'checked_in', 'cancelled', 'no_show');

CREATE TABLE reservations (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id       uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    room_id           uuid NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
    status            reservation_status NOT NULL DEFAULT 'booked',
    guest_name        text NOT NULL,
    guest_phone       text NOT NULL,                -- E.164
    check_in          date NOT NULL,
    check_out         date NOT NULL,                -- exclusive: the room is free that night
    adults            int NOT NULL DEFAULT 1 CHECK (adults BETWEEN 1 AND 20),
    children          int NOT NULL DEFAULT 0 CHECK (children BETWEEN 0 AND 20),
    nightly_rate      bigint NOT NULL CHECK (nightly_rate >= 0),    -- paise, before GST
    advance_amount    bigint NOT NULL DEFAULT 0 CHECK (advance_amount >= 0),
    advance_mode      stay_payment_mode,
    advance_reference text NOT NULL DEFAULT '',
    notes             text NOT NULL DEFAULT '',
    whatsapp_consent  boolean NOT NULL DEFAULT false,
    stay_id           uuid REFERENCES stays(id) ON DELETE SET NULL,
    cancel_reason     text NOT NULL DEFAULT '',
    created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CHECK (check_out > check_in),
    -- The database itself refuses two live bookings for one room on the same nights.
    CONSTRAINT reservations_no_double_booking
        EXCLUDE USING gist (room_id WITH =, daterange(check_in, check_out) WITH &&) WHERE (status = 'booked')
);
CREATE INDEX reservations_property_dates_idx ON reservations (property_id, check_in, check_out);

ALTER TABLE message_log ADD COLUMN reservation_id uuid REFERENCES reservations(id) ON DELETE SET NULL;
CREATE INDEX message_log_reservation_idx ON message_log (reservation_id);

-- +goose Down
ALTER TABLE message_log DROP COLUMN reservation_id;
DROP TABLE reservations;
DROP TYPE reservation_status;
