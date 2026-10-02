import { z } from "zod";
import type { PaymentMethod } from "@prisma/client";
import { can, requirePermission, type Ctx } from "@/server/auth/context";
import { platformDb, tenantDb } from "@/server/db";
import { AppError, invalidState, notFound } from "@/server/errors";
import { formatDateOnly, humanize } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { bool, cents, optDateTime, optStr, parseInput, str } from "@/lib/validation";
import { deliverEmail, loadBranding } from "@/server/email/service";
import { receiptEmail } from "@/server/email/templates";
import { applyPaymentsTx } from "./invoices";
import { publicUrl, issuePublicLink } from "./public-links";
import { skipTake, toPage, parseDate, type ListParams } from "./list";
import { audit, auditAs, notifyWithPermission, recordActivity } from "./shared";
import type { Prisma } from "@prisma/client";

const METHODS = ["CASH", "CHECK", "CREDIT_CARD", "ACH", "EXTERNAL", "MANUAL", "FINANCING", "OTHER"] as const;

const paymentSchema = z.object({
  invoiceId: str(40),
  amount: cents,
  method: z.enum(METHODS),
  receivedAt: optDateTime,
  reference: optStr(120),
  notes: optStr(500),
  isDeposit: bool.optional(),
  sendReceipt: bool.optional(),
});

/** Record a manual / offline payment against an invoice. Overpayment is rejected. */
export async function recordPayment(ctx: Ctx, raw: unknown) {
  requirePermission(ctx, "payments.record");
  const input = parseInput(paymentSchema, raw);
  if (input.amount <= 0) throw new AppError("VALIDATION", "Enter an amount greater than zero.", { amount: "Must be greater than 0" });
  const payment = await ctx.db.tx(async (tx) => {
    // Lock the invoice row so concurrent payments can't jointly overpay it.
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${input.invoiceId} FOR UPDATE`;
    const inv = await tx.invoice.findFirst({ where: { id: input.invoiceId } });
    if (!inv) throw notFound("Invoice");
    if (inv.status === "VOID") throw invalidState("This invoice is void.");
    if (inv.status === "DRAFT") throw invalidState("Finalise or send the invoice before recording payments.");
    if (inv.status === "PAID" || inv.balanceCents <= 0) throw invalidState("This invoice is already paid in full.");
    if (input.amount > inv.balanceCents) {
      throw new AppError("VALIDATION", `Payment exceeds the balance due (${formatMoney(inv.balanceCents)}).`, { amount: "Exceeds balance" });
    }
    const p = await tx.payment.create({
      data: {
        tenantId: ctx.tenantId,
        invoiceId: inv.id,
        customerId: inv.customerId,
        amountCents: input.amount,
        method: input.method as PaymentMethod,
        status: "SUCCEEDED",
        isDeposit: input.isDeposit ?? false,
        reference: input.reference ?? null,
        receivedAt: input.receivedAt ?? new Date(),
        recordedById: ctx.userId,
        notes: input.notes ?? null,
      },
    });
    const updated = await applyPaymentsTx(tx, ctx, inv.id);
    await recordActivity(tx, ctx.tenantId, ctx, {
      customerId: inv.customerId, entityType: "INVOICE", entityId: inv.id, type: "payment.recorded",
      summary: `Payment of ${formatMoney(p.amountCents)} recorded on ${inv.number} (${humanize(p.method)}${p.reference ? ` ${p.reference}` : ""})`,
      metadata: { paymentId: p.id },
    });
    if (updated.status === "PAID") {
      await recordActivity(tx, ctx.tenantId, ctx, { customerId: inv.customerId, entityType: "INVOICE", entityId: inv.id, type: "invoice.paid", summary: `Invoice ${inv.number} paid in full` });
    }
    await notifyWithPermission(tx, ctx.tenantId, "invoices.view", {
      type: updated.status === "PAID" ? "INVOICE_PAID" : "PAYMENT_RECEIVED",
      title: updated.status === "PAID" ? `Invoice ${inv.number} paid` : `Payment received on ${inv.number}`,
      body: formatMoney(p.amountCents), href: `/invoices/${inv.id}`, entityType: "INVOICE", entityId: inv.id,
    }, ctx.userId);
    await audit(ctx, "payment.recorded", "Payment", p.id, { invoiceId: inv.id, amount: p.amountCents, method: p.method }, tx);
    return { payment: p, invoice: updated };
  });
  if (input.sendReceipt) await sendReceipt(ctx, payment.payment.id).catch(() => undefined);
  return payment;
}

export async function voidPayment(ctx: Ctx, paymentId: string, reason: string) {
  requirePermission(ctx, "payments.void");
  if (!reason.trim()) throw new AppError("VALIDATION", "Please give a reason.", { reason: "Required" });
  await ctx.db.tx(async (tx) => {
    const p = await tx.payment.findFirst({ where: { id: paymentId } });
    if (!p) throw notFound("Payment");
    if (p.status !== "SUCCEEDED") throw invalidState("Only completed payments can be voided.");
    if (p.provider) throw invalidState("Card/ACH payments taken online must be refunded through the payment processor.");
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${p.invoiceId} FOR UPDATE`;
    await tx.payment.update({ where: { id: p.id }, data: { status: "VOIDED", voidedAt: new Date(), voidReason: reason.trim() } });
    const inv = await applyPaymentsTx(tx, ctx, p.invoiceId);
    await recordActivity(tx, ctx.tenantId, ctx, { customerId: p.customerId, entityType: "INVOICE", entityId: p.invoiceId, type: "payment.voided", summary: `Payment of ${formatMoney(p.amountCents)} voided on ${inv.number} — ${reason.trim()}` });
    await audit(ctx, "payment.voided", "Payment", p.id, { amount: p.amountCents, reason: reason.trim() }, tx);
  });
}

export async function sendReceipt(ctx: Ctx, paymentId: string) {
  requirePermission(ctx, "payments.view");
  const p = await ctx.db.payment.findFirst({ where: { id: paymentId, status: "SUCCEEDED" }, include: { invoice: true, customer: true } });
  if (!p) throw notFound("Payment");
  if (!p.customer.email) throw new AppError("VALIDATION", "This customer has no email address.");
  const { url } = await issuePublicLink(ctx.db, ctx.tenantId, { kind: "INVOICE", entityId: p.invoiceId, customerId: p.customerId, createdById: ctx.userId, revokeExisting: false });
  const brand = await loadBranding(ctx.db, ctx.tenantId);
  const settings = await ctx.db.tenantSettings.findFirst({ where: {}, select: { currency: true } });
  await deliverEmail(ctx.db, ctx.tenantId, {
    template: "receipt", to: p.customer.email,
    email: receiptEmail(brand, { customerName: p.customer.displayName, invoiceNumber: p.invoice.number, amountCents: p.amountCents, method: humanize(p.method), currency: settings?.currency ?? "USD", paidOn: formatDateOnly(p.receivedAt), balanceCents: p.invoice.balanceCents, url }),
    companyName: brand.companyName, replyTo: brand.email, customerId: p.customerId, entityType: "INVOICE", entityId: p.invoiceId, sentById: ctx.userId,
  });
}

export async function listPayments(ctx: Ctx, p: ListParams) {
  requirePermission(ctx, "payments.view");
  const and: Prisma.PaymentWhereInput[] = [];
  if (p.q) and.push({ OR: [{ reference: { contains: p.q, mode: "insensitive" } }, { invoice: { number: { contains: p.q, mode: "insensitive" } } }, { customer: { displayName: { contains: p.q, mode: "insensitive" } } }] });
  const f = p.filters;
  if (f.method && (METHODS as readonly string[]).includes(f.method)) and.push({ method: f.method as PaymentMethod });
  if (f.status === "voided") and.push({ status: "VOIDED" });
  else and.push({ status: "SUCCEEDED" });
  if (f.customer) and.push({ customerId: f.customer });
  const from = parseDate(f.from), to = parseDate(f.to);
  if (from) and.push({ receivedAt: { gte: from } });
  if (to) and.push({ receivedAt: { lt: new Date(to.getTime() + 86_400_000) } });
  const where = { AND: and };
  const orderBy: Prisma.PaymentOrderByWithRelationInput = p.sort === "amount" ? { amountCents: p.dir } : { receivedAt: p.dir };
  const [rows, total, sum] = await Promise.all([
    ctx.db.payment.findMany({ where, orderBy: [orderBy, { id: "desc" }], ...skipTake(p), include: { customer: { select: { id: true, displayName: true } }, invoice: { select: { id: true, number: true } } } }),
    ctx.db.payment.count({ where }),
    ctx.db.payment.aggregate({ where, _sum: { amountCents: true } }),
  ]);
  return { ...toPage(rows, total, p), sumCents: sum._sum.amountCents ?? 0 };
}

/**
 * Record a payment confirmed by a payment processor webhook (Stripe etc.).
 * Idempotent on (provider, providerPaymentId): replayed webhooks are ignored.
 * No card data is ever stored — only the processor's reference.
 */
export async function recordProviderPayment(input: {
  tenantId: string;
  invoiceId: string;
  provider: string;
  providerPaymentId: string;
  amountCents: number;
  method: "CREDIT_CARD" | "ACH";
}): Promise<{ recorded: boolean }> {
  const dup = await platformDb().payment.findFirst({ where: { provider: input.provider, providerPaymentId: input.providerPaymentId }, select: { id: true } });
  if (dup) return { recorded: false };
  const db = tenantDb(input.tenantId);
  return db.tx(async (tx) => {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${input.invoiceId} FOR UPDATE`;
    const inv = await tx.invoice.findFirst({ where: { id: input.invoiceId } });
    if (!inv || inv.status === "VOID") throw notFound("Invoice");
    const amount = Math.min(input.amountCents, Math.max(inv.balanceCents, 0));
    if (amount <= 0) return { recorded: false };
    const p = await tx.payment.create({
      data: { tenantId: input.tenantId, invoiceId: inv.id, customerId: inv.customerId, amountCents: amount, method: input.method, status: "SUCCEEDED", provider: input.provider, providerPaymentId: input.providerPaymentId, notes: "Paid online" },
    });
    const updated = await applyPaymentsTx(tx, { tenantId: input.tenantId }, inv.id);
    await recordActivity(tx, input.tenantId, null, { customerId: inv.customerId, entityType: "INVOICE", entityId: inv.id, type: "payment.recorded", summary: `Online payment of ${formatMoney(amount)} received on ${inv.number}`, actor: { type: "CUSTOMER", name: "Customer (online)" }, metadata: { paymentId: p.id } });
    if (updated.status === "PAID") await recordActivity(tx, input.tenantId, null, { customerId: inv.customerId, entityType: "INVOICE", entityId: inv.id, type: "invoice.paid", summary: `Invoice ${inv.number} paid in full`, actor: { type: "CUSTOMER", name: "Customer (online)" } });
    await notifyWithPermission(tx, input.tenantId, "invoices.view", { type: updated.status === "PAID" ? "INVOICE_PAID" : "PAYMENT_RECEIVED", title: updated.status === "PAID" ? `Invoice ${inv.number} paid online` : `Online payment on ${inv.number}`, body: formatMoney(amount), href: `/invoices/${inv.id}`, entityType: "INVOICE", entityId: inv.id });
    await auditAs(tx, input.tenantId, { name: `${input.provider} webhook` }, "payment.recorded", "Payment", p.id, { invoiceId: inv.id, amount, provider: input.provider });
    return { recorded: true };
  });
}

void can; void publicUrl;
