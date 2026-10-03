import { z } from "zod";
import { requirePermission, type Ctx } from "@/server/auth/context";
import { AppError, notFound } from "@/server/errors";
import { normalizePhone } from "@/lib/format";
import { optEmail, optPhone, optStr, parseInput, str } from "@/lib/validation";
import { deliverEmail, loadBranding } from "@/server/email/service";
import { portalAccessEmail } from "@/server/email/templates";
import { issuePublicLink, resolvePublicLink, type ResolvedLink } from "./public-links";
import { audit, auditAs, notifyWithPermission, recordActivity } from "./shared";

/** Staff action: create (and optionally email) a portal link for a customer. */
export async function issuePortalLink(ctx: Ctx, customerId: string, opts: { send: boolean }) {
  requirePermission(ctx, "customers.edit");
  const c = await ctx.db.customer.findFirst({ where: { id: customerId, deletedAt: null } });
  if (!c) throw notFound("Customer");
  if (opts.send && !c.email) throw new AppError("VALIDATION", "This customer has no email address.");
  const { url } = await issuePublicLink(ctx.db, ctx.tenantId, { kind: "PORTAL", entityId: c.id, customerId: c.id, createdById: ctx.userId });
  if (opts.send && c.email) {
    const brand = await loadBranding(ctx.db, ctx.tenantId);
    await deliverEmail(ctx.db, ctx.tenantId, { template: "portal", to: c.email, email: portalAccessEmail(brand, { customerName: c.displayName, url }), companyName: brand.companyName, replyTo: brand.email, customerId: c.id, entityType: "CUSTOMER", entityId: c.id, sentById: ctx.userId });
    await recordActivity(ctx.db, ctx.tenantId, ctx, { customerId: c.id, entityType: "CUSTOMER", entityId: c.id, type: "email.portal", summary: `Customer portal link emailed to ${c.email}` });
  }
  await audit(ctx, "portal.link_issued", "Customer", c.id, { emailed: opts.send });
  return { url };
}

export async function loadPortal(link: ResolvedLink) {
  if (!link.customerId) return null;
  const customerId = link.customerId;
  const db = link.db;
  const now = new Date();
  const [customer, appointments, quotes, invoices, history, agreements, brand, settings] = await Promise.all([
    db.customer.findFirst({ where: { id: customerId, deletedAt: null }, select: { displayName: true, phone: true, phoneAlt: true, email: true, preferredContact: true } }),
    db.appointment.findMany({ where: { job: { customerId, deletedAt: null }, startsAt: { gte: now }, status: { in: ["SCHEDULED", "DISPATCHED", "EN_ROUTE"] } }, orderBy: { startsAt: "asc" }, take: 10, select: { id: true, startsAt: true, endsAt: true, windowStart: true, windowEnd: true, status: true, job: { select: { title: true, location: { select: { addressLine1: true, city: true, state: true } } } }, assignees: { select: { employee: { select: { firstName: true } } } } } }),
    db.quote.findMany({ where: { customerId, deletedAt: null, status: { not: "DRAFT" } }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, number: true, title: true, status: true, totalCents: true, issueDate: true, expiresAt: true } }),
    db.invoice.findMany({ where: { customerId, status: { not: "DRAFT" } }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, number: true, title: true, status: true, totalCents: true, balanceCents: true, dueDate: true, issueDate: true } }),
    db.job.findMany({ where: { customerId, deletedAt: null, status: "COMPLETED" }, orderBy: { actualEnd: "desc" }, take: 15, select: { id: true, number: true, title: true, actualEnd: true, customerNotes: true, jobType: { select: { name: true } }, location: { select: { addressLine1: true } } } }),
    db.maintenanceAgreement.findMany({ where: { customerId, deletedAt: null, status: { not: "CANCELLED" } }, select: { id: true, number: true, name: true, startDate: true, renewalDate: true, includedVisits: true, includedServices: true, visits: { select: { status: true } } } }),
    loadBranding(db, link.tenantId),
    db.tenantSettings.findFirst({ where: {} }),
  ]);
  if (!customer) return null;
  return { customer, appointments, quotes, invoices, history, agreements: agreements.map((a) => ({ ...a, completed: a.visits.filter((v) => v.status === "COMPLETED").length })), brand, currency: settings?.currency ?? "USD", timezone: settings?.timezone ?? "America/Chicago" };
}

const contactSchema = z.object({ phone: optPhone, phoneAlt: optPhone, email: optEmail, preferredContact: z.enum(["PHONE", "SMS", "EMAIL"]) });

export async function updatePortalContact(token: string, raw: unknown, meta: { ip?: string; userAgent?: string }) {
  const link = await resolvePublicLink(token, "PORTAL", meta);
  if (!link?.customerId) throw notFound("Portal");
  const input = parseInput(contactSchema, raw);
  await link.db.tx(async (tx) => {
    const c = await tx.customer.update({ where: { id: link.customerId! }, data: { phone: normalizePhone(input.phone), phoneAlt: normalizePhone(input.phoneAlt), email: input.email ?? null, preferredContact: input.preferredContact } });
    await recordActivity(tx, link.tenantId, null, { customerId: c.id, entityType: "CUSTOMER", entityId: c.id, type: "customer.updated", summary: `${c.displayName} updated their contact information in the portal`, actor: { type: "CUSTOMER", name: c.displayName } });
    await auditAs(tx, link.tenantId, { name: c.displayName }, "customer.portal_contact_updated", "Customer", c.id, undefined, meta);
  });
}

const messageSchema = z.object({ message: str(2000), subject: optStr(120) });

/** Customer → company message from the portal: becomes a task + notification for the office. */
export async function sendPortalMessage(token: string, raw: unknown, meta: { ip?: string; userAgent?: string }) {
  const link = await resolvePublicLink(token, "PORTAL", meta);
  if (!link?.customerId) throw notFound("Portal");
  const input = parseInput(messageSchema, raw);
  await link.db.tx(async (tx) => {
    const c = await tx.customer.findFirstOrThrow({ where: { id: link.customerId! }, select: { id: true, displayName: true } });
    const task = await tx.task.create({ data: { tenantId: link.tenantId, title: `Reply to ${c.displayName}${input.subject ? ` — ${input.subject}` : ""}`, description: input.message, priority: "HIGH", customerId: c.id, dueAt: new Date(Date.now() + 86_400_000), assigneeUserId: null } });
    await recordActivity(tx, link.tenantId, null, { customerId: c.id, entityType: "CUSTOMER", entityId: c.id, type: "customer.message", summary: `${c.displayName} sent a message from the portal: “${input.message.slice(0, 120)}”`, actor: { type: "CUSTOMER", name: c.displayName } });
    await notifyWithPermission(tx, link.tenantId, "customers.edit", { type: "CUSTOMER_MESSAGE", title: `Message from ${c.displayName}`, body: input.message.slice(0, 140), href: `/customers/${c.id}`, entityType: "TASK", entityId: task.id });
  });
}
