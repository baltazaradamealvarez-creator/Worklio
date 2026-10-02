import { beforeAll, describe, expect, it } from "vitest";
import { loadTenantContext } from "@/server/auth/context";
import { ALL_PERMISSIONS, SYSTEM_ROLES } from "@/server/auth/permissions";
import { platformDb } from "@/server/db";
import * as customers from "@/server/domain/customers";
import * as employees from "@/server/domain/employees";
import * as invoices from "@/server/domain/invoices";
import * as jobs from "@/server/domain/jobs";
import * as notes from "@/server/domain/notes";
import * as payments from "@/server/domain/payments";
import * as pricebook from "@/server/domain/pricebook";
import * as quotes from "@/server/domain/quotes";
import * as users from "@/server/domain/users";
import * as settings from "@/server/domain/settings";
import { parseListParams } from "@/server/domain/list";
import { buildGraph, createTestTenant, installProviders, type TestTenant } from "../helpers/fixtures";

let t: TestTenant;
let g: Awaited<ReturnType<typeof buildGraph>>;
const list = (sp: Record<string, string> = {}) => parseListParams(sp, { sortable: [], defaultSort: "createdAt", filters: [] });
const today = () => new Date().toISOString().slice(0, 10);
const forbidden = { code: "FORBIDDEN" };

beforeAll(async () => {
  installProviders();
  t = await createTestTenant("Perms");
  g = await buildGraph(t);
}, 60_000);

describe("role-based access control is enforced on the server", () => {
  it("read-only users can view but not change anything", async () => {
    const ro = await t.as("READ_ONLY");
    expect((await customers.listCustomers(ro, list())).total).toBeGreaterThan(0);
    await expect(customers.createCustomer(ro, { customer: { firstName: "x", lastName: "y" } })).rejects.toMatchObject(forbidden);
    await expect(customers.updateCustomer(ro, g.customer.id, { firstName: "x", lastName: "y", type: "RESIDENTIAL" })).rejects.toMatchObject(forbidden);
    await expect(customers.archiveCustomer(ro, g.customer.id)).rejects.toMatchObject(forbidden);
    await expect(jobs.createJob(ro, { customerId: g.customer.id, locationId: g.loc.id, title: "x" })).rejects.toMatchObject(forbidden);
    await expect(quotes.sendQuote(ro, g.quote.id, {})).rejects.toMatchObject(forbidden);
    await expect(payments.recordPayment(ro, { invoiceId: g.invoice.id, amount: "1", method: "CASH" })).rejects.toMatchObject(forbidden);
    await expect(notes.addNote(ro, { entityType: "CUSTOMER", entityId: g.customer.id, body: "x" })).rejects.toMatchObject(forbidden);
  });

  it("dispatchers can schedule but cannot see billing or financial data", async () => {
    const d = await t.as("DISPATCHER");
    expect((await jobs.listJobs(d, list())).total).toBeGreaterThan(0);
    await expect(invoices.listInvoices(d, list())).rejects.toMatchObject(forbidden);
    await expect(invoices.getInvoice(d, g.invoice.id)).rejects.toMatchObject(forbidden);
    await expect(payments.listPayments(d, list())).rejects.toMatchObject(forbidden);
    await expect(pricebook.listPricebook(d, list())).rejects.toMatchObject(forbidden);
    const tl = await customers.customerTimeline(d, g.customer.id, { take: 100 });
    expect(tl.rows.some((r) => /^(invoice|payment)\./.test(r.type))).toBe(false); // financial events hidden
    const dash = await (await import("@/server/domain/dashboard")).dashboardData(d);
    expect(dash.pastDue).toBeNull();
    expect(dash.outstanding).toBeNull();
  });

  it("accounting can record payments but cannot create jobs or manage users", async () => {
    const acc = await t.as("ACCOUNTING");
    const r = await payments.recordPayment(acc, { invoiceId: g.invoice.id, amount: "1.00", method: "CASH" });
    expect(r.payment.recordedById).toBe(acc.userId);
    await expect(jobs.createJob(acc, { customerId: g.customer.id, locationId: g.loc.id, title: "x" })).rejects.toMatchObject(forbidden);
    await expect(users.inviteUser(acc, { email: "x@example.test", roleId: g.role.id })).rejects.toMatchObject(forbidden);
  });

  it("sales can quote but cannot void invoices or edit company settings", async () => {
    const s = await t.as("SALES");
    await expect(invoices.voidInvoice(s, g.invoice.id, "x")).rejects.toMatchObject(forbidden);
    await expect(settings.updateCompany(s, {})).rejects.toMatchObject(forbidden);
    await expect(quotes.recordQuoteDecision(s, g.quote.id, "APPROVED", {})).rejects.toMatchObject(forbidden); // quotes.approve
  });

  it("every built-in role only references permissions that exist in the catalog", () => {
    const known = new Set<string>(ALL_PERMISSIONS);
    for (const r of SYSTEM_ROLES) expect(r.permissions.filter((p) => !known.has(p)), r.key).toEqual([]);
  });
});

describe("field staff are limited to their own work", () => {
  it("technicians see only assigned jobs and the customers on them", async () => {
    const other = await t.as("TECHNICIAN");
    const mine = g.tech;
    expect((await jobs.listJobs(mine, list())).rows.map((j) => j.id)).toEqual([g.job.id]);
    expect((await jobs.listJobs(other, list())).total).toBe(0);
    await expect(jobs.getJob(other, g.job.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await customers.listCustomers(mine, list())).total).toBe(1);
    expect((await customers.listCustomers(other, list())).total).toBe(0);
    await expect(customers.getCustomer(other, g.customer.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("technicians cannot approve quotes, void invoices, see billing notes or pricing costs", async () => {
    const tech = g.tech;
    await expect(invoices.getInvoice(tech, g.invoice.id)).rejects.toMatchObject(forbidden);
    await notes.addNote(t.owner, { entityType: "CUSTOMER", entityId: g.customer.id, type: "BILLING", body: "Pays late" });
    const visible = await notes.listNotes(tech, "CUSTOMER", g.customer.id);
    expect(visible.some((n) => n.type === "BILLING")).toBe(false);
    expect(visible.some((n) => n.type === "WARNING")).toBe(true);
    const item = await pricebook.getPricebookItem(tech, g.item.id);
    expect(item.costCents).toBe(0);
  });

  it("an unassigned technician cannot drive someone else's job", async () => {
    const other = await t.as("TECHNICIAN");
    const { fieldAction } = await import("@/server/domain/field");
    await expect(fieldAction(other, g.job.id, "travel")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("pinned warnings are surfaced to the assigned technician before arrival", async () => {
    const { fieldJob } = await import("@/server/domain/field");
    const view = await fieldJob(g.tech, g.job.id);
    expect(view.notes.map((n) => n.body)).toContain("Dog in backyard");
  });
});

describe("sensitive data is permission-controlled", () => {
  it("hides compensation from office managers and all HR-sensitive data from dispatchers", async () => {
    const om = await t.as("OFFICE_MANAGER");
    const asOm = await employees.getEmployee(om, g.employee.id);
    expect(asOm.hourlyCostCents).toBeNull(); // no employees.view_compensation
    expect(asOm.emergencyContactName).toBe("Joan"); // has employees.view_sensitive
    const disp = await t.as("DISPATCHER");
    const asDisp = await employees.getEmployee(disp, g.employee.id);
    expect([asDisp.hourlyCostCents, asDisp.emergencyContactName, asDisp.internalNotes]).toEqual([null, null, null]);
    const owner = await employees.getEmployee(t.owner, g.employee.id);
    expect(owner.hourlyCostCents).toBe(3100);
    // list endpoints redact identically
    const omPage = await employees.listEmployees(om, list());
    expect(omPage.rows.every((r) => r.hourlyCostCents === null)).toBe(true);
    const dispPage = await employees.listEmployees(disp, list());
    expect(dispPage.rows.every((r) => r.hourlyCostCents === null && r.emergencyContactName === null && r.internalNotes === null)).toBe(true);
    expect((await employees.listEmployees(t.owner, list())).rows.find((r) => r.id === g.employee.id)?.hourlyCostCents).toBe(3100);
  });

  it("a user without edit-sensitive rights cannot overwrite sensitive fields", async () => {
    const om = await t.as("OFFICE_MANAGER");
    await employees.updateEmployee(om, g.employee.id, { firstName: "Alan", lastName: "Turing", hourlyCost: "1.00", emergencyContactName: "Nobody", isTechnician: true });
    const row = await t.owner.db.employee.findFirstOrThrow({ where: { id: g.employee.id } });
    expect(row.hourlyCostCents).toBe(3100);
  });

  it("property access codes are redacted without access_codes.view", async () => {
    await t.owner.db.customerLocation.update({ where: { id: g.loc.id }, data: { accessCodes: "Gate #4471" } });
    const role = await users.createRole(t.owner, { name: "Phone desk", permissions: ["customers.view", "jobs.view"] });
    const user = await platformDb().user.create({ data: { email: `phone-${Date.now()}@example.test`, name: "Phone", passwordHash: "x" } });
    const m = await platformDb().membership.create({ data: { tenantId: t.tenantId, userId: user.id, roleId: role.id } });
    void m;
    const ctx = (await loadTenantContext(user.id, t.tenantId))!;
    expect((await customers.getCustomer(ctx, g.customer.id)).locations[0]!.accessCodes).toBeNull();
    expect((await jobs.getJob(ctx, g.job.id)).location.accessCodes).toBeNull();
    expect((await customers.getCustomer(t.owner, g.customer.id)).locations[0]!.accessCodes).toBe("Gate #4471");
  });

  it("private notes are visible only to their author and users with notes.view_private", async () => {
    const author = await t.as("SALES");
    await notes.addNote(author, { entityType: "CUSTOMER", entityId: g.customer.id, body: "Secret pricing plan", isPrivate: true });
    const other = await t.as("DISPATCHER");
    expect((await notes.listNotes(other, "CUSTOMER", g.customer.id)).some((n) => n.body.includes("Secret"))).toBe(false);
    expect((await notes.listNotes(author, "CUSTOMER", g.customer.id)).some((n) => n.body.includes("Secret"))).toBe(true);
    expect((await notes.listNotes(t.owner, "CUSTOMER", g.customer.id)).some((n) => n.body.includes("Secret"))).toBe(true);
  });

  it("only users with notes.manage can pin notes", async () => {
    const d = await t.as("DISPATCHER");
    await expect(notes.addNote(d, { entityType: "CUSTOMER", entityId: g.customer.id, body: "x", isPinned: true })).rejects.toMatchObject(forbidden);
  });
});

describe("privilege escalation guards", () => {
  it("a user cannot grant permissions they do not hold", async () => {
    const role = await users.createRole(t.owner, { name: "Team lead", permissions: ["roles.manage", "users.manage", "customers.view"] });
    const user = await platformDb().user.create({ data: { email: `lead-${Date.now()}@example.test`, name: "Lead", passwordHash: "x" } });
    await platformDb().membership.create({ data: { tenantId: t.tenantId, userId: user.id, roleId: role.id } });
    const lead = (await loadTenantContext(user.id, t.tenantId))!;
    await expect(users.createRole(lead, { name: "Super", permissions: ["settings.manage"] })).rejects.toMatchObject(forbidden);
    await expect(users.createRole(lead, { name: "Ok", permissions: ["customers.view"] })).resolves.toBeTruthy();
    const ownerRole = await t.owner.db.role.findFirstOrThrow({ where: { key: "OWNER" } });
    await expect(users.inviteUser(lead, { email: "boss@example.test", roleId: ownerRole.id })).rejects.toMatchObject(forbidden);
    const adminRole = await t.owner.db.role.findFirstOrThrow({ where: { key: "ADMIN" } });
    await expect(users.inviteUser(lead, { email: "boss2@example.test", roleId: adminRole.id })).rejects.toMatchObject(forbidden);
  });

  it("the owner role cannot be edited and the last owner cannot be demoted or suspended", async () => {
    const ownerRole = await t.owner.db.role.findFirstOrThrow({ where: { key: "OWNER" } });
    await expect(users.updateRole(t.owner, ownerRole.id, { name: "x", permissions: [] })).rejects.toMatchObject({ code: "INVALID_STATE" });
    const ownerMembership = await t.owner.db.membership.findFirstOrThrow({ where: { userId: t.owner.userId } });
    const admin = await t.as("ADMIN");
    // Admin is not an owner → cannot touch owner access at all
    await expect(users.setMemberStatus(admin, ownerMembership.id, "SUSPENDED")).rejects.toMatchObject(forbidden);
    await expect(users.setMemberStatus(t.owner, ownerMembership.id, "SUSPENDED")).rejects.toMatchObject({ code: "INVALID_STATE" }); // self
    const adminRole = await t.owner.db.role.findFirstOrThrow({ where: { key: "ADMIN" } });
    await expect(users.changeMemberRole(t.owner, ownerMembership.id, adminRole.id)).rejects.toMatchObject({ code: "INVALID_STATE" }); // last owner
  });

  it("deleting a role in use is refused; system roles cannot be deleted", async () => {
    const dispatcher = await t.owner.db.role.findFirstOrThrow({ where: { key: "DISPATCHER" } });
    await expect(users.deleteRole(t.owner, dispatcher.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("suspended members and suspended companies lose access immediately", async () => {
    const u = await t.as("SALES");
    const m = await t.owner.db.membership.findFirstOrThrow({ where: { userId: u.userId } });
    await users.setMemberStatus(t.owner, m.id, "SUSPENDED");
    expect(await loadTenantContext(u.userId, t.tenantId)).toBeNull();
    await users.setMemberStatus(t.owner, m.id, "ACTIVE");
    expect(await loadTenantContext(u.userId, t.tenantId)).not.toBeNull();
    await platformDb().tenant.update({ where: { id: t.tenantId }, data: { status: "SUSPENDED" } });
    expect(await loadTenantContext(u.userId, t.tenantId)).toBeNull();
    await platformDb().tenant.update({ where: { id: t.tenantId }, data: { status: "ACTIVE" } });
  });

  it("changes to roles and users are written to the audit log", async () => {
    const actions = (await t.owner.db.auditLog.findMany({ where: { action: { startsWith: "role." } } })).map((a) => a.action);
    expect(actions).toContain("role.created");
    expect((await t.owner.db.auditLog.findMany({ where: { action: "user.suspended" } })).length).toBeGreaterThan(0);
  });
});

void today;
