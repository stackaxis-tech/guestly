-- +goose Up

-- A payment recorded by mistake can be voided. The row and its receipt number stay (numbers are gapless);
-- voiding only marks it and puts the plan's end date back.
-- prev_ends_on / prev_is_trial remember the plan as it was just before the payment, so a void restores it exactly.
-- Payments recorded before this migration have NULL there; voiding one falls back to period_from - 1 day.
-- public_token is the credential for the receipt link /p/:token (no login needed).
ALTER TABLE client_payments
    ADD COLUMN voided_at     timestamptz,
    ADD COLUMN void_reason   text NOT NULL DEFAULT '',
    ADD COLUMN voided_by     uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
    ADD COLUMN prev_ends_on  date,
    ADD COLUMN prev_is_trial boolean,
    ADD COLUMN public_token  text NOT NULL
        DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));

ALTER TABLE client_payments ADD CONSTRAINT client_payments_public_token_key UNIQUE (public_token);

-- +goose Down

ALTER TABLE client_payments DROP CONSTRAINT client_payments_public_token_key;
ALTER TABLE client_payments
    DROP COLUMN public_token,
    DROP COLUMN prev_is_trial,
    DROP COLUMN prev_ends_on,
    DROP COLUMN voided_by,
    DROP COLUMN void_reason,
    DROP COLUMN voided_at;
