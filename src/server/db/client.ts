import { PrismaClient } from "@prisma/client";

/**
 * The raw, UNSCOPED Prisma client.
 *
 * This module must only be imported from `src/server/db/*`. Everything else uses
 * `tenantDb(tenantId)` or `platformDb()` from `@/server/db`. tests/security/no-raw-client.test.ts
 * fails the build if any other file imports it.
 */
const globalForPrisma = globalThis as unknown as { __worklioPrisma?: PrismaClient };

export const rawPrisma: PrismaClient =
  globalForPrisma.__worklioPrisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG === "1" ? ["query", "warn", "error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.__worklioPrisma = rawPrisma;
