import type { Prisma } from "@prisma/client";
import { platformDb } from "@/server/db";
import { destroyAllSessions } from "@/server/auth/session";
import { AppError, invalidState, notFound } from "@/server/errors";
import { getEmailProvider } from "@/server/email/provider";
import { fromAddress } from "@/server/email/service";
import { email as emailSchema } from "@/lib/validation";
import { requestPasswordReset } from "./users";

/**
 * Cross-company views and actions for platform operators. Callers must have verified
 * `isPlatformAdmin` (the /platform layout and every platform server action do).
 */
type Actor = { userId: string; name: string };
const logAudit = (actor: Actor, action: string, entityId: string, metadata?: Record<string, string | number | boolean | null>) =>
  platformDb().auditLog.create({ data: { tenantId: null, actorUserId: actor.userId, actorName: actor.name, action, entityType: "User", entityId, metadata } });

// ─── Users across all companies ───────────────────────────────────────────────

export async function listAllUsers(opts: { q?: string; page: number; pageSize?: number }) {
  const take = opts.pageSize ?? 50;
  const where: Prisma.UserWhereInput = opts.q ? { OR: [{ email: { contains: opts.q, mode: "insensitive" } }, { name: { contains: opts.q, mode: "insensitive" } }] } : {};
  const db = platformDb();
  const [rows, total] = await Promise.all([
    db.user.findMany({
      where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take, skip: (opts.page - 1) * take,
      select: { id: true, email: true, name: true, isPlatformAdmin: true, isActive: true, lockedUntil: true, failedLoginCount: true, lastLoginAt: true, createdAt: true, memberships: { select: { status: true, tenant: { select: { id: true, name: true } }, role: { select: { name: true } } } } },
    }),
    db.user.count({ where }),
  ]);
  return { rows, total, pageSize: take };
}

export async function setUserActive(actor: Actor, userId: string, active: boolean) {
  if (userId === actor.userId) throw invalidState("You can't deactivate your own account.");
  const db = platformDb();
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u) throw notFound("User");
  await db.user.update({ where: { id: userId }, data: { isActive: active, ...(active ? { failedLoginCount: 0, lockedUntil: null } : {}) } });
  if (!active) await destroyAllSessions(userId);
  await logAudit(actor, active ? "platform.user_activated" : "platform.user_deactivated", userId, { email: u.email });
}

export async function unlockUser(actor: Actor, userId: string) {
  const db = platformDb();
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u) throw notFound("User");
  await db.user.update({ where: { id: userId }, data: { failedLoginCount: 0, lockedUntil: null } });
  await logAudit(actor, "platform.user_unlocked", userId, { email: u.email });
}

export async function sendUserPasswordReset(actor: Actor, userId: string) {
  const u = await platformDb().user.findUnique({ where: { id: userId } });
  if (!u) throw notFound("User");
  await requestPasswordReset(u.email, {});
  await logAudit(actor, "platform.password_reset_sent", userId, { email: u.email });
}

// ─── Invoices & revenue across all companies ──────────────────────────────────

export async function listAllInvoices(opts: { q?: string; tenantId?: string; status?: string; page: number; pageSize?: number }) {
  const take = opts.pageSize ?? 50;
  const and: Prisma.InvoiceWhereInput[] = [];
  if (opts.tenantId) and.push({ tenantId: opts.tenantId });
  if (opts.status && ["DRAFT", "OPEN", "SENT", "VIEWED", "PARTIALLY_PAID", "PAID", "VOID"].includes(opts.status)) and.push({ status: opts.status as never });
  if (opts.q) and.push({ OR: [{ number: { contains: opts.q, mode: "insensitive" } }, { customer: { displayName: { contains: opts.q, mode: "insensitive" } } }, { tenant: { name: { contains: opts.q, mode: "insensitive" } } }] });
  const where = { AND: and };
  const db = platformDb();
  const [rows, total, sums] = await Promise.all([
    db.invoice.findMany({ where, orderBy: [{ issueDate: "desc" }, { id: "desc" }], take, skip: (opts.page - 1) * take, select: { id: true, number: true, status: true, issueDate: true, dueDate: true, totalCents: true, balanceCents: true, tenant: { select: { id: true, name: true } }, customer: { select: { displayName: true } } } }),
    db.invoice.count({ where }),
    db.invoice.aggregate({ where: { AND: [...and, { status: { notIn: ["DRAFT", "VOID"] } }] }, _sum: { totalCents: true, balanceCents: true } }),
  ]);
  return { rows, total, pageSize: take, totalCents: sums._sum.totalCents ?? 0, balanceCents: sums._sum.balanceCents ?? 0 };
}

export async function revenueByCompany() {
  const db = platformDb();
  const [tenants, invoiced, collected, outstanding] = await Promise.all([
    db.tenant.findMany({ select: { id: true, name: true, status: true }, orderBy: { name: "asc" } }),
    db.invoice.groupBy({ by: ["tenantId"], where: { status: { notIn: ["DRAFT", "VOID"] } }, _sum: { totalCents: true }, _count: true }),
    db.payment.groupBy({ by: ["tenantId"], where: { status: "SUCCEEDED" }, _sum: { amountCents: true } }),
    db.invoice.groupBy({ by: ["tenantId"], where: { status: { in: ["OPEN", "SENT", "VIEWED", "PARTIALLY_PAID"] } }, _sum: { balanceCents: true } }),
  ]);
  const map = <T extends { tenantId: string }>(r: T[]) => new Map(r.map((x) => [x.tenantId, x]));
  const i = map(invoiced), c = map(collected), o = map(outstanding);
  return tenants.map((t) => ({ ...t, invoiceCount: i.get(t.id)?._count ?? 0, invoicedCents: i.get(t.id)?._sum.totalCents ?? 0, collectedCents: c.get(t.id)?._sum.amountCents ?? 0, outstandingCents: o.get(t.id)?._sum.balanceCents ?? 0 }));
}

// ─── Email test ────────────────────────────────────────────────────────────────

export async function sendTestEmail(to: string) {
  const parsed = emailSchema.safeParse(to);
  if (!parsed.success) throw new AppError("VALIDATION", "Enter a valid email address.", { to: "Invalid email" });
  const provider = await getEmailProvider();
  try {
    await provider.send({ from: await fromAddress("Worklio"), to: parsed.data, subject: "Worklio test email", text: "If you can read this, email delivery from Worklio is working.", html: "<p>If you can read this, email delivery from Worklio is working.</p>" });
  } catch (e) {
    throw new AppError("VALIDATION", `Sending failed: ${e instanceof Error ? e.message : "unknown error"}`);
  }
  return { provider: provider.name };
}
