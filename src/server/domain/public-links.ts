import { addDays } from "date-fns";
import type { PublicLinkKind } from "@prisma/client";
import type { Db } from "@/server/db";
import { platformDb, tenantDb, type DbHandle } from "@/server/db";
import { env } from "@/server/env";
import { generateToken, hashToken } from "@/server/security/tokens";
import { rateLimit } from "@/server/security/rate-limit";
import { AppError } from "@/server/errors";

/**
 * Secure, unguessable links for customers (quotes, invoices, portal). The raw token appears
 * only in the emailed URL; the database holds a SHA-256 hash, so a database leak does not
 * leak working links. Links can expire and be revoked, and are rate-limited per client.
 */
export const LINK_TTL_DAYS: Record<PublicLinkKind, number> = { QUOTE: 60, INVOICE: 365, PORTAL: 30 };

export function publicUrl(kind: PublicLinkKind, token: string): string {
  const base = env().APP_URL;
  return kind === "QUOTE" ? `${base}/q/${token}` : kind === "INVOICE" ? `${base}/i/${token}` : `${base}/portal/${token}`;
}

export async function issuePublicLink(
  db: Db,
  tenantId: string,
  input: { kind: PublicLinkKind; entityId: string; customerId?: string | null; expiresAt?: Date | null; createdById?: string | null; revokeExisting?: boolean },
): Promise<{ token: string; url: string }> {
  if (input.revokeExisting !== false) {
    await db.publicLink.updateMany({ where: { kind: input.kind, entityId: input.entityId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
  const token = generateToken();
  await db.publicLink.create({
    data: {
      tenantId,
      kind: input.kind,
      entityId: input.entityId,
      customerId: input.customerId ?? null,
      tokenHash: hashToken(token),
      expiresAt: input.expiresAt === undefined ? addDays(new Date(), LINK_TTL_DAYS[input.kind]) : input.expiresAt,
      createdById: input.createdById ?? null,
    },
  });
  return { token, url: publicUrl(input.kind, token) };
}

export async function revokePublicLinks(db: Db, kind: PublicLinkKind, entityId: string): Promise<void> {
  await db.publicLink.updateMany({ where: { kind, entityId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export interface ResolvedLink {
  linkId: string;
  tenantId: string;
  kind: PublicLinkKind;
  entityId: string;
  customerId: string | null;
  firstView: boolean;
  /** Tenant-scoped database handle derived from the verified link — never from the URL. */
  db: DbHandle;
}

/**
 * Resolve a raw token to its (verified) tenant + entity. Applies a per-client rate limit and
 * returns null for unknown / revoked / expired tokens — callers should render a generic 404.
 */
export async function resolvePublicLink(token: string, kind: PublicLinkKind, client: { ip?: string }): Promise<ResolvedLink | null> {
  await rateLimit(`public:${client.ip ?? "unknown"}`, 120, 60_000).catch(() => {
    throw new AppError("RATE_LIMITED", "Too many requests. Please wait a moment and try again.");
  });
  if (!/^[A-Za-z0-9_-]{30,80}$/.test(token)) return null;
  const link = await platformDb().publicLink.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!link || link.kind !== kind || link.revokedAt || (link.expiresAt && link.expiresAt < new Date())) return null;
  const tenant = await platformDb().tenant.findUnique({ where: { id: link.tenantId }, select: { status: true } });
  if (!tenant || tenant.status === "SUSPENDED") return null;
  return { linkId: link.id, tenantId: link.tenantId, kind: link.kind, entityId: link.entityId, customerId: link.customerId, firstView: !link.firstViewedAt, db: tenantDb(link.tenantId) };
}

export async function touchPublicLink(link: ResolvedLink): Promise<void> {
  await link.db.publicLink.update({
    where: { id: link.linkId },
    data: { viewCount: { increment: 1 }, lastViewedAt: new Date(), ...(link.firstView ? { firstViewedAt: new Date() } : {}) },
  });
}

/**
 * Resolve a link to a specific quote/invoice. Accepts either that document's own link, or a
 * customer PORTAL link provided the document belongs to the portal's customer.
 */
export async function resolveDocumentLink(token: string, kind: "QUOTE" | "INVOICE", docId: string | undefined, client: { ip?: string }): Promise<ResolvedLink | null> {
  if (!docId) return resolvePublicLink(token, kind, client);
  const portal = await resolvePublicLink(token, "PORTAL", client);
  if (!portal?.customerId) return null;
  const owned = kind === "QUOTE"
    ? await portal.db.quote.findFirst({ where: { id: docId, customerId: portal.customerId, deletedAt: null, status: { not: "DRAFT" } }, select: { id: true } })
    : await portal.db.invoice.findFirst({ where: { id: docId, customerId: portal.customerId, status: { not: "DRAFT" } }, select: { id: true } });
  return owned ? { ...portal, kind, entityId: docId } : null;
}
