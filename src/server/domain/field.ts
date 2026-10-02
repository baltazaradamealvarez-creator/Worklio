import { randomUUID } from "node:crypto";
import { z } from "zod";
import { can, requirePermission, type Ctx } from "@/server/auth/context";
import { AppError, forbidden, invalidState, notFound } from "@/server/errors";
import { formatDateTime, localDateKey } from "@/lib/format";
import { assertTransition } from "@/lib/state";
import { bool, optStr, parseInput, str } from "@/lib/validation";
import { storage } from "@/server/storage/provider";
import { jobScope } from "./entity-access";
import { pinnedNotesForJob } from "./notes";
import { dayBounds, scheduleRange, tenantTimezone } from "./scheduling";
import { audit, notifyUsers, notifyWithPermission, recordActivity } from "./shared";

type Action = "travel" | "arrive" | "start" | "pause" | "resume";

/** The assigned technician — or office staff acting for them — may drive a job's field state. */
async function assertFieldAccess(ctx: Ctx, jobId: string) {
  if (!can(ctx, "jobs.complete") && !can(ctx, "jobs.edit")) throw forbidden();
  const job = await ctx.db.job.findFirst({ where: { id: jobId, deletedAt: null, ...jobScope(ctx) }, include: { assignees: true } });
  if (!job) throw notFound("Job");
  const assigned = ctx.employeeId ? job.assignees.some((a) => a.employeeId === ctx.employeeId) : false;
  if (!assigned && !can(ctx, "jobs.edit") && !can(ctx, "schedule.manage")) throw forbidden("This job isn't assigned to you.");
  return job;
}

/** Today's work for the signed-in technician (or any employee), in the company's timezone. */
export async function myDay(ctx: Ctx, dateKey?: string) {
  if (!can(ctx, "jobs.view_assigned") && !can(ctx, "jobs.view")) throw forbidden();
  const tz = await tenantTimezone(ctx.db);
  const key = dateKey ?? localDateKey(new Date(), tz);
  const emp = ctx.employeeId;
  const { appointments } = await scheduleRange(ctx, key, 1, emp ? { employeeIds: [emp] } : {});
  const mine = emp ? appointments.filter((a) => a.assignees.some((x) => x.employeeId === emp)) : [];
  return { dateKey: key, tz, appointments: mine };
}

export async function upcomingForMe(ctx: Ctx, days = 7) {
  const tz = await tenantTimezone(ctx.db);
  const todayKey = localDateKey(new Date(), tz);
  const { start } = await dayBounds(ctx.db, todayKey, 1);
  if (!ctx.employeeId) return [];
  return ctx.db.appointment.findMany({
    where: { startsAt: { gte: new Date(start.getTime() + 86_400_000), lt: new Date(start.getTime() + (days + 1) * 86_400_000) }, status: { in: ["SCHEDULED", "DISPATCHED"] }, assignees: { some: { employeeId: ctx.employeeId } }, job: { deletedAt: null } },
    orderBy: { startsAt: "asc" },
    take: 30,
    include: { job: { select: { id: true, number: true, title: true, customer: { select: { displayName: true } }, location: { select: { addressLine1: true, city: true } } } } },
  });
}

/** Everything a technician needs on one screen before and during a visit. */
export async function fieldJob(ctx: Ctx, jobId: string) {
  const job = await assertFieldAccess(ctx, jobId);
  const [full, notes, history, locationEquipment] = await Promise.all([
    ctx.db.job.findFirst({
      where: { id: jobId },
      include: {
        customer: { select: { id: true, displayName: true, phone: true, phoneAlt: true, email: true, type: true, preferredContact: true } },
        location: true,
        jobType: { select: { name: true, color: true } },
        checklist: { orderBy: { position: "asc" } },
        lineItems: { orderBy: { createdAt: "asc" } },
        equipment: { include: { equipment: true } },
        appointments: { orderBy: { startsAt: "asc" }, include: { assignees: { select: { employeeId: true } } } },
        signatures: { select: { id: true, signerName: true, signedAt: true } },
      },
    }),
    pinnedNotesForJob(ctx, { id: job.id, customerId: job.customerId, locationId: job.locationId }),
    ctx.db.job.findMany({
      where: { locationId: job.locationId, id: { not: jobId }, deletedAt: null, status: "COMPLETED" },
      orderBy: { actualEnd: "desc" },
      take: 6,
      select: { id: true, number: true, title: true, actualEnd: true, technicianNotes: true, jobType: { select: { name: true } }, assignees: { select: { employee: { select: { firstName: true, lastName: true } } } } },
    }),
    ctx.db.equipment.findMany({ where: { locationId: job.locationId, deletedAt: null }, orderBy: { installDate: "desc" } }),
  ]);
  if (!full) throw notFound("Job");
  if (!can(ctx, "access_codes.view")) full.location.accessCodes = null;
  const myAppt = ctx.employeeId ? full.appointments.find((a) => a.assignees.some((x) => x.employeeId === ctx.employeeId) && !["COMPLETED", "CANCELLED", "NO_SHOW"].includes(a.status)) : undefined;
  return { job: full, notes, history, locationEquipment, appointment: myAppt ?? full.appointments.find((a) => !["COMPLETED", "CANCELLED", "NO_SHOW"].includes(a.status)) ?? null };
}

export async function fieldAction(ctx: Ctx, jobId: string, action: Action) {
  const job = await assertFieldAccess(ctx, jobId);
  return ctx.db.tx(async (tx) => {
    const appt = await tx.appointment.findFirst({
      where: { jobId, status: { in: ["SCHEDULED", "DISPATCHED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS"] }, ...(ctx.employeeId && !can(ctx, "jobs.edit") ? { assignees: { some: { employeeId: ctx.employeeId } } } : {}) },
      orderBy: { startsAt: "asc" },
    });
    if (!appt) throw invalidState("There's no active appointment for this job.");
    const now = new Date();
    const log = (type: string, summary: string) => recordActivity(tx, ctx.tenantId, ctx, { customerId: job.customerId, entityType: "JOB", entityId: jobId, type, summary });
    switch (action) {
      case "travel":
        assertTransition("appointment", appt.status, "EN_ROUTE");
        assertTransition("job", job.status, "EN_ROUTE");
        await tx.appointment.update({ where: { id: appt.id }, data: { status: "EN_ROUTE", enRouteAt: now } });
        await tx.job.update({ where: { id: jobId }, data: { status: "EN_ROUTE" } });
        await log("job.en_route", `${ctx.userName} is on the way to ${job.number}`);
        break;
      case "arrive":
        assertTransition("appointment", appt.status, "ARRIVED");
        await tx.appointment.update({ where: { id: appt.id }, data: { status: "ARRIVED", arrivedAt: now } });
        await log("job.arrived", `${ctx.userName} arrived for ${job.number}`);
        break;
      case "start":
        assertTransition("appointment", appt.status, "IN_PROGRESS");
        assertTransition("job", job.status, "IN_PROGRESS");
        await tx.appointment.update({ where: { id: appt.id }, data: { status: "IN_PROGRESS", startedAt: appt.startedAt ?? now, pausedAt: null, arrivedAt: appt.arrivedAt ?? now } });
        await tx.job.update({ where: { id: jobId }, data: { status: "IN_PROGRESS", actualStart: job.actualStart ?? now, holdReason: null } });
        await log("job.started", `${ctx.userName} started ${job.number}`);
        break;
      case "pause":
        if (appt.status !== "IN_PROGRESS") throw invalidState("Start the job before pausing it.");
        assertTransition("job", job.status, "ON_HOLD");
        await tx.appointment.update({ where: { id: appt.id }, data: { pausedAt: now } });
        await tx.job.update({ where: { id: jobId }, data: { status: "ON_HOLD", holdReason: "Paused by technician" } });
        await log("job.paused", `${ctx.userName} paused ${job.number}`);
        break;
      case "resume":
        if (job.status !== "ON_HOLD") throw invalidState("This job isn't paused.");
        assertTransition("job", job.status, "IN_PROGRESS");
        await tx.appointment.update({ where: { id: appt.id }, data: { pausedAt: null, status: "IN_PROGRESS" } });
        await tx.job.update({ where: { id: jobId }, data: { status: "IN_PROGRESS", holdReason: null } });
        await log("job.resumed", `${ctx.userName} resumed ${job.number}`);
        break;
    }
    await audit(ctx, `job.${action}`, "Job", jobId, { appointmentId: appt.id }, tx);
  });
}

const completeSchema = z.object({
  technicianNotes: optStr(4000),
  customerNotes: optStr(2000),
  followUpRequired: bool.optional(),
  followUpReason: optStr(500),
  allowIncomplete: bool.optional(),
});

export async function completeJob(ctx: Ctx, jobId: string, raw: unknown) {
  const input = parseInput(completeSchema, raw);
  const job = await assertFieldAccess(ctx, jobId);
  if (job.status !== "IN_PROGRESS") throw invalidState("Start the job before completing it.");
  if (input.followUpRequired && !input.followUpReason) throw new AppError("VALIDATION", "Describe the follow-up that's needed.", { followUpReason: "Required" });
  const open = await ctx.db.jobChecklistItem.count({ where: { jobId, isDone: false } });
  if (open > 0 && !input.allowIncomplete) {
    throw new AppError("CONFLICT", `${open} checklist item${open === 1 ? " is" : "s are"} not done. Finish them or confirm to complete anyway.`, { allowIncomplete: "confirm" });
  }
  const target = input.followUpRequired ? "NEEDS_FOLLOW_UP" : "COMPLETED";
  assertTransition("job", job.status, target);
  await ctx.db.tx(async (tx) => {
    const now = new Date();
    await tx.appointment.updateMany({ where: { jobId, status: { in: ["IN_PROGRESS", "ARRIVED"] } }, data: { status: "COMPLETED", completedAt: now } });
    await tx.job.update({
      where: { id: jobId },
      data: {
        status: target, actualEnd: now, actualStart: job.actualStart ?? now,
        technicianNotes: input.technicianNotes ? `${job.technicianNotes ? `${job.technicianNotes}\n\n` : ""}${input.technicianNotes}` : job.technicianNotes,
        customerNotes: input.customerNotes ?? job.customerNotes, followUpReason: input.followUpRequired ? input.followUpReason : null,
      },
    });
    // Completing a maintenance visit updates the agreement entitlement.
    await tx.maintenanceVisit.updateMany({ where: { jobId, status: { in: ["PLANNED", "SCHEDULED"] } }, data: { status: "COMPLETED", completedAt: now } });
    await recordActivity(tx, ctx.tenantId, ctx, { customerId: job.customerId, entityType: "JOB", entityId: jobId, type: "job.completed", summary: `${ctx.userName} ${input.followUpRequired ? "finished the visit (follow-up needed)" : "completed"} ${job.number}` });
    await notifyWithPermission(tx, ctx.tenantId, "invoices.create", { type: "JOB_COMPLETED", title: `${job.number} ${input.followUpRequired ? "needs follow-up" : "completed"}`, body: job.title, href: `/jobs/${jobId}`, entityType: "JOB", entityId: jobId }, ctx.userId);
    await audit(ctx, "job.completed", "Job", jobId, { status: target }, tx);
  });
}

const signatureSchema = z.object({ signerName: str(120), dataUrl: z.string().max(400_000) });

/** Customer signature captured on the technician's device. */
export async function captureJobSignature(ctx: Ctx, jobId: string, raw: unknown, meta: { ip?: string; userAgent?: string } = {}) {
  const input = parseInput(signatureSchema, raw);
  const job = await assertFieldAccess(ctx, jobId);
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(input.dataUrl);
  if (!m) throw new AppError("VALIDATION", "The signature could not be read. Please sign again.");
  const bytes = Buffer.from(m[1]!, "base64");
  if (bytes.length < 100 || bytes.length > 300_000 || bytes.readUInt32BE(0) !== 0x89504e47) throw new AppError("VALIDATION", "The signature could not be read. Please sign again.");
  const key = `${ctx.tenantId}/signatures/${randomUUID()}`;
  await storage().put(key, bytes, "image/png");
  await ctx.db.tx(async (tx) => {
    await tx.signature.create({ data: { tenantId: ctx.tenantId, entityType: "JOB", entityId: jobId, jobId, signerName: input.signerName, storageKey: key, ip: meta.ip ?? ctx.meta.ip ?? null, userAgent: meta.userAgent ?? ctx.meta.userAgent?.slice(0, 300) ?? null } });
    await recordActivity(tx, ctx.tenantId, ctx, { customerId: job.customerId, entityType: "JOB", entityId: jobId, type: "job.signed", summary: `${input.signerName} signed off on ${job.number}` });
  });
}

const recommendSchema = z.object({ notes: str(2000) });

/** Technician flags work that needs a quote; the office gets a task + notification. */
export async function recommendRepair(ctx: Ctx, jobId: string, raw: unknown) {
  const { notes } = parseInput(recommendSchema, raw);
  const job = await assertFieldAccess(ctx, jobId);
  await ctx.db.tx(async (tx) => {
    const tz = await tenantTimezone(tx);
    await tx.task.create({
      data: { tenantId: ctx.tenantId, title: `Prepare quote — ${job.number}`, description: `Recommended by ${ctx.userName} (${formatDateTime(new Date(), tz)}):\n${notes}`, priority: "HIGH", customerId: job.customerId, jobId, createdById: ctx.userId, assigneeUserId: null, dueAt: new Date(Date.now() + 2 * 86_400_000) },
    });
    if (can(ctx, "notes.create")) {
      await tx.note.create({ data: { tenantId: ctx.tenantId, entityType: "JOB", entityId: jobId, customerId: job.customerId, type: "TECHNICIAN", body: `Recommended repair: ${notes}`, authorId: ctx.userId, authorName: ctx.userName } });
    }
    await notifyWithPermission(tx, ctx.tenantId, "quotes.create", { type: "CUSTOMER_MESSAGE", title: `Quote requested for ${job.number}`, body: notes.slice(0, 140), href: `/jobs/${jobId}`, entityType: "JOB", entityId: jobId }, ctx.userId);
    await recordActivity(tx, ctx.tenantId, ctx, { customerId: job.customerId, entityType: "JOB", entityId: jobId, type: "job.repair_recommended", summary: `${ctx.userName} recommended a repair on ${job.number}` });
  });
}

void requirePermission; void notifyUsers;
