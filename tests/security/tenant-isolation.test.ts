import { beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@/server/errors";
import { tenantDb, platformDb } from "@/server/db";
import { globalSearch } from "@/server/domain/search";
import * as customers from "@/server/domain/customers";
import * as equipment from "@/server/domain/equipment";
import * as jobs from "@/server/domain/jobs";
import * as sched from "@/server/domain/scheduling";
import * as field from "@/server/domain/field";
import * as quotes from "@/server/domain/quotes";
import * as invoices from "@/server/domain/invoices";
import * as payments from "@/server/domain/payments";
import * as notes from "@/server/domain/notes";
import * as files from "@/server/domain/attachments";
import * as tasks from "@/server/domain/tasks";
import * as expenses from "@/server/domain/expenses";
import * as inventory from "@/server/domain/inventory";
import * as pricebook from "@/server/domain/pricebook";
import * as maintenance from "@/server/domain/maintenance";
import * as leads from "@/server/domain/leads";
import * as employees from "@/server/domain/employees";
import * as users from "@/server/domain/users";
import * as notifications from "@/server/domain/notifications";
import * as pdf from "@/server/domain/pdf-data";
import { runReport, defaultFilters } from "@/server/domain/reports";
import { parseListParams } from "@/server/domain/list";
import { resolvePublicLink } from "@/server/domain/public-links";
import { buildGraph, createTestTenant, installProviders, seedBasics, type TestTenant } from "../helpers/fixtures";

/**
 * Tenant A's OWNER — the most privileged role, so permissions can never be the reason an
 * attempt fails — tries to read, modify, enumerate, download and otherwise reach Tenant B's
 * records using B's real identifiers. Every attempt must behave as if the record doesn't exist.
 */
let A: TestTenant;
let B: TestTenant;
let g: Awaited<ReturnType<typeof buildGraph>>;
let ga: Awaited<ReturnType<typeof seedBasics>>;

const today = () => new Date().toISOString().slice(0, 10);
const list = (sp: Record<string, string> = {}) => parseListParams(sp, { sortable: [], defaultSort: "createdAt", filters: ["status", "customer", "type", "tech"] });

async function expectHidden(p: Promise<unknown>) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err, "expected the operation to be refused").toBeInstanceOf(AppError);
  expect(["NOT_FOUND", "FORBIDDEN"]).toContain((err as AppError).code);
}

beforeAll(async () => {
  installProviders();
  A = await createTestTenant("Iso-A");
  B = await createTestTenant("Iso-B");
  ga = await seedBasics(A);
  g = await buildGraph(B);
}, 120_000);

describe("reads by id", () => {
  const cases: [string, () => Promise<unknown>][] = [
    ["customer", () => customers.getCustomer(A.owner, g.customer.id)],
    ["customer timeline", () => customers.customerTimeline(A.owner, g.customer.id)],
    ["equipment", () => equipment.getEquipment(A.owner, g.equipment.id)],
    ["equipment history", () => equipment.equipmentServiceHistory(A.owner, g.equipment.id)],
    ["job", () => jobs.getJob(A.owner, g.job.id)],
    ["quote", () => quotes.getQuote(A.owner, g.quote.id)],
    ["quote pdf", () => pdf.quotePdf(A.owner, g.quote.id)],
    ["invoice", () => invoices.getInvoice(A.owner, g.invoice.id)],
    ["invoice pdf", () => pdf.invoicePdf(A.owner, g.invoice.id)],
    ["receipt pdf", () => pdf.receiptPdf(A.owner, g.payment.id)],
    ["notes on B's customer", () => notes.listNotes(A.owner, "CUSTOMER", g.customer.id)],
    ["customer notes feed", () => notes.listCustomerNotes(A.owner, g.customer.id)],
    ["note history", () => notes.noteHistory(A.owner, g.note.id)],
    ["attachments list", () => files.listAttachments(A.owner, "EQUIPMENT", g.equipment.id)],
    ["attachment download", () => files.readAttachmentBytes(A.owner, g.attachment.id)],
    ["expense", () => expenses.getExpense(A.owner, g.expense.id)],
    ["inventory item", () => inventory.getInventoryItem(A.owner, g.inv.id)],
    ["pricebook item", () => pricebook.getPricebookItem(A.owner, g.item.id)],
    ["agreement", () => maintenance.getAgreement(A.owner, g.agreement.id)],
    ["lead", () => leads.getLead(A.owner, g.lead.id)],
    ["employee", () => employees.getEmployee(A.owner, g.employee.id)],
    ["field view of job", () => field.fieldJob(A.owner, g.job.id)],
  ];
  it.each(cases)("A cannot read B's %s", async (_n, fn) => expectHidden(fn()));
});

describe("modifications by id", () => {
  const cases: [string, () => Promise<unknown>][] = [
    ["update customer", () => customers.updateCustomer(A.owner, g.customer.id, { type: "RESIDENTIAL", firstName: "Hacked", lastName: "X" })],
    ["archive customer", () => customers.archiveCustomer(A.owner, g.customer.id)],
    ["add location to B customer", () => customers.addLocation(A.owner, g.customer.id, { name: "x", addressLine1: "1 st", city: "c", state: "TX", postalCode: "75001" })],
    ["update B location", () => customers.updateLocation(A.owner, g.loc.id, { name: "x", addressLine1: "1 st", city: "c", state: "TX", postalCode: "75001" })],
    ["save contact on B customer", () => customers.saveContact(A.owner, g.customer.id, null, { name: "Evil" })],
    ["update equipment", () => equipment.updateEquipment(A.owner, g.equipment.id, { customerId: g.customer.id, locationId: g.loc.id, type: "FURNACE" })],
    ["create equipment on B location", () => equipment.createEquipment(A.owner, { customerId: g.customer.id, locationId: g.loc.id, type: "FURNACE" })],
    ["archive equipment", () => equipment.archiveEquipment(A.owner, g.equipment.id)],
    ["update job", () => jobs.updateJob(A.owner, g.job.id, { customerId: g.customer.id, locationId: g.loc.id, title: "x" })],
    ["transition job", () => jobs.transitionJob(A.owner, g.job.id, { to: "ON_HOLD", reason: "x" })],
    ["assign job", () => jobs.assignJob(A.owner, g.job.id, [A.owner.employeeId!])],
    ["add job line", () => jobs.addJobLineItem(A.owner, g.job.id, { name: "Free labor", unitPrice: 1 })],
    ["create job for B customer/location", () => jobs.createJob(A.owner, { customerId: g.customer.id, locationId: g.loc.id, title: "x" })],
    ["create job with A customer but B location", () => jobs.createJob(A.owner, { customerId: ga.customer.id, locationId: g.loc.id, title: "x" })],
    ["create job with B equipment", () => jobs.createJob(A.owner, { customerId: ga.customer.id, locationId: ga.loc.id, title: "x", equipmentIds: [g.equipment.id] })],
    ["schedule B's job", () => sched.scheduleAppointment(A.owner, g.job.id, { startsAt: new Date(Date.now() + 5 * 86_400_000).toISOString() })],
    ["move B's appointment", () => sched.moveAppointment(A.owner, g.appointment.id, { startsAt: new Date(Date.now() + 9 * 86_400_000).toISOString() })],
    ["cancel B's appointment", () => sched.cancelAppointment(A.owner, g.appointment.id)],
    ["dispatch B's appointment", () => sched.dispatchAppointment(A.owner, g.appointment.id)],
    ["field action on B's job", () => field.fieldAction(A.owner, g.job.id, "start")],
    ["complete B's job", () => field.completeJob(A.owner, g.job.id, {})],
    ["update B quote", () => quotes.updateQuote(A.owner, g.quote.id, { customerId: g.customer.id, title: "x", issueDate: today(), taxRate: "0", options: [{ name: "o", lines: [{ name: "l", quantity: "1", unitPrice: 1 }] }] })],
    ["send B quote", () => quotes.sendQuote(A.owner, g.quote.id, { to: "x@example.test" })],
    ["decide B quote", () => quotes.recordQuoteDecision(A.owner, g.quote.id, "APPROVED", {})],
    ["convert B quote", () => quotes.convertQuote(A.owner, g.quote.id, { to: "invoice" })],
    ["delete B quote", () => quotes.deleteQuote(A.owner, g.quote.id)],
    ["quote for B customer", () => quotes.createQuote(A.owner, { customerId: g.customer.id, title: "x", issueDate: today(), taxRate: "0", options: [{ name: "o", lines: [{ name: "l", quantity: "1", unitPrice: 1 }] }] })],
    ["quote with B pricebook item", () => quotes.createQuote(A.owner, { customerId: ga.customer.id, title: "x", issueDate: today(), taxRate: "0", options: [{ name: "o", lines: [{ pricebookItemId: g.item.id, name: "l", quantity: "1", unitPrice: 1 }] }] })],
    ["update B invoice", () => invoices.updateInvoice(A.owner, g.invoice.id, { terms: "pay me" })],
    ["send B invoice", () => invoices.sendInvoice(A.owner, g.invoice.id, { to: "x@example.test" })],
    ["void B invoice", () => invoices.voidInvoice(A.owner, g.invoice.id, "x")],
    ["invoice B customer", () => invoices.createInvoice(A.owner, { customerId: g.customer.id, issueDate: today(), paymentTermsDays: 30, taxRate: "0", lines: [{ name: "x", quantity: "1", unitPrice: 1 }] })],
    ["invoice from B job", () => invoices.createInvoiceFromJob(A.owner, g.job.id)],
    ["pay B invoice", () => payments.recordPayment(A.owner, { invoiceId: g.invoice.id, amount: "1.00", method: "CASH" })],
    ["void B payment", () => payments.voidPayment(A.owner, g.payment.id, "x")],
    ["email B receipt", () => payments.sendReceipt(A.owner, g.payment.id)],
    ["note on B customer", () => notes.addNote(A.owner, { entityType: "CUSTOMER", entityId: g.customer.id, body: "x" })],
    ["edit B note", () => notes.editNote(A.owner, g.note.id, { body: "x", type: "GENERAL" })],
    ["pin B note", () => notes.setNotePinned(A.owner, g.note.id, false)],
    ["delete B note", () => notes.deleteNote(A.owner, g.note.id)],
    ["upload to B equipment", () => files.uploadAttachment(A.owner, { name: "a.pdf", size: 9, content: Buffer.from("%PDF-1.4 x") }, { entityType: "EQUIPMENT", entityId: g.equipment.id })],
    ["delete B attachment", () => files.deleteAttachment(A.owner, g.attachment.id)],
    ["update B task", () => tasks.updateTask(A.owner, g.task.id, { title: "x" })],
    ["task status on B task", () => tasks.setTaskStatus(A.owner, g.task.id, "DONE")],
    ["task linked to B customer", () => tasks.createTask(A.owner, { title: "x", customerId: g.customer.id })],
    ["update B expense", () => expenses.saveExpense(A.owner, g.expense.id, { category: "OTHER", amount: "1", expenseDate: today(), description: "x" })],
    ["expense on B vendor", () => expenses.saveExpense(A.owner, null, { vendorId: g.vendor.id, category: "OTHER", amount: "1", expenseDate: today(), description: "x" })],
    ["delete B expense", () => expenses.deleteExpense(A.owner, g.expense.id)],
    ["adjust B stock", () => inventory.adjustStock(A.owner, { itemId: g.inv.id, locationId: g.warehouse.id, type: "ADJUST", quantity: "999" })],
    ["update B inventory item", () => inventory.saveInventoryItem(A.owner, g.inv.id, { sku: "HACK", name: "x", cost: "1", price: "1" })],
    ["update B vendor", () => inventory.saveVendor(A.owner, g.vendor.id, { name: "x" })],
    ["update B pricebook item", () => pricebook.savePricebookItem(A.owner, g.item.id, { name: "x", cost: "0", price: "0" })],
    ["archive B pricebook item", () => pricebook.archivePricebookItem(A.owner, g.item.id)],
    ["update B agreement", () => maintenance.updateAgreement(A.owner, g.agreement.id, { name: "x", customerId: g.customer.id, locationId: g.loc.id, startDate: today(), renewalDate: "2099-01-01", price: "1", discountPercent: "0" })],
    ["cancel B agreement", () => maintenance.cancelAgreement(A.owner, g.agreement.id, "x")],
    ["renew B agreement", () => maintenance.renewAgreement(A.owner, g.agreement.id)],
    ["agreement for B location", () => maintenance.createAgreement(A.owner, { name: "x", customerId: g.customer.id, locationId: g.loc.id, startDate: today(), renewalDate: "2099-01-01", price: "1", discountPercent: "0" })],
    ["update B lead", () => leads.updateLead(A.owner, g.lead.id, { firstName: "x", phone: "2145550000" })],
    ["convert B lead", () => leads.convertLead(A.owner, g.lead.id, {})],
    ["archive B lead", () => leads.archiveLead(A.owner, g.lead.id)],
    ["update B employee", () => employees.updateEmployee(A.owner, g.employee.id, { firstName: "x", lastName: "y" })],
    ["archive B employee", () => employees.archiveEmployee(A.owner, g.employee.id)],
    ["B employee certification", () => employees.addCertification(A.owner, g.employee.id, { name: "EPA 608" })],
    ["change B member role", () => users.changeMemberRole(A.owner, g.membership.id, g.role.id)],
    ["suspend B member", () => users.setMemberStatus(A.owner, g.membership.id, "SUSPENDED")],
    ["invite into B role", () => users.inviteUser(A.owner, { email: "new@example.test", roleId: g.role.id })],
    ["edit B role", () => users.updateRole(A.owner, g.role.id, { name: "x", permissions: [] })],
    ["delete B role", () => users.deleteRole(A.owner, g.role.id)],
  ];
  it.each(cases)("A cannot: %s", async (_n, fn) => expectHidden(fn()));

  it("B's data is untouched after all of the above", async () => {
    const [c, j, q, i, n, e] = await Promise.all([
      B.owner.db.customer.findFirstOrThrow({ where: { id: g.customer.id } }),
      B.owner.db.job.findFirstOrThrow({ where: { id: g.job.id } }),
      B.owner.db.quote.findFirstOrThrow({ where: { id: g.quote.id } }),
      B.owner.db.invoice.findFirstOrThrow({ where: { id: g.invoice.id } }),
      B.owner.db.note.findFirstOrThrow({ where: { id: g.note.id } }),
      B.owner.db.employee.findFirstOrThrow({ where: { id: g.employee.id } }),
    ]);
    expect(c.deletedAt).toBeNull();
    expect(c.firstName).toBe("Ada");
    expect(j.status).not.toBe("ON_HOLD");
    expect(q.status).toBe("SENT");
    expect(i.status).toBe("PARTIALLY_PAID");
    expect(i.balanceCents).toBeGreaterThan(0);
    expect(n.deletedAt).toBeNull();
    expect(e.deletedAt).toBeNull();
    expect(await B.owner.db.payment.count({ where: { status: "SUCCEEDED" } })).toBe(1);
  });
});

describe("enumeration & listing", () => {
  it("lists contain only the caller's tenant", async () => {
    const [c, j, q, i, p, e, t, x, inv, ag, l, emp, ev] = await Promise.all([
      customers.listCustomers(A.owner, list()), jobs.listJobs(A.owner, list()), quotes.listQuotes(A.owner, list()), invoices.listInvoices(A.owner, list()),
      payments.listPayments(A.owner, list()), equipment.listEquipment(A.owner, list()), tasks.listTasks(A.owner, list()), expenses.listExpenses(A.owner, list()),
      inventory.listInventory(A.owner, list()), maintenance.listAgreements(A.owner, list()), leads.listLeads(A.owner, list()), employees.listEmployees(A.owner, list()), pricebook.listPricebook(A.owner, list()),
    ]);
    const all = JSON.stringify([c.rows, j.rows, q.rows, i.rows, p.rows, e.rows, t.rows, x.rows, inv.rows, ag.rows, l.rows, emp.rows, ev.rows]);
    for (const id of [g.customer.id, g.job.id, g.quote.id, g.invoice.id, g.payment.id, g.equipment.id, g.task.id, g.expense.id, g.inv.id, g.agreement.id, g.lead.id, g.employee.id, g.item.id]) {
      expect(all).not.toContain(id);
    }
    expect(c.total).toBe(1);
  });

  it("filtering by B's ids in query params yields nothing", async () => {
    expect((await jobs.listJobs(A.owner, list({ customer: g.customer.id }))).total).toBe(0);
    expect((await jobs.listJobs(A.owner, list({ tech: g.tech.employeeId! }))).total).toBe(0);
    expect((await invoices.listInvoices(A.owner, list({ customer: g.customer.id }))).total).toBe(0);
  });

  it("customer typeahead & global search never return B's records", async () => {
    expect(await customers.listCustomerOptions(A.owner, "Ada")).toHaveLength(1); // A's own Ada only
    const hits = await globalSearch(A.owner, "Lovelace");
    expect(hits.map((h) => h.id)).not.toContain(g.customer.id);
    expect(hits.map((h) => h.id)).toContain(ga.customer.id);
    expect(await globalSearch(A.owner, g.equipment.serialNumber!)).toHaveLength(0);
    expect(await globalSearch(A.owner, "Hopper")).toHaveLength(0);
  });

  it("reports aggregate only the caller's tenant", async () => {
    const f = { ...defaultFilters("UTC"), from: `${new Date().getUTCFullYear() - 1}-01-01`, to: `${new Date().getUTCFullYear()}-12-31` };
    const rev = await runReport(A.owner, "revenue", f);
    expect(rev.totals?.invoiced).toBe(0);
    expect((await runReport(B.owner, "revenue", f)).totals?.invoiced).toBeGreaterThan(0);
    expect((await runReport(A.owner, "payments", f)).rows).toHaveLength(0);
    expect((await runReport(A.owner, "customers_revenue", f)).rows).toHaveLength(0);
  });

  it("notifications and audit logs are tenant-scoped", async () => {
    expect(await notifications.listNotifications(A.owner)).toHaveLength(0);
    await notifications.markRead(A.owner, g.notification.id);
    expect((await B.owner.db.notification.findFirstOrThrow({ where: { id: g.notification.id } })).readAt).toBeNull();
    const audit = await A.owner.db.auditLog.findMany({});
    expect(audit.every((r) => r.tenantId === A.tenantId)).toBe(true);
    expect(audit.some((r) => r.entityId === g.customer.id)).toBe(false);
  });
});

describe("the tenant-scoped database client itself", () => {
  it("returns null for another tenant's id on unique lookups", async () => {
    expect(await A.owner.db.customer.findUnique({ where: { id: g.customer.id } })).toBeNull();
    expect(await A.owner.db.invoice.findFirst({ where: { id: g.invoice.id } })).toBeNull();
  });

  it("ignores a caller-supplied tenantId in where clauses", async () => {
    expect(await A.owner.db.customer.findMany({ where: { tenantId: B.tenantId } })).toHaveLength(1); // forced back to A's tenant
    const rows = await A.owner.db.customer.findMany({ where: { tenantId: B.tenantId } });
    expect(rows.every((r) => r.tenantId === A.tenantId)).toBe(true);
  });

  it("forces created rows into the caller's tenant", async () => {
    const created = await A.owner.db.customer.create({ data: { tenantId: B.tenantId, displayName: "Smuggled" } as never });
    expect(created.tenantId).toBe(A.tenantId);
    expect(await B.owner.db.customer.count({ where: { displayName: "Smuggled" } })).toBe(0);
  });

  it("cannot re-home a row by updating its tenantId", async () => {
    await A.owner.db.customer.updateMany({ where: {}, data: { tenantId: B.tenantId } as never });
    expect((await A.owner.db.customer.findMany({})).every((r) => r.tenantId === A.tenantId)).toBe(true);
  });

  it("cannot update or delete B's rows even via updateMany/deleteMany", async () => {
    expect((await A.owner.db.customer.updateMany({ where: { id: g.customer.id }, data: { firstName: "x" } })).count).toBe(0);
    expect((await A.owner.db.customer.deleteMany({ where: { id: g.customer.id } })).count).toBe(0);
    expect((await A.owner.db.invoice.deleteMany({})).count).toBe(0); // A has none; B's are invisible
    expect(await B.owner.db.invoice.count()).toBe(1);
  });

  it("raw SQL through the tenant client is still confined by RLS", async () => {
    const rows = await A.owner.db.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM customers`;
    expect(rows[0]!.n).toBe(await A.owner.db.customer.count());
    const inTx = await A.owner.db.tx((tx) => tx.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM invoices`);
    expect(inTx[0]!.n).toBe(0);
  });

  it("nested relation reads cannot reach across tenants", async () => {
    const withRel = await A.owner.db.customer.findMany({ include: { jobs: true, invoices: true, locations: true } });
    expect(JSON.stringify(withRel)).not.toContain(g.job.id);
  });

  it("refuses to touch platform-only tables (users, sessions, plans)", async () => {
    const client = tenantDb(A.tenantId) as unknown as Record<string, { findMany(): Promise<unknown> }>;
    await expect(client.user!.findMany()).rejects.toThrow(/not tenant-scoped/);
    await expect(client.session!.findMany()).rejects.toThrow(/not tenant-scoped/);
    await expect(client.plan!.findMany()).rejects.toThrow(/not tenant-scoped/);
  });

  it("a tenant client can only see its own tenant row", async () => {
    const t = await A.owner.db.tenant.findMany({});
    expect(t.map((x) => x.id)).toEqual([A.tenantId]);
    expect(await A.owner.db.tenant.findUnique({ where: { id: B.tenantId } })).toBeNull();
  });
});

describe("public (customer) links", () => {
  const token = (url: string) => url.split("/").pop()!;
  it("a B quote token resolves only within B and only as a quote", async () => {
    const link = await resolvePublicLink(token(g.quoteLink), "QUOTE", { ip: "1.1.1.1" });
    expect(link?.tenantId).toBe(B.tenantId);
    expect(link?.entityId).toBe(g.quote.id);
    expect(await resolvePublicLink(token(g.quoteLink), "INVOICE", { ip: "1.1.1.1" })).toBeNull();
    expect(await resolvePublicLink(token(g.quoteLink), "PORTAL", { ip: "1.1.1.1" })).toBeNull();
  });
  it("the link's database handle cannot see tenant A", async () => {
    const link = (await resolvePublicLink(token(g.quoteLink), "QUOTE", { ip: "1.1.1.1" }))!;
    expect(await link.db.customer.findUnique({ where: { id: ga.customer.id } })).toBeNull();
  });
  it("guessed, malformed and cross-tenant tokens are rejected", async () => {
    expect(await resolvePublicLink("not-a-token", "QUOTE", {})).toBeNull();
    expect(await resolvePublicLink("A".repeat(43), "QUOTE", {})).toBeNull();
    expect(await resolvePublicLink(g.quote.id, "QUOTE", {})).toBeNull(); // ids are not tokens
  });
  it("only a hash of the token is stored", async () => {
    const row = await platformDb().publicLink.findFirstOrThrow({ where: { id: g.publicLinkRow.id } });
    expect(row.tokenHash).not.toContain(token(g.quoteLink));
    expect(row.tokenHash).toHaveLength(64);
  });
});
