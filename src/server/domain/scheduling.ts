import type { AppointmentStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { can, requirePermission, type Ctx } from "@/server/auth/context";
import type { Db } from "@/server/db";
import { AppError, invalidState, notFound } from "@/server/errors";
import { addDays, formatDateTime, formatTime, localDateKey, zonedToUtc } from "@/lib/format";
import { assertTransition } from "@/lib/state";
import { bool, optDateTime, optStr, parseInput } from "@/lib/validation";
import { jobScope } from "./entity-access";
import { audit, notifyUsers, recordActivity } from "./shared";

const ACTIVE_APPT: AppointmentStatus[] = ["SCHEDULED", "DISPATCHED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS"];

export interface Conflict {
  employeeId: string;
  employeeName: string;
  kind: "overlap" | "time_off" | "outside_hours";
  detail: string;
}

export async function tenantTimezone(db: Db): Promise<string> {
  const s = await db.tenantSettings.findFirst({ where: {}, select: { timezone: true } });
  return s?.timezone ?? "America/Chicago";
}

/** Local minutes-from-midnight and weekday of an instant in `tz`. */
function localParts(d: Date, tz: string): { weekday: number; minutes: number; key: string } {
  const key = localDateKey(d, tz);
  const start = zonedToUtc(key, 0, tz);
  const minutes = Math.round((d.getTime() - start.getTime()) / 60_000);
  const weekday = new Date(`${key}T12:00:00Z`).getUTCDay();
  return { weekday, minutes, key };
}

export async function detectConflicts(
  db: Db,
  input: { employeeIds: string[]; startsAt: Date; endsAt: Date; excludeAppointmentId?: string },
): Promise<Conflict[]> {
  if (input.employeeIds.length === 0) return [];
  const tz = await tenantTimezone(db);
  const [employees, overlaps, timeOff, windows] = await Promise.all([
    db.employee.findMany({ where: { id: { in: input.employeeIds } }, select: { id: true, firstName: true, lastName: true } }),
    db.appointmentAssignee.findMany({
      where: {
        employeeId: { in: input.employeeIds },
        startsAt: { lt: input.endsAt },
        endsAt: { gt: input.startsAt },
        appointment: { status: { in: ACTIVE_APPT }, ...(input.excludeAppointmentId ? { id: { not: input.excludeAppointmentId } } : {}) },
      },
      include: { appointment: { select: { job: { select: { number: true, title: true } } } } },
    }),
    db.timeOff.findMany({ where: { employeeId: { in: input.employeeIds }, startsAt: { lt: input.endsAt }, endsAt: { gt: input.startsAt } } }),
    db.employeeAvailability.findMany({ where: { employeeId: { in: input.employeeIds } } }),
  ]);
  const name = new Map(employees.map((e) => [e.id, `${e.firstName} ${e.lastName}`]));
  const out: Conflict[] = [];
  for (const o of overlaps) {
    out.push({
      employeeId: o.employeeId,
      employeeName: name.get(o.employeeId) ?? "Technician",
      kind: "overlap",
      detail: `already booked ${formatTime(o.startsAt, tz)}–${formatTime(o.endsAt, tz)} on ${o.appointment.job.number}`,
    });
  }
  for (const t of timeOff) {
    out.push({ employeeId: t.employeeId, employeeName: name.get(t.employeeId) ?? "Technician", kind: "time_off", detail: `has time off${t.reason ? ` (${t.reason})` : ""}` });
  }
  const s = localParts(input.startsAt, tz);
  const e = localParts(input.endsAt, tz);
  for (const id of input.employeeIds) {
    const mine = windows.filter((w) => w.employeeId === id);
    if (mine.length === 0) continue;
    const day = mine.filter((w) => w.weekday === s.weekday);
    const sameDay = s.key === e.key;
    const fits = sameDay && day.some((w) => s.minutes >= w.startMinute && e.minutes <= w.endMinute);
    if (!fits) out.push({ employeeId: id, employeeName: name.get(id) ?? "Technician", kind: "outside_hours", detail: "is outside their available hours" });
  }
  return out;
}

function conflictError(conflicts: Conflict[]): AppError {
  const msg = conflicts.map((c) => `${c.employeeName} ${c.detail}`).join("; ");
  return new AppError("CONFLICT", `Scheduling conflict: ${msg}.`, { force: "confirm", conflicts: JSON.stringify(conflicts) });
}

const scheduleSchema = z.object({
  startsAt: z.union([z.string(), z.date()]).transform((v, c) => {
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) { c.addIssue({ code: "custom", message: "Enter a valid start time" }); return z.NEVER; }
    return d;
  }),
  endsAt: optDateTime,
  assigneeIds: z.preprocess((v) => (typeof v === "string" ? (v ? [v] : []) : v), z.array(z.string().min(1).max(40)).max(10)).default([]),
  windowStart: optDateTime,
  windowEnd: optDateTime,
  notes: optStr(1000),
  force: bool.optional(),
});
export type ScheduleInput = z.input<typeof scheduleSchema>;

/** Keep the denormalised job schedule fields aligned with its live appointments. */
export async function syncJobSchedule(tx: Db, jobId: string): Promise<void> {
  const job = await tx.job.findFirst({ where: { id: jobId }, select: { status: true } });
  if (!job) return;
  const next = await tx.appointment.findFirst({ where: { jobId, status: { in: ACTIVE_APPT } }, orderBy: { startsAt: "asc" } });
  const patch: Prisma.JobUncheckedUpdateInput = { scheduledStart: next?.startsAt ?? null, scheduledEnd: next?.endsAt ?? null };
  if (!next && (job.status === "SCHEDULED" || job.status === "DISPATCHED")) patch.status = "UNSCHEDULED";
  if (next && (job.status === "NEW" || job.status === "UNSCHEDULED" || job.status === "ON_HOLD" || job.status === "NEEDS_FOLLOW_UP")) patch.status = "SCHEDULED";
  await tx.job.update({ where: { id: jobId }, data: patch });
}

async function validateEmployees(db: Db, ids: string[]) {
  if (ids.length === 0) return [];
  const found = await db.employee.findMany({ where: { id: { in: ids }, deletedAt: null, status: { in: ["ACTIVE", "INVITED", "ON_LEAVE"] } }, select: { id: true, membership: { select: { userId: true } } } });
  if (found.length !== new Set(ids).size) throw notFound("Technician");
  return found;
}

export async function scheduleAppointment(ctx: Ctx, jobId: string, raw: unknown) {
  requirePermission(ctx, "schedule.manage");
  const input = parseInput(scheduleSchema, raw);
  return ctx.db.tx(async (tx) => {
    const job = await tx.job.findFirst({ where: { id: jobId, deletedAt: null }, include: { customer: { select: { id: true, displayName: true } }, assignees: true } });
    if (!job) throw notFound("Job");
    if (job.status === "COMPLETED" || job.status === "CANCELLED") throw invalidState(`A ${job.status.toLowerCase()} job can't be scheduled.`);
    const endsAt = input.endsAt ?? new Date(input.startsAt.getTime() + job.estimatedMinutes * 60_000);
    if (endsAt <= input.startsAt) throw new AppError("VALIDATION", "End time must be after the start time.");
    const assigneeIds = input.assigneeIds.length ? input.assigneeIds : job.assignees.map((a) => a.employeeId);
    const people = await validateEmployees(tx, assigneeIds);
    const conflicts = await detectConflicts(tx, { employeeIds: assigneeIds, startsAt: input.startsAt, endsAt });
    if (conflicts.length && !input.force) throw conflictError(conflicts);

    const appt = await tx.appointment.create({
      data: {
        tenantId: ctx.tenantId,
        jobId,
        startsAt: input.startsAt,
        endsAt,
        windowStart: input.windowStart ?? null,
        windowEnd: input.windowEnd ?? null,
        notes: input.notes ?? null,
        createdById: ctx.userId,
        assignees: { create: assigneeIds.map((employeeId) => ({ employeeId, startsAt: input.startsAt, endsAt })) },
      },
    });
    const have = new Set(job.assignees.map((a) => a.employeeId));
    const missing = assigneeIds.filter((id) => !have.has(id));
    if (missing.length) await tx.jobAssignee.createMany({ data: missing.map((employeeId) => ({ tenantId: ctx.tenantId, jobId, employeeId })) });
    await syncJobSchedule(tx, jobId);
    const tz = await tenantTimezone(tx);
    await notifyUsers(tx, ctx.tenantId, people.map((p) => p.membership?.userId).filter((u): u is string => !!u && u !== ctx.userId), {
      type: "JOB_ASSIGNED",
      title: `New job: ${job.number} — ${job.customer.displayName}`,
      body: formatDateTime(input.startsAt, tz),
      href: `/tech/jobs/${jobId}`,
      entityType: "JOB",
      entityId: jobId,
    });
    await recordActivity(tx, ctx.tenantId, ctx, {
      customerId: job.customerId,
      entityType: "JOB",
      entityId: jobId,
      type: "appointment.scheduled",
      summary: `Scheduled ${job.number} for ${formatDateTime(input.startsAt, tz)}`,
      metadata: { appointmentId: appt.id },
    });
    await audit(ctx, "appointment.scheduled", "Appointment", appt.id, { jobId, startsAt: input.startsAt, assigneeIds, forced: conflicts.length > 0 }, tx);
    return appt;
  });
}

const moveSchema = z.object({
  startsAt: z.union([z.string(), z.date()]).transform((v) => (v instanceof Date ? v : new Date(v))),
  endsAt: optDateTime,
  assigneeIds: z.preprocess((v) => (typeof v === "string" ? (v ? [v] : []) : v), z.array(z.string().min(1).max(40)).max(10)).optional(),
  force: bool.optional(),
});

/** Reschedule / reassign (drag-and-drop on the board). */
export async function moveAppointment(ctx: Ctx, appointmentId: string, raw: unknown) {
  requirePermission(ctx, "schedule.manage");
  const input = parseInput(moveSchema, raw);
  if (Number.isNaN(input.startsAt.getTime())) throw new AppError("VALIDATION", "Enter a valid start time.");
  return ctx.db.tx(async (tx) => {
    const appt = await tx.appointment.findFirst({ where: { id: appointmentId }, include: { assignees: true, job: { select: { id: true, number: true, customerId: true } } } });
    if (!appt) throw notFound("Appointment");
    if (appt.status !== "SCHEDULED" && appt.status !== "DISPATCHED") throw invalidState("Only scheduled appointments can be moved.");
    const duration = appt.endsAt.getTime() - appt.startsAt.getTime();
    const endsAt = input.endsAt ?? new Date(input.startsAt.getTime() + duration);
    if (endsAt <= input.startsAt) throw new AppError("VALIDATION", "End time must be after the start time.");
    const assigneeIds = input.assigneeIds ?? appt.assignees.map((a) => a.employeeId);
    const people = await validateEmployees(tx, assigneeIds);
    const conflicts = await detectConflicts(tx, { employeeIds: assigneeIds, startsAt: input.startsAt, endsAt, excludeAppointmentId: appt.id });
    if (conflicts.length && !input.force) throw conflictError(conflicts);

    await tx.appointment.update({ where: { id: appt.id }, data: { startsAt: input.startsAt, endsAt, windowStart: null, windowEnd: null } });
    await tx.appointmentAssignee.deleteMany({ where: { appointmentId: appt.id } });
    if (assigneeIds.length) await tx.appointmentAssignee.createMany({ data: assigneeIds.map((employeeId) => ({ tenantId: ctx.tenantId, appointmentId: appt.id, employeeId, startsAt: input.startsAt, endsAt })) });
    const existingJobAssignees = new Set((await tx.jobAssignee.findMany({ where: { jobId: appt.jobId } })).map((a) => a.employeeId));
    const add = assigneeIds.filter((id) => !existingJobAssignees.has(id));
    if (add.length) await tx.jobAssignee.createMany({ data: add.map((employeeId) => ({ tenantId: ctx.tenantId, jobId: appt.jobId, employeeId })) });
    await syncJobSchedule(tx, appt.jobId);

    const tz = await tenantTimezone(tx);
    const affected = new Set([...appt.assignees.map((a) => a.employeeId), ...assigneeIds]);
    const users = await tx.employee.findMany({ where: { id: { in: [...affected] } }, select: { membership: { select: { userId: true } } } });
    await notifyUsers(tx, ctx.tenantId, users.map((u) => u.membership?.userId).filter((u): u is string => !!u && u !== ctx.userId), {
      type: "SCHEDULE_CHANGED",
      title: `Schedule changed: ${appt.job.number}`,
      body: `Now ${formatDateTime(input.startsAt, tz)}`,
      href: `/tech/jobs/${appt.jobId}`,
      entityType: "JOB",
      entityId: appt.jobId,
    });
    await recordActivity(tx, ctx.tenantId, ctx, { customerId: appt.job.customerId, entityType: "JOB", entityId: appt.jobId, type: "appointment.rescheduled", summary: `Rescheduled ${appt.job.number} to ${formatDateTime(input.startsAt, tz)}` });
    await audit(ctx, "appointment.moved", "Appointment", appt.id, { from: appt.startsAt, to: input.startsAt, assigneeIds }, tx);
    void people;
  });
}

export async function cancelAppointment(ctx: Ctx, appointmentId: string, reason?: string) {
  requirePermission(ctx, "schedule.manage");
  await ctx.db.tx(async (tx) => {
    const appt = await tx.appointment.findFirst({ where: { id: appointmentId }, include: { job: { select: { number: true, customerId: true } }, assignees: { select: { employee: { select: { membership: { select: { userId: true } } } } } } } });
    if (!appt) throw notFound("Appointment");
    assertTransition("appointment", appt.status, "CANCELLED");
    await tx.appointment.update({ where: { id: appt.id }, data: { status: "CANCELLED", notes: reason ? `${appt.notes ? `${appt.notes}\n` : ""}Cancelled: ${reason}` : appt.notes } });
    await syncJobSchedule(tx, appt.jobId);
    await notifyUsers(tx, ctx.tenantId, appt.assignees.map((a) => a.employee.membership?.userId).filter((u): u is string => !!u && u !== ctx.userId), {
      type: "SCHEDULE_CHANGED", title: `Appointment cancelled: ${appt.job.number}`, body: reason ?? null, href: `/tech/jobs/${appt.jobId}`, entityType: "JOB", entityId: appt.jobId,
    });
    await recordActivity(tx, ctx.tenantId, ctx, { customerId: appt.job.customerId, entityType: "JOB", entityId: appt.jobId, type: "appointment.cancelled", summary: `Cancelled appointment for ${appt.job.number}${reason ? ` — ${reason}` : ""}` });
    await audit(ctx, "appointment.cancelled", "Appointment", appt.id, { reason: reason ?? null }, tx);
  });
}

/** Send the technician(s) out: SCHEDULED → DISPATCHED. */
export async function dispatchAppointment(ctx: Ctx, appointmentId: string) {
  requirePermission(ctx, "schedule.manage");
  await ctx.db.tx(async (tx) => {
    const appt = await tx.appointment.findFirst({ where: { id: appointmentId }, include: { job: true, assignees: { select: { employee: { select: { membership: { select: { userId: true } } } } } } } });
    if (!appt) throw notFound("Appointment");
    assertTransition("appointment", appt.status, "DISPATCHED");
    if (appt.assignees.length === 0) throw invalidState("Assign a technician before dispatching.");
    await tx.appointment.update({ where: { id: appt.id }, data: { status: "DISPATCHED" } });
    if (appt.job.status === "SCHEDULED") await tx.job.update({ where: { id: appt.jobId }, data: { status: "DISPATCHED" } });
    await notifyUsers(tx, ctx.tenantId, appt.assignees.map((a) => a.employee.membership?.userId).filter((u): u is string => !!u && u !== ctx.userId), {
      type: "JOB_ASSIGNED", title: `Dispatched: ${appt.job.number}`, href: `/tech/jobs/${appt.jobId}`, entityType: "JOB", entityId: appt.jobId,
    });
    await recordActivity(tx, ctx.tenantId, ctx, { customerId: appt.job.customerId, entityType: "JOB", entityId: appt.jobId, type: "appointment.dispatched", summary: `Dispatched ${appt.job.number}` });
  });
}

// ─── Board / calendar queries ────────────────────────────────────────────────────────

const apptInclude = {
  assignees: { select: { employeeId: true } },
  job: {
    select: {
      id: true, number: true, title: true, status: true, priority: true, estimatedMinutes: true, customerId: true,
      jobType: { select: { name: true, color: true } },
      customer: { select: { id: true, displayName: true, phone: true } },
      location: { select: { id: true, name: true, addressLine1: true, city: true, state: true, postalCode: true } },
    },
  },
} satisfies Prisma.AppointmentInclude;

export type ScheduleAppointment = Prisma.AppointmentGetPayload<{ include: typeof apptInclude }>;

export interface DayBounds {
  tz: string;
  start: Date;
  end: Date;
}

export async function dayBounds(db: Db, fromKey: string, days = 1): Promise<DayBounds> {
  const tz = await tenantTimezone(db);
  return { tz, start: zonedToUtc(fromKey, 0, tz), end: zonedToUtc(addDays(fromKey, days), 0, tz) };
}

/** Appointments in [from, from+days) local days, optionally limited to technicians. */
export async function scheduleRange(ctx: Ctx, fromKey: string, days: number, opts: { employeeIds?: string[] } = {}) {
  requirePermission(ctx, "schedule.view");
  const { tz, start, end } = await dayBounds(ctx.db, fromKey, days);
  const jobFilter = jobScope(ctx);
  const appointments = await ctx.db.appointment.findMany({
    where: {
      startsAt: { gte: start, lt: end },
      status: { not: "CANCELLED" },
      job: { deletedAt: null, ...jobFilter },
      ...(opts.employeeIds?.length ? { assignees: { some: { employeeId: { in: opts.employeeIds } } } } : {}),
    },
    orderBy: { startsAt: "asc" },
    include: apptInclude,
    take: 1000,
  });
  const [technicians, timeOff] = await Promise.all([
    ctx.db.employee.findMany({
      where: { isTechnician: true, deletedAt: null, status: { in: ["ACTIVE", "ON_LEAVE", "INVITED"] }, ...(opts.employeeIds?.length ? { id: { in: opts.employeeIds } } : {}) },
      orderBy: { firstName: "asc" },
      select: { id: true, firstName: true, lastName: true, calendarColor: true, status: true, phone: true },
    }),
    ctx.db.timeOff.findMany({ where: { startsAt: { lt: end }, endsAt: { gt: start } } }),
  ]);
  return { tz, start, end, appointments, technicians, timeOff };
}

/** Jobs that still need a time slot (open, with no active appointment). */
export async function unscheduledJobs(ctx: Ctx, limit = 50) {
  requirePermission(ctx, "schedule.view");
  return ctx.db.job.findMany({
    where: { deletedAt: null, status: { in: ["NEW", "UNSCHEDULED", "NEEDS_FOLLOW_UP", "ON_HOLD"] }, appointments: { none: { status: { in: ACTIVE_APPT } } }, ...jobScope(ctx) },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: limit,
    select: {
      id: true, number: true, title: true, priority: true, estimatedMinutes: true, status: true, createdAt: true,
      customer: { select: { displayName: true } },
      location: { select: { addressLine1: true, city: true, postalCode: true } },
      jobType: { select: { name: true, color: true } },
      assignees: { select: { employeeId: true } },
    },
  });
}

/** Per-technician state for the dispatcher board: what they're doing now and what's next. */
export async function dispatchBoard(ctx: Ctx, dateKey: string) {
  const data = await scheduleRange(ctx, dateKey, 1);
  const now = new Date();
  const rows = data.technicians.map((t) => {
    const mine = data.appointments.filter((a) => a.assignees.some((x) => x.employeeId === t.id));
    const live = mine.find((a) => a.status === "IN_PROGRESS" || a.status === "ARRIVED" || a.status === "EN_ROUTE");
    const next = mine.find((a) => a !== live && a.status !== "COMPLETED" && a.status !== "NO_SHOW" && a.startsAt >= now) ?? mine.find((a) => a !== live && ACTIVE_APPT.includes(a.status));
    const scheduledMinutes = mine.reduce((s, a) => s + Math.max(0, (a.endsAt.getTime() - a.startsAt.getTime()) / 60_000), 0);
    const off = data.timeOff.find((o) => o.employeeId === t.id);
    return { technician: t, appointments: mine, current: live ?? null, next: next ?? null, scheduledMinutes, completed: mine.filter((a) => a.status === "COMPLETED").length, timeOff: off ?? null };
  });
  return { ...data, rows };
}

export async function getAppointmentForJob(ctx: Ctx, jobId: string) {
  return ctx.db.appointment.findMany({ where: { jobId }, orderBy: { startsAt: "asc" }, include: { assignees: { include: { employee: { select: { id: true, firstName: true, lastName: true, calendarColor: true } } } } } });
}

void can;
