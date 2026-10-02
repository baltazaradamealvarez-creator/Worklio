import { platformDb } from "@/server/db";
import { generateToken, hashToken } from "@/server/security/tokens";
import { rateLimit } from "@/server/security/rate-limit";
import { AppError } from "@/server/errors";
import { verifyPassword } from "./password";
import type { RequestMeta } from "./context";

export const SESSION_COOKIE = "wl_session";
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const SLIDE_AFTER_MS = 60 * 60 * 1000;
const MAX_FAILED_LOGINS = 8;
const LOCK_MS = 15 * 60 * 1000;

export async function createSession(
  userId: string,
  meta: RequestMeta,
  activeTenantId: string | null,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await platformDb().session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      activeTenantId,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      expiresAt,
    },
  });
  return { token, expiresAt };
}

export async function resolveSession(token: string) {
  const db = platformDb();
  const session = await db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session) return null;
  if (session.expiresAt <= new Date() || !session.user.isActive) {
    await db.session.deleteMany({ where: { id: session.id } });
    return null;
  }
  if (Date.now() - session.lastSeenAt.getTime() > SLIDE_AFTER_MS) {
    await db.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
    });
  }
  return session;
}

export async function destroySession(token: string): Promise<void> {
  await platformDb().session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export async function destroyAllSessions(userId: string): Promise<void> {
  await platformDb().session.deleteMany({ where: { userId } });
}

export async function switchTenant(sessionId: string, userId: string, tenantId: string): Promise<boolean> {
  const db = platformDb();
  const m = await db.membership.findFirst({
    where: { userId, tenantId, status: "ACTIVE", tenant: { status: { not: "SUSPENDED" } } },
  });
  if (!m) return false;
  await db.session.update({ where: { id: sessionId }, data: { activeTenantId: tenantId, impersonatingTenantId: null } });
  return true;
}

export interface AuthResult {
  userId: string;
  token: string;
  expiresAt: Date;
  isPlatformAdmin: boolean;
  activeTenantId: string | null;
}

/**
 * Verify credentials. Constant-ish work for unknown accounts, per-IP and per-account
 * throttling, and temporary lockout after repeated failures.
 */
export async function authenticate(email: string, password: string, meta: RequestMeta): Promise<AuthResult> {
  const normalized = email.trim().toLowerCase();
  await rateLimit(`login:ip:${meta.ip ?? "unknown"}`, 30, 15 * 60 * 1000);
  await rateLimit(`login:acct:${normalized}`, 15, 15 * 60 * 1000);

  const db = platformDb();
  const user = await db.user.findUnique({ where: { email: normalized } });
  const generic = new AppError("UNAUTHENTICATED", "Incorrect email or password.");

  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError("UNAUTHENTICATED", "Too many failed attempts. Try again in a few minutes or reset your password.");
  }
  const ok = await verifyPassword(password, user?.passwordHash ?? null);
  if (!user || !ok || !user.isActive) {
    if (user) {
      const failed = user.failedLoginCount + 1;
      await db.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: failed,
          lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MS) : null,
        },
      });
      await db.auditLog.create({
        data: {
          actorUserId: user.id,
          actorName: user.name,
          action: "auth.login_failed",
          entityType: "User",
          entityId: user.id,
          ip: meta.ip ?? null,
          userAgent: meta.userAgent?.slice(0, 300) ?? null,
        },
      });
    }
    throw generic;
  }

  await db.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  const memberships = await db.membership.findMany({
    where: { userId: user.id, status: "ACTIVE", tenant: { status: { not: "SUSPENDED" } } },
    orderBy: { createdAt: "asc" },
    select: { tenantId: true },
  });
  const activeTenantId = memberships[0]?.tenantId ?? null;
  if (!activeTenantId && !user.isPlatformAdmin) {
    throw new AppError("UNAUTHENTICATED", "Your account does not have access to an active company.");
  }
  const { token, expiresAt } = await createSession(user.id, meta, activeTenantId);
  await db.auditLog.create({
    data: {
      tenantId: activeTenantId,
      actorUserId: user.id,
      actorName: user.name,
      action: "auth.login",
      entityType: "User",
      entityId: user.id,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    },
  });
  return { userId: user.id, token, expiresAt, isPlatformAdmin: user.isPlatformAdmin, activeTenantId };
}
