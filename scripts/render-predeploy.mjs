#!/usr/bin/env node
/**
 * Render pre-deploy step: provision the restricted application database role, then migrate.
 *
 * Worklio enforces tenant isolation with Postgres row-level security, which only works if the
 * application connects as a role that is NOT the table owner, NOT a superuser and does NOT have
 * BYPASSRLS. Render's managed Postgres only hands out the owner credentials, so this script
 * creates `worklio_app` (idempotently) and sets its password from APP_DB_PASSWORD. The runtime
 * connection string is derived from DIRECT_URL + APP_DB_PASSWORD by scripts/render-start.mjs.
 *
 * Required env: DIRECT_URL (owner connection), APP_DB_PASSWORD.
 */
import { spawnSync } from "node:child_process";

const { DIRECT_URL, APP_DB_PASSWORD } = process.env;
if (!DIRECT_URL) throw new Error("DIRECT_URL is required");
if (!APP_DB_PASSWORD || APP_DB_PASSWORD.length < 16) throw new Error("APP_DB_PASSWORD (16+ chars) is required");

// The Prisma schema reads DATABASE_URL at parse time; point it at the owner connection for this step.
const env = { ...process.env, DATABASE_URL: DIRECT_URL };
const run = (args, input) => {
  const r = spawnSync("npx", ["prisma", ...args], { env, input, stdio: [input ? "pipe" : "inherit", "inherit", "inherit"], encoding: "utf8" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

const pw = APP_DB_PASSWORD.replace(/'/g, "''");
const roleSql = `
DO $do$
BEGIN
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'worklio_app') THEN
      CREATE ROLE worklio_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD '${pw}';
    ELSE
      ALTER ROLE worklio_app PASSWORD '${pw}';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'This database user cannot manage roles; the app will connect as the database owner instead (RLS is FORCEd on every tenant table, so isolation still applies).';
  END;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'worklio_app') THEN
    -- Row-level security is only enforced for roles like this one; refuse to run with anything else.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'worklio_app' AND (rolsuper OR rolbypassrls)) THEN
      RAISE EXCEPTION 'worklio_app must not be a superuser or have BYPASSRLS';
    END IF;
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO worklio_app', current_database());
  END IF;
END
$do$;`;

console.log("→ ensuring application role worklio_app");
run(["db", "execute", "--schema", "prisma/schema.prisma", "--stdin"], roleSql);

console.log("→ applying migrations");
run(["migrate", "deploy"]);

// Migrations grant privileges when the role exists; repeat here so a role created later still works.
console.log("→ verifying grants");
run(["db", "execute", "--schema", "prisma/schema.prisma", "--stdin"], `
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'worklio_app') THEN
    GRANT USAGE ON SCHEMA public TO worklio_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO worklio_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO worklio_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM worklio_app;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Could not adjust grants for worklio_app';
END
$do$;`);
console.log("✓ database ready");
