# Worklio architecture

Worklio is a multi-tenant operating system for HVAC companies: CRM, leads, jobs, dispatch, a technician app,
quotes, invoices and payments, a customer portal, maintenance agreements, inventory, expenses and reporting.

* **Stack:** Next.js 16 (App Router, server actions), React 19, TypeScript, Tailwind v4, Prisma 6, PostgreSQL 16, Zod 4, Vitest.
* **Layout:** `src/server` is the only place that touches data (domain services, auth, email, storage, payments, PDF);
  `src/app` and `src/components` render and call domain services through server actions; `src/lib` holds pure code
  (money, formatting, state machines, validation).

## Tenant isolation (three independent layers)

1. **Scoped client.** Application code never gets the raw Prisma client. `tenantDb(tenantId)` injects `tenantId` into every
   query and write, runs each operation in a transaction that sets `app.tenant_id`, and refuses models that aren't tenant-owned.
   `platformDb()` (RLS bypass for sign-in, platform admin, public links and webhooks) is limited to an allowlist of modules,
   enforced by `tests/security/no-raw-client.test.ts`.
2. **Row-level security.** Every `tenantId` table has `ENABLE` + `FORCE ROW LEVEL SECURITY` with a policy comparing
   `tenantId` to `current_setting('app.tenant_id')`. The runtime role (`worklio_app`) is not a superuser, not the table owner and
   has no `BYPASSRLS`. The audit log is insert/select only for that role and has update/delete/truncate triggers.
3. **Composite foreign keys.** Tenant-owned tables reference each other by `(tenantId, id)`, so a row in tenant A can't point
   at a row in tenant B even if application code were wrong.

The tenant id always comes from the server-side session (`getAuth()` → `Ctx`). It is never read from forms, query strings or
route params. Public customer links resolve a hashed token to `(tenantId, entity)` in the database.

## Authentication, sessions, impersonation

scrypt password hashes; session tokens stored only as SHA-256 hashes (cookie `wl_session`); lockout and rate limiting;
single-use hashed invitation and password-reset tokens. Platform admins can open a company only through an explicit support
session: a reason is required, a persistent red banner is shown, and start/stop plus every change are written to both the
platform and the company's audit trail.

## Authorization

A catalog of permissions (`src/server/auth/permissions.ts`) is grouped into built-in roles (Owner, Administrator,
Office Manager, Dispatcher, Service Manager, Sales, Accounting, Technician, Installer, Read Only) plus custom roles.
Every domain function calls `requirePermission`; the UI hides controls but is never the authority. Further guards:

* privilege-escalation checks (you can only grant permissions you hold; only owners manage owners; a company keeps ≥ 1 owner),
* field-only scoping for technicians (`jobScope`, `customerScope`: only assigned jobs and their customers),
* redaction of sensitive fields (compensation, emergency contacts, access codes, internal costs),
* private notes visible only to their author and holders of `notes.view_private`.

## Money and documents

Money is stored as integer cents, rates as basis points, quantities as hundredths. `src/lib/money.ts` is the single calculation
path (half-away-from-zero rounding, proportional discount allocation across taxable lines); the server **recomputes every
total** and takes costs from the pricebook, so a tampered client can't change prices. Documents are numbered per company with a
gap-free counter (`INSERT … ON CONFLICT … RETURNING`). Quotes/invoices/jobs/appointments/leads/agreements follow explicit
state machines in `src/lib/state.ts`; "past due" and agreement expiry are derived, never stored.

## Integrations behind interfaces

* **Email:** `console` or `resend`, branded templates, every message stored in `EmailMessage`.
* **Storage:** local disk or S3-compatible; opaque tenant-prefixed keys; magic-byte validation; downloads go through an
  authenticated route that re-checks entity access.
* **Payments:** `manual` or `stripe` (hosted checkout; no card data touches Worklio). Webhooks are HMAC-verified and idempotent.

## Testing

`npm test` runs ~240 tests against a real Postgres (`worklio_test`, rebuilt from migrations each run): money math, RLS, a
cross-tenant attack suite over every domain function, auth, file safety, quote→invoice→payment workflows, scheduling conflicts,
permissions, public links, Stripe signatures, CSV injection and timezone-correct reporting.

## Operational notes

Financial screens are management reports, not accounting. Background work (renewal reminders, quote expiry) is idempotent and
safe to call from a scheduler. Deployment: see `docs/DEPLOY.md`.
