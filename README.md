# Worklio

Multi-tenant business management for HVAC companies — customers, leads, jobs, dispatch, a touch-first technician app,
quotes with customer approval, invoices and payments, a customer portal, maintenance agreements, inventory, reporting,
and a platform-admin console for the operator.

> This repo uses a version of Next.js with breaking changes; see `AGENTS.md` and `node_modules/next/dist/docs/`.

## Quick start

```bash
cp .env.example .env              # adjust DB credentials
npm install
npm run db:reset                  # drop, migrate, seed demo data
npm run dev                       # http://localhost:3000
```

The database needs Postgres 16 with two roles: an owner (migrations/seed) and a restricted `worklio_app` runtime role
(no superuser, no `BYPASSRLS`) — see `.env.example` and `docs/ARCHITECTURE.md`.

Demo logins (password `ComfortDemo!2026`): `maria@comfortair.example` (owner), `tom@…` (dispatcher), `carlos@…` (technician).
Platform admin: `admin@worklio.example` / `WorklioAdmin!2026` → `/platform`. Demo data is for development only.

## Scripts

`npm run dev | build | start | lint | typecheck | test` · `npm run db:migrate | db:seed | db:reset`

## Docs

* `docs/ARCHITECTURE.md` — tenancy, security model, money, integrations
* `docs/DEPLOY.md` — deploying with the Render Blueprint (`render.yaml`)
