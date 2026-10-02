import { describe, expect, it, beforeAll } from "vitest";
import * as invoices from "@/server/domain/invoices";
import * as jobs from "@/server/domain/jobs";
import * as quotes from "@/server/domain/quotes";
import { createTestTenant, installProviders, seedBasics } from "../helpers/fixtures";

const today = () => new Date().toISOString().slice(0, 10);
const inv = (t: Awaited<ReturnType<typeof createTestTenant>>, customerId: string) =>
  invoices.createInvoice(t.owner, { customerId, issueDate: today(), paymentTermsDays: 30, taxRate: "0", lines: [{ name: "x", quantity: "1", unitPrice: 100 }] });

describe("per-tenant document numbering", () => {
  beforeAll(installProviders);

  it("gives every tenant its own sequence — INV-1001 in A and B are unrelated", async () => {
    const a = await createTestTenant("Num-A");
    const b = await createTestTenant("Num-B");
    const ba = await seedBasics(a);
    const bb = await seedBasics(b);
    const [a1, a2, b1] = [await inv(a, ba.customer.id), await inv(a, ba.customer.id), await inv(b, bb.customer.id)];
    expect(a1.number).toBe("INV-1001");
    expect(a2.number).toBe("INV-1002");
    expect(b1.number).toBe("INV-1001");
    expect(a1.id).not.toBe(b1.id);
  });

  it("keeps separate counters per document type", async () => {
    const t = await createTestTenant("Num-C");
    const b = await seedBasics(t);
    const job = await jobs.createJob(t.owner, { customerId: b.customer.id, locationId: b.loc.id, title: "x" });
    const q = await quotes.createQuote(t.owner, { customerId: b.customer.id, title: "x", issueDate: today(), taxRate: "0", options: [{ name: "o", lines: [{ name: "l", quantity: "1", unitPrice: 100 }] }] });
    const i = await inv(t, b.customer.id);
    expect([job.number, q.number, i.number]).toEqual(["JOB-1001", "Q-1001", "INV-1001"]);
  });

  it("honours company-configured prefix and starting number", async () => {
    const t = await createTestTenant("Num-D");
    const b = await seedBasics(t);
    await t.owner.db.tenantSettings.updateMany({ where: {}, data: { invoicePrefix: "A-", invoiceStartNumber: 5000 } });
    expect((await inv(t, b.customer.id)).number).toBe("A-5000");
    expect((await inv(t, b.customer.id)).number).toBe("A-5001");
  });

  it("never issues duplicates under concurrency", async () => {
    const t = await createTestTenant("Num-E");
    const b = await seedBasics(t);
    const made = await Promise.all(Array.from({ length: 12 }, () => inv(t, b.customer.id)));
    const numbers = made.map((m) => m.number);
    expect(new Set(numbers).size).toBe(12);
    const n = numbers.map((x) => Number(x.replace("INV-", ""))).sort((x, y) => x - y);
    expect(n[0]).toBe(1001);
    expect(n[11]).toBe(1012); // gap-free
  });

  it("rolls the number back with the transaction (no gaps on failure)", async () => {
    const t = await createTestTenant("Num-F");
    const b = await seedBasics(t);
    await expect(
      t.owner.db.tx(async (tx) => {
        const { nextDocumentNumber } = await import("@/server/domain/numbering");
        await nextDocumentNumber(tx, t.tenantId, "INVOICE");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect((await inv(t, b.customer.id)).number).toBe("INV-1001");
  });
});
