-- Staff attendance tracking and daily sessions.
-- +goose Up

CREATE TABLE staff_attendance (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id    uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date           date NOT NULL,
    clock_in_at    timestamptz NOT NULL DEFAULT now(),
    clock_out_at   timestamptz,
    status         text NOT NULL DEFAULT 'present',
    notes          text NOT NULL DEFAULT '',
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (property_id, user_id, date)
);

CREATE INDEX staff_attendance_prop_date_idx ON staff_attendance (property_id, date DESC);
CREATE INDEX staff_attendance_user_date_idx ON staff_attendance (user_id, date DESC);

-- Track cancellations on stays with a timestamp
ALTER TABLE stays ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

-- +goose Down
ALTER TABLE stays DROP COLUMN IF EXISTS cancelled_at;
DROP TABLE IF EXISTS staff_attendance;
