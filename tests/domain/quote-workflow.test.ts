import { beforeAll, describe, expect, it } from "vitest";
import { computeDocument } from "@/lib/money";
import { platformDb } from "@/server/db";
import { AppError } from "@/server/errors";
import * as quotes from "@/server/domain/quotes";
import { resolvePublicLink } from "@/server/domain/public-links";
import { customerTimeline } from "@/server/domain/customers";
import { createTestTenant, email, installProviders, seedBasics, type TestTenant } from "../helpers/fixtures";

let t: TestTenant;
let base: Awaited<ReturnType<typeof seedBasics>>;
const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const token = (url: string) => url.split("/").pop()!;
const meta = { ip: "9.9.9.9", userAgent: "vitest" };

async function newQuote(overrides: Record<string, unknown> = {}) {
  return quotes.createQuote(t.owner, {
    customerId: base.customer.id, locationId: base.loc.id, title: "System replacement", issueDate: today(), expiresAt: inDays(30), taxRate: "8.25", depositType: "PERCENT", depositValue: 2500,
    options: [
      { name: "Good", lines: [{ name: "14 SEER condenser", quantity: "1", unitPrice: 380000 }, { name: "Labor", quantity: "6", unitPrice: 9500, taxable: false }] },
      { name: "Better", isRecommended: true, lines: [{ name: "16 SEER condenser", quantity: "1", unitPrice: 520000, discountType: "PERCENT", discountValue: 1000 }] },
    ],
    ...overrides,
  });
}

beforeAll(async () => {
  installProviders();
  t = await createTestTenant("Quotes");
  base = await seedBasics(t);
});

describe("quote totals are computed on the server", () => {
  it("matches the money module for every option and mirrors the recommended option", async () => {
    const q = await newQuote();
    const full = await quotes.getQuote(t.owner, q.id);
    const good = computeDocument({ lines: [{ quantity: "1", unitPriceCents: 380000 }, { quantity: "6", unitPriceCents: 9500, taxable: false }], taxRateBp: 825, depositType: "PERCENT", depositValue: 2500 });
    const better = computeDocument({ lines: [{ quantity: "1", unitPriceCents: 520000, discountType: "PERCENT", discountValue: 1000 }], taxRateBp: 825, depositType: "PERCENT", depositValue: 2500 });
    expect(full.options[0]!.totalCents).toBe(good.totalCents);
    expect(full.options[1]!.totalCents).toBe(better.totalCents);
    expect(full.totalCents).toBe(better.totalCents); // recommended option is the headline
    expect(full.depositCents).toBe(better.depositCents);
    expect(full.number).toMatch(/^Q-\d+$/);
    expect(full.status).toBe("DRAFT");
  });

  it("zeroes tax for tax-exempt customers regardless of the submitted rate", async () => {
    await t.owner.db.customer.update({ where: { id: base.customer.id }, data: { taxExempt: true } });
    const q = await newQuote({ taxRate: "10" });
    expect((await quotes.getQuote(t.owner, q.id)).taxCents).toBe(0);
    await t.owner.db.customer.update({ where: { id: base.customer.id }, data: { taxExempt: false } });
  });

  it("copies internal cost from the pricebook, never from the client", async () => {
    const q = await newQuote({ options: [{ name: "A", lines: [{ pricebookItemId: base.item.id, name: "Diagnostic", quantity: "1", unitPrice: 12900, unitCost: 1 }] }] });
    const line = (await t.owner.db.quoteLineItem.findFirstOrThrow({ where: { option: { quoteId: q.id } } }));
    expect(line.unitCostCents).toBe(4000);
  });

  it("rejects empty options and malformed money", async () => {
    await expect(newQuote({ options: [{ name: "Empty", lines: [] }] })).rejects.toBeInstanceOf(AppError);
    await expect(newQuote({ options: [{ name: "x", lines: [{ name: "x", quantity: "1", unitPrice: "abc" }] }] })).rejects.toBeInstanceOf(AppError);
  });
});

describe("send → view → approve → convert", () => {
  it("runs the full customer workflow with timeline entries and consistent references", async () => {
    const q = await newQuote();
    await quotes.markQuoteReady(t.owner, q.id);
    email.sent = [];
    const { url } = await quotes.sendQuote(t.owner, q.id, { to: "ada@example.test", message: "Thanks for having us out." });

    // Email: branded, addressed, with the secure link and no raw ids
    const mail = email.last()!;
    expect(mail.to).toBe("ada@example.test");
    expect(mail.subject).toContain(q.number);
    expect(mail.html).toContain(url);
    expect(mail.html).toContain("View quote");
    expect(url).toMatch(/\/q\/[A-Za-z0-9_-]{40,}$/);
    expect((await quotes.getQuote(t.owner, q.id)).status).toBe("SENT");
    const record = await t.owner.db.emailMessage.findFirstOrThrow({ where: { entityId: q.id } });
    expect(record.status).toBe("SENT");

    // Customer opens the link (no account)
    const link = (await resolvePublicLink(token(url), "QUOTE", meta))!;
    const view = (await quotes.loadPublicQuote(link))!;
    expect(JSON.stringify(view)).not.toMatch(/unitCostCents|internalNotes/);
    await quotes.recordQuoteView(link, meta);
    const viewed = await quotes.getQuote(t.owner, q.id);
    expect(viewed.status).toBe("VIEWED");
    expect(viewed.link?.viewCount).toBe(1);

    // Approve option 2
    const better = viewed.options[1]!;
    await quotes.respondToPublicQuote(token(url), { action: "approve", optionId: better.id, message: "Go ahead" }, meta);
    const approved = await quotes.getQuote(t.owner, q.id);
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedOptionId).toBe(better.id);
    expect(approved.totalCents).toBe(better.totalCents);
    expect(approved.customerMessage).toBe("Go ahead");
    await expect(quotes.respondToPublicQuote(token(url), { action: "decline" }, meta)).rejects.toMatchObject({ code: "INVALID_STATE" });

    // Convert to job + invoice with no re-entry
    const { jobId, invoiceId } = await quotes.convertQuote(t.owner, q.id, { to: "job_and_invoice" });
    const job = await t.owner.db.job.findFirstOrThrow({ where: { id: jobId! }, include: { lineItems: true } });
    const invoice = await t.owner.db.invoice.findFirstOrThrow({ where: { id: invoiceId! }, include: { lineItems: true } });
    expect(job.quoteId).toBe(q.id);
    expect(job.customerId).toBe(base.customer.id);
    expect(job.lineItems).toHaveLength(1);
    expect(invoice.quoteId).toBe(q.id);
    expect(invoice.jobId).toBe(jobId);
    expect(invoice.totalCents).toBe(better.totalCents);
    expect(invoice.depositRequiredCents).toBe(better.depositCents);
    const final = await quotes.getQuote(t.owner, q.id);
    expect(final.status).toBe("CONVERTED");
    expect(final.jobId).toBe(jobId);
    expect(final.convertedInvoiceId).toBe(invoiceId);
    await expect(quotes.convertQuote(t.owner, q.id, { to: "job" })).rejects.toMatchObject({ code: "INVALID_STATE" });

    // Timeline recorded every step on the customer
    const tl = await customerTimeline(t.owner, base.customer.id, { take: 100 });
    const types = tl.rows.map((r) => r.type);
    for (const expected of ["quote.created", "quote.sent", "quote.viewed", "quote.approved", "quote.converted", "job.created", "invoice.created"]) expect(types).toContain(expected);
    expect(tl.rows.find((r) => r.type === "quote.approved")!.actorType).toBe("CUSTOMER");
  });

  it("records a decline and notifies the team", async () => {
    const q = await newQuote();
    const { url } = await quotes.sendQuote(t.owner, q.id, { to: "ada@example.test" });
    await quotes.respondToPublicQuote(token(url), { action: "decline", message: "Too expensive" }, meta);
    const d = await quotes.getQuote(t.owner, q.id);
    expect(d.status).toBe("DECLINED");
    expect(d.declineReason).toBe("Too expensive");
    expect(await t.owner.db.notification.count({ where: { type: "QUOTE_DECLINED", entityId: q.id } })).toBeGreaterThan(0);
  });

  it("requires choosing an option when there are several", async () => {
    const q = await newQuote();
    const { url } = await quotes.sendQuote(t.owner, q.id, { to: "ada@example.test" });
    await expect(quotes.respondToPublicQuote(token(url), { action: "approve" }, meta)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("refuses approval of an expired quote and marks it expired", async () => {
    const q = await newQuote();
    const { url } = await quotes.sendQuote(t.owner, q.id, { to: "ada@example.test" });
    await platformDb().quote.update({ where: { id: q.id }, data: { expiresAt: new Date(Date.now() - 3 * 86_400_000) } });
    const opt = (await quotes.getQuote(t.owner, q.id)).options[0]!; // reading also expires it
    expect((await quotes.getQuote(t.owner, q.id)).status).toBe("EXPIRED");
    await expect(quotes.respondToPublicQuote(token(url), { action: "approve", optionId: opt.id }, meta)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("revising a sent quote revokes the old link and re-opens editing", async () => {
    const q = await newQuote();
    const { url } = await quotes.sendQuote(t.owner, q.id, { to: "ada@example.test" });
    await expect(quotes.updateQuote(t.owner, q.id, { customerId: base.customer.id, title: "x", issueDate: today(), taxRate: "0", options: [{ name: "o", lines: [{ name: "l", quantity: "1", unitPrice: 1 }] }] })).rejects.toMatchObject({ code: "INVALID_STATE" });
    await quotes.reviseQuote(t.owner, q.id);
    expect(await resolvePublicLink(token(url), "QUOTE", meta)).toBeNull();
    const after = await quotes.getQuote(t.owner, q.id);
    expect(after.status).toBe("DRAFT");
    expect(after.version).toBe(2);
  });

  it("does not mark the quote sent when the email provider fails", async () => {
    const q = await newQuote();
    email.fail = true;
    await expect(quotes.sendQuote(t.owner, q.id, { to: "ada@example.test" })).rejects.toMatchObject({ code: "CONFLICT" });
    email.fail = false;
    expect((await quotes.getQuote(t.owner, q.id)).status).toBe("DRAFT");
    expect(await t.owner.db.publicLink.count({ where: { entityId: q.id, revokedAt: null } })).toBe(0);
    expect((await t.owner.db.emailMessage.findFirstOrThrow({ where: { entityId: q.id } })).status).toBe("FAILED");
  });

  it("requires a customer email or an override recipient", async () => {
    await t.owner.db.customer.update({ where: { id: base.customer.id }, data: { email: null } });
    const q = await newQuote();
    await expect(quotes.sendQuote(t.owner, q.id, {})).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("enforces the state machine", async () => {
    const q = await newQuote();
    await expect(quotes.convertQuote(t.owner, q.id, { to: "job" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    await quotes.recordQuoteDecision(t.owner, q.id, "APPROVED", { optionId: (await quotes.getQuote(t.owner, q.id)).options[0]!.id });
    await expect(quotes.markQuoteReady(t.owner, q.id)).rejects.toThrow(/can't move/);
    await expect(quotes.deleteQuote(t.owner, q.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("requires a signature when the company setting demands it", async () => {
    await t.owner.db.tenantSettings.updateMany({ where: {}, data: { requireQuoteSignature: true } });
    const q = await newQuote({ options: [{ name: "Only", lines: [{ name: "x", quantity: "1", unitPrice: 10000 }] }] });
    const { url } = await quotes.sendQuote(t.owner, q.id, { to: "ada@example.test" });
    await expect(quotes.respondToPublicQuote(token(url), { action: "approve" }, meta)).rejects.toMatchObject({ code: "VALIDATION" });
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]).toString("base64");
    await quotes.respondToPublicQuote(token(url), { action: "approve", signerName: "Ada Lovelace", signatureData: `data:image/png;base64,${png}` }, meta);
    expect((await quotes.getQuote(t.owner, q.id)).signature?.signerName).toBe("Ada Lovelace");
    await t.owner.db.tenantSettings.updateMany({ where: {}, data: { requireQuoteSignature: false } });
  });
});
