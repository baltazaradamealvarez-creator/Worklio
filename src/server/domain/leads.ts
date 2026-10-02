import type { LeadStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { requirePermission, type Ctx } from "@/server/auth/context";
import { AppError, invalidState, notFound } from "@/server/errors";
import { normalizePhone } from "@/lib/format";
import { assertTransition, nextStates } from "@/lib/state";
import { bool, cents, optEmail, optId, optPhone, optStr, parseInput, str } from "@/lib/validation";
import { findDuplicates, deriveDisplayName } from "./customers";
import { assertWithinLimit } from "./limits";
import { insertJob } from "./jobs";
import { skipTake, toPage, type ListParams } from "./list";
import { insertQuoteShell } from "./quotes";
import { audit, notifyUsers, recordActivity } from "./shared";

export const LEAD_STATUSES: LeadStatus[] = ["NEW", "CONTACTED", "APPOINTMENT_SCHEDULED", "ESTIMATE_NEEDED", "QUOTE_SENT", "WON", "LOST"];

const leadSchema = z
  .object({
    firstName: optStr(60),
    lastName: optStr(60),
    companyName: optStr(120),
    phone: optPhone,
    email: optEmail,
    addressLine1: optStr(160),
    addressLine2: optStr(160),
    city: optStr(80),
    state: optStr(40),
    postalCode: optStr(20),
    requestedService: optStr(200),
    source: optStr(80),
    assignedToId: optId,
    estimatedValue: cents.default(0),
    notes: optStr(4000),
  })
  .superRefine((v, c) => {
    if (!v.firstName && !v.lastName && !v.companyName) c.addIssue({ code: "custom", path: ["lastName"], message: "Enter a name or company" });
    if (!v.phone && !v.email) c.addIssue({ code: "custom", path: ["phone"], message: "Enter a phone number or email" });
  });

const dataOf = (i: z.output<typeof leadSchema>) => ({
  firstName: i.firstName ?? null, lastName: i.lastName ?? null, companyName: i.companyName ?? null,
  displayName: i.companyName || [i.firstName, i.lastName].filter(Boolean).join(" ") || "Unnamed lead",
  phone: normalizePhone(i.phone), email: i.email ?? null, addressLine1: i.addressLine1 ?? null, addressLine2: i.addressLine2 ?? null, city: i.city ?? null, state: i.state ?? null, postalCode: i.postalCode ?? null,
  requestedService: i.requestedService ?? null, source: i.source ?? null, assignedToId: i.assignedToId ?? null, estimatedValueCents: i.estimatedValue, notes: i.notes ?? null,
});

export async function createLead(ctx: Ctx, raw: unknown) {
  requirePermission(ctx, "leads.manage");
  const input = parseInput(leadSchema, raw);
  if (input.assignedToId && !(await ctx.db.employee.findFirst({ where: { id: input.assignedToId, deletedAt: null } }))) throw notFound("Salesperson");
  return ctx.db.tx(async (tx) => {
    const lead = await tx.lead.create({ data: { tenantId: ctx.tenantId, ...dataOf(input), status: "NEW" } });
    if (lead.assignedToId) {
      const e = await tx.employee.findFirst({ where: { id: lead.assignedToId }, select: { membership: { select: { userId: true } } } });
      if (e?.membership?.userId && e.membership.userId !== ctx.userId) await notifyUsers(tx, ctx.tenantId, [e.membership.userId], { type: "TASK_ASSIGNED", title: `New lead: ${lead.displayName}`, body: lead.requestedService, href: `/leads/${lead.id}`, entityType: "LEAD", entityId: lead.id });
    }
    await audit(ctx, "lead.created", "Lead", lead.id, undefined, tx);
    return lead;
  });
}

export async function updateLead(ctx: Ctx, id: string, raw: unknown) {
  requirePermission(ctx, "leads.manage");
  const input = parseInput(leadSchema, raw);
  const lead = await ctx.db.lead.findFirst({ where: { id, deletedAt: null } });
  if (!lead) throw notFound("Lead");
  if (lead.convertedAt) throw invalidState("This lead has already been converted to a customer.");
  return ctx.db.lead.update({ where: { id }, data: dataOf(input) });
}

const statusSchema = z.object({ to: z.enum(["NEW", "CONTACTED", "APPOINTMENT_SCHEDULED", "ESTIMATE_NEEDED", "QUOTE_SENT", "WON", "LOST"]), lostReason: optStr(300) });

export async function setLeadStatus(ctx: Ctx, id: string, raw: unknown) {
  requirePermission(ctx, "leads.manage");
  const { to, lostReason } = parseInput(statusSchema, raw);
  const lead = await ctx.db.lead.findFirst({ where: { id, deletedAt: null } });
  if (!lead) throw notFound("Lead");
  assertTransition("lead", lead.status, to);
  if (to === "WON" && !lead.convertedAt) throw invalidState("Convert the lead to a customer to mark it won.");
  if (to === "LOST" && !lostReason) throw new AppError("VALIDATION", "Please record why the lead was lost.", { lostReason: "Required" });
  await ctx.db.lead.update({ where: { id }, data: { status: to, lostReason: to === "LOST" ? lostReason : null } });
  await audit(ctx, "lead.status_changed", "Lead", id, { from: lead.status, to });
}

const convertSchema = z.object({
  customerId: optId, // link to an existing customer instead of creating one
  customerType: z.enum(["RESIDENTIAL", "COMMERCIAL"]).default("RESIDENTIAL"),
  createJob: bool.optional(),
  jobTitle: optStr(160),
  createQuote: bool.optional(),
  allowDuplicate: bool.optional(),
});

/** Won lead → customer + service location (+ optional job and draft quote), nothing retyped. */
export async function convertLead(ctx: Ctx, id: string, raw: unknown) {
  requirePermission(ctx, "leads.manage");
  const input = parseInput(convertSchema, raw);
  if (!input.customerId) requirePermission(ctx, "customers.create");
  if (input.createJob) requirePermission(ctx, "jobs.create");
  if (input.createQuote) requirePermission(ctx, "quotes.create");
  const lead = await ctx.db.lead.findFirst({ where: { id, deletedAt: null } });
  if (!lead) throw notFound("Lead");
  if (lead.convertedAt) throw invalidState("This lead has already been converted.");
  if (!lead.addressLine1 || !lead.city || !lead.state || !lead.postalCode) {
    throw new AppError("VALIDATION", "Add the service address (street, city, state, ZIP) to the lead before converting it.");
  }
  if (!input.customerId && !input.allowDuplicate) {
    const dupes = await findDuplicates(ctx, lead);
    if (dupes.length) throw new AppError("CONFLICT", `A customer with the same ${dupes[0]!.email && dupes[0]!.email === lead.email ? "email" : "phone number"} already exists (${dupes[0]!.displayName}). Link to them, or confirm to create a duplicate.`, { duplicateCustomerId: dupes[0]!.id });
  }
  if (!input.customerId) await assertWithinLimit(ctx, "customers");

  return ctx.db.tx(async (tx) => {
    let customerId = input.customerId ?? null;
    if (customerId) {
      if (!(await tx.customer.findFirst({ where: { id: customerId, deletedAt: null } }))) throw notFound("Customer");
    } else {
      const c = await tx.customer.create({
        data: {
          tenantId: ctx.tenantId, type: input.customerType, status: "ACTIVE", firstName: lead.firstName, lastName: lead.lastName, companyName: lead.companyName,
          displayName: deriveDisplayName({ type: input.customerType, firstName: lead.firstName, lastName: lead.lastName, companyName: lead.companyName }), phone: lead.phone, email: lead.email, referralSource: lead.source,
          tags: [], preferredContact: "PHONE", preferredLanguage: "en",
        },
      });
      customerId = c.id;
      await recordActivity(tx, ctx.tenantId, ctx, { customerId, entityType: "CUSTOMER", entityId: customerId, type: "customer.created", summary: "Customer created from lead" });
    }
    const hasPrimary = await tx.customerLocation.count({ where: { customerId, deletedAt: null, isPrimary: true } });
    const loc = await tx.customerLocation.create({
      data: { tenantId: ctx.tenantId, customerId, name: lead.addressLine1!, addressLine1: lead.addressLine1!, addressLine2: lead.addressLine2, city: lead.city!, state: lead.state!, postalCode: lead.postalCode!, isPrimary: hasPrimary === 0 },
    });
    let jobId: string | null = null;
    let quoteId: string | null = null;
    if (input.createJob) {
      const job = await insertJob(tx, ctx, {
        customerId, locationId: loc.id, title: input.jobTitle ?? lead.requestedService ?? "Service call", description: lead.notes, priority: "NORMAL", assigneeIds: [], equipmentIds: [],
        jobTypeId: null, dispatcherId: null, internalNotes: null, customerNotes: null, quoteId: null, agreementId: null, estimatedMinutes: undefined,
      });
      jobId = job.id;
    }
    if (input.createQuote) {
      const q = await insertQuoteShell(tx, ctx, { customerId, locationId: loc.id, title: lead.requestedService ?? "Quote", salespersonId: lead.assignedToId });
      quoteId = q.id;
    }
    await tx.lead.update({ where: { id }, data: { status: "WON", customerId, locationId: loc.id, convertedAt: new Date() } });
    await recordActivity(tx, ctx.tenantId, ctx, { customerId, entityType: "LEAD", entityId: id, type: "lead.converted", summary: `Lead converted${jobId ? ", job created" : ""}${quoteId ? ", quote drafted" : ""}` });
    await audit(ctx, "lead.converted", "Lead", id, { customerId, locationId: loc.id, jobId, quoteId }, tx);
    return { customerId, locationId: loc.id, jobId, quoteId };
  });
}

export async function archiveLead(ctx: Ctx, id: string) {
  requirePermission(ctx, "leads.manage");
  const r = await ctx.db.lead.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } });
  if (r.count === 0) throw notFound("Lead");
  await audit(ctx, "lead.archived", "Lead", id);
}

export async function listLeads(ctx: Ctx, p: ListParams) {
  requirePermission(ctx, "leads.view");
  const and: Prisma.LeadWhereInput[] = [{ deletedAt: null }];
  if (p.q) and.push({ OR: [{ displayName: { contains: p.q, mode: "insensitive" } }, { email: { contains: p.q, mode: "insensitive" } }, { phone: { contains: p.q.replace(/\D/g, "") || "__" } }, { requestedService: { contains: p.q, mode: "insensitive" } }] });
  if (p.filters.status && (LEAD_STATUSES as string[]).includes(p.filters.status)) and.push({ status: p.filters.status as LeadStatus });
  if (p.filters.assignee) and.push({ assignedToId: p.filters.assignee });
  if (p.filters.source) and.push({ source: { equals: p.filters.source, mode: "insensitive" } });
  const where = { AND: and };
  const orderBy: Prisma.LeadOrderByWithRelationInput = p.sort === "value" ? { estimatedValueCents: p.dir } : p.sort === "status" ? { status: p.dir } : p.sort === "name" ? { displayName: p.dir } : { createdAt: p.dir };
  const [rows, total] = await Promise.all([ctx.db.lead.findMany({ where, orderBy: [orderBy, { id: "desc" }], ...skipTake(p) }), ctx.db.lead.count({ where })]);
  const emp = await ctx.db.employee.findMany({ where: { id: { in: rows.map((r) => r.assignedToId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true } });
  const names = new Map(emp.map((e) => [e.id, `${e.firstName} ${e.lastName}`]));
  return toPage(rows.map((r) => ({ ...r, assignedToName: r.assignedToId ? (names.get(r.assignedToId) ?? null) : null })), total, p);
}

/** Board data: every open lead grouped by stage (bounded). */
export async function leadBoard(ctx: Ctx) {
  requirePermission(ctx, "leads.view");
  const leads = await ctx.db.lead.findMany({ where: { deletedAt: null, OR: [{ status: { notIn: ["WON", "LOST"] } }, { updatedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }] }, orderBy: { createdAt: "desc" }, take: 400 });
  const emp = await ctx.db.employee.findMany({ where: { id: { in: leads.map((r) => r.assignedToId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true } });
  const names = new Map(emp.map((e) => [e.id, `${e.firstName} ${e.lastName}`]));
  return LEAD_STATUSES.map((status) => ({
    status,
    leads: leads.filter((l) => l.status === status).map((l) => ({ ...l, assignedToName: l.assignedToId ? (names.get(l.assignedToId) ?? null) : null })),
  }));
}

export async function getLead(ctx: Ctx, id: string) {
  requirePermission(ctx, "leads.view");
  const lead = await ctx.db.lead.findFirst({ where: { id, deletedAt: null }, include: { customer: { select: { id: true, displayName: true } } } });
  if (!lead) throw notFound("Lead");
  const assignee = lead.assignedToId ? await ctx.db.employee.findFirst({ where: { id: lead.assignedToId }, select: { id: true, firstName: true, lastName: true } }) : null;
  return { ...lead, assignee, nextStatuses: nextStates("lead", lead.status) as LeadStatus[] };
}
