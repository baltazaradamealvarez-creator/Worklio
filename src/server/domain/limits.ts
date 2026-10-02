import { platformDb } from "@/server/db";
import type { Ctx } from "@/server/auth/context";
import { AppError } from "@/server/errors";

export interface TenantLimits {
  users: number;
  technicians: number;
  customers: number;
  storageMb: number;
}

export async function getLimits(tenantId: string): Promise<TenantLimits> {
  const sub = await platformDb().subscription.findUnique({ where: { tenantId }, include: { plan: true } });
  if (!sub) return { users: 5, technicians: 3, customers: 1000, storageMb: 5120 };
  return {
    users: sub.maxUsersOverride ?? sub.plan.maxUsers,
    technicians: sub.maxTechniciansOverride ?? sub.plan.maxTechnicians,
    customers: sub.maxCustomersOverride ?? sub.plan.maxCustomers,
    storageMb: sub.maxStorageMbOverride ?? sub.plan.maxStorageMb,
  };
}

export type LimitKind = keyof TenantLimits;

export async function assertWithinLimit(ctx: Pick<Ctx, "tenantId" | "db">, kind: LimitKind, adding = 1, bytes = 0): Promise<void> {
  const limits = await getLimits(ctx.tenantId);
  let used = 0;
  let label = "";
  switch (kind) {
    case "users":
      // Seats = active memberships + outstanding invitations
      used =
        (await ctx.db.membership.count({ where: { status: "ACTIVE" } })) +
        (await ctx.db.invitation.count({ where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }));
      label = "users";
      break;
    case "technicians":
      used = await ctx.db.employee.count({ where: { isTechnician: true, deletedAt: null, status: { not: "TERMINATED" } } });
      label = "technicians";
      break;
    case "customers":
      used = await ctx.db.customer.count({ where: { deletedAt: null } });
      label = "customers";
      break;
    case "storageMb": {
      const agg = await ctx.db.attachment.aggregate({ where: { deletedAt: null }, _sum: { sizeBytes: true } });
      used = Math.ceil(((agg._sum.sizeBytes ?? 0) + bytes) / (1024 * 1024));
      if (used > limits.storageMb) throw new AppError("LIMIT_EXCEEDED", `Storage limit of ${limits.storageMb} MB reached. Contact support to upgrade.`);
      return;
    }
  }
  if (used + adding > limits[kind]) {
    throw new AppError("LIMIT_EXCEEDED", `Your plan allows ${limits[kind]} ${label}. Contact support to upgrade.`);
  }
}
