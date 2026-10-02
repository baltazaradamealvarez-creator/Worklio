import { beforeAll, describe, expect, it } from "vitest";
import { effectiveInvoiceStatus } from "@/lib/state";
import { platformDb } from "@/server/db";
import * as invoices from "@/server/domain/invoices";
import * as payments from "@/server/domain/payments";
import * as jobs from "@/server/domain/jobs";
import { parseListParams } from "@/server/domain/list";
import { createTestTenant, installProviders, seedBasics, type TestTenant } from "../helpers/fixtures";

let t: TestTenant;
let base: Awaited<ReturnType<typeof seedBasics>>;
const today = () => new Date().toISOString().slice(0, 10);

async function openInvoice(amountCents = 100000, opts: { terms?: number } = {}) {
  const inv = await invoices.createInvoice(t.owner, { customerId: base.customer.id, locationId: base.loc.id, issueDate: today(), paymentTermsDays: opts.terms ?? 30, taxRate: "0", lines: [{ name: "Work", quantity: "1", unitPrice: amountCents }] });
  await invoices.markInvoiceOpen(t.owner, inv.id);
  return inv;
}

beforeAll(async () => {
  installProviders();
  t = await createTestTenant("Billing");
  base = await seedBasics(t);
});

describe("invoice calculations", () => {
  it("computes subtotal, discount, tax, total and balance on the server", async () => {
    const inv = await invoices.createInvoice(t.owner, {
      customerId: base.customer.id, issueDate: today(), paymentTermsDays: 15, taxRate: "8.25", discountType: "PERCENT", discountValue: 1000,
      lines: [{ name: "Part", quantity: "2", unitPrice: 25000 }, { name: "Labor", quantity: "1.5", unitPrice: 12000, taxable: false }],
    });
    expect(inv.subtotalCents).toBe(68000);
    expect(inv.discountCents).toBe(6800);
    // taxable share of discount: 6800 * 50000/68000 = 5000 → taxable base 45000 → tax 3713 (3712.5 rounds up)
    expect(inv.taxCents).toBe(3713);
    expect(inv.totalCents).toBe(68000 - 6800 + 3713);
    expect(inv.balanceCents).toBe(inv.totalCents);
    expect(inv.status).toBe("DRAFT");
    expect(inv.number).toMatch(/^INV-\d+$/);
    expect(inv.dueDate.toISOString().slice(0, 10)).toBe(new Date(Date.now() + 15 * 86_400_000).toISOString().slice(0, 10));
  });

  it("freezes line items once issued (only notes/terms/due date remain editable)", async () => {
    const inv = await openInvoice(50000);
    const edited = await invoices.updateInvoice(t.owner, inv.id, { terms: "Net 10", lines: [{ name: "Tampered", quantity: "1", unitPrice: 1 }] });
    expect(edited.totalCents).toBe(50000);
    expect(edited.terms).toBe("Net 10");
    expect(await t.owner.db.invoiceLineItem.count({ where: { invoiceId: inv.id } })).toBe(1);
  });
});

describe("payments", () => {
  it("supports partial payments, deposits and full payment with correct status transitions", async () => {
    const inv = await openInvoice(100000);
    let r = await payments.recordPayment(t.owner, { invoiceId: inv.id, amount: "250.00", method: "CHECK", reference: "#4471", isDeposit: true });
    expect(r.invoice.status).toBe("PARTIALLY_PAID");
    expect(r.invoice.amountPaidCents).toBe(25000);
    expect(r.invoice.balanceCents).toBe(75000);
    expect(r.payment.isDeposit).toBe(true);
    r = await payments.recordPayment(t.owner, { invoiceId: inv.id, amount: "750.00", method: "CASH" });
    expect(r.invoice.status).toBe("PAID");
    expect(r.invoice.balanceCents).toBe(0);
    expect(r.invoice.paidAt).not.toBeNull();
    await expect(payments.recordPayment(t.owner, { invoiceId: inv.id, amount: "1.00", method: "CASH" })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("rejects overpayment, zero, negative and garbage amounts", async () => {
    const inv = await openInvoice(10000);
    for (const amount of ["100.01", "0", "-5", "abc", ""]) {
      await expect(payments.recordPayment(t.owner, { invoiceId: inv.id, amount, method: "CASH" }), `amount=${amount}`).rejects.toMatchObject({ code: "VALIDATION" });
    }
    expect((await t.owner.db.invoice.findFirstOrThrow({ where: { id: inv.id } })).amountPaidCents).toBe(0);
  });

  it("does not allow payments against drafts or void invoices", async () => {
    const draft = await invoices.createInvoice(t.owner, { customerId: base.customer.id, issueDate: today(), paymentTermsDays: 30, taxRate: "0", lines: [{ name: "x", quantity: "1", unitPrice: 5000 }] });
    await expect(payments.recordPayment(t.owner, { invoiceId: draft.id, amount: "10", method: "CASH" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    const open = await openInvoice(5000);
    await invoices.voidInvoice(t.owner, open.id, "Entered in error");
    await expect(payments.recordPayment(t.owner, { invoiceId: open.id, amount: "10", method: "CASH" })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("two simultaneous full payments cannot overpay (row lock)", async () => {
    const inv = await openInvoice(20000);
    const results = await Promise.allSettled([
      payments.recordPayment(t.owner, { invoiceId: inv.id, amount: "200.00", method: "CASH" }),
      payments.recordPayment(t.owner, { invoiceId: inv.id, amount: "200.00", method: "CHECK" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const row = await t.owner.db.invoice.findFirstOrThrow({ where: { id: inv.id } });
    expect(row.amountPaidCents).toBe(20000);
    expect(row.balanceCents).toBe(0);
  });

  it("voiding a payment restores the balance and status; invoices with payments can't be voided", async () => {
    const inv = await openInvoice(30000);
    const { payment } = await payments.recordPayment(t.owner, { invoiceId: inv.id, amount: "100", method: "CASH" });
    await expect(invoices.voidInvoice(t.owner, inv.id, "oops")).rejects.toMatchObject({ code: "INVALID_STATE" });
    await payments.voidPayment(t.owner, payment.id, "Bounced");
    const row = await t.owner.db.invoice.findFirstOrThrow({ where: { id: inv.id } });
    expect(row.amountPaidCents).toBe(0);
    expect(row.balanceCents).toBe(30000);
    expect(row.status).toBe("OPEN");
    await invoices.voidInvoice(t.owner, inv.id, "Customer cancelled");
    expect((await t.owner.db.invoice.findFirstOrThrow({ where: { id: inv.id } })).status).toBe("VOID");
  });

  it("voided payments remain in the database (financial records are never deleted)", async () => {
    const inv = await openInvoice(9000);
    const { payment } = await payments.recordPayment(t.owner, { invoiceId: inv.id, amount: "90", method: "CASH" });
    await payments.voidPayment(t.owner, payment.id, "Duplicate");
    const row = await t.owner.db.payment.findFirstOrThrow({ where: { id: payment.id } });
    expect(row.status).toBe("VOIDED");
    expect(row.voidReason).toBe("Duplicate");
  });

  it("processor payments are idempotent and never store card data", async () => {
    const inv = await openInvoice(12000);
    const evt = { tenantId: t.tenantId, invoiceId: inv.id, provider: "stripe", providerPaymentId: `pi_${Math.random().toString(36).slice(2)}`, amountCents: 12000, method: "CREDIT_CARD" as const };
    expect((await payments.recordProviderPayment(evt)).recorded).toBe(true);
    expect((await payments.recordProviderPayment(evt)).recorded).toBe(false);
    const rows = await t.owner.db.payment.findMany({ where: { invoiceId: inv.id } });
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).join(",")).not.toMatch(/card|pan|cvv|number/i);
    expect((await t.owner.db.invoice.findFirstOrThrow({ where: { id: inv.id } })).status).toBe("PAID");
  });
});

describe("past due & lists", () => {
  it("derives PAST_DUE from the due date and balance, and the filter finds it", async () => {
    const inv = await openInvoice(15000, { terms: 0 });
    await platformDb().invoice.update({ where: { id: inv.id }, data: { issueDate: new Date("2020-01-01"), dueDate: new Date("2020-01-31") } });
    const row = await t.owner.db.invoice.findFirstOrThrow({ where: { id: inv.id } });
    expect(effectiveInvoiceStatus(row)).toBe("PAST_DUE");
    expect(effectiveInvoiceStatus({ ...row, balanceCents: 0 })).not.toBe("PAST_DUE");
    const list = await invoices.listInvoices(t.owner, parseListParams({ status: "PAST_DUE" }, { sortable: [], defaultSort: "issueDate", filters: ["status"] }));
    expect(list.rows.map((r) => r.id)).toContain(inv.id);
    expect(list.rows.every((r) => r.balanceCents > 0)).toBe(true);
  });
});

describe("invoice from job", () => {
  it("bills un-invoiced job lines once and carries costs for margin", async () => {
    const job = await jobs.createJob(t.owner, { customerId: base.customer.id, locationId: base.loc.id, title: "Repair" });
    await jobs.addJobLineItem(t.owner, job.id, { pricebookItemId: base.item.id, quantity: "1" });
    await jobs.addJobLineItem(t.owner, job.id, { name: "Capacitor", kind: "MATERIAL", quantity: "2", unitPrice: "35.00" });
    const inv = await invoices.createInvoiceFromJob(t.owner, job.id);
    expect(inv.jobId).toBe(job.id);
    expect(inv.subtotalCents).toBe(12900 + 2 * 3500);
    await expect(invoices.createInvoiceFromJob(t.owner, job.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(await t.owner.db.jobLineItem.count({ where: { jobId: job.id, invoicedAt: null } })).toBe(0);
    await invoices.voidInvoice(t.owner, inv.id, "Wrong customer");
    expect(await t.owner.db.jobLineItem.count({ where: { jobId: job.id, invoicedAt: null } })).toBe(2); // released for re-invoicing
  });
});
