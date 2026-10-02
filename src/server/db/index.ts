import { createPlatformHandle, createTenantHandle, type DbHandle } from "./scope";

export type { Db, DbHandle, ScopedPrisma, TxClient } from "./scope";
export { TENANT_MODELS } from "./scope";

const tenantHandles = new Map<string, DbHandle>();

/**
 * A database handle that can only ever see and write one tenant's rows.
 * `tenantId` must come from the authenticated server-side session (or a verified
 * public-link record) — never from request input.
 */
export function tenantDb(tenantId: string): DbHandle {
  let handle = tenantHandles.get(tenantId);
  if (!handle) {
    handle = createTenantHandle(tenantId);
    // Bounded cache: handles are cheap, but don't grow forever in long-lived processes.
    if (tenantHandles.size > 500) tenantHandles.clear();
    tenantHandles.set(tenantId, handle);
  }
  return handle;
}

let platform: DbHandle | undefined;

/**
 * Cross-tenant database handle that bypasses row-level security.
 *
 * Only for: platform-admin features, authentication (users/sessions/invitations),
 * resolving public links, and seeding. tests/security/no-raw-client.test.ts restricts
 * which modules may import it.
 */
export function platformDb(): DbHandle {
  return (platform ??= createPlatformHandle());
}
