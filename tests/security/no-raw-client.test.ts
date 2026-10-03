import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname, "../../src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}
const files = walk(SRC).map((f) => ({ rel: path.relative(SRC, f).replaceAll("\\", "/"), text: readFileSync(f, "utf8") }));

/** Modules allowed to use the cross-tenant (RLS-bypassing) client. Anything else must use a tenant handle. */
const PLATFORM_DB_ALLOWED = new Set([
  "server/db/index.ts",
  "server/auth/context.ts",
  "server/auth/session.ts",
  "server/auth/server.ts",
  "server/domain/tenants.ts",
  "server/domain/users.ts",
  "server/domain/limits.ts",
  "server/domain/public-links.ts",
  "server/domain/payments.ts", // processor webhooks resolve the tenant from the verified event
  "server/domain/settings.ts", // public logo lookup
  "server/domain/platform-settings.ts", // platform-admin settings (encrypted)
  "server/domain/platform-admin.ts", // cross-company views for platform operators
]);

describe("guard rails against bypassing tenant isolation", () => {
  it("nothing outside src/server/db imports the raw Prisma client", () => {
    const offenders = files.filter((f) => !f.rel.startsWith("server/db/") && /server\/db\/client|rawPrisma/.test(f.text)).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("nothing outside src/server/db instantiates PrismaClient", () => {
    const offenders = files.filter((f) => !f.rel.startsWith("server/db/") && /new PrismaClient\(/.test(f.text)).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("platformDb() (RLS bypass) is only used by an explicit allowlist of modules", () => {
    const offenders = files.filter((f) => /platformDb\(\)/.test(f.text) && !f.rel.startsWith("server/db/") && !PLATFORM_DB_ALLOWED.has(f.rel)).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("UI components and pages never import the database layer directly", () => {
    const offenders = files.filter((f) => (f.rel.startsWith("components/") || f.rel.startsWith("app/")) && /@\/server\/db/.test(f.text)).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("no source file reads a tenant id from request input", () => {
    const offenders = files.filter((f) => f.rel.startsWith("app/") && /(searchParams|formData|FormData|params)\S*\.?(get\()?\(?["']tenantId["']/.test(f.text)).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});
