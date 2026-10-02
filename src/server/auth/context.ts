import { platformDb, tenantDb, type DbHandle } from "@/server/db";
import { forbidden } from "@/server/errors";
import { ALL_PERMISSIONS, type Permission } from "./permissions";

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

/**
 * The authenticated, server-resolved identity every service receives.
 * `tenantId`, `permissions` and `db` are derived from the session on the server and are
 * never taken from client input.
 */
export interface Ctx {
  tenantId: string;
  tenantName: string;
  userId: string;
  userName: string;
  userEmail: string;
  membershipId: string | null;
  employeeId: string | null;
  roleKey: string | null;
  roleName: string;
  permissions: ReadonlySet<string>;
  db: DbHandle;
  /** Present only while a platform admin is impersonating this tenant. */
  impersonator: { userId: string; name: string; reason: string | null } | null;
  meta: RequestMeta;
}

export function can(ctx: Pick<Ctx, "permissions">, permission: Permission): boolean {
  return ctx.permissions.has(permission);
}

export function canAny(ctx: Pick<Ctx, "permissions">, ...permissions: Permission[]): boolean {
  return permissions.some((p) => ctx.permissions.has(p));
}

export function requirePermission(ctx: Pick<Ctx, "permissions">, permission: Permission): void {
  if (!ctx.permissions.has(permission)) throw forbidden();
}

export function requireAnyPermission(ctx: Pick<Ctx, "permissions">, ...permissions: Permission[]): void {
  if (!permissions.some((p) => ctx.permissions.has(p))) throw forbidden();
}

/**
 * Build a context for a user inside a tenant from the database. Used by session
 * resolution and by tests / scripts. Returns null if the user has no active access.
 */
export async function loadTenantContext(
  userId: string,
  tenantId: string,
  meta: RequestMeta = {},
): Promise<Ctx | null> {
  const p = platformDb();
  const membership = await p.membership.findFirst({
    where: { tenantId, userId, status: "ACTIVE", user: { isActive: true } },
    include: { role: true, user: true, tenant: true },
  });
  if (!membership || membership.tenant.status === "SUSPENDED") return null;
  const employee = await p.employee.findFirst({
    where: { tenantId, membershipId: membership.id, deletedAt: null },
    select: { id: true },
  });
  const isOwner = membership.role.key === "OWNER";
  return {
    tenantId,
    tenantName: membership.tenant.name,
    userId,
    userName: membership.user.name,
    userEmail: membership.user.email,
    membershipId: membership.id,
    employeeId: employee?.id ?? null,
    roleKey: membership.role.key,
    roleName: membership.role.name,
    permissions: new Set(isOwner ? ALL_PERMISSIONS : membership.role.permissions),
    db: tenantDb(tenantId),
    impersonator: null,
    meta,
  };
}

/** Context for a platform admin who is impersonating a tenant (full access, always audited). */
export async function loadImpersonationContext(
  adminUserId: string,
  tenantId: string,
  reason: string | null,
  meta: RequestMeta = {},
): Promise<Ctx | null> {
  const p = platformDb();
  const [admin, tenant] = await Promise.all([
    p.user.findFirst({ where: { id: adminUserId, isPlatformAdmin: true, isActive: true } }),
    p.tenant.findUnique({ where: { id: tenantId } }),
  ]);
  if (!admin || !tenant) return null;
  return {
    tenantId,
    tenantName: tenant.name,
    userId: admin.id,
    userName: admin.name,
    userEmail: admin.email,
    membershipId: null,
    employeeId: null,
    roleKey: "PLATFORM_SUPPORT",
    roleName: "Platform support (impersonating)",
    permissions: new Set(ALL_PERMISSIONS),
    db: tenantDb(tenantId),
    impersonator: { userId: admin.id, name: admin.name, reason },
    meta,
  };
}
