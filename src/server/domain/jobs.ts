import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { can, requirePermission, type Ctx } from "@/server/auth/context";
import type { Db } from "@/server/db";
import { AppError, conflict, forbidden, invalidState, notFound } from "@/server/errors";
import { assertTransition, nextStates } from "@/lib/state";
import { cents, optCents, optId, optStr, parseInput, qty, str, strList } from "@/lib/validation";
import { customerScope, jobScope } from "./entity-access";
import { skipTake, toPage, parseDate, type ListParams } from "./list";
import { nextDocumentNumber } from "./numbering";
import { scheduleAppointment, type ScheduleInput } from "./scheduling";
import { audit, notifyUsers, notifyWithPermission, recordActivity } from "./shared";
import { consumeInventoryTx } from "./inventory";

const PRIORITIES = ["LOW", "NORMAL", "HIGH", "EMERGENCY"] as const;
const JOB_STATUSES = ["NEW", "UNSCHEDULED", "SCHEDULED", "DISPATCHED", "EN_ROUTE", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "NEEDS_FOLLOW_UP", "CANCELLED"] as const;
export const OPEN_JOB_STATUSES = ["NEW", "UNSCHEDULED", "SCHEDULED", "DISPATCHED", "EN_ROUTE", "IN_PROGRESS", "ON_HOLD", "NEEDS_FOLLOW_UP"] as const;

const idList = z.preprocess((v) => (typeof v === "string" ? (v ? [v] : []) : v), z.array(z.string().min(1).max(40)).max(20)).default([]);

const jobSchema = z.object({
  customerId: str(40),
  locationId: str(40),
  jobTypeId: optId,
  title: str(160),
  description: optStr(5000),
  priority: z.enum(PRIORITIES).default("NORMAL"),
  estimatedMinutes: z.preprocess((v) => (v === "" || v == null ? undefined : Number(v)), z.number().int().min(15).max(14 * 24 * 60).optional()),
  dispatcherId: optId,
  assigneeIds: idList,
  equipmentIds: idList,
  internalNotes: optStr(4000),
  customerNotes: optStr(4000),
  quoteId: optId,
  agreementId: optId,
});

export const jobFilters = ["status", "priority", "type", "tech", "customer", "from", "to", "view"] as const;

export async function listJobs(ctx: Ctx, p: ListParams) {
  if (!can(ctx, "jobs.view") && !can(ctx, "jobs.view_assigned")) throw forbidden();
  const and: Prisma.JobWhereInput[] = [{ deletedAt: null }, jobScope(ctx)];
  const f = p.filters;
  if (p.q) {
    and.push({
      OR: [
        { number: { contains: p.q, mode: "insensitive" } },
        { title: { contains: p.q, mode: "insensitive" } },
        { customer: { displayName: { contains: p.q, mode: "insensitive" } } },
        { location: { addressLine1: { contains: p.q, mode: "insensitive" } } },
      ],
    });
  }
  if (f.status) {
    const list = f.status.split(",").filter((s): s is (typeof JOB_STATUSES)[number] => (JOB_STATUSES as readonly string[]).includes(s));
    if (list.length) and.push({ status: { in: list } });
  }
  if (f.view === "open") and.push({ status: { in: [...OPEN_JOB_STATUSES] } });
  if (f.view === "unscheduled") and.push({ status: { in: ["NEW", "UNSCHEDULED"] } });
  if (f.view === "today") {
    const s = new Date(); s.setHours(0, 0, 0, 0);
    and.push({ scheduledStart: { gte: s, lt: new Date(s.getTime() + 86_400_000) } });
  }
  if (f.priority && (PRIORITIES as readonly string[]).includes(f.priority)) and.push({ priority: f.priority as (typeof PRIORITIES)[number] });
  if (f.type) and.push({ jobTypeId: f.type });
  if (f.tech) and.push({ assignees: { some: { employeeId: f.tech } } });
  if (f.customer) and.push({ customerId: f.customer });
  const from = parseDate(f.from), to = parseDate(f.to);
  if (from) and.push({ scheduledStart: { gte: from } });
  if (to) and.push({ scheduledStart: { lt: new Date(to.getTime() + 86_400_000) } });
  const where = { AND: and };
  const orderBy: Prisma.JobOrderByWithRelationInput =
    p.sort === "scheduledStart" ? { scheduledStart: { sort: p.dir, nulls: "last" } } : p.sort === "priority" ? { priority: p.dir } : p.sort === "status" ? { status: p.dir } : p.sort === "customer" ? { customer: { displayName: p.dir } } : { createdAt: p.dir };
  const [rows, total] = await Promise.all([
    ctx.db.job.findMany({
      where,
      orderBy: [orderBy, { id: "desc" }],
      ...skipTake(p),
      include: {
        customer: { select: { id: true, displayName: true } },
        location: { select: { addressLine1: true, city: true, state: true } },
        jobType: { select: { name: true, color: true } },
        assignees: { select: { employee: { select: { id: true, firstName: true, lastName: true, calendarColor: true } } } },
      },
    }),
    ctx.db.job.count({ where }),
  ]);
  return toPage(rows, total, p);
}

export async function getJob(ctx: Ctx, id: string) {
  if (!can(ctx, "jobs.view") && !can(ctx, "jobs.view_assigned")) throw forbidden();
  const job = await ctx.db.job.findFirst({
    where: { id, deletedAt: null, ...jobScope(ctx) },
    include: {
      customer: true,
      location: true,
      jobType: true,
      assignees: { include: { employee: { select: { id: true, firstName: true, lastName: true, calendarColor: true, phone: true, membership: { select: { userId: true } } } } } },
      equipment: { include: { equipment: true } },
      lineItems: { orderBy: { createdAt: "asc" } },
      checklist: { orderBy: { position: "asc" } },
      appointments: { orderBy: { startsAt: "asc" }, include: { assignees: { include: { employee: { select: { id: true, firstName: true, lastName: true, calendarColor: true } } } } } },
      quotes: { where: { deletedAt: null }, select: { id: true, number: true, status: true, totalCents: true, title: true } },
      invoices: { select: { id: true, number: true, status: true, totalCents: true, balanceCents: true, dueDate: true } },
      signatures: { select: { id: true, signerName: true, signedAt: true } },
    },
  });
  if (!job) throw notFound("Job");
  if (!can(ctx, "access_codes.view")) job.location.accessCodes = null;
  if (!can(ctx, "pricebook.view_costs")) for (const li of job.lineItems) li.unitCostCents = 0;
  if (!can(ctx, "quotes.view")) job.quotes = [];
  if (!can(ctx, "invoices.view")) job.invoices = [];
  const dispatcher = job.dispatcherId ? await ctx.db.employee.findFirst({ where: { id: job.dispatcherId }, select: { id: true, firstName: true, lastName: true } }) : null;
  return { ...job, dispatcher, allowedTransitions: nextStates("job", job.status) as readonly (typeof JOB_STATUSES)[number][] };
}

async function assertCustomerLocation(ctx: Ctx, customerId: string, locationId: string) {
  const loc = await ctx.db.customerLocation.findFirst({ where: { id: locationId, customerId, deletedAt: null, customer: { deletedAt: null, ...customerScope(ctx) } }, select: { id: true } });
  if (!loc) throw notFound("Location");
}

async function assertEquipment(ctx: Ctx, ids: string[], customerId: string) {
  if (!ids.length) return;
  const n = await ctx.db.equipment.count({ where: { id: { in: ids }, customerId, deletedAt: null } });
  if (n !== new Set(ids).size) throw notFound("Equipment");
}

/** Insert a job (+ checklist from template) inside an existing transaction. */
export async function insertJob(tx: Db, ctx: Ctx, input: z.output<typeof jobSchema> & { status?: "UNSCHEDULED" | "NEW" }) {
  const [type, settings, template] = await Promise.all([
    input.jobTypeId ? tx.jobType.findFirst({ where: { id: input.jobTypeId } }) : null,
    tx.tenantSettings.findFirst({ where: {}, select: { defaultAppointmentMinutes: true } }),
    input.jobTypeId ? tx.checklistTemplate.findFirst({ where: { jobTypeId: input.jobTypeId } }) : null,
  ]);
  if (input.jobTypeId && !type) throw notFound("Job type");
  const number = await nextDocumentNumber(tx, ctx.tenantId, "JOB");
  const j = await tx.job.create({
    data: {
      tenantId: ctx.tenantId,
      number,
      customerId: input.customerId,
      locationId: input.locationId,
      jobTypeId: input.jobTypeId ?? null,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority,
      status: "UNSCHEDULED",
      dispatcherId: input.dispatcherId ?? null,
      estimatedMinutes: input.estimatedMinutes ?? type?.defaultDurationMin ?? settings?.defaultAppointmentMinutes ?? 90,
      internalNotes: input.internalNotes ?? null,
      customerNotes: input.customerNotes ?? null,
      quoteId: input.quoteId ?? null,
      agreementId: input.agreementId ?? null,
      createdById: ctx.userId,
      assignees: { create: input.assigneeIds.map((employeeId) => ({ employeeId })) },
      equipment: { create: input.equipmentIds.map((equipmentId) => ({ equipmentId })) },
      checklist: { create: (template?.items ?? []).map((label, position) => ({ label, position })) },
    },
  });
  await recordActivity(tx, ctx.tenantId, ctx, { customerId: j.customerId, entityType: "JOB", entityId: j.id, type: "job.created", summary: `Created job ${j.number} — ${j.title}` });
  await audit(ctx, "job.created", "Job", j.id, { number: j.number }, tx);
  return j;
}

export async function createJob(ctx: Ctx, raw: unknown, schedule?: ScheduleInput | null) {
  requirePermission(ctx, "jobs.create");
  const input = parseInput(jobSchema, raw);
  await assertCustomerLocation(ctx, input.customerId, input.locationId);
  await assertEquipment(ctx, input.equipmentIds, input.customerId);
  if (input.assigneeIds.length) requirePermission(ctx, "jobs.assign");
  if (input.assigneeIds.length && (await ctx.db.employee.count({ where: { id: { in: input.assigneeIds }, deletedAt: null } })) !== new Set(input.assigneeIds).size) throw notFound("Technician");

  const job = await ctx.db.tx((tx) => insertJob(tx, ctx, input));
  if (schedule?.startsAt) {
    try {
      await scheduleAppointment(ctx, job.id, { ...schedule, assigneeIds: (schedule.assigneeIds as string[] | undefined)?.length ? schedule.assigneeIds : input.assigneeIds });
    } catch (err) {
      // The job exists; surface scheduling problems without losing it.
      if (err instanceof AppError) throw new AppError(err.code, `Job ${job.number} was created, but could not be scheduled: ${err.message}`, { ...err.fieldErrors, jobId: job.id });
      throw err;
    }
  }
  return job;
}

export async function updateJob(ctx: Ctx, id: string, raw: unknown) {
  requirePermission(ctx, "jobs.edit");
  const input = parseInput(jobSchema.omit({ assigneeIds: true, equipmentIds: true }).extend({ equipmentIds: idList }), raw);
  const job = await ctx.db.job.findFirst({ where: { id, deletedAt: null } });
  if (!job) throw notFound("Job");
  if (job.status === "COMPLETED" || job.status === "CANCELLED") throw invalidState("Completed and cancelled jobs can't be edited. Reopen the job first.");
  await assertCustomerLocation(ctx, job.customerId, input.locationId);
  await assertEquipment(ctx, input.equipmentIds, job.customerId);
  return ctx.db.tx(async (tx) => {
    const updated = await tx.job.update({
      where: { id },
      data: {
        locationId: input.locationId,
        jobTypeId: input.jobTypeId ?? null,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority,
        estimatedMinutes: input.estimatedMinutes ?? job.estimatedMinutes,
        dispatcherId: input.dispatcherId ?? null,
        internalNotes: input.internalNotes ?? null,
        customerNotes: input.customerNotes ?? null,
      },
    });
    const current = await tx.jobEquipment.findMany({ where: { jobId: id } });
    const keep = new Set(input.equipmentIds);
    const remove = current.filter((c) => !keep.has(c.equipmentId) && !c.installed).map((c) => c.id);
    if (remove.length) await tx.jobEquipment.deleteMany({ where: { id: { in: remove } } });
    const have = new Set(current.map((c) => c.equipmentId));
    const add = input.equipmentIds.filter((e) => !have.has(e));
    if (add.length) await tx.jobEquipment.createMany({ data: add.map((equipmentId) => ({ tenantId: ctx.tenantId, jobId: id, equipmentId })) });
    await recordActivity(tx, ctx.tenantId, ctx, { customerId: job.customerId, entityType: "JOB", entityId: id, type: "job.updated", summary: `Updated job ${job.number}` });
    await audit(ctx, "job.updated", "Job", id, undefined, tx);
    return updated;
  });
}

const transitionSchema = z.object({ to: z.enum(JOB_STATUSES), reason: optStr(500) });

/** Office-initiated status change (hold, cancel, reopen, mark follow-up…). */
export async function transitionJob(ctx: Ctx, id: string, raw: unknown) {
  requirePermission(ctx, "jobs.edit");
  const { to, reason } = parseInput(transitionSchema, raw);
  const job = await ctx.db.job.findFirst({ where: { id, deletedAt: null } });
  if (!job) throw notFound("Job");
  assertTransition("job", job.status, to);
  if ((to === "ON_HOLD" || to === "CANCELLED" || to === "NEEDS_FOLLOW_UP") && !reason) throw new AppError("VALIDATION", "Please give a reason.", { reason: "Required" });
  if (to === "CANCELLED") requirePermission(ctx, "jobs.delete");
  if (to === "COMPLETED") throw invalidState("Complete jobs from the technician flow so required details are captured.");
  if (["SCHEDULED", "DISPATCHED", "EN_ROUTE", "IN_PROGRESS"].includes(to) && to !== job.status && !["SCHEDULED"].includes(to)) {
    // Moving into a live state is the technician/dispatch flow's job.
    if (to === "IN_PROGRESS" || to === "EN_ROUTE" || to === "DISPATCHED") throw invalidState("Use Dispatch or the technician controls to move a job into that state.");
  }
  if (to === "SCHEDULED") throw invalidState("Schedule an appointment to move this job to Scheduled.");
  await ctx.db.tx(async (tx) => {
    await tx.job.update({
      where: { id },
      data: {
        status: to,
        ...(to === "ON_HOLD" ? { holdReason: reason } : {}),
        ...(to === "CANCELLED" ? { cancelReason: reason } : {}),
        ...(to === "NEEDS_FOLLOW_UP" ? { followUpReason: reason } : {}),
        ...(to === "UNSCHEDULED" ? { scheduledStart: null, scheduledEnd: null } : {}),
      },
    });
    if (to === "CANCELLED" || to === "UNSCHEDULED" || to === "ON_HOLD") {
      await tx.appointment.updateMany({ where: { jobId: id, status: { in: ["SCHEDULED", "DISPATCHED", "EN_ROUTE"] } }, data: { status: "CANCELLED" } });
    }
    await recordActivity(tx, ctx.tenantId, ctx, { customerId: job.customerId, entityType: "JOB", entityId: id, type: "job.status_changed", summary: `${job.number} moved to ${to.toLowerCase().replace(/_/g, " ")}${reason ? ` — ${reason}` : ""}`, metadata: { from: job.status, to } });
    await audit(ctx, "job.status_changed", "Job", id, { from: job.status, to, reason: reason ?? null }, tx);
  });
}

export async function assignJob(ctx: Ctx, id: string, employeeIds: string[]) {
  requirePermission(ctx, "jobs.assign");
  const ids = [...new Set(employeeIds)];
  const job = await ctx.db.job.findFirst({ where: { id, deletedAt: null } });
  if (!job) throw notFound("Job");
  if (job.status === "COMPLETED" || job.status === "CANCELLED") throw invalidState("This job is closed.");
  const employees = await ctx.db.employee.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, membership: { select: { userId: true } } } });
  if (employees.length !== ids.length) throw notFound("Technician");
  await ctx.db.tx(async (tx) => {
    const current = await tx.jobAssignee.findMany({ where: { jobId: id } });
    const have = new Set(current.map((c) => c.employeeId));
    const add = ids.filter((e) => !have.has(e));
    const remove = current.filter((c) => !ids.includes(c.employeeId)).map((c) => c.id);
    if (remove.length) await tx.jobAssignee.deleteMany({ where: { id: { in: remove } } });
    if (add.length) await tx.jobAssignee.createMany({ data: add.map((employeeId) => ({ tenantId: ctx.tenantId, jobId: id, employeeId })) });
    await notifyUsers(tx, ctx.tenantId, employees.filter((e) => add.includes(e.id)).map((e) => e.membership?.userId).filter((u): u is string => !!u && u !== ctx.userId), {
      type: "JOB_ASSIGNED", title: `You were assigned ${job.number}`, body: job.title, href: `/tech/jobs/${id}`, entityType: "JOB", entityId: id,
    });
    await recordActivity(tx, ctx.tenantId, ctx, { customerId: job.customerId, entityType: "JOB", entityId: id, type: "job.assigned", summary: `Updated technicians on ${job.number}` });
    await audit(ctx, "job.assigned", "Job", id, { employeeIds: ids }, tx);
  });
}

// ─── Line items (services / labor / materials / equipment installed) ─────────────────

const lineSchema = z.object({
  pricebookItemId: optId,
  kind: z.enum(["SERVICE", "LABOR", "MATERIAL", "EQUIPMENT", "OTHER"]).default("MATERIAL"),
  name: z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.string().max(160).optional()),
  description: optStr(500),
  quantity: qty.default("1"),
  unitPrice: optCents,
  inventoryItemId: optId,
  inventoryLocationId: optId,
  installedEquipmentId: optId,
});

/** Who may change a job's billable lines: office (jobs.edit) or the assigned technician. */
async function assertCanWorkJob(ctx: Ctx, jobId: string) {
  const job = await ctx.db.job.findFirst({ where: { id: jobId, deletedAt: null, ...jobScope(ctx) } });
  if (!job) throw notFound("Job");
  if (!can(ctx, "jobs.edit") && !can(ctx, "jobs.complete")) throw forbidden();
  if (job.status === "COMPLETED" || job.status === "CANCELLED") {
    if (!can(ctx, "jobs.edit")) throw invalidState("This job is closed.");
  }
  return job;
}

export async function addJobLineItem(ctx: Ctx, jobId: string, raw: unknown) {
  const input = parseInput(lineSchema, raw);
  const job = await assertCanWorkJob(ctx, jobId);
  const item = input.pricebookItemId ? await ctx.db.pricebookItem.findFirst({ where: { id: input.pricebookItemId, deletedAt: null } }) : null;
  if (input.pricebookItemId && !item) throw notFound("Pricebook item");
  const name = item?.name ?? input.name;
  if (!name) throw new AppError("VALIDATION", "Choose an item or enter a description.", { name: "Required" });
  // Technicians use catalog prices; only office staff may override a price or add ad-hoc lines at any price.
  const canPrice = can(ctx, "jobs.edit");
  const unitPriceCents = item ? (canPrice && input.unitPrice != null ? input.unitPrice : item.priceCents) : canPrice ? (input.unitPrice ?? 0) : 0;
  if (!item && !canPrice) throw forbidden("Select an item from the pricebook, or ask the office to add a custom line.");
  return ctx.db.tx(async (tx) => {
    const li = await tx.jobLineItem.create({
      data: {
        tenantId: ctx.tenantId,
        jobId,
        kind: item?.kind ?? input.kind,
        pricebookItemId: item?.id ?? null,
        name,
        description: input.description ?? item?.description ?? null,
        quantity: input.quantity,
        unitPriceCents,
        unitCostCents: item?.costCents ?? 0,
        taxable: item?.taxable ?? true,
        inventoryItemId: input.inventoryItemId ?? null,
        addedById: ctx.userId,
      },
    });
    if (input.inventoryItemId) {
      requirePermission(ctx, "inventory.consume");
      await consumeInventoryTx(tx, ctx, { itemId: input.inventoryItemId, locationId: input.inventoryLocationId ?? null, quantity: input.quantity, jobId });
    }
    if (input.installedEquipmentId) {
      await assertEquipment(ctx, [input.installedEquipmentId], job.customerId);
      await tx.jobEquipment.upsert({
        where: { tenantId_jobId_equipmentId: { tenantId: ctx.tenantId, jobId, equipmentId: input.installedEquipmentId } },
        update: { installed: true },
        create: { tenantId: ctx.tenantId, jobId, equipmentId: input.installedEquipmentId, installed: true },
      });
    }
    await recordActivity(tx, ctx.tenantId, ctx, { customerId: job.customerId, entityType: "JOB", entityId: jobId, type: "job.line_added", summary: `Added ${li.name} × ${input.quantity} to ${job.number}` });
    return li;
  });
}

export async function removeJobLineItem(ctx: Ctx, jobId: string, lineId: string) {
  await assertCanWorkJob(ctx, jobId);
  const li = await ctx.db.jobLineItem.findFirst({ where: { id: lineId, jobId } });
  if (!li) throw notFound("Line item");
  if (li.invoicedAt) throw invalidState("This line has already been invoiced.");
  if (!can(ctx, "jobs.edit") && li.addedById !== ctx.userId) throw forbidden("You can only remove items you added.");
  await ctx.db.jobLineItem.delete({ where: { id: lineId } });
}

// ─── Checklist ──────────────────────────────────────────────────────────────────────────

export async function toggleChecklistItem(ctx: Ctx, jobId: string, itemId: string, done: boolean) {
  await assertCanWorkJob(ctx, jobId);
  const item = await ctx.db.jobChecklistItem.findFirst({ where: { id: itemId, jobId } });
  if (!item) throw notFound("Checklist item");
  await ctx.db.jobChecklistItem.update({ where: { id: itemId }, data: { isDone: done, doneAt: done ? new Date() : null, doneById: done ? ctx.userId : null } });
}

export async function addChecklistItem(ctx: Ctx, jobId: string, label: string) {
  const clean = parseInput(str(200), label);
  await assertCanWorkJob(ctx, jobId);
  const count = await ctx.db.jobChecklistItem.count({ where: { jobId } });
  await ctx.db.jobChecklistItem.create({ data: { tenantId: ctx.tenantId, jobId, label: clean, position: count } });
}

export async function removeChecklistItem(ctx: Ctx, jobId: string, itemId: string) {
  requirePermission(ctx, "jobs.edit");
  await ctx.db.jobChecklistItem.deleteMany({ where: { id: itemId, jobId } });
}

// ─── Job types ──────────────────────────────────────────────────────────────────────────

export async function listJobTypes(ctx: Pick<Ctx, "db">) {
  return ctx.db.jobType.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
}

const jobTypeSchema = z.object({ name: str(80), defaultDurationMin: z.coerce.number().int().min(15).max(10_080), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#2563eb") });

export async function saveJobType(ctx: Ctx, id: string | null, raw: unknown) {
  requirePermission(ctx, "settings.manage");
  const input = parseInput(jobTypeSchema, raw);
  const dup = await ctx.db.jobType.findFirst({ where: { name: { equals: input.name, mode: "insensitive" }, ...(id ? { id: { not: id } } : {}) } });
  if (dup) throw conflict("A job type with that name already exists.");
  if (id) {
    if (!(await ctx.db.jobType.findFirst({ where: { id } }))) throw notFound("Job type");
    await ctx.db.jobType.update({ where: { id }, data: input });
  }
  else await ctx.db.jobType.create({ data: { tenantId: ctx.tenantId, ...input } });
}

export async function archiveJobType(ctx: Ctx, id: string) {
  requirePermission(ctx, "settings.manage");
  await ctx.db.jobType.updateMany({ where: { id }, data: { isActive: false } });
}

void cents; void strList; void notifyWithPermission;
