-- Check-in/checkout rules, as front-desk systems handle them:
--  * checkout_policy: 'fixed' (leave by check_out_time) or '24h' (24 hours from check-in, common in India).
--  * early_arrival_cutoff: under 'fixed', a walk-in before this time (e.g. 02:00) takes the night that's
--    already begun, so it's billed from the previous date. '00:00' turns this off.
--  * late_checkout_grace: minutes after the checkout time before it counts as a late checkout.

-- +goose Up
ALTER TABLE properties
    ADD COLUMN checkout_policy      text NOT NULL DEFAULT 'fixed' CHECK (checkout_policy IN ('fixed', '24h')),
    ADD COLUMN early_arrival_cutoff time NOT NULL DEFAULT '06:00' CHECK (early_arrival_cutoff <= '12:00'),
    ADD COLUMN late_checkout_grace  int  NOT NULL DEFAULT 60 CHECK (late_checkout_grace BETWEEN 0 AND 360);

-- Each stay keeps the rules it was checked in under, so changing the settings never re-bills guests
-- already in-house. NULL (stays from before this migration) means the old rule: fixed, from the check-in date.
ALTER TABLE stays
    ADD COLUMN arrival_date        date,
    ADD COLUMN checkout_policy     text CHECK (checkout_policy IN ('fixed', '24h')),
    ADD COLUMN late_checkout_grace int;

-- +goose Down
ALTER TABLE stays DROP COLUMN arrival_date, DROP COLUMN checkout_policy, DROP COLUMN late_checkout_grace;
ALTER TABLE properties DROP COLUMN checkout_policy, DROP COLUMN early_arrival_cutoff, DROP COLUMN late_checkout_grace;
