import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { can, requirePermission, type Ctx } from "@/server/auth/context";
import { conflict, forbidden, invalidState, notFound } from "@/server/errors";
import { bool, cents, dateReq, intField, optCents, optDate, optEmail, optPhone, optStr, optId, parseInput, str, strList } from "@/lib/validation";
import { assertWithinLimit } from "./limits";
import { skipTake, toPage, type ListParams, type Page } from "./list";
import { audit } from "./shared";

const STATUSES = ["INVITED", "ACTIVE", "ON_LEAVE", "TERMINATED"] as const;

const employeeSchema = z.object({
  firstName: str(60),
  lastName: str(60),
  email: optEmail,
  phone: optPhone,
  jobTitle: optStr(80),
  status: z.enum(STATUSES).default("ACTIVE"),
  hireDate: optDate,
  terminationDate: optDate,
  isTechnician: bool.optional(),
  skills: strList.optional(),
  calendarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#2563eb"),
  territoryId: optId,
  internalNotes: optStr(4000),
  hourlyCost: optCents,
  emergencyContactName: optStr(100),
  emergencyContactPhone: optPhone,
  emergencyContactRelationship: optStr(60),
});

/** Remove HR-sensitive fields the viewer isn't entitled to. */
export function redactEmployee<T extends { id: string; hourlyCostCents: number | null; internalNotes: string | null; emergencyContactName: string | null; emergencyContactPhone: string | null; emergencyContactRelationship: string | null }>(
  ctx: Pick<Ctx, "permissions" | "employeeId">,
  e: T,
): T {
  const sensitive = can(ctx, "employees.view_sensitive") || ctx.employeeId === e.id;
  return {
    ...e,
    hourlyCostCents: can(ctx, "employees.view_compensation") ? e.hourlyCostCents : null,
    internalNotes: can(ctx, "employees.view_sensitive") ? e.internalNotes : null,
    emergencyContactName: sensitive ? e.emergencyContactName : null,
    emergencyContactPhone: sensitive ? e.emergencyContactPhone : null,
    emergencyContactRelationship: sensitive ? e.emergencyContactRelationship : null,
  };
}

export async function listEmployees(ctx: Ctx, p: ListParams): Promise<Page<Awaited<ReturnType<typeof findRows>>[number]>> {
  requirePermission(ctx, "employees.view");
  const where: Prisma.EmployeeWhereInput = { deletedAt: null };
  if (p.q) {
    where.OR = [
      { firstName: { contains: p.q, mode: "insensitive" } },
      { lastName: { contains: p.q, mode: "insensitive" } },
      { email: { contains: p.q, mode: "insensitive" } },
      { jobTitle: { contains: p.q, mode: "insensitive" } },
    ];
  }
  if (p.filters.status && (STATUSES as readonly string[]).includes(p.filters.status)) where.status = p.filters.status as (typeof STATUSES)[number];
  if (p.filters.type === "technician") where.isTechnician = true;
  if (p.filters.type === "office") where.isTechnician = false;
  if (p.filters.role) where.membership = { roleId: p.filters.role };
  const orderBy: Prisma.EmployeeOrderByWithRelationInput =
    p.sort === "jobTitle" ? { jobTitle: p.dir } : p.sort === "hireDate" ? { hireDate: p.dir } : p.sort === "status" ? { status: p.dir } : { lastName: p.dir };
  const [rows, total] = await Promise.all([findRows(ctx, where, orderBy, p), ctx.db.employee.count({ where })]);
  return toPage(rows.map((r) => redactEmployee(ctx, r)), total, p);
}

function findRows(ctx: Ctx, where: Prisma.EmployeeWhereInput, orderBy: Prisma.EmployeeOrderByWithRelationInput, p: ListParams) {
  return ctx.db.employee.findMany({
    where,
    orderBy,
    ...skipTake(p),
    include: { membership: { include: { role: { select: { id: true, name: true, key: true } } } }, territory: { select: { name: true } } },
  });
}

export async function getEmployee(ctx: Ctx, id: string) {
  if (ctx.employeeId !== id) requirePermission(ctx, "employees.view");
  const e = await ctx.db.employee.findFirst({
    where: { id, deletedAt: null },
    include: {
      membership: { include: { role: true } },
      territory: true,
      certifications: { orderBy: { expiresAt: "asc" } },
      availabilities: { orderBy: [{ weekday: "asc" }, { startMinute: "asc" }] },
      timeOffs: { where: { endsAt: { gte: new Date() } }, orderBy: { startsAt: "asc" } },
    },
  });
  if (!e) throw notFound("Employee");
  return redactEmployee(ctx, e);
}

export async function listTechnicians(ctx: Pick<Ctx, "db">) {
  return ctx.db.employee.findMany({
    where: { isTechnician: true, deletedAt: null, status: { in: ["ACTIVE", "ON_LEAVE", "INVITED"] } },
    orderBy: [{ firstName: "asc" }],
    select: { id: true, firstName: true, lastName: true, calendarColor: true, skills: true, status: true, phone: true },
  });
}

export async function listAssignableEmployees(ctx: Pick<Ctx, "db">) {
  return ctx.db.employee.findMany({
    where: { deletedAt: null, status: { in: ["ACTIVE", "ON_LEAVE", "INVITED"] } },
    orderBy: [{ firstName: "asc" }],
    select: { id: true, firstName: true, lastName: true, isTechnician: true, membership: { select: { userId: true } } },
  });
}

function toData(input: z.output<typeof employeeSchema>, ctx: Ctx) {
  const { hourlyCost, ...rest } = input;
  return {
    firstName: rest.firstName,
    lastName: rest.lastName,
    email: rest.email ?? null,
    phone: rest.phone ?? null,
    jobTitle: rest.jobTitle ?? null,
    status: rest.status,
    hireDate: rest.hireDate ?? null,
    terminationDate: rest.terminationDate ?? null,
    isTechnician: rest.isTechnician ?? false,
    skills: rest.skills ?? [],
    calendarColor: rest.calendarColor,
    territoryId: rest.territoryId ?? null,
    // Sensitive fields are only writable by people allowed to see them.
    ...(can(ctx, "employees.view_sensitive")
      ? {
          internalNotes: rest.internalNotes ?? null,
          emergencyContactName: rest.emergencyContactName ?? null,
          emergencyContactPhone: rest.emergencyContactPhone ?? null,
          emergencyContactRelationship: rest.emergencyContactRelationship ?? null,
        }
      : {}),
    ...(can(ctx, "employees.view_compensation") ? { hourlyCostCents: hourlyCost ?? null } : {}),
  };
}

export async function createEmployee(ctx: Ctx, raw: unknown) {
  requirePermission(ctx, "employees.manage");
  const input = parseInput(employeeSchema, raw);
  if (input.isTechnician) await assertWithinLimit(ctx, "technicians");
  return ctx.db.tx(async (tx) => {
    const e = await tx.employee.create({ data: { tenantId: ctx.tenantId, ...toData(input, ctx) } });
    await audit(ctx, "employee.created", "Employee", e.id, { name: `${e.firstName} ${e.lastName}`, technician: e.isTechnician }, tx);
    return e;
  });
}

export async function updateEmployee(ctx: Ctx, id: string, raw: unknown) {
  requirePermission(ctx, "employees.manage");
  const input = parseInput(employeeSchema, raw);
  const existing = await ctx.db.employee.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw notFound("Employee");
  if (input.isTechnician && !existing.isTechnician) await assertWithinLimit(ctx, "technicians");
  const data = toData(input, ctx);
  return ctx.db.tx(async (tx) => {
    const e = await tx.employee.update({ where: { id }, data });
    const changed = (Object.keys(data) as (keyof typeof data)[]).filter((k) => JSON.stringify(data[k]) !== JSON.stringify((existing as Record<string, unknown>)[k]));
    // Never log sensitive values — just which fields changed.
    await audit(ctx, "employee.updated", "Employee", id, { fields: changed }, tx);
    // Terminated employees lose access immediately.
    if (input.status === "TERMINATED" && existing.membershipId) {
      await tx.membership.update({ where: { id: existing.membershipId }, data: { status: "SUSPENDED" } });
      await audit(ctx, "user.suspended", "Membership", existing.membershipId, { reason: "employee terminated" }, tx);
    }
    return e;
  });
}

export async function archiveEmployee(ctx: Ctx, id: string) {
  requirePermission(ctx, "employees.manage");
  const e = await ctx.db.employee.findFirst({ where: { id, deletedAt: null }, include: { membership: { include: { role: true } } } });
  if (!e) throw notFound("Employee");
  if (e.id === ctx.employeeId) throw invalidState("You can't archive your own profile.");
  if (e.membership?.role.key === "OWNER") throw forbidden("Owners can't be archived.");
  const upcoming = await ctx.db.appointmentAssignee.count({ where: { employeeId: id, startsAt: { gte: new Date() }, appointment: { status: { in: ["SCHEDULED", "DISPATCHED"] } } } });
  if (upcoming > 0) throw conflict(`${upcoming} upcoming appointment(s) are assigned to this person. Reassign them first.`);
  await ctx.db.tx(async (tx) => {
    await tx.employee.update({ where: { id }, data: { deletedAt: new Date(), status: "TERMINATED" } });
    if (e.membershipId) await tx.membership.update({ where: { id: e.membershipId }, data: { status: "SUSPENDED" } });
    await audit(ctx, "employee.archived", "Employee", id, undefined, tx);
  });
}

// ─── Certifications, availability, time off ────────────────────────────────────

const certSchema = z.object({ name: str(100), number: optStr(60), issuer: optStr(100), issuedAt: optDate, expiresAt: optDate });

export async function addCertification(ctx: Ctx, employeeId: string, raw: unknown) {
  requirePermission(ctx, "employees.manage");
  const input = parseInput(certSchema, raw);
  if (!(await ctx.db.employee.findFirst({ where: { id: employeeId, deletedAt: null } }))) throw notFound("Employee");
  await ctx.db.employeeCertification.create({
    data: { tenantId: ctx.tenantId, employeeId, name: input.name, number: input.number ?? null, issuer: input.issuer ?? null, issuedAt: input.issuedAt ?? null, expiresAt: input.expiresAt ?? null },
  });
}

export async function removeCertification(ctx: Ctx, id: string) {
  requirePermission(ctx, "employees.manage");
  await ctx.db.employeeCertification.deleteMany({ where: { id } });
}

const availabilitySchema = z.object({
  windows: z.array(z.object({ weekday: intField.pipe(z.number().min(0).max(6)), startMinute: intField.pipe(z.number().min(0).max(1439)), endMinute: intField.pipe(z.number().min(1).max(1440)) }).refine((w) => w.endMinute > w.startMinute, "End must be after start")),
});

/** Replace the technician's recurring weekly availability. */
export async function setAvailability(ctx: Ctx, employeeId: string, raw: unknown) {
  requirePermission(ctx, "employees.manage");
  const { windows } = parseInput(availabilitySchema, raw);
  if (!(await ctx.db.employee.findFirst({ where: { id: employeeId, deletedAt: null } }))) throw notFound("Employee");
  await ctx.db.tx(async (tx) => {
    await tx.employeeAvailability.deleteMany({ where: { employeeId } });
    if (windows.length) await tx.employeeAvailability.createMany({ data: windows.map((w) => ({ tenantId: ctx.tenantId, employeeId, ...w })) });
    await audit(ctx, "employee.availability_updated", "Employee", employeeId, { windows: windows.length }, tx);
  });
}

const timeOffSchema = z.object({ startsAt: dateReq, endsAt: dateReq, reason: optStr(200) });

export async function addTimeOff(ctx: Ctx, employeeId: string, raw: unknown) {
  requirePermission(ctx, "employees.manage");
  const input = parseInput(timeOffSchema, raw);
  if (!(await ctx.db.employee.findFirst({ where: { id: employeeId, deletedAt: null } }))) throw notFound("Employee");
  const endsAt = new Date(input.endsAt.getTime() + 24 * 3600_000); // inclusive end date
  if (endsAt <= input.startsAt) throw invalidState("End date must be on or after the start date.");
  await ctx.db.timeOff.create({ data: { tenantId: ctx.tenantId, employeeId, startsAt: input.startsAt, endsAt, reason: input.reason ?? null } });
}

export async function removeTimeOff(ctx: Ctx, id: string) {
  requirePermission(ctx, "employees.manage");
  await ctx.db.timeOff.deleteMany({ where: { id } });
}

void cents;
