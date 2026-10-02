import { addDays } from "date-fns";
import { platformDb, tenantDb } from "@/server/db";
import type { Db } from "@/server/db";
import { SYSTEM_ROLES } from "@/server/auth/permissions";
import { env } from "@/server/env";
import { AppError, conflict, notFound } from "@/server/errors";
import { slugify } from "@/lib/format";
import { email as emailSchema, parseInput, str } from "@/lib/validation";
import { z } from "zod";
import { generateToken, hashToken } from "@/server/security/tokens";
import { invitationEmail } from "@/server/email/templates";
import { deliverEmail, loadBranding } from "@/server/email/service";
import { DEFAULT_CHECKLISTS, DEFAULT_JOB_TYPES, DEFAULT_PLANS, DEFAULT_PRICEBOOK_CATEGORIES } from "./defaults";

export const INVITE_TTL_DAYS = 7;

export async function ensureDefaultPlans(): Promise<void> {
  const db = platformDb();
  for (const p of DEFAULT_PLANS) {
    await db.plan.upsert({ where: { key: p.key }, update: {}, create: { ...p } });
  }
}

/** Install roles, job types, pricebook categories and checklists into a fresh tenant. */
export async function installTenantDefaults(db: Db, tenantId: string): Promise<{ ownerRoleId: string }> {
  const roleIds: Record<string, string> = {};
  for (const r of SYSTEM_ROLES) {
    const role = await db.role.create({
      data: { tenantId, key: r.key, name: r.name, description: r.description, isSystem: true, permissions: r.permissions },
    });
    roleIds[r.key] = role.id;
  }
  const typeIds: Record<string, string> = {};
  for (const t of DEFAULT_JOB_TYPES) {
    const jt = await db.jobType.create({ data: { tenantId, ...t } });
    typeIds[t.name] = jt.id;
  }
  await db.pricebookCategory.createMany({
    data: DEFAULT_PRICEBOOK_CATEGORIES.map((c, i) => ({ tenantId, name: c.name, kind: c.kind, position: i })),
  });
  for (const c of DEFAULT_CHECKLISTS) {
    await db.checklistTemplate.create({ data: { tenantId, jobTypeId: typeIds[c.jobType] ?? null, name: c.name, items: c.items } });
  }
  return { ownerRoleId: roleIds.OWNER! };
}

const createTenantSchema = z.object({
  companyName: str(120),
  ownerName: str(120),
  ownerEmail: emailSchema,
  planKey: str(40).default("starter"),
  trialDays: z.coerce.number().int().min(0).max(120).default(14),
});
export type CreateTenantInput = z.input<typeof createTenantSchema>;

async function uniqueSlug(base: string): Promise<string> {
  const db = platformDb();
  const root = slugify(base) || "company";
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    if (!(await db.tenant.findUnique({ where: { slug: candidate }, select: { id: true } }))) return candidate;
  }
  return `${root}-${generateToken(4).toLowerCase()}`;
}

/**
 * Create a new HVAC company (tenant) with defaults and an owner invitation.
 * Platform admin only (caller must have verified `isPlatformAdmin`).
 */
export async function provisionTenant(
  actor: { userId: string; name: string },
  rawInput: CreateTenantInput,
  opts: { sendInvite?: boolean } = {},
): Promise<{ tenantId: string; inviteUrl: string }> {
  const input = parseInput(createTenantSchema, rawInput);
  const db = platformDb();
  const plan = await db.plan.findUnique({ where: { key: input.planKey } });
  if (!plan || !plan.isActive) throw new AppError("VALIDATION", "Choose a valid plan.");
  const slug = await uniqueSlug(input.companyName);
  const token = generateToken();

  const tenant = await db.tx(async (tx) => {
    const t = await tx.tenant.create({ data: { name: input.companyName, slug, status: "ACTIVE", createdById: actor.userId } });
    await tx.subscription.create({
      data: {
        tenantId: t.id,
        planId: plan.id,
        status: input.trialDays > 0 ? "TRIALING" : "ACTIVE",
        trialEndsAt: input.trialDays > 0 ? addDays(new Date(), input.trialDays) : null,
      },
    });
    await tx.tenantSettings.create({ data: { tenantId: t.id, legalName: input.companyName, email: input.ownerEmail } });
    const { ownerRoleId } = await installTenantDefaults(tx, t.id);
    await tx.invitation.create({
      data: {
        tenantId: t.id,
        email: input.ownerEmail,
        name: input.ownerName,
        roleId: ownerRoleId,
        tokenHash: hashToken(token),
        invitedById: actor.userId,
        expiresAt: addDays(new Date(), INVITE_TTL_DAYS),
      },
    });
    await tx.auditLog.create({
      data: {
        tenantId: null,
        actorUserId: actor.userId,
        actorName: actor.name,
        action: "platform.tenant_created",
        entityType: "Tenant",
        entityId: t.id,
        metadata: { name: t.name, plan: plan.key, ownerEmail: input.ownerEmail },
      },
    });
    return t;
  });

  const inviteUrl = `${env().APP_URL}/accept-invite/${token}`;
  if (opts.sendInvite !== false) {
    const tdb = tenantDb(tenant.id);
    const brand = await loadBranding(tdb, tenant.id);
    const email = invitationEmail(brand, {
      inviteeName: input.ownerName,
      inviterName: "The Worklio team",
      roleName: "Company Owner",
      url: inviteUrl,
      expiresInDays: INVITE_TTL_DAYS,
    });
    try {
      await deliverEmail(tdb, tenant.id, { template: "invitation", to: input.ownerEmail, email, companyName: brand.companyName, sentById: actor.userId });
    } catch {
      // The invitation exists; the platform admin can resend or copy the link.
    }
  }
  return { tenantId: tenant.id, inviteUrl };
}

/** Re-issue the owner invitation (platform support). Returns the fresh link. */
export async function reissueOwnerInvitation(actor: { userId: string; name: string }, tenantId: string): Promise<{ inviteUrl: string; email: string }> {
  const db = platformDb();
  const existing = await db.invitation.findFirst({
    where: { tenantId, role: { key: "OWNER" }, acceptedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!existing) throw conflict("This company already has an active owner, or no owner invitation exists.");
  const token = generateToken();
  await db.invitation.update({
    where: { id: existing.id },
    data: { tokenHash: hashToken(token), expiresAt: addDays(new Date(), INVITE_TTL_DAYS), revokedAt: null },
  });
  await db.auditLog.create({
    data: { tenantId: null, actorUserId: actor.userId, actorName: actor.name, action: "platform.invitation_reissued", entityType: "Tenant", entityId: tenantId },
  });
  const inviteUrl = `${env().APP_URL}/accept-invite/${token}`;
  const tdb = tenantDb(tenantId);
  const brand = await loadBranding(tdb, tenantId);
  try {
    await deliverEmail(tdb, tenantId, {
      template: "invitation",
      to: existing.email,
      email: invitationEmail(brand, { inviteeName: existing.name, inviterName: "The Worklio team", roleName: "Company Owner", url: inviteUrl, expiresInDays: INVITE_TTL_DAYS }),
      companyName: brand.companyName,
      sentById: actor.userId,
    });
  } catch {
    /* link is still returned to the admin */
  }
  return { inviteUrl, email: existing.email };
}

export async function setTenantStatus(actor: { userId: string; name: string }, tenantId: string, status: "ACTIVE" | "SUSPENDED", reason?: string): Promise<void> {
  const db = platformDb();
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw notFound("Company");
  await db.tx(async (tx) => {
    await tx.tenant.update({
      where: { id: tenantId },
      data: status === "SUSPENDED" ? { status, suspendedAt: new Date(), suspendedReason: reason ?? null } : { status, suspendedAt: null, suspendedReason: null },
    });
    await tx.auditLog.create({
      data: {
        tenantId: null,
        actorUserId: actor.userId,
        actorName: actor.name,
        action: status === "SUSPENDED" ? "platform.tenant_suspended" : "platform.tenant_activated",
        entityType: "Tenant",
        entityId: tenantId,
        metadata: { reason: reason ?? null, name: tenant.name },
      },
    });
  });
}

const subscriptionSchema = z.object({
  planKey: str(40),
  status: z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "CANCELLED"]),
  trialEndsAt: z.string().optional().nullable(),
  maxUsersOverride: z.coerce.number().int().min(1).optional().nullable().or(z.literal("").transform(() => null)),
  maxTechniciansOverride: z.coerce.number().int().min(0).optional().nullable().or(z.literal("").transform(() => null)),
  maxCustomersOverride: z.coerce.number().int().min(1).optional().nullable().or(z.literal("").transform(() => null)),
  maxStorageMbOverride: z.coerce.number().int().min(1).optional().nullable().or(z.literal("").transform(() => null)),
});

export async function updateSubscription(actor: { userId: string; name: string }, tenantId: string, raw: unknown): Promise<void> {
  const input = parseInput(subscriptionSchema, raw);
  const db = platformDb();
  const plan = await db.plan.findUnique({ where: { key: input.planKey } });
  if (!plan) throw new AppError("VALIDATION", "Unknown plan.");
  await db.tx(async (tx) => {
    const before = await tx.subscription.findUnique({ where: { tenantId }, include: { plan: true } });
    const data = {
      planId: plan.id,
      status: input.status,
      trialEndsAt: input.trialEndsAt ? new Date(input.trialEndsAt) : null,
      cancelledAt: input.status === "CANCELLED" ? new Date() : null,
      maxUsersOverride: input.maxUsersOverride ?? null,
      maxTechniciansOverride: input.maxTechniciansOverride ?? null,
      maxCustomersOverride: input.maxCustomersOverride ?? null,
      maxStorageMbOverride: input.maxStorageMbOverride ?? null,
    };
    await tx.subscription.upsert({ where: { tenantId }, update: data, create: { tenantId, ...data } });
    await tx.auditLog.create({
      data: {
        tenantId: null,
        actorUserId: actor.userId,
        actorName: actor.name,
        action: "platform.subscription_updated",
        entityType: "Tenant",
        entityId: tenantId,
        metadata: { fromPlan: before?.plan.key ?? null, toPlan: plan.key, status: input.status },
      },
    });
  });
}

const planSchema = z.object({
  key: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,30}$/, "Lowercase letters, numbers and dashes"),
  name: str(60),
  description: z.string().trim().max(200).optional().nullable(),
  priceMonthlyCents: z.coerce.number().int().min(0),
  maxUsers: z.coerce.number().int().min(1),
  maxTechnicians: z.coerce.number().int().min(0),
  maxCustomers: z.coerce.number().int().min(1),
  maxStorageMb: z.coerce.number().int().min(1),
  isActive: z.coerce.boolean().default(true),
});

export async function upsertPlan(actor: { userId: string; name: string }, raw: unknown): Promise<void> {
  const input = parseInput(planSchema, raw);
  const db = platformDb();
  await db.plan.upsert({
    where: { key: input.key },
    update: { ...input, key: undefined },
    create: input,
  });
  await db.auditLog.create({
    data: { tenantId: null, actorUserId: actor.userId, actorName: actor.name, action: "platform.plan_saved", entityType: "Plan", entityId: input.key },
  });
}

// ─── Impersonation ───────────────────────────────────────────────────────────

export async function startImpersonation(
  actor: { userId: string; name: string; sessionId: string },
  tenantId: string,
  reason: string,
  meta: { ip?: string; userAgent?: string } = {},
): Promise<void> {
  if (reason.trim().length < 5) throw new AppError("VALIDATION", "Enter a reason for accessing this company (at least 5 characters).");
  const db = platformDb();
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw notFound("Company");
  await db.tx(async (tx) => {
    await tx.session.update({ where: { id: actor.sessionId }, data: { impersonatingTenantId: tenantId, impersonationReason: reason.trim() } });
    // Recorded in BOTH the platform trail and the company's own trail so the customer can see it.
    for (const t of [null, tenantId]) {
      await tx.auditLog.create({
        data: {
          tenantId: t,
          actorUserId: actor.userId,
          actorName: actor.name,
          impersonatorUserId: actor.userId,
          action: "platform.impersonation_started",
          entityType: "Tenant",
          entityId: tenantId,
          metadata: { reason: reason.trim(), tenant: tenant.name },
          ip: meta.ip ?? null,
          userAgent: meta.userAgent?.slice(0, 300) ?? null,
        },
      });
    }
  });
}

export async function stopImpersonation(actor: { userId: string; name: string; sessionId: string }, tenantId: string): Promise<void> {
  const db = platformDb();
  await db.tx(async (tx) => {
    await tx.session.update({ where: { id: actor.sessionId }, data: { impersonatingTenantId: null, impersonationReason: null } });
    for (const t of [null, tenantId]) {
      await tx.auditLog.create({
        data: { tenantId: t, actorUserId: actor.userId, actorName: actor.name, impersonatorUserId: actor.userId, action: "platform.impersonation_ended", entityType: "Tenant", entityId: tenantId },
      });
    }
  });
}

// ─── Platform listings ───────────────────────────────────────────────────────

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: Date;
  onboardingCompletedAt: Date | null;
  plan: string | null;
  subscriptionStatus: string | null;
  trialEndsAt: Date | null;
  users: number;
  technicians: number;
  customers: number;
  storageBytes: number;
  lastActivityAt: Date | null;
}

export async function listTenants(opts: { q?: string; status?: string } = {}): Promise<TenantSummary[]> {
  const db = platformDb();
  const tenants = await db.tenant.findMany({
    where: {
      ...(opts.q ? { OR: [{ name: { contains: opts.q, mode: "insensitive" } }, { slug: { contains: opts.q, mode: "insensitive" } }] } : {}),
      ...(opts.status === "ACTIVE" || opts.status === "SUSPENDED" ? { status: opts.status } : {}),
    },
    include: { subscription: { include: { plan: true } } },
    orderBy: { createdAt: "desc" },
  });
  const ids = tenants.map((t) => t.id);
  const [members, techs, customers, storage, activity] = await Promise.all([
    db.membership.groupBy({ by: ["tenantId"], where: { tenantId: { in: ids }, status: "ACTIVE" }, _count: { _all: true } }),
    db.employee.groupBy({ by: ["tenantId"], where: { tenantId: { in: ids }, isTechnician: true, deletedAt: null, status: { not: "TERMINATED" } }, _count: { _all: true } }),
    db.customer.groupBy({ by: ["tenantId"], where: { tenantId: { in: ids }, deletedAt: null }, _count: { _all: true } }),
    db.attachment.groupBy({ by: ["tenantId"], where: { tenantId: { in: ids }, deletedAt: null }, _sum: { sizeBytes: true } }),
    db.activity.groupBy({ by: ["tenantId"], where: { tenantId: { in: ids } }, _max: { createdAt: true } }),
  ]);
  const by = <T extends { tenantId: string }>(rows: T[]) => new Map(rows.map((r) => [r.tenantId, r]));
  const m = by(members), t = by(techs), c = by(customers), s = by(storage), a = by(activity);
  return tenants.map((x) => ({
    id: x.id,
    name: x.name,
    slug: x.slug,
    status: x.status,
    createdAt: x.createdAt,
    onboardingCompletedAt: x.onboardingCompletedAt,
    plan: x.subscription?.plan.name ?? null,
    subscriptionStatus: x.subscription?.status ?? null,
    trialEndsAt: x.subscription?.trialEndsAt ?? null,
    users: m.get(x.id)?._count._all ?? 0,
    technicians: t.get(x.id)?._count._all ?? 0,
    customers: c.get(x.id)?._count._all ?? 0,
    storageBytes: s.get(x.id)?._sum.sizeBytes ?? 0,
    lastActivityAt: a.get(x.id)?._max.createdAt ?? null,
  }));
}

export async function platformMetrics() {
  const db = platformDb();
  const [tenants, suspended, users, customers, jobs, storage, trialing] = await Promise.all([
    db.tenant.count(),
    db.tenant.count({ where: { status: "SUSPENDED" } }),
    db.user.count({ where: { isActive: true } }),
    db.customer.count({ where: { deletedAt: null } }),
    db.job.count({ where: { deletedAt: null } }),
    db.attachment.aggregate({ where: { deletedAt: null }, _sum: { sizeBytes: true } }),
    db.subscription.count({ where: { status: "TRIALING" } }),
  ]);
  return { tenants, suspended, users, customers, jobs, storageBytes: storage._sum.sizeBytes ?? 0, trialing };
}
