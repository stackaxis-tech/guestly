-- +goose Up

-- Front-desk settings used in guest messages and billing.
ALTER TABLE properties
    ADD COLUMN whatsapp_number   text NOT NULL DEFAULT '',
    ADD COLUMN whatsapp_open_in  text NOT NULL DEFAULT 'app' CHECK (whatsapp_open_in IN ('app', 'web')),
    ADD COLUMN wifi_name         text NOT NULL DEFAULT '',
    ADD COLUMN wifi_password     text NOT NULL DEFAULT '',
    ADD COLUMN gst_registered    boolean NOT NULL DEFAULT false,
    -- Room GST by nightly tariff: tariffs up to the threshold use the low rate.
    ADD COLUMN room_gst_threshold bigint NOT NULL DEFAULT 750000,   -- paise (₹7,500)
    ADD COLUMN room_gst_low       numeric(5,2) NOT NULL DEFAULT 5,
    ADD COLUMN room_gst_high      numeric(5,2) NOT NULL DEFAULT 18,
    ADD COLUMN service_gst_rate   numeric(5,2) NOT NULL DEFAULT 5;

-- A person who has stayed at a property. Guests belong to a property, not globally.
CREATE TABLE guests (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id  uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    name         text NOT NULL,
    phone        text NOT NULL DEFAULT '',          -- E.164, e.g. +919847012345
    email        text NOT NULL DEFAULT '',
    nationality  text NOT NULL DEFAULT 'IN',        -- ISO 3166 alpha-2
    gender       text NOT NULL DEFAULT '',
    birth_year   int,
    address      text NOT NULL DEFAULT '',
    photo_key    text,                              -- encrypted object
    whatsapp_consent_at timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guests_property_phone_idx ON guests (property_id, phone);
CREATE INDEX guests_property_name_idx ON guests (property_id, lower(name));

CREATE TYPE id_doc_type AS ENUM ('aadhaar', 'passport', 'driving_licence', 'voter_id', 'other');

-- Identity documents. Numbers are AES-GCM encrypted; for Aadhaar only the last
-- four digits are ever stored. Images are encrypted objects in storage.
CREATE TABLE guest_documents (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    guest_id         uuid NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    doc_type         id_doc_type NOT NULL,
    number_encrypted bytea,
    number_last4     text NOT NULL DEFAULT '',
    front_key        text,
    back_key         text,
    -- Foreign nationals (Form C)
    visa_number_encrypted bytea,
    visa_expiry      date,
    created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guest_documents_guest_idx ON guest_documents (guest_id, created_at DESC);

-- Images uploaded during check-in before the stay exists. Attached on check-in;
-- unattached ones are deleted by a cleanup job.
CREATE TABLE staged_uploads (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id  uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    object_key   text NOT NULL,
    kind         text NOT NULL CHECK (kind IN ('photo', 'id_front', 'id_back')),
    created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
    attached_at  timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE stay_status AS ENUM ('in_house', 'checked_out', 'cancelled');

CREATE TABLE stays (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id           uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    room_id               uuid NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
    guest_id              uuid NOT NULL REFERENCES guests(id) ON DELETE RESTRICT,
    status                stay_status NOT NULL DEFAULT 'in_house',
    adults                int NOT NULL DEFAULT 1 CHECK (adults BETWEEN 1 AND 20),
    children              int NOT NULL DEFAULT 0 CHECK (children BETWEEN 0 AND 20),
    nightly_rate          bigint NOT NULL CHECK (nightly_rate >= 0),     -- paise, before GST
    check_in_at           timestamptz NOT NULL,
    expected_check_out_at timestamptz NOT NULL,
    checked_out_at        timestamptz,
    nights                int,                                           -- fixed at checkout
    purpose               text NOT NULL DEFAULT '',
    coming_from           text NOT NULL DEFAULT '',
    going_to              text NOT NULL DEFAULT '',
    notes                 text NOT NULL DEFAULT '',
    checked_in_by         uuid REFERENCES users(id) ON DELETE SET NULL,
    checked_out_by        uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at            timestamptz NOT NULL DEFAULT now(),
    CHECK (expected_check_out_at > check_in_at)
);
-- A room can hold only one in-house stay.
CREATE UNIQUE INDEX stays_one_per_room ON stays (room_id) WHERE status = 'in_house';
CREATE INDEX stays_property_status_idx ON stays (property_id, status, check_in_at DESC);
CREATE INDEX stays_guest_idx ON stays (guest_id);

-- Companions (other guests in the room). The primary guest is stays.guest_id.
CREATE TABLE stay_guests (
    stay_id   uuid NOT NULL REFERENCES stays(id) ON DELETE CASCADE,
    guest_id  uuid NOT NULL REFERENCES guests(id) ON DELETE RESTRICT,
    PRIMARY KEY (stay_id, guest_id)
);

-- Extra services (breakfast, laundry, airport pickup…). Room nights are computed, not stored here.
CREATE TABLE stay_charges (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    stay_id     uuid NOT NULL REFERENCES stays(id) ON DELETE CASCADE,
    description text NOT NULL,
    quantity    int NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price  bigint NOT NULL CHECK (unit_price >= 0),   -- paise, before GST
    gst_rate    numeric(5,2) NOT NULL DEFAULT 0,
    charged_on  date NOT NULL DEFAULT current_date,
    created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE stay_payment_mode AS ENUM ('cash', 'upi', 'card', 'bank', 'other');

CREATE TABLE stay_payments (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    stay_id     uuid NOT NULL REFERENCES stays(id) ON DELETE CASCADE,
    amount      bigint NOT NULL CHECK (amount <> 0),   -- negative = refund
    mode        stay_payment_mode NOT NULL,
    reference   text NOT NULL DEFAULT '',
    is_advance  boolean NOT NULL DEFAULT false,
    received_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stay_payments_stay_idx ON stay_payments (stay_id);

-- Who looked at a guest's ID images or number, and when.
CREATE TABLE id_access_log (
    id          bigserial PRIMARY KEY,
    property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    guest_id    uuid NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
    user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
    what        text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Per-property overrides of the default WhatsApp message wording.
CREATE TABLE message_templates (
    property_id  uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    kind         text NOT NULL,
    enabled      boolean NOT NULL DEFAULT true,
    body         text NOT NULL,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (property_id, kind)
);

CREATE TABLE message_log (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    stay_id     uuid REFERENCES stays(id) ON DELETE SET NULL,
    guest_id    uuid REFERENCES guests(id) ON DELETE SET NULL,
    kind        text NOT NULL,
    phone       text NOT NULL,
    body        text NOT NULL,
    status      text NOT NULL CHECK (status IN ('sent', 'skipped')),
    user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX message_log_stay_idx ON message_log (stay_id, created_at DESC);

-- +goose Down
DROP TABLE message_log;
DROP TABLE message_templates;
DROP TABLE id_access_log;
DROP TABLE stay_payments;
DROP TYPE stay_payment_mode;
DROP TABLE stay_charges;
DROP TABLE stay_guests;
DROP TABLE stays;
DROP TYPE stay_status;
DROP TABLE staged_uploads;
DROP TABLE guest_documents;
DROP TYPE id_doc_type;
DROP TABLE guests;
ALTER TABLE properties DROP COLUMN whatsapp_number, DROP COLUMN whatsapp_open_in, DROP COLUMN wifi_name,
    DROP COLUMN wifi_password, DROP COLUMN gst_registered, DROP COLUMN room_gst_threshold,
    DROP COLUMN room_gst_low, DROP COLUMN room_gst_high, DROP COLUMN service_gst_rate;
