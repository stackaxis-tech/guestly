-- +goose Up

-- What a GST invoice needs from the seller, beyond the trade name we already keep.
ALTER TABLE properties
    ADD COLUMN legal_name     text NOT NULL DEFAULT '',   -- name registered under GST; falls back to the trade name
    ADD COLUMN invoice_footer text NOT NULL DEFAULT '';   -- terms or thank-you line printed at the bottom

-- Who the bill is addressed to (a company, for example) and the meal plan, set before or at checkout.
ALTER TABLE stays
    ADD COLUMN food_plan       text NOT NULL DEFAULT 'EP' CHECK (food_plan IN ('EP', 'CP', 'MAP', 'AP')),
    ADD COLUMN bill_to_name    text NOT NULL DEFAULT '',
    ADD COLUMN bill_to_gstin   text NOT NULL DEFAULT '',
    ADD COLUMN bill_to_address text NOT NULL DEFAULT '',
    ADD COLUMN bill_to_state   text NOT NULL DEFAULT '';

-- Gapless invoice numbers: one counter per property per financial year (April to March).
CREATE TABLE invoice_counters (
    property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    fy          text NOT NULL,                 -- '26-27'
    last_seq    int  NOT NULL DEFAULT 0,
    PRIMARY KEY (property_id, fy)
);

-- An issued invoice. `doc` is a frozen copy of everything printed on it (seller, bill-to, lines, tax),
-- so later edits to the property or the stay never change a number that was already given to a guest.
-- Payments are not frozen: the invoice shows them live.
CREATE TABLE invoices (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id  uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    stay_id      uuid NOT NULL UNIQUE REFERENCES stays(id) ON DELETE RESTRICT,
    fy           text NOT NULL,
    seq          int  NOT NULL,
    number       text NOT NULL,                -- 'INV/26-27/0001' (max 16 characters, as GST requires)
    issued_at    timestamptz NOT NULL DEFAULT now(),
    share_token  text NOT NULL UNIQUE,         -- the public link /i/<token>
    doc          jsonb NOT NULL,
    total        bigint NOT NULL,              -- paise
    print_count  int NOT NULL DEFAULT 0,       -- 0 = next print is the ORIGINAL, after that DUPLICATE
    issued_by    uuid REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE (property_id, number),
    UNIQUE (property_id, fy, seq)
);

-- +goose Down
DROP TABLE invoices;
DROP TABLE invoice_counters;
ALTER TABLE stays DROP COLUMN food_plan, DROP COLUMN bill_to_name, DROP COLUMN bill_to_gstin,
    DROP COLUMN bill_to_address, DROP COLUMN bill_to_state;
ALTER TABLE properties DROP COLUMN legal_name, DROP COLUMN invoice_footer;
