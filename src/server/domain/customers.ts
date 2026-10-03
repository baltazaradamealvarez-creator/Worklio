import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { can, requirePermission, type Ctx } from "@/server/auth/context";
import { conflict, forbidden, invalidState, notFound } from "@/server/errors";
import { normalizePhone } from "@/lib/format";
import { bool, optEmail, optId, optPhone, optStr, parseInput, str, strList } from "@/lib/validation";
import { customerScope } from "./entity-access";
import { assertWithinLimit } from "./limits";
import { skipTake, toPage, type ListParams } from "./list";
import { audit, recordActivity } from "./shared";

const TYPES = ["RESIDENTIAL", "COMMERCIAL"] as const;
const STATUSES = ["PROSPECT", "ACTIVE", "INACTIVE", "DO_NOT_SERVICE"] as const;
const CONTACT_METHODS = ["PHONE", "SMS", "EMAIL"] as const;
const OPEN_INVOICE_STATUSES = ["OPEN", "SENT", "VIEWED", "PARTIALLY_PAID"] as const;

export function deriveDisplayName(c: { type: string; firstName?: string | null; lastName?: string | null; companyName?: string | null }): string {
  const person = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  if (c.type === "COMMERCIAL") return (c.companyName?.trim() || person || "Unnamed company");
  return person || c.companyName?.trim() || "Unnamed customer";
}

const addressFields = {
  addressLine1: str(160),
  addressLine2: optStr(160),
  city: str(80),
  state: str(40),
  postalCode: str(20),
  country: z.string().trim().length(2).default("US"),
};

const customerSchema = z
  .object({
    type: z.enum(TYPES).default("RESIDENTIAL"),
    status: z.enum(STATUSES).default("ACTIVE"),
    firstName: optStr(60),
    lastName: optStr(60),
    companyName: optStr(120),
    phone: optPhone,
    phoneAlt: optPhone,
    email: optEmail,
    preferredContact: z.enum(CONTACT_METHODS).default("PHONE"),
    preferredLanguage: z.string().trim().min(2).max(10).default("en"),
    billingLine1: optStr(160),
    billingLine2: optStr(160),
    billingCity: optStr(80),
    billingState: optStr(40),
    billingPostalCode: optStr(20),
    billingCountry: z.string().trim().length(2).default("US"),
    referralSource: optStr(80),
    tags: strList.optional(),
    taxExempt: bool.optional(),
    taxExemptReason: optStr(200),
    accountNotes: optStr(4000),
    internalNotes: optStr(4000),
  })
  .superRefine((v, c) => {
    if (v.type === "COMMERCIAL" && !v.companyName) c.addIssue({ code: "custom", path: ["companyName"], message: "Company name is required for commercial customers" });
    if (v.type === "RESIDENTIAL" && !v.firstName && !v.lastName) c.addIssue({ code: "custom", path: ["lastName"], message: "Enter a name" });
  });

const locationSchema = z.object({
  name: str(100).default("Primary"),
  ...addressFields,
  isPrimary: bool.optional(),
  billToCustomer: bool.optional(),
  gateInstructions: optStr(1000),
  parkingInstructions: optStr(1000),
  accessCodes: optStr(500),
  onSiteContactName: optStr(100),
  onSiteContactPhone: optPhone,
  notes: optStr(2000),
});

const contactSchema = z.object({
  name: str(100),
  role: optStr(80),
  phone: optPhone,
  email: optEmail,
  locationId: optId,
  isPrimary: bool.optional(),
  isBilling: bool.optional(),
  notes: optStr(1000),
});

export type CustomerInput = z.input<typeof customerSchema>;

function customerData(i: z.output<typeof customerSchema>) {
  return {
    type: i.type,
    status: i.status,
    firstName: i.firstName ?? null,
    lastName: i.lastName ?? null,
    companyName: i.companyName ?? null,
    displayName: deriveDisplayName(i),
    phone: normalizePhone(i.phone),
    phoneAlt: normalizePhone(i.phoneAlt),
    email: i.email ?? null,
    preferredContact: i.preferredContact,
    preferredLanguage: i.preferredLanguage,
    billingLine1: i.billingLine1 ?? null,
    billingLine2: i.billingLine2 ?? null,
    billingCity: i.billingCity ?? null,
    billingState: i.billingState ?? null,
    billingPostalCode: i.billingPostalCode ?? null,
    billingCountry: i.billingCountry,
    referralSource: i.referralSource ?? null,
    tags: i.tags ?? [],
    taxExempt: i.taxExempt ?? false,
    taxExemptReason: i.taxExempt ? (i.taxExemptReason ?? null) : null,
    accountNotes: i.accountNotes ?? null,
    internalNotes: i.internalNotes ?? null,
  };
}

// ─── Queries ─────────────────────────────────────────────────────────────────────

export function customerWhere(ctx: Ctx, p: Pick<ListParams, "q" | "filters">): Prisma.CustomerWhereInput {
  const and: Prisma.CustomerWhereInput[] = [{ deletedAt: p.filters.archived === "1" ? { not: null } : null }, customerScope(ctx)];
  if (p.q) {
    const digits = p.q.replace(/\D/g, "");
    const or: Prisma.CustomerWhereInput[] = [
      { displayName: { contains: p.q, mode: "insensitive" } },
      { email: { contains: p.q, mode: "insensitive" } },
      { companyName: { contains: p.q, mode: "insensitive" } },
      { locations: { some: { addressLine1: { contains: p.q, mode: "insensitive" }, deletedAt: null } } },
      { equipment: { some: { serialNumber: { contains: p.q, mode: "insensitive" }, deletedAt: null } } },
    ];
    if (digits.length >= 3) or.push({ phone: { contains: digits } }, { phoneAlt: { contains: digits } });
    and.push({ OR: or });
  }
  const f = p.filters;
  if (f.status && (STATUSES as readonly string[]).includes(f.status)) and.push({ status: f.status as (typeof STATUSES)[number] });
  if (f.type && (TYPES as readonly string[]).includes(f.type)) and.push({ type: f.type as (typeof TYPES)[number] });
  if (f.tag) and.push({ tags: { has: f.tag } });
  if (f.balance === "owing") and.push({ invoices: { some: { status: { in: [...OPEN_INVOICE_STATUSES] }, balanceCents: { gt: 0 } } } });
  if (f.city) and.push({ locations: { some: { city: { equals: f.city, mode: "insensitive" }, deletedAt: null } } });
  if (f.postalCode) and.push({ locations: { some: { postalCode: { startsWith: f.postalCode }, deletedAt: null } } });
  if (f.state) and.push({ locations: { some: { state: { equals: f.state, mode: "insensitive" }, deletedAt: null } } });
  if (f.source) and.push({ referralSource: { equals: f.source, mode: "insensitive" } });
  return { AND: and };
}

export async function listCustomers(ctx: Ctx, p: ListParams) {
  requirePermission(ctx, "customers.view");
  const where = customerWhere(ctx, p);
  const orderBy: Prisma.CustomerOrderByWithRelationInput =
    p.sort === "createdAt" ? { createdAt: p.dir } : p.sort === "status" ? { status: p.dir } : p.sort === "type" ? { type: p.dir } : { displayName: p.dir };
  const [rows, total] = await Promise.all([
    ctx.db.customer.findMany({
      where,
      orderBy: [orderBy, { id: "asc" }],
      ...skipTake(p),
      include: {
        locations: { where: { deletedAt: null }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1, select: { city: true, state: true, addressLine1: true } },
        _count: { select: { locations: { where: { deletedAt: null } } } },
      },
    }),
    ctx.db.customer.count({ where }),
  ]);
  // One grouped query for balances (no N+1).
  const balances = can(ctx, "invoices.view")
    ? await ctx.db.invoice.groupBy({
        by: ["customerId"],
        where: { customerId: { in: rows.map((r) => r.id) }, status: { in: [...OPEN_INVOICE_STATUSES] } },
        _sum: { balanceCents: true },
      })
    : [];
  const bal = new Map(balances.map((b) => [b.customerId, b._sum.balanceCents ?? 0]));
  return toPage(rows.map((r) => ({ ...r, balanceCents: bal.get(r.id) ?? 0 })), total, p);
}

export async function customerSummary(ctx: Ctx, customerId: string) {
  const showFinance = can(ctx, "invoices.view");
  const [open, paid, quotes, jobsOpen, lastJob, nextAppt] = await Promise.all([
    showFinance
      ? ctx.db.invoice.aggregate({ where: { customerId, status: { in: [...OPEN_INVOICE_STATUSES] } }, _sum: { balanceCents: true }, _count: true })
      : null,
    showFinance ? ctx.db.invoice.aggregate({ where: { customerId, status: { not: "VOID" } }, _sum: { amountPaidCents: true } }) : null,
    can(ctx, "quotes.view") ? ctx.db.quote.count({ where: { customerId, status: { in: ["SENT", "VIEWED", "READY"] }, deletedAt: null } }) : 0,
    ctx.db.job.count({ where: { customerId, deletedAt: null, status: { notIn: ["COMPLETED", "CANCELLED"] } } }),
    ctx.db.job.findFirst({ where: { customerId, deletedAt: null, status: "COMPLETED" }, orderBy: { actualEnd: "desc" }, select: { actualEnd: true, number: true } }),
    ctx.db.appointment.findFirst({ where: { job: { customerId }, startsAt: { gte: new Date() }, status: { in: ["SCHEDULED", "DISPATCHED"] } }, orderBy: { startsAt: "asc" }, select: { startsAt: true, jobId: true } }),
  ]);
  return {
    balanceCents: open?._sum.balanceCents ?? 0,
    openInvoices: open?._count ?? 0,
    lifetimePaidCents: paid?._sum.amountPaidCents ?? 0,
    openQuotes: quotes,
    openJobs: jobsOpen,
    lastServiceAt: lastJob?.actualEnd ?? null,
    nextAppointment: nextAppt,
  };
}

export async function getCustomer(ctx: Ctx, id: string) {
  requirePermission(ctx, "customers.view");
  const c = await ctx.db.customer.findFirst({
    where: { id, ...customerScope(ctx) },
    include: {
      contacts: { where: { deletedAt: null }, orderBy: [{ isPrimary: "desc" }, { name: "asc" }] },
      locations: { where: { deletedAt: null }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
    },
  });
  if (!c) throw notFound("Customer");
  // Access codes are sensitive: only people with that permission see them.
  if (!can(ctx, "access_codes.view")) for (const l of c.locations) l.accessCodes = null;
  if (!can(ctx, "customers.edit")) c.internalNotes = null;
  return c;
}

export async function listCustomerOptions(ctx: Ctx, q: string, limit = 20) {
  requirePermission(ctx, "customers.view");
  const digits = q.replace(/\D/g, "");
  return ctx.db.customer.findMany({
    where: {
      deletedAt: null,
      ...customerScope(ctx),
      ...(q
        ? { OR: [{ displayName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : [])] }
        : {}),
    },
    orderBy: { displayName: "asc" },
    take: limit,
    select: { id: true, displayName: true, phone: true, email: true, type: true },
  });
}

export async function findDuplicates(ctx: Ctx, input: { email?: string | null; phone?: string | null }, excludeId?: string) {
  const phone = normalizePhone(input.phone);
  const or: Prisma.CustomerWhereInput[] = [];
  if (input.email) or.push({ email: { equals: input.email, mode: "insensitive" } });
  if (phone) or.push({ phone }, { phoneAlt: phone });
  if (or.length === 0) return [];
  return ctx.db.customer.findMany({ where: { deletedAt: null, OR: or, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true, displayName: true, email: true, phone: true }, take: 5 });
}

// ─── Mutations ───────────────────────────────────────────────────────────────────

const createSchema = z.object({ customer: customerSchema, location: locationSchema.optional(), allowDuplicate: bool.optional() });

export async function createCustomer(ctx: Ctx, raw: unknown) {
  requirePermission(ctx, "customers.create");
  const input = parseInput(createSchema, raw);
  if (!input.allowDuplicate) {
    const dupes = await findDuplicates(ctx, input.customer);
    if (dupes.length) throw conflict(`A customer with the same ${dupes[0]!.email && dupes[0]!.email === input.customer.email ? "email" : "phone number"} already exists (${dupes[0]!.displayName}). Tick "Create anyway" to add a duplicate.`);
  }
  await assertWithinLimit(ctx, "customers");
  const data = customerData(input.customer);
  return ctx.db.tx(async (tx) => {
    const c = await tx.customer.create({ data: { tenantId: ctx.tenantId, ...data } });
    if (input.location) {
      await tx.customerLocation.create({
        data: { tenantId: ctx.tenantId, customerId: c.id, ...locationData(input.location), isPrimary: true },
      });
    }
    await recordActivity(tx, ctx.tenantId, ctx, { customerId: c.id, entityType: "CUSTOMER", entityId: c.id, type: "customer.created", summary: "Customer created" });
    await audit(ctx, "customer.created", "Customer", c.id, { name: c.displayName }, tx);
    return c;
  });
}

export async function updateCustomer(ctx: Ctx, id: string, raw: unknown) {
  requirePermission(ctx, "customers.edit");
  const input = parseInput(customerSchema, raw);
  const existing = await ctx.db.customer.findFirst({ where: { id, deletedAt: null, ...customerScope(ctx) } });
  if (!existing) throw notFound("Customer");
  const data = customerData(input);
  return ctx.db.tx(async (tx) => {
    const c = await tx.customer.update({ where: { id }, data });
    const changed = (Object.keys(data) as (keyof typeof data)[]).filter((k) => JSON.stringify(data[k]) !== JSON.stringify((existing as Record<string, unknown>)[k]));
    if (changed.length) {
      await recordActivity(tx, ctx.tenantId, ctx, { customerId: id, entityType: "CUSTOMER", entityId: id, type: "customer.updated", summary: `Updated customer details (${changed.join(", ")})` });
      await audit(ctx, "customer.updated", "Customer", id, { fields: changed }, tx);
    }
    return c;
  });
}

export async function archiveCustomer(ctx: Ctx, id: string) {
  requirePermission(ctx, "customers.delete");
  const c = await ctx.db.customer.findFirst({ where: { id, deletedAt: null } });
  if (!c) throw notFound("Customer");
  const [owing, openJobs, activeAgreements] = await Promise.all([
    ctx.db.invoice.count({ where: { customerId: id, status: { in: [...OPEN_INVOICE_STATUSES] }, balanceCents: { gt: 0 } } }),
    ctx.db.job.count({ where: { customerId: id, deletedAt: null, status: { notIn: ["COMPLETED", "CANCELLED"] } } }),
    ctx.db.maintenanceAgreement.count({ where: { customerId: id, deletedAt: null, status: { in: ["ACTIVE", "EXPIRING", "PENDING_RENEWAL"] } } }),
  ]);
  if (owing) throw invalidState("This customer has an outstanding balance. Collect or void the open invoices first.");
  if (openJobs) throw invalidState("This customer has open jobs. Complete or cancel them first.");
  if (activeAgreements) throw invalidState("This customer has an active maintenance agreement.");
  await ctx.db.tx(async (tx) => {
    await tx.customer.update({ where: { id }, data: { deletedAt: new Date(), status: "INACTIVE" } });
    await recordActivity(tx, ctx.tenantId, ctx, { customerId: id, entityType: "CUSTOMER", entityId: id, type: "customer.archived", summary: "Customer archived" });
    await audit(ctx, "customer.archived", "Customer", id, { name: c.displayName }, tx);
  });
}

export async function restoreCustomer(ctx: Ctx, id: string) {
  requirePermission(ctx, "customers.delete");
  const c = await ctx.db.customer.findFirst({ where: { id, deletedAt: { not: null } } });
  if (!c) throw notFound("Customer");
  await ctx.db.tx(async (tx) => {
    await tx.customer.update({ where: { id }, data: { deletedAt: null, status: "ACTIVE" } });
    await recordActivity(tx, ctx.tenantId, ctx, { customerId: id, entityType: "CUSTOMER", entityId: id, type: "customer.restored", summary: "Customer restored" });
    await audit(ctx, "customer.restored", "Customer", id, undefined, tx);
  });
}

const bulkSchema = z.object({
  ids: z.array(z.string().min(1).max(40)).min(1).max(500),
  action: z.enum(["add_tag", "remove_tag", "set_status", "archive"]),
  value: optStr(60),
});

export async function bulkUpdateCustomers(ctx: Ctx, raw: unknown): Promise<{ updated: number; skipped: number }> {
  const input = parseInput(bulkSchema, raw);
  requirePermission(ctx, input.action === "archive" ? "customers.delete" : "customers.edit");
  const rows = await ctx.db.customer.findMany({ where: { id: { in: input.ids }, deletedAt: null, ...customerScope(ctx) } });
  let updated = 0;
  let skipped = input.ids.length - rows.length;
  await ctx.db.tx(async (tx) => {
    for (const c of rows) {
      if (input.action === "add_tag" && input.value) {
        if (!c.tags.includes(input.value)) await tx.customer.update({ where: { id: c.id }, data: { tags: [...c.tags, input.value] } });
      } else if (input.action === "remove_tag" && input.value) {
        await tx.customer.update({ where: { id: c.id }, data: { tags: c.tags.filter((t) => t !== input.value) } });
      } else if (input.action === "set_status" && input.value && (STATUSES as readonly string[]).includes(input.value)) {
        await tx.customer.update({ where: { id: c.id }, data: { status: input.value as (typeof STATUSES)[number] } });
      } else if (input.action === "archive") {
        const owing = await tx.invoice.count({ where: { customerId: c.id, status: { in: [...OPEN_INVOICE_STATUSES] }, balanceCents: { gt: 0 } } });
        if (owing) { skipped++; continue; }
        await tx.customer.update({ where: { id: c.id }, data: { deletedAt: new Date(), status: "INACTIVE" } });
      } else {
        skipped++;
        continue;
      }
      updated++;
    }
    await audit(ctx, "customer.bulk_updated", "Customer", null, { action: input.action, value: input.value ?? null, count: updated }, tx);
  });
  return { updated, skipped };
}

export async function listCustomerTags(ctx: Ctx): Promise<string[]> {
  const rows = await ctx.db.$queryRaw<{ tag: string }[]>`SELECT DISTINCT unnest(tags) AS tag FROM customers WHERE "deletedAt" IS NULL ORDER BY 1 LIMIT 200`;
  return rows.map((r) => r.tag);
}

// ─── Locations ────────────────────────────────────────────────────────────────────

function locationData(i: z.output<typeof locationSchema>) {
  return {
    name: i.name,
    addressLine1: i.addressLine1,
    addressLine2: i.addressLine2 ?? null,
    city: i.city,
    state: i.state,
    postalCode: i.postalCode,
    country: i.country,
    billToCustomer: i.billToCustomer ?? true,
    gateInstructions: i.gateInstructions ?? null,
    parkingInstructions: i.parkingInstructions ?? null,
    accessCodes: i.accessCodes ?? null,
    onSiteContactName: i.onSiteContactName ?? null,
    onSiteContactPhone: normalizePhone(i.onSiteContactPhone),
    notes: i.notes ?? null,
  };
}

async function assertCustomer(ctx: Ctx, customerId: string) {
  const c = await ctx.db.customer.findFirst({ where: { id: customerId, deletedAt: null, ...customerScope(ctx) }, select: { id: true, displayName: true } });
  if (!c) throw notFound("Customer");
  return c;
}

export async function addLocation(ctx: Ctx, customerId: string, raw: unknown) {
  requirePermission(ctx, "customers.edit");
  const input = parseInput(locationSchema, raw);
  await assertCustomer(ctx, customerId);
  return ctx.db.tx(async (tx) => {
    const existing = await tx.customerLocation.count({ where: { customerId, deletedAt: null } });
    const makePrimary = input.isPrimary || existing === 0;
    if (makePrimary) await tx.customerLocation.updateMany({ where: { customerId }, data: { isPrimary: false } });
    const l = await tx.customerLocation.create({ data: { tenantId: ctx.tenantId, customerId, ...locationData(input), isPrimary: makePrimary } });
    await recordActivity(tx, ctx.tenantId, ctx, { customerId, entityType: "LOCATION", entityId: l.id, type: "location.added", summary: `Added location ${l.name} — ${l.addressLine1}` });
    await audit(ctx, "location.created", "CustomerLocation", l.id, { customerId }, tx);
    return l;
  });
}

export async function updateLocation(ctx: Ctx, locationId: string, raw: unknown) {
  requirePermission(ctx, "customers.edit");
  const input = parseInput(locationSchema, raw);
  const loc = await ctx.db.customerLocation.findFirst({ where: { id: locationId, deletedAt: null, customer: customerScope(ctx) } });
  if (!loc) throw notFound("Location");
  return ctx.db.tx(async (tx) => {
    if (input.isPrimary && !loc.isPrimary) await tx.customerLocation.updateMany({ where: { customerId: loc.customerId }, data: { isPrimary: false } });
    const data = locationData(input);
    const updated = await tx.customerLocation.update({ where: { id: locationId }, data: { ...data, ...(input.isPrimary ? { isPrimary: true } : {}), ...(can(ctx, "access_codes.view") ? {} : { accessCodes: loc.accessCodes }) } });
    await recordActivity(tx, ctx.tenantId, ctx, { customerId: loc.customerId, entityType: "LOCATION", entityId: loc.id, type: "location.updated", summary: `Updated location ${updated.name}` });
    await audit(ctx, "location.updated", "CustomerLocation", locationId, undefined, tx);
    return updated;
  });
}

export async function archiveLocation(ctx: Ctx, locationId: string) {
  requirePermission(ctx, "customers.edit");
  const loc = await ctx.db.customerLocation.findFirst({ where: { id: locationId, deletedAt: null } });
  if (!loc) throw notFound("Location");
  const [jobs, equipment] = await Promise.all([
    ctx.db.job.count({ where: { locationId, deletedAt: null, status: { notIn: ["COMPLETED", "CANCELLED"] } } }),
    ctx.db.equipment.count({ where: { locationId, deletedAt: null } }),
  ]);
  if (jobs) throw invalidState("This location has open jobs.");
  if (equipment) throw invalidState("Remove or move this location's equipment first.");
  await ctx.db.tx(async (tx) => {
    await tx.customerLocation.update({ where: { id: locationId }, data: { deletedAt: new Date(), isPrimary: false } });
    await audit(ctx, "location.archived", "CustomerLocation", locationId, undefined, tx);
  });
}

// ─── Contacts ──────────────────────────────────────────────────────────────────────

export async function saveContact(ctx: Ctx, customerId: string, contactId: string | null, raw: unknown) {
  requirePermission(ctx, "customers.edit");
  const input = parseInput(contactSchema, raw);
  await assertCustomer(ctx, customerId);
  if (input.locationId && !(await ctx.db.customerLocation.findFirst({ where: { id: input.locationId, customerId, deletedAt: null } }))) throw notFound("Location");
  const data = {
    name: input.name,
    role: input.role ?? null,
    phone: normalizePhone(input.phone),
    email: input.email ?? null,
    locationId: input.locationId ?? null,
    isPrimary: input.isPrimary ?? false,
    isBilling: input.isBilling ?? false,
    notes: input.notes ?? null,
  };
  await ctx.db.tx(async (tx) => {
    if (data.isPrimary) await tx.customerContact.updateMany({ where: { customerId }, data: { isPrimary: false } });
    if (contactId) {
      if (!(await tx.customerContact.findFirst({ where: { id: contactId, customerId, deletedAt: null } }))) throw notFound("Contact");
      await tx.customerContact.update({ where: { id: contactId }, data });
    } else {
      await tx.customerContact.create({ data: { tenantId: ctx.tenantId, customerId, ...data } });
    }
    await recordActivity(tx, ctx.tenantId, ctx, { customerId, entityType: "CUSTOMER", entityId: customerId, type: "contact.saved", summary: `${contactId ? "Updated" : "Added"} contact ${input.name}` });
  });
}

export async function removeContact(ctx: Ctx, customerId: string, contactId: string) {
  requirePermission(ctx, "customers.edit");
  await assertCustomer(ctx, customerId);
  await ctx.db.customerContact.updateMany({ where: { id: contactId, customerId }, data: { deletedAt: new Date() } });
}

// ─── Timeline ──────────────────────────────────────────────────────────────────────

export async function customerTimeline(ctx: Ctx, customerId: string, opts: { take?: number; before?: Date; types?: string[] } = {}) {
  requirePermission(ctx, "customers.view");
  await assertCustomer(ctx, customerId);
  const take = Math.min(opts.take ?? 50, 200);
  const rows = await ctx.db.activity.findMany({
    where: {
      customerId,
      ...(opts.before ? { createdAt: { lt: opts.before } } : {}),
      ...(opts.types?.length ? { OR: opts.types.map((t) => ({ type: { startsWith: t } })) } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: take + 1,
  });
  // Financial events are hidden from users who can't see financials.
  const visible = can(ctx, "invoices.view") ? rows : rows.filter((r) => !/^(invoice|payment)\./.test(r.type));
  return { rows: visible.slice(0, take), hasMore: rows.length > take };
}

void forbidden;

export async function listCustomerEmails(ctx: Ctx, customerId: string) {
  requirePermission(ctx, "customers.view");
  await assertCustomer(ctx, customerId);
  const rows = await ctx.db.emailMessage.findMany({ where: { customerId }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, toEmail: true, subject: true, template: true, status: true, sentAt: true, createdAt: true, openedAt: true, error: true, entityType: true, entityId: true } });
  return can(ctx, "invoices.view") ? rows : rows.filter((r) => r.entityType !== "INVOICE");
}
