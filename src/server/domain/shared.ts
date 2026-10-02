import type { Prisma } from "@prisma/client";
import type { Ctx } from "@/server/auth/context";
import type { Db } from "@/server/db";
import type { EntityType, NotificationType } from "@prisma/client";
import type { Permission } from "@/server/auth/permissions";

export type Json = Prisma.InputJsonValue;

export function actorLabel(ctx: Ctx): string {
  return ctx.impersonator ? `${ctx.impersonator.name} (platform support)` : ctx.userName;
}

/** Append to the tenant's audit trail. Always call inside the same transaction as the change. */
export async function audit(
  ctx: Ctx,
  action: string,
  entityType: string | null,
  entityId: string | null,
  metadata?: Record<string, unknown>,
  db: Db = ctx.db,
): Promise<void> {
  await db.auditLog.create({
    data: {
      tenantId: ctx.tenantId,
      actorUserId: ctx.impersonator?.userId ?? ctx.userId,
      actorName: ctx.impersonator ? ctx.impersonator.name : ctx.userName,
      impersonatorUserId: ctx.impersonator?.userId ?? null,
      action,
      entityType,
      entityId,
      metadata: (metadata ?? undefined) as Json | undefined,
      ip: ctx.meta.ip ?? null,
      userAgent: ctx.meta.userAgent?.slice(0, 300) ?? null,
    },
  });
}

export interface ActivityInput {
  customerId?: string | null;
  entityType: EntityType;
  entityId: string;
  type: string;
  summary: string;
  metadata?: Record<string, unknown>;
  actor?: { type: "USER" | "CUSTOMER" | "SYSTEM"; id?: string | null; name?: string | null };
}

/** Customer/record timeline entry. */
export async function recordActivity(
  db: Db,
  tenantId: string,
  ctx: Ctx | null,
  a: ActivityInput,
): Promise<void> {
  const actor = a.actor ?? (ctx ? { type: "USER" as const, id: ctx.userId, name: actorLabel(ctx) } : { type: "SYSTEM" as const });
  await db.activity.create({
    data: {
      tenantId,
      customerId: a.customerId ?? null,
      entityType: a.entityType,
      entityId: a.entityId,
      type: a.type,
      summary: a.summary,
      metadata: (a.metadata ?? undefined) as Json | undefined,
      actorType: actor.type,
      actorId: actor.id ?? null,
      actorName: actor.name ?? null,
    },
  });
}

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body?: string | null;
  href?: string | null;
  entityType?: EntityType;
  entityId?: string;
}

export async function notifyUsers(db: Db, tenantId: string, userIds: string[], n: NotifyInput): Promise<void> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  await db.notification.createMany({
    data: unique.map((userId) => ({
      tenantId,
      userId,
      type: n.type,
      title: n.title,
      body: n.body ?? null,
      href: n.href ?? null,
      entityType: n.entityType ?? null,
      entityId: n.entityId ?? null,
    })),
  });
}

/** Notify everyone in the tenant whose role grants `permission` (owners always qualify). */
export async function notifyWithPermission(
  db: Db,
  tenantId: string,
  permission: Permission,
  n: NotifyInput,
  exceptUserId?: string,
): Promise<void> {
  const members = await db.membership.findMany({
    where: {
      status: "ACTIVE",
      role: { OR: [{ key: "OWNER" }, { permissions: { has: permission } }] },
      ...(exceptUserId ? { userId: { not: exceptUserId } } : {}),
    },
    select: { userId: true },
  });
  await notifyUsers(db, tenantId, members.map((m) => m.userId), n);
}

export const toNumber = (d: { toString(): string } | number | null | undefined): number =>
  d == null ? 0 : typeof d === "number" ? d : Number(d.toString());

/** Audit entry for actions performed by someone who isn't a signed-in user (customer via public link, webhook). */
export async function auditAs(
  db: Db,
  tenantId: string,
  actor: { name: string; userId?: string | null },
  action: string,
  entityType: string | null,
  entityId: string | null,
  metadata?: Record<string, unknown>,
  meta: { ip?: string; userAgent?: string } = {},
): Promise<void> {
  await db.auditLog.create({
    data: {
      tenantId,
      actorUserId: actor.userId ?? null,
      actorName: actor.name,
      action,
      entityType,
      entityId,
      metadata: (metadata ?? undefined) as Json | undefined,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    },
  });
}

/** Local "today" as a UTC-midnight Date, for comparing against DATE columns. */
export function todayDateOnly(tz: string, now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return new Date(`${parts}T00:00:00.000Z`);
}
