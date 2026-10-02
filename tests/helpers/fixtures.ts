import { randomUUID } from "node:crypto";
import { loadTenantContext, type Ctx } from "@/server/auth/context";
import { hashPassword } from "@/server/auth/password";
import { platformDb } from "@/server/db";
import { provisionTenant, ensureDefaultPlans } from "@/server/domain/tenants";
import { setEmailProvider, type EmailProvider, type OutboundEmail } from "@/server/email/provider";
import { setStorageProvider, type StorageProvider } from "@/server/storage/provider";

export class CaptureEmail implements EmailProvider {
  readonly name = "capture";
  sent: OutboundEmail[] = [];
  fail = false;
  async send(e: OutboundEmail) {
    if (this.fail) throw new Error("provider down");
    this.sent.push(e);
    return { id: `cap-${this.sent.length}` };
  }
  last() {
    return this.sent[this.sent.length - 1];
  }
  /** First absolute URL in the last message's text part. */
  lastLink(): string {
    const m = /(https?:\/\/[^\s]+)/.exec(this.last()?.text ?? "");
    if (!m) throw new Error("no link in last email");
    return m[1]!;
  }
}

export class MemoryStorage implements StorageProvider {
  readonly name = "memory";
  objects = new Map<string, Buffer>();
  async put(key: string, body: Buffer) { this.objects.set(key, body); }
  async get(key: string) {
    const b = this.objects.get(key);
    if (!b) throw new Error("not found");
    return b;
  }
  async delete(key: string) { this.objects.delete(key); }
}

export const email = new CaptureEmail();
export const memoryStorage = new MemoryStorage();

export function installProviders() {
  setEmailProvider(email);
  setStorageProvider(memoryStorage);
  email.sent = [];
  email.fail = false;
}

let passwordHash: string | undefined;

export interface TestTenant {
  tenantId: string;
  name: string;
  owner: Ctx;
  /** Build a context for a new user holding the given built-in role. */
  as(roleKey: string, opts?: { technician?: boolean }): Promise<Ctx>;
}

/** Create an isolated company with default roles/settings and an owner. */
export async function createTestTenant(name: string): Promise<TestTenant> {
  await ensureDefaultPlans();
  const admin = { userId: "test-admin", name: "Test Admin" };
  const { tenantId } = await provisionTenant(admin, { companyName: `${name} ${randomUUID().slice(0, 6)}`, ownerName: `${name} Owner`, ownerEmail: `owner-${randomUUID()}@example.test` }, { sendInvite: false });
  passwordHash ??= await hashPassword("Correct-Horse-9");
  const db = platformDb();

  const make = async (roleKey: string, opts: { technician?: boolean } = {}): Promise<Ctx> => {
    const role = await db.role.findFirstOrThrow({ where: { tenantId, key: roleKey } });
    const user = await db.user.create({ data: { email: `${roleKey.toLowerCase()}-${randomUUID()}@example.test`, name: `${roleKey} User`, passwordHash } });
    const membership = await db.membership.create({ data: { tenantId, userId: user.id, roleId: role.id } });
    await db.employee.create({ data: { tenantId, membershipId: membership.id, firstName: roleKey, lastName: "User", email: user.email, isTechnician: opts.technician ?? ["TECHNICIAN", "INSTALLER"].includes(roleKey), status: "ACTIVE" } });
    const ctx = await loadTenantContext(user.id, tenantId);
    if (!ctx) throw new Error("failed to build ctx");
    return ctx;
  };
  const owner = await make("OWNER");
  // The provisioning invitation is consumed in real life when the owner accepts; mirror that here.
  await db.invitation.updateMany({ where: { tenantId, acceptedAt: null }, data: { acceptedAt: new Date() } });
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  return { tenantId, name: tenant.name, owner, as: make };
}

/** Seed the minimum graph used by most tests: customer + location + equipment + job type + pricebook item. */
export async function seedBasics(t: TestTenant) {
  const { createCustomer } = await import("@/server/domain/customers");
  const { createEquipment } = await import("@/server/domain/equipment");
  const { savePricebookItem, listCategories } = await import("@/server/domain/pricebook");
  const customer = await createCustomer(t.owner, {
    customer: { type: "RESIDENTIAL", firstName: "Ada", lastName: `Lovelace-${randomUUID().slice(0, 4)}`, phone: "(214) 555-0142", email: `ada-${randomUUID()}@example.test` },
    location: { name: "Home", addressLine1: "12 Analytical Way", city: "Dallas", state: "TX", postalCode: "75201" },
  });
  const loc = await t.owner.db.customerLocation.findFirstOrThrow({ where: { customerId: customer.id } });
  const equipment = await createEquipment(t.owner, { customerId: customer.id, locationId: loc.id, type: "AIR_CONDITIONER", manufacturer: "Carrier", model: "24ACC636", serialNumber: `SN-${randomUUID().slice(0, 8)}` });
  const cats = await listCategories(t.owner);
  const item = await savePricebookItem(t.owner, null, { categoryId: cats[0]!.id, kind: "SERVICE", name: "Diagnostic visit", sku: `DX-${randomUUID().slice(0, 5)}`, cost: "40.00", price: "129.00", taxable: false });
  const jobType = await t.owner.db.jobType.findFirstOrThrow({ where: { name: "Service Call" } });
  return { customer, loc, equipment, item, jobType };
}

export const futureDate = (days: number) => new Date(Date.now() + days * 86_400_000);

/** A complete operational graph for one tenant, built through the real domain services. */
export async function buildGraph(t: TestTenant) {
  const [{ createJob }, { createQuote, sendQuote }, { createInvoice, sendInvoice }, { recordPayment }, { addNote }, { uploadAttachment }, { createTask }, { saveExpense }, { saveInventoryItem, saveInventoryLocation, adjustStock, saveVendor }, { createAgreement }, { createLead }, { createEmployee }] = await Promise.all([
    import("@/server/domain/jobs"), import("@/server/domain/quotes"), import("@/server/domain/invoices"), import("@/server/domain/payments"), import("@/server/domain/notes"),
    import("@/server/domain/attachments"), import("@/server/domain/tasks"), import("@/server/domain/expenses"), import("@/server/domain/inventory"), import("@/server/domain/maintenance"),
    import("@/server/domain/leads"), import("@/server/domain/employees"),
  ]);
  const base = await seedBasics(t);
  const tech = await t.as("TECHNICIAN");
  const o = t.owner;
  const start = new Date(Date.now() + 2 * 86_400_000);
  start.setUTCHours(15, 0, 0, 0);

  const job = await createJob(o, { customerId: base.customer.id, locationId: base.loc.id, jobTypeId: base.jobType.id, title: "No cooling", equipmentIds: [base.equipment.id], assigneeIds: [tech.employeeId!] }, { startsAt: start, assigneeIds: [tech.employeeId!] });
  const appointment = await o.db.appointment.findFirstOrThrow({ where: { jobId: job.id } });

  const quote = await createQuote(o, {
    customerId: base.customer.id, locationId: base.loc.id, title: "Replace condenser", issueDate: new Date().toISOString().slice(0, 10), expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), taxRate: "8.25",
    options: [{ name: "Good", lines: [{ pricebookItemId: base.item.id, name: "Diagnostic visit", quantity: "1", unitPrice: 12900, taxable: false }] }, { name: "Better", isRecommended: true, lines: [{ name: "Condenser unit", quantity: "1", unitPrice: 450000 }] }],
  });
  await sendQuote(o, quote.id, { to: "customer@example.test" });
  const quoteLink = email.lastLink();

  const invoice = await createInvoice(o, { customerId: base.customer.id, locationId: base.loc.id, jobId: job.id, issueDate: new Date().toISOString().slice(0, 10), paymentTermsDays: 30, taxRate: "8.25", lines: [{ name: "Repair labor", quantity: "2", unitPrice: 9500 }, { name: "Capacitor", quantity: "1", unitPrice: 8500 }] });
  await sendInvoice(o, invoice.id, { to: "customer@example.test" });
  const invoiceLink = email.lastLink();
  const { payment } = await recordPayment(o, { invoiceId: invoice.id, amount: "100.00", method: "CHECK", reference: "1001" });

  const note = await addNote(o, { entityType: "CUSTOMER", entityId: base.customer.id, type: "WARNING", body: "Dog in backyard", isPinned: true });
  const attachment = await uploadAttachment(o, { name: "manual.pdf", size: 12, content: Buffer.from("%PDF-1.4 test") }, { entityType: "EQUIPMENT", entityId: base.equipment.id, kind: "MANUAL" });
  const task = await createTask(o, { title: "Call customer", customerId: base.customer.id });
  const vendor = await saveVendor(o, null, { name: "Ferguson" }).then(() => o.db.vendor.findFirstOrThrow({ where: { name: "Ferguson" } }));
  const expense = await saveExpense(o, null, { vendorId: vendor.id, category: "PARTS", amount: "55.20", expenseDate: new Date().toISOString().slice(0, 10), description: "Contactors", jobId: job.id });
  await saveInventoryLocation(o, null, { name: "Main warehouse", type: "WAREHOUSE" });
  const warehouse = await o.db.inventoryLocation.findFirstOrThrow({});
  const inv = await saveInventoryItem(o, null, { sku: `CAP-${randomUUID().slice(0, 4)}`, name: "Run capacitor 45/5", cost: "6.50", price: "28.00", reorderThreshold: 2, vendorId: vendor.id });
  await adjustStock(o, { itemId: inv.id, locationId: warehouse.id, type: "RECEIVE", quantity: "10" });
  const agreement = await createAgreement(o, { name: "Gold Plan", customerId: base.customer.id, locationId: base.loc.id, startDate: new Date().toISOString().slice(0, 10), renewalDate: new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10), price: "299.00", includedVisits: 2, equipmentIds: [base.equipment.id] });
  const lead = await createLead(o, { firstName: "Grace", lastName: "Hopper", phone: "2145550199", requestedService: "New system", addressLine1: "9 Compiler Ct", city: "Dallas", state: "TX", postalCode: "75202" });
  const employee = await createEmployee(o, { firstName: "Alan", lastName: "Turing", isTechnician: true, hourlyCost: "31.00", emergencyContactName: "Joan" });
  const membership = await o.db.membership.findFirstOrThrow({ where: { userId: tech.userId } });
  const role = await o.db.role.findFirstOrThrow({ where: { key: "DISPATCHER" } });
  const notification = await o.db.notification.findFirstOrThrow({ where: { userId: tech.userId } });
  const publicLinkRow = await o.db.publicLink.findFirstOrThrow({ where: { kind: "QUOTE" } });
  return { ...base, tech, job, appointment, quote, quoteLink, invoice, invoiceLink, payment, note, attachment, task, vendor, expense, warehouse, inv, agreement, lead, employee, membership, role, notification, publicLinkRow };
}
