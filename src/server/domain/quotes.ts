import { randomUUID } from "node:crypto";
import { addDays } from "date-fns";
import type { DiscountType, Prisma, QuoteStatus } from "@prisma/client";
import { z } from "zod";
import { can, requirePermission, type Ctx } from "@/server/auth/context";
import { AppError, invalidState, notFound } from "@/server/errors";
import { formatDateOnly, humanize } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { assertTransition } from "@/lib/state";
import { dateReq, email as emailSchema, optDate, optId, optStr, parseInput, percentBp, str, bool } from "@/lib/validation";
import { deliverEmail, loadBranding } from "@/server/email/service";
import { quoteEmail } from "@/server/email/templates";
import { storage } from "@/server/storage/provider";
import { customerScope } from "./entity-access";
import { discountSchema, lineInputSchema, prepareLines, stripCosts, totalsFor, type PreparedLine } from "./documents";
import { insertInvoice } from "./invoices";
import { insertJob } from "./jobs";
import { skipTake, toPage, parseDate, type ListParams } from "./list";
import { nextDocumentNumber } from "./numbering";
import { issuePublicLink, resolvePublicLink, touchPublicLink, type ResolvedLink } from "./public-links";
import { audit, auditAs, notifyUsers, notifyWithPermission, recordActivity, todayDateOnly } from "./shared";
import { tenantTimezone } from "./scheduling";

export const QUOTE_STATUSES: QuoteStatus[] = ["DRAFT", "READY", "SENT", "VIEWED", "APPROVED", "DECLINED", "EXPIRED", "CONVERTED"];

const optionSchema = z.object({
  id: optId,
  name: str(80),
  description: optStr(1000),
  isRecommended: bool.optional(),
  lines: z.array(lineInputSchema).max(200),
});

const quoteSchema = z.object({
  customerId: str(40),
  locationId: optId,
  jobId: optId,
  salespersonId: optId,
  title: str(160),
  issueDate: dateReq,
  expiresAt: optDate,
  taxRate: percentBp,
  ...discountSchema,
  depositType: z.enum(["NONE", "PERCENT", "FIXED"]).default("NONE"),
  depositValue: z.preprocess((v) => (v === "" || v == null ? 0 : Number(v)), z.number().int().min(0).max(100_000_000)).default(0),
  terms: optStr(8000),
  customerNotes: optStr(4000),
  internalNotes: optStr(4000),
  options: z.array(optionSchema).min(1, "Add at least one option").max(5),
});
export type QuoteInput = z.input<typeof quoteSchema>;

interface Computed {
  options: { name: string; description: string | null; isRecommended: boolean; position: number; lines: PreparedLine[]; totals: ReturnType<typeof totalsFor> }[];
}

async function computeOptions(ctx: Ctx, input: z.output<typeof quoteSchema>, taxRateBp: number): Promise<Computed> {
  const out: Computed["options"] = [];
  for (const [position, o] of input.options.entries()) {
    const lines = await prepareLines(ctx, o.lines);
    if (lines.length === 0) throw new AppError("VALIDATION", `Option "${o.name}" needs at least one line item.`);
    const totals = totalsFor(lines, { taxRateBp, discountType: input.discountType as DiscountType, discountValue: input.discountValue, depositType: input.depositType as DiscountType, depositValue: input.depositValue });
    out.push({ name: o.name, description: o.description ?? null, isRecommended: o.isRecommended ?? false, position, lines, totals });
  }
  if (out.filter((o) => o.isRecommended).length > 1) {
    let seen = false;
    for (const o of out) { if (o.isRecommended && seen) o.isRecommended = false; if (o.isRecommended) seen = true; }
  }
  return out.length ? { options: out } : { options: [] };
}

function headline(options: Computed["options"], approvedIdx?: number) {
  return (approvedIdx != null ? options[approvedIdx] : undefined) ?? options.find((o) => o.isRecommended) ?? options[0]!;
}

async function assertRefs(ctx: Ctx, customerId: string, locationId?: string | null, jobId?: string | null, salespersonId?: string | null) {
  const c = await ctx.db.customer.findFirst({ where: { id: customerId, deletedAt: null, ...customerScope(ctx) }, select: { id: true, taxExempt: true } });
  if (!c) throw notFound("Customer");
  if (locationId && !(await ctx.db.customerLocation.findFirst({ where: { id: locationId, customerId, deletedAt: null } }))) throw notFound("Location");
  if (jobId && !(await ctx.db.job.findFirst({ where: { id: jobId, customerId, deletedAt: null } }))) throw notFound("Job");
  if (salespersonId && !(await ctx.db.employee.findFirst({ where: { id: salespersonId, deletedAt: null } }))) throw notFound("Salesperson");
  return c;
}

/** Quotes past their expiry date that were never answered become EXPIRED. */
export async function expireStaleQuotes(db: Ctx["db"]): Promise<void> {
  const today = todayDateOnly(await tenantTimezone(db));
  await db.quote.updateMany({ where: { status: { in: ["SENT", "VIEWED"] }, expiresAt: { lt: today } }, data: { status: "EXPIRED" } });
}

export async function createQuote(ctx: Ctx, raw: unknown) {
  requirePermission(ctx, "quotes.create");
  const input = parseInput(quoteSchema, raw);
  const customer = await assertRefs(ctx, input.customerId, input.locationId, input.jobId, input.salespersonId);
  const taxRateBp = customer.taxExempt ? 0 : input.taxRate;
  const { options } = await computeOptions(ctx, input, taxRateBp);
  const head = headline(options);
  return ctx.db.tx(async (tx) => {
    const number = await nextDocumentNumber(tx, ctx.tenantId, "QUOTE");
    const q = await tx.quote.create({
      data: {
        tenantId: ctx.tenantId, number, customerId: input.customerId, locationId: input.locationId ?? null, jobId: input.jobId ?? null,
        salespersonId: input.salespersonId ?? ctx.employeeId ?? null, title: input.title, status: "DRAFT", issueDate: input.issueDate, expiresAt: input.expiresAt ?? null,
        taxRateBp, discountType: input.discountType, discountValue: input.discountValue, depositType: input.depositType, depositValue: input.depositValue,
        terms: input.terms ?? null, customerNotes: input.customerNotes ?? null, internalNotes: input.internalNotes ?? null,
        subtotalCents: head.totals.subtotalCents, discountCents: head.totals.discountCents, taxCents: head.totals.taxCents, totalCents: head.totals.totalCents, depositCents: head.totals.depositCents,
      },
    });
    await writeOptions(tx, ctx, q.id, options);
    await recordActivity(tx, ctx.tenantId, ctx, { customerId: q.customerId, entityType: "QUOTE", entityId: q.id, type: "quote.created", summary: `Created quote ${q.number} — ${q.title}` });
    await audit(ctx, "quote.created", "Quote", q.id, { number: q.number, total: q.totalCents }, tx);
    return q;
  });
}

async function writeOptions(tx: Ctx["db"] | Parameters<Parameters<Ctx["db"]["tx"]>[0]>[0], ctx: Ctx, quoteId: string, options: Computed["options"]) {
  for (const o of options) {
    await tx.quoteOption.create({
      data: {
        tenantId: ctx.tenantId, quoteId, position: o.position, name: o.name, description: o.description, isRecommended: o.isRecommended,
        subtotalCents: o.totals.subtotalCents, discountCents: o.totals.discountCents, taxCents: o.totals.taxCents, totalCents: o.totals.totalCents, depositCents: o.totals.depositCents,
        lineItems: { create: o.lines.map((l) => ({ ...l })) },
      },
    });
  }
}

export async function updateQuote(ctx: Ctx, id: string, raw: unknown) {
  requirePermission(ctx, "quotes.edit");
  const input = parseInput(quoteSchema, raw);
  const q = await ctx.db.quote.findFirst({ where: { id, deletedAt: null } });
  if (!q) throw notFound("Quote");
  if (q.status !== "DRAFT" && q.status !== "READY") throw invalidState("Only draft quotes can be edited. Use “Revise” to reopen a sent quote.");
  const customer = await assertRefs(ctx, q.customerId, input.locationId, input.jobId, input.salespersonId);
  const taxRateBp = customer.taxExempt ? 0 : input.taxRate;
  const { options } = await computeOptions(ctx, input, taxRateBp);
  const head = headline(options);
  return ctx.db.tx(async (tx) => {
    await tx.quoteOption.deleteMany({ where: { quoteId: id } });
    await writeOptions(tx, ctx, id, options);
    const updated = await tx.quote.update({
      where: { id },
      data: {
        locationId: input.locationId ?? null, jobId: input.jobId ?? null, salespersonId: input.salespersonId ?? null, title: input.title, issueDate: input.issueDate, expiresAt: input.expiresAt ?? null,
        taxRateBp, discountType: input.discountType, discountValue: input.discountValue, depositType: input.depositType, depositValue: input.depositValue,
        terms: input.terms ?? null, customerNotes: input.customerNotes ?? null, internalNotes: input.internalNotes ?? null,
        subtotalCents: head.totals.subtotalCents, discountCents: head.totals.discountCents, taxCents: head.totals.taxCents, totalCents: head.totals.totalCents, depositCents: head.totals.depositCents,
      },
    });
    await recordActivity(tx, ctx.tenantId, ctx, { customerId: q.customerId, entityType: "QUOTE", entityId: id, type: "quote.updated", summary: `Updated quote ${q.number}` });
    await audit(ctx, "quote.updated", "Quote", id, { total: updated.totalCents }, tx);
    return updated;
  });
}

export async function markQuoteReady(ctx: Ctx, id: string) {
  requirePermission(ctx, "quotes.edit");
  const q = await ctx.db.quote.findFirst({ where: { id, deletedAt: null }, include: { options: { include: { _count: { select: { lineItems: true } } } } } });
  if (!q) throw notFound("Quote");
  assertTransition("quote", q.status, "READY");
  if (q.options.every((o) => o._count.lineItems === 0)) throw invalidState("Add line items before marking the quote ready.");
  await ctx.db.quote.update({ where: { id }, data: { status: "READY" } });
}

/** Reopen a sent/declined/expired quote for editing; revokes the customer's link. */
export async function reviseQuote(ctx: Ctx, id: string) {
  requirePermission(ctx, "quotes.edit");
  const q = await ctx.db.quote.findFirst({ where: { id, deletedAt: null } });
  if (!q) throw notFound("Quote");
  assertTransition("quote", q.status, "DRAFT");
  await ctx.db.tx(async (tx) => {
    await tx.quote.update({ where: { id }, data: { status: "DRAFT", version: { increment: 1 }, viewedAt: null, declinedAt: null, declineReason: null } });
    await tx.publicLink.updateMany({ where: { kind: "QUOTE", entityId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await recordActivity(tx, ctx.tenantId, ctx, { customerId: q.customerId, entityType: "QUOTE", entityId: id, type: "quote.revised", summary: `Reopened quote ${q.number} for revision` });
    await audit(ctx, "quote.revised", "Quote", id, { from: q.status }, tx);
  });
}

const sendSchema = z.object({ to: z.preprocess((v) => (v === "" ? undefined : v), emailSchema.optional()), message: optStr(2000) });

export async function sendQuote(ctx: Ctx, id: string, raw: unknown = {}) {
  requirePermission(ctx, "quotes.send");
  const input = parseInput(sendSchema, raw);
  await expireStaleQuotes(ctx.db);
  const q = await ctx.db.quote.findFirst({ where: { id, deletedAt: null }, include: { customer: true, options: { include: { _count: { select: { lineItems: true } } } } } });
  if (!q) throw notFound("Quote");
  if (q.status === "APPROVED" || q.status === "CONVERTED" || q.status === "DECLINED") throw invalidState(`This quote is ${humanize(q.status).toLowerCase()} and can't be sent again.`);
  if (q.options.every((o) => o._count.lineItems === 0)) throw invalidState("Add line items before sending.");
  const settings = await ctx.db.tenantSettings.findFirst({ where: {} });
  const tz = settings?.timezone ?? "America/Chicago";
  if (q.status === "EXPIRED") {
    // Re-sending an expired quote extends it by the default validity period.
    await ctx.db.quote.update({ where: { id }, data: { expiresAt: addDays(todayDateOnly(tz), settings?.quoteExpirationDays ?? 30), status: "DRAFT" } });
    q.expiresAt = addDays(todayDateOnly(tz), settings?.quoteExpirationDays ?? 30);
    q.status = "DRAFT";
  }
  const to = input.to ?? q.customer.email;
  if (!to) throw new AppError("VALIDATION", "This customer has no email address. Add one or enter a recipient.", { to: "Required" });

  const linkExpiry = q.expiresAt ? addDays(q.expiresAt, 14) : addDays(new Date(), 60);
  const { url } = await issuePublicLink(ctx.db, ctx.tenantId, { kind: "QUOTE", entityId: id, customerId: q.customerId, expiresAt: linkExpiry, createdById: ctx.userId });
  const brand = await loadBranding(ctx.db, ctx.tenantId);
  try {
    await deliverEmail(ctx.db, ctx.tenantId, {
      template: "quote", to,
      email: quoteEmail(brand, { customerName: q.customer.displayName, quoteNumber: q.number, title: q.title, totalCents: q.totalCents, currency: settings?.currency ?? "USD", expiresOn: q.expiresAt ? formatDateOnly(q.expiresAt) : null, message: input.message, url, optionCount: q.options.length }),
      companyName: brand.companyName, replyTo: brand.email, customerId: q.customerId, entityType: "QUOTE", entityId: id, sentById: ctx.userId,
    });
  } catch (err) {
    await ctx.db.publicLink.updateMany({ where: { kind: "QUOTE", entityId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    throw err;
  }
  await ctx.db.tx(async (tx) => {
    const next: QuoteStatus = q.status === "VIEWED" ? "VIEWED" : "SENT";
    assertTransition("quote", q.status, next);
    await tx.quote.update({ where: { id }, data: { status: next, sentAt: new Date() } });
    await recordActivity(tx, ctx.tenantId, ctx, { customerId: q.customerId, entityType: "QUOTE", entityId: id, type: "quote.sent", summary: `Quote ${q.number} emailed to ${to}` });
    await audit(ctx, "quote.sent", "Quote", id, { to }, tx);
  });
  return { url };
}

const manualResponseSchema = z.object({ optionId: optId, note: optStr(500) });

/** Office records the customer's verbal / written answer. */
export async function recordQuoteDecision(ctx: Ctx, id: string, decision: "APPROVED" | "DECLINED", raw: unknown = {}) {
  requirePermission(ctx, "quotes.approve");
  const input = parseInput(manualResponseSchema, raw);
  const q = await ctx.db.quote.findFirst({ where: { id, deletedAt: null }, include: { options: true } });
  if (!q) throw notFound("Quote");
  assertTransition("quote", q.status, decision);
  const option = decision === "APPROVED" ? (input.optionId ? q.options.find((o) => o.id === input.optionId) : q.options.length === 1 ? q.options[0] : undefined) : undefined;
  if (decision === "APPROVED" && !option) throw new AppError("VALIDATION", "Choose which option the customer approved.", { optionId: "Required" });
  await ctx.db.tx(async (tx) => {
    await tx.quote.update({
      where: { id },
      data: decision === "APPROVED"
        ? { status: "APPROVED", approvedAt: new Date(), approvedOptionId: option!.id, subtotalCents: option!.subtotalCents, discountCents: option!.discountCents, taxCents: option!.taxCents, totalCents: option!.totalCents, depositCents: option!.depositCents, customerMessage: input.note ?? null }
        : { status: "DECLINED", declinedAt: new Date(), declineReason: input.note ?? null },
    });
    await recordActivity(tx, ctx.tenantId, ctx, { customerId: q.customerId, entityType: "QUOTE", entityId: id, type: decision === "APPROVED" ? "quote.approved" : "quote.declined", summary: `Quote ${q.number} ${decision === "APPROVED" ? "approved" : "declined"} (recorded by ${ctx.userName})` });
    await audit(ctx, decision === "APPROVED" ? "quote.approved" : "quote.declined", "Quote", id, { manual: true, optionId: option?.id ?? null }, tx);
  });
}

export async function deleteQuote(ctx: Ctx, id: string) {
  requirePermission(ctx, "quotes.edit");
  const q = await ctx.db.quote.findFirst({ where: { id, deletedAt: null } });
  if (!q) throw notFound("Quote");
  if (!["DRAFT", "READY", "DECLINED", "EXPIRED"].includes(q.status)) throw invalidState("Sent or approved quotes can't be deleted.");
  await ctx.db.tx(async (tx) => {
    await tx.quote.update({ where: { id }, data: { deletedAt: new Date() } });
    await tx.publicLink.updateMany({ where: { kind: "QUOTE", entityId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(ctx, "quote.deleted", "Quote", id, { number: q.number }, tx);
  });
}

// ─── Conversion ─────────────────────────────────────────────────────────────────────────

const convertSchema = z.object({ to: z.enum(["job", "invoice", "job_and_invoice"]), locationId: optId });

/** Approved quote → job and/or invoice, carrying every line across (no re-entry). */
export async function convertQuote(ctx: Ctx, id: string, raw: unknown) {
  requirePermission(ctx, "quotes.edit");
  const input = parseInput(convertSchema, raw);
  const wantsJob = input.to !== "invoice";
  const wantsInvoice = input.to !== "job";
  if (wantsJob) requirePermission(ctx, "jobs.create");
  if (wantsInvoice) requirePermission(ctx, "invoices.create");
  return ctx.db.tx(async (tx) => {
    const q = await tx.quote.findFirst({ where: { id, deletedAt: null }, include: { customer: true, options: { include: { lineItems: { orderBy: { position: "asc" } } } } } });
    if (!q) throw notFound("Quote");
    if (q.status !== "APPROVED") throw invalidState("Only approved quotes can be converted.");
    const option = q.options.find((o) => o.id === q.approvedOptionId) ?? q.options[0];
    if (!option) throw invalidState("This quote has no approved option.");
    const settings = await tx.tenantSettings.findFirst({ where: {} });
    let jobId = q.jobId;
    let invoiceId: string | null = null;

    if (wantsJob && !jobId) {
      const locationId = q.locationId ?? input.locationId ?? (await tx.customerLocation.findFirst({ where: { customerId: q.customerId, deletedAt: null }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] }))?.id;
      if (!locationId) throw new AppError("VALIDATION", "Choose a service location for the job.", { locationId: "Required" });
      const job = await insertJob(tx, ctx, {
        customerId: q.customerId, locationId, title: q.title, description: `Approved quote ${q.number} — ${option.name}${option.description ? `\n${option.description}` : ""}`,
        priority: "NORMAL", assigneeIds: [], equipmentIds: [], quoteId: q.id, customerNotes: q.customerNotes, jobTypeId: null, dispatcherId: null, internalNotes: null, agreementId: null, estimatedMinutes: undefined,
      });
      jobId = job.id;
      // Carry the approved scope across as the job's billable lines.
      await tx.jobLineItem.createMany({
        data: option.lineItems.map((l) => ({ tenantId: ctx.tenantId, jobId: job.id, kind: l.kind, pricebookItemId: l.pricebookItemId, name: l.name, description: l.description, quantity: l.quantity, unitPriceCents: l.unitPriceCents, unitCostCents: l.unitCostCents, taxable: l.taxable, addedById: ctx.userId })),
      });
      await recordActivity(tx, ctx.tenantId, ctx, { customerId: q.customerId, entityType: "JOB", entityId: job.id, type: "job.created", summary: `Created job ${job.number} from quote ${q.number}` });
    }

    if (wantsInvoice) {
      const lines: PreparedLine[] = option.lineItems.map((l, position) => ({
        position, kind: l.kind, pricebookItemId: l.pricebookItemId, name: l.name, description: l.description, quantity: l.quantity.toString(),
        unitPriceCents: l.unitPriceCents, unitCostCents: l.unitCostCents, discountType: l.discountType, discountValue: l.discountValue, taxable: l.taxable, totalCents: 0,
      }));
      const inv = await insertInvoice(tx, ctx, {
        customerId: q.customerId, locationId: q.locationId, jobId, quoteId: q.id, title: q.title,
        issueDate: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`), paymentTermsDays: settings?.paymentTermsDays ?? 30,
        taxRateBp: q.taxRateBp, discountType: q.discountType, discountValue: q.discountValue, depositRequiredCents: q.depositCents,
        terms: settings?.invoiceTerms ?? null, customerNotes: q.customerNotes, internalNotes: q.internalNotes, lines,
      });
      invoiceId = inv.id;
      // If a job exists the lines are already billed through this invoice.
      if (jobId) await tx.jobLineItem.updateMany({ where: { jobId }, data: { invoicedAt: new Date() } });
    }

    await tx.quote.update({ where: { id }, data: { status: "CONVERTED", convertedAt: new Date(), jobId, convertedInvoiceId: invoiceId } });
    await recordActivity(tx, ctx.tenantId, ctx, { customerId: q.customerId, entityType: "QUOTE", entityId: id, type: "quote.converted", summary: `Quote ${q.number} converted${jobId ? " to a job" : ""}${jobId && invoiceId ? " and" : ""}${invoiceId ? " to an invoice" : ""}` });
    await audit(ctx, "quote.converted", "Quote", id, { jobId, invoiceId }, tx);
    return { jobId, invoiceId };
  });
}

// ─── Queries ────────────────────────────────────────────────────────────────────────────

export async function listQuotes(ctx: Ctx, p: ListParams) {
  requirePermission(ctx, "quotes.view");
  await expireStaleQuotes(ctx.db);
  const and: Prisma.QuoteWhereInput[] = [{ deletedAt: null }];
  if (p.q) and.push({ OR: [{ number: { contains: p.q, mode: "insensitive" } }, { title: { contains: p.q, mode: "insensitive" } }, { customer: { displayName: { contains: p.q, mode: "insensitive" } } }] });
  const f = p.filters;
  if (f.status === "OUTSTANDING") and.push({ status: { in: ["SENT", "VIEWED"] } });
  else if (f.status && (QUOTE_STATUSES as string[]).includes(f.status)) and.push({ status: f.status as QuoteStatus });
  if (f.customer) and.push({ customerId: f.customer });
  if (f.salesperson) and.push({ salespersonId: f.salesperson });
  const from = parseDate(f.from), to = parseDate(f.to);
  if (from) and.push({ issueDate: { gte: from } });
  if (to) and.push({ issueDate: { lte: to } });
  if (f.minAmount && /^\d+(\.\d{1,2})?$/.test(f.minAmount)) and.push({ totalCents: { gte: Math.round(Number(f.minAmount) * 100) } });
  if (f.maxAmount && /^\d+(\.\d{1,2})?$/.test(f.maxAmount)) and.push({ totalCents: { lte: Math.round(Number(f.maxAmount) * 100) } });
  const where = { AND: and };
  const orderBy: Prisma.QuoteOrderByWithRelationInput = p.sort === "total" ? { totalCents: p.dir } : p.sort === "expiresAt" ? { expiresAt: { sort: p.dir, nulls: "last" } } : p.sort === "customer" ? { customer: { displayName: p.dir } } : p.sort === "number" ? { number: p.dir } : p.sort === "status" ? { status: p.dir } : { issueDate: p.dir };
  const [rows, total, sum] = await Promise.all([
    ctx.db.quote.findMany({ where, orderBy: [orderBy, { id: "desc" }], ...skipTake(p), include: { customer: { select: { id: true, displayName: true } }, _count: { select: { options: true } } } }),
    ctx.db.quote.count({ where }),
    ctx.db.quote.aggregate({ where, _sum: { totalCents: true } }),
  ]);
  const salespeople = await ctx.db.employee.findMany({ where: { id: { in: rows.map((r) => r.salespersonId).filter((x): x is string => !!x) } }, select: { id: true, firstName: true, lastName: true } });
  const sp = new Map(salespeople.map((s) => [s.id, `${s.firstName} ${s.lastName}`]));
  return { ...toPage(rows.map((r) => ({ ...r, salespersonName: r.salespersonId ? (sp.get(r.salespersonId) ?? null) : null })), total, p), sumCents: sum._sum.totalCents ?? 0 };
}

export async function getQuote(ctx: Ctx, id: string) {
  requirePermission(ctx, "quotes.view");
  await expireStaleQuotes(ctx.db);
  const q = await ctx.db.quote.findFirst({
    where: { id, deletedAt: null },
    include: {
      customer: true,
      location: true,
      job: { select: { id: true, number: true, title: true, status: true } },
      options: { orderBy: { position: "asc" }, include: { lineItems: { orderBy: { position: "asc" } } } },
      invoices: { select: { id: true, number: true, status: true, totalCents: true } },
    },
  });
  if (!q) throw notFound("Quote");
  const [salesperson, link, emails, signature] = await Promise.all([
    q.salespersonId ? ctx.db.employee.findFirst({ where: { id: q.salespersonId }, select: { id: true, firstName: true, lastName: true } }) : null,
    ctx.db.publicLink.findFirst({ where: { kind: "QUOTE", entityId: id }, orderBy: { createdAt: "desc" }, select: { createdAt: true, firstViewedAt: true, lastViewedAt: true, viewCount: true, revokedAt: true, expiresAt: true } }),
    ctx.db.emailMessage.findMany({ where: { entityType: "QUOTE", entityId: id }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, toEmail: true, subject: true, status: true, sentAt: true, error: true } }),
    q.signatureId ? ctx.db.signature.findFirst({ where: { id: q.signatureId }, select: { signerName: true, signedAt: true } }) : null,
  ]);
  if (!can(ctx, "pricebook.view_costs")) for (const o of q.options) stripCosts(o.lineItems).forEach((l, i) => (o.lineItems[i]!.unitCostCents = l.unitCostCents));
  return { ...q, salesperson, link, emails, signature };
}

// ─── Customer-facing (token) ─────────────────────────────────────────────────────────────

/** The only fields a customer ever sees — no costs, no internal notes. */
export async function loadPublicQuote(link: ResolvedLink) {
  const q = await link.db.quote.findFirst({
    where: { id: link.entityId, deletedAt: null },
    include: {
      customer: { select: { displayName: true, email: true } },
      location: { select: { name: true, addressLine1: true, addressLine2: true, city: true, state: true, postalCode: true } },
      options: { orderBy: { position: "asc" }, include: { lineItems: { orderBy: { position: "asc" }, select: { id: true, name: true, description: true, quantity: true, unitPriceCents: true, discountType: true, discountValue: true, totalCents: true, taxable: true } } } },
    },
  });
  if (!q) return null;
  const [brand, settings] = await Promise.all([loadBranding(link.db, link.tenantId), link.db.tenantSettings.findFirst({ where: {} })]);
  const signature = q.signatureId ? await link.db.signature.findFirst({ where: { id: q.signatureId }, select: { signerName: true, signedAt: true } }) : null;
  return {
    quote: {
      id: q.id, number: q.number, title: q.title, status: q.status, issueDate: q.issueDate, expiresAt: q.expiresAt, terms: q.terms, customerNotes: q.customerNotes,
      taxRateBp: q.taxRateBp, discountType: q.discountType, discountValue: q.discountValue, discountCents: q.discountCents, taxCents: q.taxCents, subtotalCents: q.subtotalCents, totalCents: q.totalCents, depositCents: q.depositCents,
      approvedOptionId: q.approvedOptionId, approvedAt: q.approvedAt, declinedAt: q.declinedAt,
      customerName: q.customer.displayName, location: q.location,
      options: q.options.map((o) => ({ id: o.id, name: o.name, description: o.description, isRecommended: o.isRecommended, subtotalCents: o.subtotalCents, discountCents: o.discountCents, taxCents: o.taxCents, totalCents: o.totalCents, depositCents: o.depositCents, lines: o.lineItems })),
    },
    brand,
    currency: settings?.currency ?? "USD",
    timezone: settings?.timezone ?? "America/Chicago",
    requireSignature: settings?.requireQuoteSignature ?? false,
    introText: settings?.quoteIntro ?? null,
    footerText: settings?.quoteFooter ?? null,
    signature,
  };
}

/** Customer opened the link: mark VIEWED once, log the event, tell the team. */
export async function recordQuoteView(link: ResolvedLink, meta: { ip?: string; userAgent?: string }) {
  await touchPublicLink(link);
  const q = await link.db.quote.findFirst({ where: { id: link.entityId, deletedAt: null }, include: { customer: { select: { displayName: true } } } });
  if (!q) return;
  if (q.status === "SENT" || q.status === "READY") {
    await link.db.tx(async (tx) => {
      await tx.quote.update({ where: { id: q.id }, data: { status: "VIEWED", viewedAt: q.viewedAt ?? new Date() } });
      await recordActivity(tx, link.tenantId, null, { customerId: q.customerId, entityType: "QUOTE", entityId: q.id, type: "quote.viewed", summary: `${q.customer.displayName} viewed quote ${q.number}`, actor: { type: "CUSTOMER", name: q.customer.displayName } });
      await notifyWithPermission(tx, link.tenantId, "quotes.view", { type: "QUOTE_VIEWED", title: `${q.customer.displayName} viewed ${q.number}`, href: `/quotes/${q.id}`, entityType: "QUOTE", entityId: q.id });
      await auditAs(tx, link.tenantId, { name: q.customer.displayName }, "quote.viewed", "Quote", q.id, undefined, meta);
    });
  }
}

const respondSchema = z.object({
  action: z.enum(["approve", "decline"]),
  optionId: optId,
  message: optStr(1000),
  signerName: optStr(120),
  signatureData: optStr(400_000),
});

const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/;

export async function respondToPublicQuote(token: string, raw: unknown, meta: { ip?: string; userAgent?: string }) {
  const link = await resolvePublicLink(token, "QUOTE", meta);
  if (!link) throw notFound("Quote");
  return respondWithLink(link, raw, meta);
}

/** Core of the customer response; `link.entityId` is the quote (from a quote link or a verified portal link). */
export async function respondWithLink(link: ResolvedLink, raw: unknown, meta: { ip?: string; userAgent?: string }) {
  const input = parseInput(respondSchema, raw);
  const settings = await link.db.tenantSettings.findFirst({ where: {} });
  const result = await link.db.tx(async (tx) => {
    await tx.$queryRaw`SELECT id FROM quotes WHERE id = ${link.entityId} FOR UPDATE`;
    const q = await tx.quote.findFirst({ where: { id: link.entityId, deletedAt: null }, include: { customer: { select: { displayName: true } }, options: true } });
    if (!q) throw notFound("Quote");
    if (!["SENT", "VIEWED", "READY"].includes(q.status)) {
      throw invalidState(q.status === "APPROVED" || q.status === "CONVERTED" ? "This quote has already been approved." : q.status === "DECLINED" ? "This quote was declined." : "This quote is no longer open for response.");
    }
    const today = todayDateOnly(settings?.timezone ?? "America/Chicago");
    if (q.expiresAt && q.expiresAt < today) {
      await tx.quote.update({ where: { id: q.id }, data: { status: "EXPIRED" } });
      throw invalidState("This quote has expired. Please contact us for an updated quote.");
    }
    const actor = { type: "CUSTOMER" as const, name: q.customer.displayName };
    if (input.action === "decline") {
      await tx.quote.update({ where: { id: q.id }, data: { status: "DECLINED", declinedAt: new Date(), declineReason: input.message ?? null, customerMessage: input.message ?? null } });
      await recordActivity(tx, link.tenantId, null, { customerId: q.customerId, entityType: "QUOTE", entityId: q.id, type: "quote.declined", summary: `${q.customer.displayName} declined quote ${q.number}${input.message ? ` — “${input.message}”` : ""}`, actor });
      await notifyWithPermission(tx, link.tenantId, "quotes.view", { type: "QUOTE_DECLINED", title: `${q.customer.displayName} declined ${q.number}`, body: input.message ?? null, href: `/quotes/${q.id}`, entityType: "QUOTE", entityId: q.id });
      await auditAs(tx, link.tenantId, { name: q.customer.displayName }, "quote.declined", "Quote", q.id, undefined, meta);
      return { status: "DECLINED" as const };
    }
    const option = input.optionId ? q.options.find((o) => o.id === input.optionId) : q.options.length === 1 ? q.options[0] : undefined;
    if (!option) throw new AppError("VALIDATION", "Please choose one of the options to approve.");
    let signatureId: string | null = null;
    const wantsSig = settings?.requireQuoteSignature ?? false;
    if (wantsSig && (!input.signerName || !input.signatureData)) throw new AppError("VALIDATION", "Please type your name and sign to approve this quote.");
    if (input.signerName && input.signatureData) {
      const m = PNG_DATA_URL.exec(input.signatureData);
      if (!m) throw new AppError("VALIDATION", "The signature could not be read. Please sign again.");
      const bytes = Buffer.from(m[1]!, "base64");
      if (bytes.length < 100 || bytes.length > 300_000 || bytes.readUInt32BE(0) !== 0x89504e47) throw new AppError("VALIDATION", "The signature could not be read. Please sign again.");
      const key = `${link.tenantId}/signatures/${randomUUID()}`;
      await storage().put(key, bytes, "image/png");
      const sig = await tx.signature.create({ data: { tenantId: link.tenantId, entityType: "QUOTE", entityId: q.id, signerName: input.signerName, storageKey: key, ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null } });
      signatureId = sig.id;
    }
    await tx.quote.update({
      where: { id: q.id },
      data: { status: "APPROVED", approvedAt: new Date(), approvedOptionId: option.id, signatureId, customerMessage: input.message ?? null, subtotalCents: option.subtotalCents, discountCents: option.discountCents, taxCents: option.taxCents, totalCents: option.totalCents, depositCents: option.depositCents },
    });
    await recordActivity(tx, link.tenantId, null, { customerId: q.customerId, entityType: "QUOTE", entityId: q.id, type: "quote.approved", summary: `${q.customer.displayName} approved quote ${q.number}${q.options.length > 1 ? ` (${option.name})` : ""} — ${formatMoney(option.totalCents)}`, actor });
    const who = [q.salespersonId ? (await tx.employee.findFirst({ where: { id: q.salespersonId }, select: { membership: { select: { userId: true } } } }))?.membership?.userId : null].filter((u): u is string => !!u);
    await notifyUsers(tx, link.tenantId, who, { type: "QUOTE_APPROVED", title: `${q.customer.displayName} approved ${q.number}`, body: formatMoney(option.totalCents), href: `/quotes/${q.id}`, entityType: "QUOTE", entityId: q.id });
    await notifyWithPermission(tx, link.tenantId, "quotes.edit", { type: "QUOTE_APPROVED", title: `${q.customer.displayName} approved ${q.number}`, body: formatMoney(option.totalCents), href: `/quotes/${q.id}`, entityType: "QUOTE", entityId: q.id });
    await auditAs(tx, link.tenantId, { name: q.customer.displayName }, "quote.approved", "Quote", q.id, { optionId: option.id, signed: !!signatureId }, meta);
    return { status: "APPROVED" as const };
  });
  return result;
}


/** Empty draft quote (one empty option) — used when converting a lead. Run inside a transaction. */
export async function insertQuoteShell(
  tx: Parameters<Parameters<Ctx["db"]["tx"]>[0]>[0],
  ctx: Ctx,
  d: { customerId: string; locationId?: string | null; title: string; salespersonId?: string | null },
) {
  const [settings, customer] = await Promise.all([tx.tenantSettings.findFirst({ where: {} }), tx.customer.findFirst({ where: { id: d.customerId }, select: { taxExempt: true } })]);
  const tz = settings?.timezone ?? "America/Chicago";
  const number = await nextDocumentNumber(tx, ctx.tenantId, "QUOTE");
  const q = await tx.quote.create({
    data: {
      tenantId: ctx.tenantId, number, customerId: d.customerId, locationId: d.locationId ?? null, salespersonId: d.salespersonId ?? ctx.employeeId ?? null, title: d.title, status: "DRAFT",
      issueDate: todayDateOnly(tz), expiresAt: addDays(todayDateOnly(tz), settings?.quoteExpirationDays ?? 30), taxRateBp: customer?.taxExempt ? 0 : (settings?.defaultTaxRateBp ?? 0),
      terms: settings?.quoteTerms ?? null,
      options: { create: [{ position: 0, name: "Option 1", isRecommended: false }] },
    },
  });
  await recordActivity(tx, ctx.tenantId, ctx, { customerId: d.customerId, entityType: "QUOTE", entityId: q.id, type: "quote.created", summary: `Created quote ${q.number} — ${q.title}` });
  return q;
}
