import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { platformDb } from "@/server/db";
import * as customers from "@/server/domain/customers";
import * as invoices from "@/server/domain/invoices";
import * as payments from "@/server/domain/payments";
import { issuePortalLink } from "@/server/domain/portal";
import { issuePublicLink, resolveDocumentLink, resolvePublicLink, revokePublicLinks } from "@/server/domain/public-links";
import * as quotes from "@/server/domain/quotes";
import { financialOverview, reportToCsv, type ReportResult } from "@/server/domain/reports";
import { verifyStripeSignature } from "@/server/payments/provider";
import { createTestTenant, installProviders, seedBasics, type TestTenant } from "../helpers/fixtures";

let t: TestTenant;
let base: Awaited<ReturnType<typeof seedBasics>>;
const today = () => new Date().toISOString().slice(0, 10);
const tokenOf = (url: string) => url.split("/").pop()!;

beforeAll(async () => {
  installProviders();
  t = await createTestTenant("PublicFlows");
  base = await seedBasics(t);
});

describe("Stripe webhook signature verification", () => {
  const secret = "whsec_test_secret";
  const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
  const sign = (payload: string, ts: number, s = secret) => `t=${ts},v1=${createHmac("sha256", s).update(`${ts}.${payload}`).digest("hex")}`;
  const now = Date.now();
  const ts = Math.floor(now / 1000);

  it("accepts a correctly signed, fresh payload", () => {
    expect(() => verifyStripeSignature(body, sign(body, ts), secret, 300, now)).not.toThrow();
  });
  it("rejects a tampered payload, wrong secret, stale timestamp and missing header", () => {
    expect(() => verifyStripeSignature(body + " ", sign(body, ts), secret, 300, now)).toThrow(/Invalid signature/);
    expect(() => verifyStripeSignature(body, sign(body, ts, "other"), secret, 300, now)).toThrow(/Invalid signature/);
    expect(() => verifyStripeSignature(body, sign(body, ts - 3600), secret, 300, now)).toThrow(/tolerance/);
    expect(() => verifyStripeSignature(body, null, secret, 300, now)).toThrow(/Missing/);
  });
});

describe("CSV export", () => {
  it("neutralises spreadsheet formula injection and escapes delimiters", () => {
    const r: ReportResult = {
      key: "jobs", title: "t", description: "", supports: [],
      columns: [{ key: "name", label: "Name", format: "text" }, { key: "amt", label: "Amount", format: "money" }],
      rows: [{ name: "=HYPERLINK(\"http://evil\")", amt: 12345 }, { name: "+SUM(1,2)", amt: 0 }, { name: "@cmd", amt: 1 }, { name: "-1+1", amt: 2 }, { name: "Smith, John \"JJ\"", amt: 100 }],
    };
    const lines = reportToCsv(r).trim().split("\r\n");
    expect(lines[1]).toBe(`"'=HYPERLINK(""http://evil"")",123.45`);
    expect(lines[2]).toBe(`"'+SUM(1,2)",0.00`);
    expect(lines[3]).toBe("'@cmd,0.01");
    expect(lines[4]).toBe("'-1+1,0.02");
    expect(lines[5]).toBe(`"Smith, John ""JJ""",1.00`);
  });
});

describe("public links", () => {
  it("only resolve for their own kind, and stop resolving once revoked", async () => {
    const q = await quotes.createQuote(t.owner, { customerId: base.customer.id, locationId: base.loc.id, title: "Q", issueDate: today(), expiresAt: new Date(Date.now() + 864e5 * 10).toISOString(), taxRate: "0", options: [{ name: "Only", lines: [{ name: "Work", quantity: "1", unitPrice: 10000 }] }] });
    const { url } = await issuePublicLink(t.owner.db, t.tenantId, { kind: "QUOTE", entityId: q.id, customerId: base.customer.id });
    const token = tokenOf(url);
    expect(await resolvePublicLink(token, "INVOICE", {})).toBeNull();
    expect(await resolvePublicLink(token, "PORTAL", {})).toBeNull();
    const ok = await resolvePublicLink(token, "QUOTE", {});
    expect(ok).toMatchObject({ tenantId: t.tenantId, entityId: q.id });
    await revokePublicLinks(t.owner.db, "QUOTE", q.id);
    expect(await resolvePublicLink(token, "QUOTE", {})).toBeNull();
    expect(await resolvePublicLink("not-a-real-token-but-long-enough-to-pass-the-shape-check", "QUOTE", {})).toBeNull();
  });

  it("a customer portal link reaches only that customer's documents", async () => {
    const other = await customers.createCustomer(t.owner, { customer: { firstName: "Grace", lastName: "Hopper" }, location: { name: "Home", addressLine1: "1 Navy Way", city: "Dallas", state: "TX", postalCode: "75001" } });
    const otherLoc = await t.owner.db.customerLocation.findFirstOrThrow({ where: { customerId: other.id } });
    const mk = async (customerId: string, locationId: string) => {
      const inv = await invoices.createInvoice(t.owner, { customerId, locationId, issueDate: today(), paymentTermsDays: 30, taxRate: "0", lines: [{ name: "Service", quantity: "1", unitPrice: 5000 }] });
      await invoices.markInvoiceOpen(t.owner, inv.id);
      return inv;
    };
    const mine = await mk(base.customer.id, base.loc.id);
    const theirs = await mk(other.id, otherLoc.id);
    const { url } = await issuePortalLink(t.owner, base.customer.id, { send: false });
    const token = tokenOf(url);
    expect(await resolveDocumentLink(token, "INVOICE", mine.id, {})).toMatchObject({ entityId: mine.id, customerId: base.customer.id });
    expect(await resolveDocumentLink(token, "INVOICE", theirs.id, {})).toBeNull();
    // A portal token is not a document token.
    expect(await resolveDocumentLink(token, "INVOICE", undefined, {})).toBeNull();
  });
});

describe("report date ranges use the company's timezone", () => {
  it("counts a payment received at 21:00 local on Dec 31 in December, not January", async () => {
    await platformDb().tenantSettings.updateMany({ where: { tenantId: t.tenantId }, data: { timezone: "America/Chicago" } });
    const inv = await invoices.createInvoice(t.owner, { customerId: base.customer.id, locationId: base.loc.id, issueDate: "2025-12-31", paymentTermsDays: 30, taxRate: "0", lines: [{ name: "Service", quantity: "1", unitPrice: 77700 }] });
    await invoices.markInvoiceOpen(t.owner, inv.id);
    const { payment } = await payments.recordPayment(t.owner, { invoiceId: inv.id, amount: "777.00", method: "CHECK" });
    // 2026-01-01T03:00Z is 2025-12-31 21:00 in Chicago.
    await platformDb().payment.update({ where: { id: payment.id }, data: { receivedAt: new Date("2026-01-01T03:00:00.000Z") } });
    const dec31 = await financialOverview(t.owner, { from: "2025-12-31", to: "2025-12-31" });
    const jan1 = await financialOverview(t.owner, { from: "2026-01-01", to: "2026-01-01" });
    expect(dec31.collectedCents).toBe(77700);
    expect(jan1.collectedCents).toBe(0);
  });
});
