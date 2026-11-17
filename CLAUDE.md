# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Gustlog

Front-desk / property management app for small **Indian** hotels, guesthouses, and homestays.

**Naming:** the product is **Gustlog** (no "e"; domain gustlog.com; earlier names Guestly, then Guestlog). Use Gustlog in anything people read. Internal identifiers deliberately keep `guestly` (Go module path, Postgres user/db, cookies, JWT issuer, `GUESTLY_*` env vars, `~/guestly` on the VM, repo folder, and existing `@guestly.dev` logins); renaming them would risk live data or sign everyone out.

## Stack
- `backend/`: Go, chi router, pgx (hand-written SQL, no ORM), goose migrations embedded and run on API start, JWT auth.
- `frontend/`: React + TypeScript + Vite, Tailwind v4, TanStack Query, React Router, react-hook-form + zod, lucide icons.
- Postgres 16 via `docker-compose.yml` on **port 5433** (5432 is taken on this machine). The frontend dev server is on **5180** (5173–5174 are used by other projects).

## Commands
```
make db      # start Postgres
make seed    # hotel login: owner@guestly.dev / guestly123 · super admin: admin@guestly.dev / guestly-admin (at /admin)
make api     # :8080, applies migrations
make web     # :5180
make test    # go vet + go test + tsc
make build   # backend/bin/api + frontend/dist
```
- Single Go test: `cd backend && go test ./internal/stay -run TestName`. Go tests are pure unit tests (bill math, Aadhaar QR parsing, room transitions, subscription states, refresh-token source), so they don't need Postgres.
- Frontend checks: `npx tsc -b` and `npm test` (Vitest, only the pure ID parsers in `src/lib/idscan/*.test.ts`; single file: `npx vitest run src/lib/idscan/mrz.test.ts`). There's no linter. Ignore `frontend/README.md` (it's the Vite template).
- `npm run dev` / `npm run build` first run `scripts/ocr-assets.mjs`, which copies the OCR engine and model from `node_modules` into `public/ocr/` (gitignored).
- No `.env` is needed locally: every setting in `backend/internal/config/config.go` has a dev default that points at the compose Postgres on 5433.

## Deployment
- Live at **http://43.204.102.193** (AWS EC2, Ubuntu, 1 GB RAM). Stack: `deploy/docker-compose.yml` (Postgres, which isn't exposed publicly, the API binary on alpine, and Caddy on :80 serving `deploy/web` and proxying `/api`).
- Redeploy with `./deploy/deploy.sh`: it runs `go vet` + `go test`, cross-builds linux/amd64 `guestly-api` and `createadmin` into `deploy/bin`, builds the web app with `VITE_API_URL=/api/v1` into `deploy/web`, rsyncs `deploy/` to `~/guestly`, restarts, and checks `/healthz`. Override the target and SSH key with `GUESTLY_HOST` / `GUESTLY_KEY`. Production secrets are in `deploy/.env` and the admin login is in `deploy/ADMIN_CREDENTIALS.txt`; both are gitignored, so never commit them.
- Create or reset a platform admin on the VM: `docker compose exec -e ADMIN_EMAIL=… -e ADMIN_PASSWORD=… api /app/createadmin`.
- HTTP only for now. Camera capture (phase 2) needs a domain + HTTPS: point a domain at the VM, change `:80` in the Caddyfile to the domain, and set `PUBLIC_URL=https://…` and `SECURE_COOKIES=true`. (`deploy/docker-compose.yml` derives `APP_URL`, `PUBLIC_API_URL` and `ALLOWED_ORIGINS` from `PUBLIC_URL`.)

## Backend conventions
- Package per domain under `backend/internal/` (`auth`, `property`, `room`, …). Handlers return `error`, wrapped with `httpx.Handler`.
- `internal/server/server.go` is the whole route table and the dependency wiring, so read it first. Role gates are applied there per route: `managers` (owner and manager) and `desk` (everyone except housekeeping, which covers all guest-data and money routes). `cmd/api/main.go` runs migrations, builds the `secure.Box`, and starts the hourly staged-upload cleanup. Other binaries: `cmd/seed` and `cmd/createadmin`.
- Guests, stays, payments, reservations and message templates all live in one package, `internal/stay`.
- Return `httpx.Invalid(map[field]msg)` for form errors (422), so the frontend shows them inline; other helpers are `NotFound`, `Conflict`, `Forbidden`, etc.
- Everything property-scoped lives under `/api/v1/properties/{propertyID}/…`. The `property.Access` middleware checks access; read the ID with `property.ID(ctx)`. Always filter queries by `property_id`.
- **Two auth scopes**: hotel staff (`/api/v1/auth`, `users`) and Gustlog super admins (`/api/v1/admin/auth`, `platform_admins`). The JWT `scope` claim is `hotel` or `platform`, and each middleware rejects the other scope. Hotels can't self-register: an admin creates the client, and the owner sets a password through `/invite/:token`.
- Subscriptions are **per property** (`internal/billing`). The `property.Access` middleware returns 402 `subscription_expired` on writes once the grace period is over, and 403 for suspended clients. Admin actions call `h.audit(...)`.
- **Subscription payments** (`internal/admin/payments.go`): recording extends the plan and issues a gapless receipt number. A wrong payment is voided with `POST /admin/payments/{id}/void` (reason required, **latest payment of a property only**): the row and receipt number stay, it stops counting as revenue, and the plan's end date and trial flag go back to `prev_ends_on` / `prev_is_trial`. Each payment has a `public_token`; the client's receipt is the public page `/p/:token` (`GET /api/v1/public/receipts/{token}`, `receipt.go`). It is a receipt, not a GST tax invoice. In the admin UI, "Record payment" is on each property card, each Renewals row, and the Payments page (`admin/RecordPayment.tsx`).
- Files are stored via the `storage.Store` interface (`LocalStore` in `backend/var/uploads` for dev) and served only through HMAC-signed URLs (`storage.Signer`). Logos must be PNG/JPG/WebP ≤ 1 MB; SVG is rejected.
- Roles: `owner` (all org properties), `manager`, `front_desk`, `housekeeping` (need a `property_members` row). Use `auth.RequireRole`.
- **Money is `bigint` paise** everywhere. Never use floats.
- New schema changes go in a new file, `internal/db/migrations/0000N_name.sql` (goose Up/Down). The latest is `00008_stay_rules.sql`. Never edit an applied migration, because production has already run it.
- **Guest ID data**: `internal/secure` uses AES-256-GCM with `DATA_KEY` (64 hex chars, required when `GUESTLY_ENV=production`). ID numbers are encrypted in DB columns, and guest photos and ID images are encrypted objects (`guests/*.enc`) served only through authenticated, logged endpoints (`id_access_log`). **Aadhaar: only the last 4 digits are ever stored.** Losing `DATA_KEY` makes all ID data unreadable, so back it up.
- Check-in images go through `staged_uploads` (upload first, then reference the IDs in `POST /stays`); unattached uploads are deleted hourly after 24h.
- **Invoices** (`internal/stay/invoice.go`, table `invoices`): created automatically at checkout (or `POST /stays/{id}/invoice` for older stays). The printed content is frozen as JSON in `invoices.doc`; payments are read live. Numbers are `PREFIX/26-27/0001` from `invoice_counters` (per property, per April–March year, gapless, ≤16 chars). Bill-to company/GSTIN and meal plan live on `stays` and lock once the invoice exists. The guest link `/i/:token` is served by the public `GET /api/v1/public/invoices/{token}`; the token is the only credential.
- **Stay rules** (Settings → Check-in & checkout rules, `properties.checkout_policy` / `early_arrival_cutoff` / `late_checkout_grace`): `fixed` bills one night per date from the arrival night, and a walk-in before the cutoff (default 6 AM) takes the night that already began (`ArrivalNight`); `24h` bills one night per started 24 hours from check-in, after the grace period (`StayNights` in `stay/bill.go`). Each stay snapshots its rules (`stays.arrival_date`, `checkout_policy`, `late_checkout_grace`; NULL on old stays = fixed from the check-in date), so changing settings never re-bills in-house guests. The frontend mirrors this in `lib/reservations.ts` (`arrivalNight`, `hotelInstant`). Build checkout instants with `hotelInstant(date, time)`, never `new Date("…T11:00")`, which uses the device's time zone. Late checkout is not a night: the checkout preview returns `lateCheckoutMinutes` and staff can add a half-day fee. Early check-in and late checkout fees use `kind: "room"`, so they take the room's GST slab. A room stays occupied through its checkout date if the guest is due out after the check-in time (`occupiedRange`, and the `inHouseOverlap` SQL).
- Bills are computed (`stay.computeBill`), not stored: room line = nights × rate with GST by tariff slab (`TaxConfig`), plus `stay_charges`; GST is always split CGST/SGST. While in-house, nights are an estimate; the checkout preview `GET /stays/{id}/checkout` uses the actual nights. Checkout refuses a balance due unless `settleLater`, and records refunds as negative `stay_payments`.
- WhatsApp templates: defaults are in `internal/stay/messages.go` (`messageKinds`), with per-property overrides in `message_templates`. `Render` drops a line whose known fields are all empty.
- Room status `occupied` is set **only** by check-in/checkout. Manual housekeeping moves are in `room.CanTransition`, mirrored in `frontend/src/lib/rooms.ts` (`manualNext`).
- Auth: 15-minute access JWT kept in memory on the client, plus a rotating refresh token in the httpOnly cookie `guestly_refresh` (path `/api/v1/auth`).

## Frontend conventions
- Brand: **Red on clean white** (staging redesign, after https://guestly-phi.vercel.app/). Tokens are in `src/index.css` (`@theme`): `brand-*` (red, `brand-700` = primary), `accent-*` (gold highlights only; `accent-700` if it must be text), plus neutrals (`ivory` = page bg, `paper`, `sand`, `line`, `ink`, `muted`). Never hard-code hex values in components. Cards are flat (border, no shadow).
- Fonts: Manrope (`font-display`, headings and numbers, bold) + DM Sans (UI).
- Shell: a sticky top bar (logo · property switcher · account) and a floating bottom nav at every screen size; `PageHeader` shows a small "Hotel operations" eyebrow.
- Logo: `src/components/brand/Logo.tsx`. An arched doorway forms a "g" in ink, with a red "welcome light" dot. The favicon is `public/favicon.svg`.
- UI primitives are in `src/components/ui.tsx` (Button, Field, Input, Select, Card, Sheet, EmptyState…). Use `Sheet` for create/edit flows.
- API calls go through `src/lib/api.ts`. `createClient(authPrefix, native)` builds both the hotel client (`api` / `hotel`) and `adminClient`. On a 401 it runs a single shared refresh, so parallel requests don't rotate the token twice, then retries once. Errors are thrown as `ApiError(status, code, message, fields)`, and `applyFieldErrors` maps a 422's `fields` onto react-hook-form, which pairs with `httpx.Invalid`. The base URL is `VITE_API_URL` (default `http://localhost:8080/api/v1`).
- Format money with `rupees(paise)` and parse input with `toPaise()` from `src/lib/format.ts`.
- Mobile-first.
- The admin console lives in `src/admin/` with its own API client (`adminClient`) and auth context. `App.tsx` switches between the hotel and admin apps by the `/admin` path.

## ID auto-fill (`src/lib/idscan/`)
Check-in reads the ID photo and fills empty fields; staff confirm, and differing values are offered, not overwritten. Everything runs **on the device**, with no outside OCR or AI service. Images never leave the device except the server Aadhaar fallback below.
- **Aadhaar**: the QR is decoded on the device (`zxing-wasm`; the live camera captures by itself once a frame decodes) and only its text goes to `POST /guests/parse-aadhaar`. If the device can't decode it, the photo goes to `POST /guests/scan-aadhaar` (gozxing, in memory, never stored). Parsing stays on the server (`internal/stay/aadhaar.go`) so only the last 4 digits ever leave it. Secure QR fields are located from the DOB + gender pair, not fixed positions, because QR versions differ in their leading fields. Neither endpoint logs the image, the text or the result. Results come from the QR, not from UIDAI.
- **Passport**: OCR of the MRZ (`mrz.ts`). Check digits must match, look-alike characters are repaired, and an ambiguous number is left empty.
- **PAN / Voter ID / Driving licence**: OCR (`tesseract.js`, served from `/ocr/`, ~7 MB on first use) plus format checks in `indianIds.ts`. A field that fails its check stays empty.
- The QR and OCR modules are dynamically imported so they stay out of the main bundle.

## Mobile apps (Capacitor, `frontend/ios` + `frontend/android`)
- `make ios` / `make android`. App ID `tech.stackaxis.guestlog`. Hotel staff only: `/admin` is web-only. Native code paths check `isNative` (`src/lib/platform.ts`).
- Native sessions: requests send `X-Client: mobile`, the refresh token comes back in JSON and lives in Keychain/Keystore (never web storage). Browsers keep the httpOnly cookie and can't use a body token.
- "Powered by StackAxis" (`components/PoweredBy.tsx`) shows only in the apps for now.
- Release builds need HTTPS for the API; iOS and Android block plain HTTP.

## Reservations
`internal/stay/reservations.go`, `src/pages/ReservationsPage.tsx`. Dates are `[check_in, check_out)`, so same-day turnover is allowed. A Postgres exclusion constraint on `(room_id, daterange)` is the final guard against double booking; walk-in check-in and stay extensions also refuse rooms promised to a booking. Check-in with `reservationId` moves the booking's advance into `stay_payments` exactly once. A check-in date later than today on the check-in page hands off to `/reservations?new=1&checkIn=…&checkOut=…&name=…` (prefilled `BookingForm`), since only today's arrivals can be checked in. "Today" in the frontend must use `hotelToday()` (India time), never the device date.

## Build phases
1. ✅ Foundation: auth, properties, room types, rooms and housekeeping, app shell, brand
1.5 ✅ Gustlog Super Admin: clients, per-property subscriptions, manual payments, logos, invites, read-only after grace
2. ✅ Guests + secure ID (encrypted), check-in, checkout, payments
3. ✅ GST invoices: numbering per financial year, one standard layout with the client's logo, print + WhatsApp + share link `/i/:token` (see `docs/bill-structure.html`). Still to do: round-off, credit notes, PDF file
4. Reviews: tokenized `/r/:token`. Every guest sees the Google review button, with an optional private note to the manager. **Never gate Google by rating** (Google policy).
- Guest WhatsApp messaging is **click-to-send** (prefilled wa.me / WhatsApp Web link, staff press Send) with editable per-property templates. First messages: welcome (phase 2), bill link (phase 3), review request (phase 4). The Business API comes later.
5. ✅ Reservations calendar · still to do: reports, Form C pending list
6. Subscription (Razorpay), PWA, polish
