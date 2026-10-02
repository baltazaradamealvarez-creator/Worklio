import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { platformDb } from "@/server/db";
import { env } from "@/server/env";
import { AppError } from "@/server/errors";
import { loadImpersonationContext, loadTenantContext, type Ctx, type RequestMeta } from "./context";
import { SESSION_COOKIE, destroySession, resolveSession } from "./session";

export async function requestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return { ip: fwd || h.get("x-real-ip") || undefined, userAgent: h.get("user-agent") || undefined };
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env().NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export interface AuthState {
  sessionId: string;
  user: { id: string; name: string; email: string; isPlatformAdmin: boolean };
  /** Tenant context if the user has an active company (or is impersonating one). */
  ctx: Ctx | null;
  impersonatingTenantId: string | null;
  companies: { tenantId: string; name: string }[];
}

/** Resolve the current request's authentication state (cached per request). */
export const getAuth = cache(async (): Promise<AuthState | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await resolveSession(token);
  if (!session) return null;
  const meta = await requestMeta();
  const db = platformDb();

  const memberships = await db.membership.findMany({
    where: { userId: session.userId, status: "ACTIVE", tenant: { status: { not: "SUSPENDED" } } },
    include: { tenant: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const companies = memberships.map((m) => ({ tenantId: m.tenantId, name: m.tenant.name }));

  let ctx: Ctx | null = null;
  if (session.impersonatingTenantId && session.user.isPlatformAdmin) {
    ctx = await loadImpersonationContext(session.userId, session.impersonatingTenantId, session.impersonationReason, meta);
  } else {
    const wanted =
      companies.find((c) => c.tenantId === session.activeTenantId)?.tenantId ?? companies[0]?.tenantId ?? null;
    if (wanted) ctx = await loadTenantContext(session.userId, wanted, meta);
  }
  return {
    sessionId: session.id,
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      isPlatformAdmin: session.user.isPlatformAdmin,
    },
    ctx,
    impersonatingTenantId: session.impersonatingTenantId,
    companies,
  };
});

/** Require a tenant context or redirect to login. */
export async function requireCtx(): Promise<Ctx> {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  if (!auth.ctx) redirect(auth.user.isPlatformAdmin ? "/platform" : "/no-access");
  return auth.ctx;
}

export async function requireAuth(): Promise<AuthState> {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  return auth;
}

/** Require the SaaS owner (platform administrator). Never satisfied by tenant roles. */
export async function requirePlatformAdmin(): Promise<AuthState> {
  const auth = await requireAuth();
  if (!auth.user.isPlatformAdmin) throw new AppError("FORBIDDEN", "Platform administrators only.");
  return auth;
}

export async function logout() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await destroySession(token);
  await clearSessionCookie();
}
