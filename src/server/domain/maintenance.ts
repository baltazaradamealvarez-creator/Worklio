import { addMonths, addYears } from "date-fns";
import type { AgreementStatus, BillingFrequency, Prisma } from "@prisma/client";
import { z } from "zod";
import { requirePermission, type Ctx } from "@/server/auth/context";
import { AppError, invalidState, notFound } from "@/server/errors";
import { AGREEMENT_MANUAL_TRANSITIONS, effectiveAgreementStatus } from "@/lib/state";
import { bool, cents, dateReq, intField, optStr, parseInput, percentBp, str } from "@/lib/validation";
import { customerScope } from "./entity-access";
import { insertInvoice } from "./invoices";
import { skipTake, toPage, type ListParams } from "./list";
import { nextDocumentNumber } from "./numbering";
import { audit, notifyWithPermission, recordActivity } from "./shared";
import { type PreparedLine } from "./documents";

const FREQ = ["MONTHLY", "QUARTERLY", "SEMI_ANNUAL", "ANNUAL", "ONE_TIME"] as const;

const agreementSchema = z.object({
  name: str(120),
  customerId: str(40),
  locationId: str(40),
  startDate: dateReq,
  renewalDate: dateReq,
  billingFrequency: z.enum(FREQ).default("ANNUAL"),
  price: cents,
  includedVisits: intField.pipe(z.number().min(0).max(100)).default(2),
  includedServices: optStr(2000),
  discountPercent: percentBp,
  autoRenew: bool.optional(),
  notes: optStr(2000),
  equipmentIds: z.preprocess((v) => (typeof v === "string" ? (v ? [v] : []) : v), z.array(z.string().min(1).max(40)).max(50)).default([]),
});

/** Spread N visits evenly across the agreement term. */
function visitDates(start: Date, end: Date, n: number): Date[] {
  if (n <= 0) return [];
  const span = end.getTime() - start.getTime();
  return Array.from({ length: n }, (_, i) => new Date(start.getTime() + (span * (i + 0.5)) / n)).map((d) => new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`));
}

export async function createAgreement(ctx: Ctx, raw: unknown) {
  requirePermission(ctx, "maintenance.manage");
  const input = parseInput(agreementSchema, raw);
  if (input.renewalDate <= input.startDate) throw new AppError("VALIDATION", "Renewal date must be after the start date.", { renewalDate: "Must be after start" });
  const loc = await ctx.db.customerLocation.findFirst({ where: { id: input.locationId, customerId: input.customerId, deletedAt: null, customer: { deletedAt: null, ...customerScope(ctx) } } });
  if (!loc) throw notFound("Location");
  if (input.equipmentIds.length && (await ctx.db.equipment.count({ where: { id: { in: input.equipmentIds }, locationId: input.locationId, deletedAt: null } })) !== new Set(input.equipmentIds).size) throw notFound("Equipment");
  return ctx.db.tx(async (tx) => {
    const number = await nextDocumentNumber(tx, ctx.tenantId, "AGREEMENT");
    const a = await tx.maintenanceAgreement.create({
      data: {
        tenantId: ctx.tenantId, number, name: input.name, customerId: input.customerId, locationId: input.locationId, startDate: input.startDate, renewalDate: input.renewalDate,
        billingFrequency: input.billingFrequency as BillingFrequency, priceCents: input.price, includedVisits: input.includedVisits, includedServices: input.includedServices ?? null,
        discountPercentBp: input.discountPercent, autoRenew: input.autoRenew ?? false, notes: input.notes ?? null,
        status: effectiveAgreementStatus({ status: "ACTIVE", startDate: input.startDate, renewalDate: input.renewalDate }),
        equipment: { create: input.equipmentIds.map((equipmentId) => ({ equipmentId })) },
        visits: { create: visitDates(input.startDate, input.renewalDate, input.includedVisits).map((dueDate) => ({ dueDate })) },
      },
    });
    await recordActivity(tx, ctx.tenantId, ctx, { customerId: a.customerId, entityType: "AGREEMENT", entityId: a.id, type: "agreement.created", summary: `Created maintenance agreement ${a.number} — ${a.name}` });
    await audit(ctx, "agreement.created", "MaintenanceAgreement", a.id, { number: a.number }, tx);
    return a;
  });
}

export async function updateAgreement(ctx: Ctx, id: string, raw: unknown) {
  requirePermission(ctx, "maintenance.manage");
  const input = parseInput(agreementSchema, raw);
  const a = await ctx.db.maintenanceAgreement.findFirst({ where: { id, deletedAt: null } });
  if (!a) throw notFound("Agreement");
  if (a.status === "CANCELLED") throw invalidState("A cancelled agreement can't be edited.");
  return ctx.db.tx(async (tx) => {
    const updated = await tx.maintenanceAgreement.update({
      where: { id },
      data: {
        name: input.name, startDate: input.startDate, renewalDate: input.renewalDate, billingFrequency: input.billingFrequency as BillingFrequency, priceCents: input.price,
        includedVisits: input.includedVisits, includedServices: input.includedServices ?? null, discountPercentBp: input.discountPercent, autoRenew: input.autoRenew ?? false, notes: input.notes ?? null,
      },
    });
    await tx.agreementEquipment.deleteMany({ where: { agreementId: id } });
    if (input.equipmentIds.length) await tx.agreementEquipment.createMany({ data: input.equipmentIds.map((equipmentId) => ({ tenantId: ctx.tenantId, agreementId: id, equipmentId })) });
    // Top up planned visits if the entitlement grew.
    const existing = await tx.maintenanceVisit.count({ where: { agreementId: id } });
    if (input.includedVisits > existing) {
      const extra = visitDates(input.startDate, input.renewalDate, input.includedVisits).slice(existing);
      await tx.maintenanceVisit.createMany({ data: extra.map((dueDate) => ({ tenantId: ctx.tenantId, agreementId: id, dueDate })) });
    }
    await audit(ctx, "agreement.updated", "MaintenanceAgreement", id, undefined, tx);
    return updated;
  });
}

export async function cancelAgreement(ctx: Ctx, id: string, reason: string) {
  requirePermission(ctx, "maintenance.manage");
  if (!reason.trim()) throw new AppError("VALIDATION", "Please give a reason.", { reason: "Required" });
  const a = await ctx.db.maintenanceAgreement.findFirst({ where: { id, deletedAt: null } });
  if (!a) throw notFound("Agreement");
  if (!AGREEMENT_MANUAL_TRANSITIONS[a.status].includes("CANCELLED")) throw invalidState("This agreement can't be cancelled.");
  await ctx.db.tx(async (tx) => {
    await tx.maintenanceAgreement.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason.trim() } });
    await tx.maintenanceVisit.updateMany({ where: { agreementId: id, status: { in: ["PLANNED", "SCHEDULED"] } }, data: { status: "SKIPPED" } });
    await recordActivity(tx, ctx.tenantId, ctx, { customerId: a.customerId, entityType: "AGREEMENT", entityId: id, type: "agreement.cancelled", summary: `Cancelled agreement ${a.number} — ${reason.trim()}` });
    await audit(ctx, "agreement.cancelled", "MaintenanceAgreement", id, { reason: reason.trim() }, tx);
  });
}

/** Renew for another term: extends the renewal date, adds a fresh set of visits, optionally invoices. */
export async function renewAgreement(ctx: Ctx, id: string, opts: { createInvoice?: boolean } = {}) {
  requirePermission(ctx, "maintenance.manage");
  if (opts.createInvoice) requirePermission(ctx, "invoices.create");
  return ctx.db.tx(async (tx) => {
    const a = await tx.maintenanceAgreement.findFirst({ where: { id, deletedAt: null } });
    if (!a) throw notFound("Agreement");
    if (a.status === "CANCELLED") throw invalidState("A cancelled agreement can't be renewed.");
    const oneTerm = a.billingFrequency === "ONE_TIME" || a.billingFrequency === "ANNUAL";
    const newStart = a.renewalDate;
    const newEnd = oneTerm ? addYears(newStart, 1) : addMonths(newStart, 12);
    await tx.maintenanceAgreement.update({ where: { id }, data: { startDate: a.startDate, renewalDate: newEnd, status: "ACTIVE" } });
    await tx.maintenanceVisit.createMany({ data: visitDates(newStart, newEnd, a.includedVisits).map((dueDate) => ({ tenantId: ctx.tenantId, agreementId: id, dueDate })) });
    let invoiceId: string | null = null;
    if (opts.createInvoice && a.priceCents > 0) {
      const settings = await tx.tenantSettings.findFirst({ where: {} });
      const lines: PreparedLine[] = [{ position: 0, kind: "SERVICE", pricebookItemId: null, name: `${a.name} — renewal`, description: `Maintenance agreement ${a.number}, ${a.includedVisits} visit(s)`, quantity: "1", unitPriceCents: a.priceCents, unitCostCents: 0, discountType: "NONE", discountValue: 0, taxable: false, totalCents: 0 }];
      const inv = await insertInvoice(tx, ctx, { customerId: a.customerId, locationId: a.locationId, agreementId: a.id, title: `${a.name} renewal`, issueDate: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`), paymentTermsDays: settings?.paymentTermsDays ?? 30, taxRateBp: 0, discountType: "NONE", discountValue: 0, terms: settings?.invoiceTerms, lines });
      invoiceId = inv.id;
    }
    await recordActivity(tx, ctx.tenantId, ctx, { customerId: a.customerId, entityType: "AGREEMENT", entityId: id, type: "agreement.renewed", summary: `Renewed agreement ${a.number} through ${newEnd.toISOString().slice(0, 10)}` });
    await audit(ctx, "agreement.renewed", "MaintenanceAgreement", id, { invoiceId }, tx);
    return { invoiceId };
  });
}

export async function listAgreements(ctx: Ctx, p: ListParams) {
  requirePermission(ctx, "maintenance.view");
  const and: Prisma.MaintenanceAgreementWhereInput[] = [{ deletedAt: null }, { customer: customerScope(ctx) }];
  if (p.q) and.push({ OR: [{ number: { contains: p.q, mode: "insensitive" } }, { name: { contains: p.q, mode: "insensitive" } }, { customer: { displayName: { contains: p.q, mode: "insensitive" } } }] });
  const f = p.filters;
  const now = new Date();
  const soon = new Date(now.getTime() + 45 * 86_400_000);
  if (f.status === "ACTIVE") and.push({ status: { not: "CANCELLED" }, startDate: { lte: now }, renewalDate: { gt: soon } });
  else if (f.status === "EXPIRING") and.push({ status: { not: "CANCELLED" }, renewalDate: { gte: now, lte: soon } });
  else if (f.status === "EXPIRED") and.push({ status: { not: "CANCELLED" }, renewalDate: { lt: now } });
  else if (f.status === "PENDING_RENEWAL") and.push({ status: { not: "CANCELLED" }, startDate: { gt: now } });
  else if (f.status === "CANCELLED") and.push({ status: "CANCELLED" });
  if (f.customer) and.push({ customerId: f.customer });
  const where = { AND: and };
  const orderBy: Prisma.MaintenanceAgreementOrderByWithRelationInput = p.sort === "price" ? { priceCents: p.dir } : p.sort === "customer" ? { customer: { displayName: p.dir } } : p.sort === "startDate" ? { startDate: p.dir } : { renewalDate: p.dir };
  const [rows, total] = await Promise.all([
    ctx.db.maintenanceAgreement.findMany({ where, orderBy: [orderBy, { id: "asc" }], ...skipTake(p), include: { customer: { select: { id: true, displayName: true } }, location: { select: { name: true, addressLine1: true } }, visits: { select: { status: true } } } }),
    ctx.db.maintenanceAgreement.count({ where }),
  ]);
  return toPage(rows.map((r) => ({ ...r, effectiveStatus: effectiveAgreementStatus(r), completedVisits: r.visits.filter((v) => v.status === "COMPLETED").length })), total, p);
}

export async function getAgreement(ctx: Ctx, id: string) {
  requirePermission(ctx, "maintenance.view");
  const a = await ctx.db.maintenanceAgreement.findFirst({
    where: { id, deletedAt: null, customer: customerScope(ctx) },
    include: {
      customer: { select: { id: true, displayName: true, email: true, phone: true } },
      location: true,
      equipment: { include: { equipment: true } },
      visits: { orderBy: { dueDate: "asc" }, include: { job: { select: { id: true, number: true, status: true, scheduledStart: true } } } },
    },
  });
  if (!a) throw notFound("Agreement");
  const completed = a.visits.filter((v) => v.status === "COMPLETED").length;
  return { ...a, effectiveStatus: effectiveAgreementStatus(a), completedVisits: completed, remainingVisits: Math.max(0, a.includedVisits - completed) };
}

/** Create a job for an upcoming planned visit and link it. */
export async function scheduleVisitJob(ctx: Ctx, visitId: string) {
  requirePermission(ctx, "maintenance.manage");
  requirePermission(ctx, "jobs.create");
  const { insertJob } = await import("./jobs");
  return ctx.db.tx(async (tx) => {
    const v = await tx.maintenanceVisit.findFirst({ where: { id: visitId }, include: { agreement: true } });
    if (!v) throw notFound("Visit");
    if (v.jobId) throw invalidState("A job already exists for this visit.");
    if (v.status !== "PLANNED") throw invalidState("This visit is already handled.");
    const type = await tx.jobType.findFirst({ where: { name: { contains: "Maintenance", mode: "insensitive" } } });
    const job = await insertJob(tx, ctx, {
      customerId: v.agreement.customerId, locationId: v.agreement.locationId, jobTypeId: type?.id ?? null, title: `${v.agreement.name} — maintenance visit`, description: `Included visit under agreement ${v.agreement.number}.`,
      priority: "NORMAL", assigneeIds: [], equipmentIds: [], agreementId: v.agreementId, dispatcherId: null, internalNotes: null, customerNotes: null, quoteId: null, estimatedMinutes: undefined,
    });
    const eq = await tx.agreementEquipment.findMany({ where: { agreementId: v.agreementId } });
    if (eq.length) await tx.jobEquipment.createMany({ data: eq.map((e) => ({ tenantId: ctx.tenantId, jobId: job.id, equipmentId: e.equipmentId })) });
    await tx.maintenanceVisit.update({ where: { id: v.id }, data: { jobId: job.id, status: "SCHEDULED" } });
    return job;
  });
}

/** Flag renewals approaching and notify the team. Idempotent per day. Call from a scheduled job. */
export async function notifyUpcomingRenewals(ctx: Ctx): Promise<number> {
  const soon = new Date(Date.now() + 30 * 86_400_000);
  const list = await ctx.db.maintenanceAgreement.findMany({ where: { deletedAt: null, status: { not: "CANCELLED" }, renewalDate: { gte: new Date(), lte: soon } }, include: { customer: { select: { displayName: true } } } });
  let n = 0;
  for (const a of list) {
    const already = await ctx.db.notification.count({ where: { entityType: "AGREEMENT", entityId: a.id, type: "AGREEMENT_RENEWAL", createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } } });
    if (already) continue;
    await notifyWithPermission(ctx.db, ctx.tenantId, "maintenance.manage", { type: "AGREEMENT_RENEWAL", title: `Renewal approaching: ${a.number}`, body: `${a.customer.displayName} — renews ${a.renewalDate.toISOString().slice(0, 10)}`, href: `/maintenance/${a.id}`, entityType: "AGREEMENT", entityId: a.id });
    n++;
  }
  return n;
}

export type { AgreementStatus };
void percentBp;
