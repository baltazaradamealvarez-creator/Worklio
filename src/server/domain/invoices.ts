import { addDays } from "date-fns";
import type { DiscountType, InvoiceStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { requirePermission, type Ctx } from "@/server/auth/context";
import type { Db } from "@/server/db";
import { AppError, forbidden, invalidState, notFound } from "@/server/errors";
import { formatDateOnly } from "@/lib/format";
import { assertTransition, OPEN_INVOICE_STATUSES } from "@/lib/state";
import { dateReq, email as emailSchema, optDate, optId, optStr, parseInput, percentBp, str } from "@/lib/validation";
import { can } from "@/server/auth/context";
import { deliverEmail, loadBranding } from "@/server/email/service";
import { invoiceEmail } from "@/server/email/templates";
import { customerScope } from "./entity-access";
import { discountSchema, lineInputSchema, prepareLines, stripCosts, totalsFor, type PreparedLine } from "./documents";
import { skipTake, toPage, parseDate, type ListParams } from "./list";
import { nextDocumentNumber } from "./numbering";
import { issuePublicLink } from "./public-links";
import { audit, recordActivity, todayDateOnly } from "./shared";
import { tenantTimezone } from "./scheduling";

export const INVOICE_STATUSES: InvoiceStatus[] = ["DRAFT", "OPEN", "SENT", "VIEWED", "PARTIALLY_PAID", "PAID", "VOID"];

export interface InvoiceDraft {
  customerId: string;
  locationId?: string | null;
  jobId?: string | null;
  quoteId?: string | null;
  agreementId?: string | null;
  title?: string | null;
  issueDate: Date;
  paymentTermsDays: number;
  taxRateBp: number;
  discountType: DiscountType;
  discountValue: number;
  depositRequiredCents?: number;
  terms?: string | null;
  customerNotes?: string | null;
  internalNotes?: string | null;
  lines: PreparedLine[];
  status?: InvoiceStatus;
}

/** Insert an invoice with server-computed totals. Run inside `ctx.db.tx`. */
export async function insertInvoice(tx: Db, ctx: Ctx, d: InvoiceDraft) {
  const totals = totalsFor(d.lines, { taxRateBp: d.taxRateBp, discountType: d.discountType, discountValue: d.discountValue });
  const deposit = Math.min(d.depositRequiredCents ?? 0, totals.totalCents);
  const number = await nextDocumentNumber(tx, ctx.tenantId, "INVOICE");
  const dueDate = addDays(d.issueDate, d.paymentTermsDays);
  const inv = await tx.invoice.create({
    data: {
      tenantId: ctx.tenantId,
      number,
      customerId: d.customerId,
      locationId: d.locationId ?? null,
      jobId: d.jobId ?? null,
      quoteId: d.quoteId ?? null,
      agreementId: d.agreementId ?? null,
      title: d.title ?? null,
      status: d.status ?? "DRAFT",
      issueDate: d.issueDate,
      dueDate,
      paymentTermsDays: d.paymentTermsDays,
      taxRateBp: d.taxRateBp,
      discountType: d.discountType,
      discountValue: d.discountValue,
      depositRequiredCents: deposit,
      terms: d.terms ?? null,
      customerNotes: d.customerNotes ?? null,
      internalNotes: d.internalNotes ?? null,
      subtotalCents: totals.subtotalCents,
      discountCents: totals.discountCents,
      taxCents: totals.taxCents,
      totalCents: totals.totalCents,
      amountPaidCents: 0,
      balanceCents: totals.totalCents,
      createdById: ctx.userId,
      lineItems: { create: d.lines.map((l) => ({ ...l })) },
    },
  });
  await recordActivity(tx, ctx.tenantId, ctx, { customerId: d.customerId, entityType: "INVOICE", entityId: inv.id, type: "invoice.created", summary: `Created invoice ${inv.number}` });
  await audit(ctx, "invoice.created", "Invoice", inv.id, { number: inv.number, total: inv.totalCents }, tx);
  return inv;
}

async function defaults(ctx: Ctx, customerId: string) {
  const [settings, customer] = await Promise.all([
    ctx.db.tenantSettings.findFirst({ where: {} }),
    ctx.db.customer.findFirst({ where: { id: customerId, deletedAt: null, ...customerScope(ctx) }, select: { id: true, taxExempt: true, displayName: true } }),
  ]);
  if (!customer) throw notFound("Customer");
  return { settings, customer, taxRateBp: customer.taxExempt ? 0 : (settings?.defaultTaxRateBp ?? 0) };
}

const invoiceSchema = z.object({
  customerId: str(40),
  locationId: optId,
  jobId: optId,
  title: optStr(160),
  issueDate: dateReq,
  paymentTermsDays: z.coerce.number().int().min(0).max(365),
  taxRate: percentBp,
  ...discountSchema,
  depositRequired: z.coerce.number().int().min(0).default(0),
  terms: optStr(8000),
  customerNotes: optStr(4000),
  internalNotes: optStr(4000),
  lines: z.array(lineInputSchema).min(1, "Add at least one line item").max(200),
});

async function assertRefs(ctx: Ctx, customerId: string, locationId?: string | null, jobId?: string | null) {
  if (locationId && !(await ctx.db.customerLocation.findFirst({ where: { id: locationId, customerId } }))) throw notFound("Location");
  if (jobId && !(await ctx.db.job.findFirst({ where: { id: jobId, customerId, deletedAt: null } }))) throw notFound("Job");
}

export async function createInvoice(ctx: Ctx, raw: unknown) {
  requirePermission(ctx, "invoices.create");
  const input = parseInput(invoiceSchema, raw);
  const { customer, taxRateBp } = await defaults(ctx, input.customerId);
  await assertRefs(ctx, input.customerId, input.locationId, input.jobId);
  const lines = await prepareLines(ctx, input.lines);
  return ctx.db.tx((tx) =>
    insertInvoice(tx, ctx, {
      customerId: customer.id,
      locationId: input.locationId,
      jobId: input.jobId,
      title: input.title,
      issueDate: input.issueDate,
      paymentTermsDays: input.paymentTermsDays,
      taxRateBp: customer.taxExempt ? 0 : input.taxRate || taxRateBp,
      discountType: input.discountType,
      discountValue: input.discountValue,
      depositRequiredCents: input.depositRequired,
      terms: input.terms,
      customerNotes: input.customerNotes,
      internalNotes: input.internalNotes,
      lines,
    }),
  );
}

/** Build an invoice from a job's un-invoiced services, labor and materials. */
export async function createInvoiceFromJob(ctx: Ctx, jobId: string) {
  requirePermission(ctx, "invoices.create");
  const job = await ctx.db.job.findFirst({ where: { id: jobId, deletedAt: null }, include: { lineItems: { where: { invoicedAt: null }, orderBy: { createdAt: "asc" } } } });
  if (!job) throw notFound("Job");
  if (job.status === "CANCELLED") throw invalidState("A cancelled job can't be invoiced.");
  if (job.lineItems.length === 0) throw invalidState("This job has no un-invoiced services or materials. Add them to the job first.");
  const { settings, taxRateBp } = await defaults(ctx, job.customerId);
  const lines: PreparedLine[] = job.lineItems.map((l, position) => ({
    position, kind: l.kind, pricebookItemId: l.pricebookItemId, name: l.name, description: l.description, quantity: l.quantity.toString(),
    unitPriceCents: l.unitPriceCents, unitCostCents: l.unitCostCents, discountType: "NONE", discountValue: 0, taxable: l.taxable, totalCents: 0,
  }));
  return ctx.db.tx(async (tx) => {
    const inv = await insertInvoice(tx, ctx, {
      customerId: job.customerId,
      locationId: job.locationId,
      jobId: job.id,
      quoteId: job.quoteId,
      title: job.title,
      issueDate: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`),
      paymentTermsDays: settings?.paymentTermsDays ?? 30,
      taxRateBp,
      discountType: "NONE",
      discountValue: 0,
      terms: settings?.invoiceTerms,
      customerNotes: job.customerNotes,
      lines,
    });
    await tx.jobLineItem.updateMany({ where: { id: { in: job.lineItems.map((l) => l.id) } }, data: { invoicedAt: new Date() } });
    return inv;
  });
}

const editSchema = invoiceSchema.partial({ customerId: true, issueDate: true, paymentTermsDays: true, taxRate: true, lines: true });

export async function updateInvoice(ctx: Ctx, id: string, raw: unknown) {
  requirePermission(ctx, "invoices.edit");
  const input = parseInput(editSchema, raw);
  const inv = await ctx.db.invoice.findFirst({ where: { id } });
  if (!inv) throw notFound("Invoice");
  if (inv.status === "VOID") throw invalidState("A void invoice can't be edited.");
  return ctx.db.tx(async (tx) => {
    if (inv.status !== "DRAFT") {
      // Issued invoices are immutable apart from presentation fields and the due date.
      const patch: Prisma.InvoiceUncheckedUpdateInput = {
        terms: input.terms ?? inv.terms,
        customerNotes: input.customerNotes ?? inv.customerNotes,
        internalNotes: input.internalNotes ?? inv.internalNotes,
      };
      if (input.paymentTermsDays != null) {
        patch.paymentTermsDays = input.paymentTermsDays;
        patch.dueDate = addDays(inv.issueDate, input.paymentTermsDays);
      }
      const updated = await tx.invoice.update({ where: { id }, data: patch });
      await audit(ctx, "invoice.updated", "Invoice", id, { fields: Object.keys(patch) }, tx);
      return updated;
    }
    const lines = input.lines ? await prepareLines(ctx, input.lines) : null;
    const taxRateBp = input.taxRate ?? inv.taxRateBp;
    const discountType = input.discountType ?? inv.discountType;
    const discountValue = input.discountValue ?? inv.discountValue;
    const useLines: PreparedLine[] =
      lines ??
      (await tx.invoiceLineItem.findMany({ where: { invoiceId: id }, orderBy: { position: "asc" } })).map((l) => ({
        position: l.position, kind: l.kind, pricebookItemId: l.pricebookItemId, name: l.name, description: l.description, quantity: l.quantity.toString(),
        unitPriceCents: l.unitPriceCents, unitCostCents: l.unitCostCents, discountType: l.discountType, discountValue: l.discountValue, taxable: l.taxable, totalCents: 0,
      }));
    const totals = totalsFor(useLines, { taxRateBp, discountType, discountValue });
    const issueDate = input.issueDate ?? inv.issueDate;
    const terms = input.paymentTermsDays ?? inv.paymentTermsDays;
    if (lines) {
      await tx.invoiceLineItem.deleteMany({ where: { invoiceId: id } });
      await tx.invoiceLineItem.createMany({ data: useLines.map((l) => ({ tenantId: ctx.tenantId, invoiceId: id, ...l })) });
    }
    const updated = await tx.invoice.update({
      where: { id },
      data: {
        locationId: input.locationId === undefined ? inv.locationId : input.locationId,
        title: input.title === undefined ? inv.title : input.title,
        issueDate,
        paymentTermsDays: terms,
        dueDate: addDays(issueDate, terms),
        taxRateBp,
        discountType,
        discountValue,
        depositRequiredCents: Math.min(input.depositRequired ?? inv.depositRequiredCents, totals.totalCents),
        terms: input.terms === undefined ? inv.terms : input.terms,
        customerNotes: input.customerNotes === undefined ? inv.customerNotes : input.customerNotes,
        internalNotes: input.internalNotes === undefined ? inv.internalNotes : input.internalNotes,
        subtotalCents: totals.subtotalCents,
        discountCents: totals.discountCents,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        balanceCents: totals.totalCents - inv.amountPaidCents,
      },
    });
    await audit(ctx, "invoice.updated", "Invoice", id, { total: updated.totalCents }, tx);
    return updated;
  });
}

/** Finalise a draft without emailing it. */
export async function markInvoiceOpen(ctx: Ctx, id: string) {
  requirePermission(ctx, "invoices.edit");
  const inv = await ctx.db.invoice.findFirst({ where: { id }, include: { _count: { select: { lineItems: true } } } });
  if (!inv) throw notFound("Invoice");
  assertTransition("invoice", inv.status, "OPEN");
  if (inv._count.lineItems === 0) throw invalidState("Add at least one line item first.");
  await ctx.db.tx(async (tx) => {
    await tx.invoice.update({ where: { id }, data: { status: "OPEN" } });
    await recordActivity(tx, ctx.tenantId, ctx, { customerId: inv.customerId, entityType: "INVOICE", entityId: id, type: "invoice.issued", summary: `Invoice ${inv.number} finalised` });
    await audit(ctx, "invoice.issued", "Invoice", id, undefined, tx);
  });
}

const sendSchema = z.object({ to: z.preprocess((v) => (v === "" ? undefined : v), emailSchema.optional()), message: optStr(2000) });

export async function sendInvoice(ctx: Ctx, id: string, raw: unknown = {}) {
  requirePermission(ctx, "invoices.send");
  const input = parseInput(sendSchema, raw);
  const inv = await ctx.db.invoice.findFirst({ where: { id }, include: { customer: true, _count: { select: { lineItems: true } } } });
  if (!inv) throw notFound("Invoice");
  if (inv.status === "VOID" || inv.status === "PAID") throw invalidState(`A ${inv.status.toLowerCase()} invoice can't be sent.`);
  if (inv._count.lineItems === 0) throw invalidState("Add at least one line item first.");
  const to = input.to ?? inv.customer.email;
  if (!to) throw new AppError("VALIDATION", "This customer has no email address. Add one or enter a recipient.", { to: "Required" });

  const { url } = await issuePublicLink(ctx.db, ctx.tenantId, { kind: "INVOICE", entityId: id, customerId: inv.customerId, createdById: ctx.userId });
  const brand = await loadBranding(ctx.db, ctx.tenantId);
  const settings = await ctx.db.tenantSettings.findFirst({ where: {}, select: { currency: true } });
  await deliverEmail(ctx.db, ctx.tenantId, {
    template: "invoice",
    to,
    email: invoiceEmail(brand, { customerName: inv.customer.displayName, invoiceNumber: inv.number, totalCents: inv.totalCents, balanceCents: inv.balanceCents, currency: settings?.currency ?? "USD", dueOn: formatDateOnly(inv.dueDate), message: input.message, url }),
    companyName: brand.companyName,
    replyTo: brand.email,
    customerId: inv.customerId,
    entityType: "INVOICE",
    entityId: id,
    sentById: ctx.userId,
  });
  await ctx.db.tx(async (tx) => {
    const next: InvoiceStatus = inv.status === "DRAFT" || inv.status === "OPEN" ? "SENT" : inv.status;
    await tx.invoice.update({ where: { id }, data: { status: next, sentAt: new Date() } });
    await recordActivity(tx, ctx.tenantId, ctx, { customerId: inv.customerId, entityType: "INVOICE", entityId: id, type: "invoice.sent", summary: `Invoice ${inv.number} emailed to ${to}` });
    await audit(ctx, "invoice.sent", "Invoice", id, { to }, tx);
  });
  return { url };
}

export async function voidInvoice(ctx: Ctx, id: string, reason: string) {
  requirePermission(ctx, "invoices.void");
  if (!reason.trim()) throw new AppError("VALIDATION", "Please give a reason for voiding.", { reason: "Required" });
  const inv = await ctx.db.invoice.findFirst({ where: { id } });
  if (!inv) throw notFound("Invoice");
  assertTransition("invoice", inv.status, "VOID");
  if (inv.amountPaidCents > 0) throw invalidState("This invoice has payments. Void or refund them first.");
  await ctx.db.tx(async (tx) => {
    await tx.invoice.update({ where: { id }, data: { status: "VOID", voidedAt: new Date(), voidReason: reason.trim(), balanceCents: 0 } });
    // Release job lines so they can be invoiced again.
    if (inv.jobId) {
      const lines = await tx.invoiceLineItem.findMany({ where: { invoiceId: id }, select: { pricebookItemId: true, name: true } });
      void lines;
      await tx.jobLineItem.updateMany({ where: { jobId: inv.jobId }, data: { invoicedAt: null } });
    }
    await tx.publicLink.updateMany({ where: { kind: "INVOICE", entityId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await recordActivity(tx, ctx.tenantId, ctx, { customerId: inv.customerId, entityType: "INVOICE", entityId: id, type: "invoice.voided", summary: `Invoice ${inv.number} voided — ${reason.trim()}` });
    await audit(ctx, "invoice.voided", "Invoice", id, { reason: reason.trim(), total: inv.totalCents }, tx);
  });
}

/**
 * Recompute amountPaid / balance / status from the invoice's SUCCEEDED payments.
 * The single place invoice payment state is derived.
 */
export async function applyPaymentsTx(tx: Db, ctx: Pick<Ctx, "tenantId">, invoiceId: string) {
  const inv = await tx.invoice.findFirst({ where: { id: invoiceId } });
  if (!inv) throw notFound("Invoice");
  const agg = await tx.payment.aggregate({ where: { invoiceId, status: "SUCCEEDED" }, _sum: { amountCents: true } });
  const paid = agg._sum.amountCents ?? 0;
  const balance = inv.totalCents - paid;
  let status: InvoiceStatus = inv.status;
  if (inv.status !== "VOID" && inv.status !== "DRAFT") {
    if (paid >= inv.totalCents && inv.totalCents > 0) status = "PAID";
    else if (paid > 0) status = "PARTIALLY_PAID";
    else status = inv.viewedAt ? "VIEWED" : inv.sentAt ? "SENT" : "OPEN";
  }
  return tx.invoice.update({
    where: { id: invoiceId },
    data: { amountPaidCents: paid, balanceCents: balance, status, paidAt: status === "PAID" ? (inv.paidAt ?? new Date()) : null },
  });
}

// ─── Queries ──────────────────────────────────────────────────────────────────────────

export async function pastDueWhere(db: Db): Promise<Prisma.InvoiceWhereInput> {
  const today = todayDateOnly(await tenantTimezone(db));
  return { status: { in: [...OPEN_INVOICE_STATUSES] }, balanceCents: { gt: 0 }, dueDate: { lt: today } };
}

export async function listInvoices(ctx: Ctx, p: ListParams) {
  requirePermission(ctx, "invoices.view");
  const and: Prisma.InvoiceWhereInput[] = [];
  if (p.q) {
    and.push({ OR: [{ number: { contains: p.q, mode: "insensitive" } }, { title: { contains: p.q, mode: "insensitive" } }, { customer: { displayName: { contains: p.q, mode: "insensitive" } } }] });
  }
  const f = p.filters;
  if (f.status === "PAST_DUE") and.push(await pastDueWhere(ctx.db));
  else if (f.status === "OUTSTANDING") and.push({ status: { in: [...OPEN_INVOICE_STATUSES] }, balanceCents: { gt: 0 } });
  else if (f.status && (INVOICE_STATUSES as string[]).includes(f.status)) and.push({ status: f.status as InvoiceStatus });
  if (f.customer) and.push({ customerId: f.customer });
  if (f.job) and.push({ jobId: f.job });
  const from = parseDate(f.from), to = parseDate(f.to);
  if (from) and.push({ issueDate: { gte: from } });
  if (to) and.push({ issueDate: { lte: to } });
  if (f.minAmount && /^\d+(\.\d{1,2})?$/.test(f.minAmount)) and.push({ totalCents: { gte: Math.round(Number(f.minAmount) * 100) } });
  if (f.maxAmount && /^\d+(\.\d{1,2})?$/.test(f.maxAmount)) and.push({ totalCents: { lte: Math.round(Number(f.maxAmount) * 100) } });
  const where = { AND: and };
  const orderBy: Prisma.InvoiceOrderByWithRelationInput =
    p.sort === "dueDate" ? { dueDate: p.dir } : p.sort === "total" ? { totalCents: p.dir } : p.sort === "balance" ? { balanceCents: p.dir } : p.sort === "customer" ? { customer: { displayName: p.dir } } : p.sort === "number" ? { number: p.dir } : { issueDate: p.dir };
  const [rows, total, sums] = await Promise.all([
    ctx.db.invoice.findMany({ where, orderBy: [orderBy, { id: "desc" }], ...skipTake(p), include: { customer: { select: { id: true, displayName: true } } } }),
    ctx.db.invoice.count({ where }),
    ctx.db.invoice.aggregate({ where: { AND: [...and, { status: { not: "VOID" } }] }, _sum: { totalCents: true, balanceCents: true } }),
  ]);
  return { ...toPage(rows, total, p), sums: { totalCents: sums._sum.totalCents ?? 0, balanceCents: sums._sum.balanceCents ?? 0 } };
}

export async function getInvoice(ctx: Ctx, id: string) {
  requirePermission(ctx, "invoices.view");
  const inv = await ctx.db.invoice.findFirst({
    where: { id },
    include: {
      customer: true,
      location: true,
      job: { select: { id: true, number: true, title: true } },
      quote: { select: { id: true, number: true } },
      lineItems: { orderBy: { position: "asc" } },
      payments: { orderBy: { receivedAt: "desc" } },
    },
  });
  if (!inv) throw notFound("Invoice");
  const [links, emails] = await Promise.all([
    ctx.db.publicLink.findMany({ where: { kind: "INVOICE", entityId: id }, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true, firstViewedAt: true, lastViewedAt: true, viewCount: true, revokedAt: true, expiresAt: true } }),
    ctx.db.emailMessage.findMany({ where: { entityType: "INVOICE", entityId: id }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, toEmail: true, subject: true, status: true, sentAt: true, template: true, error: true } }),
  ]);
  if (!can(ctx, "pricebook.view_costs")) stripCosts(inv.lineItems).forEach((l, i) => (inv.lineItems[i]!.unitCostCents = l.unitCostCents));
  return { ...inv, link: links[0] ?? null, emails };
}

void forbidden; void optDate;

// ─── Customer-facing (token) ──────────────────────────────────────────────────────────

import { touchPublicLink, type ResolvedLink } from "./public-links";
import { auditAs, notifyWithPermission } from "./shared";
import { loadBranding as loadBrandingForPublic } from "@/server/email/service";

export async function loadPublicInvoice(link: ResolvedLink) {
  const inv = await link.db.invoice.findFirst({
    where: { id: link.entityId },
    include: {
      customer: { select: { displayName: true, email: true } },
      location: { select: { name: true, addressLine1: true, addressLine2: true, city: true, state: true, postalCode: true } },
      lineItems: { orderBy: { position: "asc" }, select: { id: true, name: true, description: true, quantity: true, unitPriceCents: true, discountType: true, discountValue: true, totalCents: true } },
      payments: { where: { status: "SUCCEEDED" }, orderBy: { receivedAt: "asc" }, select: { id: true, amountCents: true, method: true, receivedAt: true, reference: true } },
    },
  });
  if (!inv || inv.status === "DRAFT") return null;
  const [brand, settings] = await Promise.all([loadBrandingForPublic(link.db, link.tenantId), link.db.tenantSettings.findFirst({ where: {} })]);
  return { invoice: inv, brand, currency: settings?.currency ?? "USD", timezone: settings?.timezone ?? "America/Chicago", footer: settings?.invoiceFooter ?? null };
}

export async function recordInvoiceView(link: ResolvedLink, meta: { ip?: string; userAgent?: string }) {
  await touchPublicLink(link);
  const inv = await link.db.invoice.findFirst({ where: { id: link.entityId }, include: { customer: { select: { displayName: true } } } });
  if (!inv || !["OPEN", "SENT"].includes(inv.status)) return;
  await link.db.tx(async (tx) => {
    await tx.invoice.update({ where: { id: inv.id }, data: { status: "VIEWED", viewedAt: inv.viewedAt ?? new Date() } });
    await recordActivity(tx, link.tenantId, null, { customerId: inv.customerId, entityType: "INVOICE", entityId: inv.id, type: "invoice.viewed", summary: `${inv.customer.displayName} viewed invoice ${inv.number}`, actor: { type: "CUSTOMER", name: inv.customer.displayName } });
    await auditAs(tx, link.tenantId, { name: inv.customer.displayName }, "invoice.viewed", "Invoice", inv.id, undefined, meta);
    void notifyWithPermission;
  });
}
