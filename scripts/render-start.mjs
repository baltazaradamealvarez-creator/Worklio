#!/usr/bin/env node
/**
 * Render start command.
 *  - Connects as the restricted `worklio_app` role (derived from DIRECT_URL + APP_DB_PASSWORD).
 *    If that role isn't available on this database, falls back to the owner connection.
 *  - Refuses to start if the chosen role could bypass row-level security (superuser / BYPASSRLS).
 *  - Defaults APP_URL to Render's public URL, then starts Next.js.
 */
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const env = { ...process.env };
const owner = env.DIRECT_URL;

async function check(url) {
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const rows = await prisma.$queryRawUnsafe("SELECT current_user AS u, (rolsuper OR rolbypassrls) AS bypass FROM pg_roles WHERE rolname = current_user");
    return rows[0] ?? null;
  } catch {
    return null;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

let url = env.DATABASE_URL;
if (!url) {
  if (!owner) throw new Error("Set DATABASE_URL, or DIRECT_URL and APP_DB_PASSWORD");
  if (env.APP_DB_PASSWORD) {
    const u = new URL(owner);
    u.username = "worklio_app";
    u.password = env.APP_DB_PASSWORD; // the URL setter percent-encodes
    if (await check(u.toString())) url = u.toString();
    else console.warn("[worklio] worklio_app is not usable; connecting as the database owner (RLS is still forced on tenant tables).");
  }
  url ??= owner;
}
const who = await check(url);
if (!who) throw new Error("Cannot connect to the database");
if (who.bypass) throw new Error(`Database role "${who.u}" can bypass row-level security. Refusing to start: tenant isolation would not be enforced.`);
console.log(`[worklio] database connected as ${who.u}`);

env.DATABASE_URL = url;
env.DIRECT_URL = url; // the runtime client doesn't migrate
if (!env.APP_URL && env.RENDER_EXTERNAL_URL) env.APP_URL = env.RENDER_EXTERNAL_URL;

const child = spawn("npx", ["next", "start", "-H", "0.0.0.0", "-p", env.PORT ?? "10000"], { env, stdio: "inherit" });
const forward = (sig) => () => child.kill(sig);
process.on("SIGTERM", forward("SIGTERM"));
process.on("SIGINT", forward("SIGINT"));
child.on("exit", (code) => process.exit(code ?? 0));
