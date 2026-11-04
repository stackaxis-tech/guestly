# Guestly

Front-desk / property management app for small **Indian** hotels, guesthouses, and homestays.
Full plan: `~/.claude/plans/dont-use-artificats-i-woolly-wilkinson.md`.

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
```

## Deployment
- Live at **http://43.204.102.193** (AWS EC2, Ubuntu, 1 GB RAM). Stack: `deploy/docker-compose.yml` (Postgres, which isn't exposed publicly, the API binary on alpine, and Caddy on :80 serving `deploy/web` and proxying `/api`).
- Redeploy with `./deploy/deploy.sh`. Production secrets are in `deploy/.env` and the admin login is in `deploy/ADMIN_CREDENTIALS.txt`; both are gitignored, so never commit them.
- Create or reset a platform admin on the VM: `docker compose exec -e ADMIN_EMAIL=… -e ADMIN_PASSWORD=… api /app/createadmin`.
- HTTP only for now. Camera capture (phase 2) needs a domain + HTTPS: point a domain at the VM, change `:80` in the Caddyfile to the domain, and set `PUBLIC_URL=https://…` and `SECURE_COOKIES=true`.

## Backend conventions
- Package per domain under `backend/internal/` (`auth`, `property`, `room`, …). Handlers return `error`, wrapped with `httpx.Handler`.
- Return `httpx.Invalid(map[field]msg)` for form errors (422), so the frontend shows them inline; other helpers are `NotFound`, `Conflict`, `Forbidden`, etc.
- Everything property-scoped lives under `/api/v1/properties/{propertyID}/…`. The `property.Access` middleware checks access; read the ID with `property.ID(ctx)`. Always filter queries by `property_id`.
- **Two auth scopes**: hotel staff (`/api/v1/auth`, `users`) and Guestly super admins (`/api/v1/admin/auth`, `platform_admins`). The JWT `scope` claim is `hotel` or `platform`, and each middleware rejects the other scope. Hotels can't self-register: an admin creates the client, and the owner sets a password through `/invite/:token`.
- Subscriptions are **per property** (`internal/billing`). The `property.Access` middleware returns 402 `subscription_expired` on writes once the grace period is over, and 403 for suspended clients. Admin actions call `h.audit(...)`.
- Files are stored via the `storage.Store` interface (`LocalStore` in `backend/var/uploads` for dev) and served only through HMAC-signed URLs (`storage.Signer`). Logos must be PNG/JPG/WebP ≤ 1 MB; SVG is rejected.
- Roles: `owner` (all org properties), `manager`, `front_desk`, `housekeeping` (need a `property_members` row). Use `auth.RequireRole`.
- **Money is `bigint` paise** everywhere. Never use floats.
- New schema changes go in a new file, `internal/db/migrations/0000N_name.sql` (goose Up/Down).
- **Guest ID data**: `internal/secure` uses AES-256-GCM with `DATA_KEY` (64 hex chars, required when `GUESTLY_ENV=production`). ID numbers are encrypted in DB columns, and guest photos and ID images are encrypted objects (`guests/*.enc`) served only through authenticated, logged endpoints (`id_access_log`). **Aadhaar: only the last 4 digits are ever stored.** Losing `DATA_KEY` makes all ID data unreadable, so back it up.
- Check-in images go through `staged_uploads` (upload first, then reference the IDs in `POST /stays`); unattached uploads are deleted hourly after 24h.
- Bills are computed (`stay.computeBill`), not stored: room line = nights × rate with GST by tariff slab (`TaxConfig`), plus `stay_charges`; GST is always split CGST/SGST. While in-house, nights are an estimate; the checkout preview `GET /stays/{id}/checkout` uses the actual nights. Checkout refuses a balance due unless `settleLater`, and records refunds as negative `stay_payments`.
- WhatsApp templates: defaults are in `internal/stay/messages.go` (`messageKinds`), with per-property overrides in `message_templates`. `Render` drops a line whose known fields are all empty.
- Room status `occupied` is set **only** by check-in/checkout. Manual housekeeping moves are in `room.CanTransition`, mirrored in `frontend/src/lib/rooms.ts` (`manualNext`).
- Auth: 15-minute access JWT kept in memory on the client, plus a rotating refresh token in the httpOnly cookie `guestly_refresh` (path `/api/v1/auth`).

## Frontend conventions
- Brand: **Teal + Marigold** on warm ivory. Tokens are in `src/index.css` (`@theme`); never hard-code hex values in components. Marigold is an accent only (welcome light, stars, attention), never body text; use `marigold-700` if it must be text.
- Fonts: Fraunces (`font-display`, headings and numbers) + Plus Jakarta Sans (UI).
- Logo: `src/components/brand/Logo.tsx`. An arched doorway forms a "g", with a marigold "welcome light" dot. The favicon is `public/favicon.svg`.
- UI primitives are in `src/components/ui.tsx` (Button, Field, Input, Select, Card, Sheet, EmptyState…). Use `Sheet` for create/edit flows.
- Format money with `rupees(paise)` and parse input with `toPaise()` from `src/lib/format.ts`.
- Mobile-first: bottom tabs below `lg`, sidebar at `lg` and up.
- The admin console lives in `src/admin/` with its own API client (`adminClient`) and auth context. `App.tsx` switches between the hotel and admin apps by the `/admin` path.

## Build phases
1. ✅ Foundation: auth, properties, room types, rooms and housekeeping, app shell, brand
1.5 ✅ Guestly Super Admin: clients, per-property subscriptions, manual payments, logos, invites, read-only after grace
2. ✅ Guests + secure ID (encrypted), check-in, checkout, payments
3. GST invoices (numbering per financial year, CGST/SGST vs IGST), PDF, WhatsApp + share link
4. Reviews: tokenized `/r/:token`. Every guest sees the Google review button, with an optional private note to the manager. **Never gate Google by rating** (Google policy).
- Guest WhatsApp messaging is **click-to-send** (prefilled wa.me / WhatsApp Web link, staff press Send) with editable per-property templates. First messages: welcome (phase 2), bill link (phase 3), review request (phase 4). The Business API comes later.
5. Reservations calendar, reports, Form C pending list
6. Subscription (Razorpay), PWA, polish
