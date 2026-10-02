import { beforeAll, describe, expect, it } from "vitest";
import { canTransition, nextStates } from "@/lib/state";
import * as jobs from "@/server/domain/jobs";
import * as sched from "@/server/domain/scheduling";
import * as field from "@/server/domain/field";
import * as maintenance from "@/server/domain/maintenance";
import { createTestTenant, installProviders, seedBasics, type TestTenant } from "../helpers/fixtures";

let t: TestTenant;
let base: Awaited<ReturnType<typeof seedBasics>>;
let tech: Awaited<ReturnType<TestTenant["as"]>>;
let tech2: Awaited<ReturnType<TestTenant["as"]>>;

/** A slot N days out at a fixed UTC hour, so tests don't depend on wall-clock time. */
const slot = (days: number, hour: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
};
const newJob = (title = "Service") => jobs.createJob(t.owner, { customerId: base.customer.id, locationId: base.loc.id, jobTypeId: base.jobType.id, title });

beforeAll(async () => {
  installProviders();
  t = await createTestTenant("Sched");
  base = await seedBasics(t);
  tech = await t.as("TECHNICIAN");
  tech2 = await t.as("TECHNICIAN");
});

describe("job lifecycle", () => {
  it("creates jobs UNSCHEDULED with a number, default duration, and a checklist from the template", async () => {
    const maint = await t.owner.db.jobType.findFirstOrThrow({ where: { name: { contains: "Maintenance" } } });
    const j = await jobs.createJob(t.owner, { customerId: base.customer.id, locationId: base.loc.id, jobTypeId: maint.id, title: "Spring tune-up" });
    expect(j.status).toBe("UNSCHEDULED");
    expect(j.number).toMatch(/^JOB-\d+$/);
    expect(j.estimatedMinutes).toBe(maint.defaultDurationMin);
    expect(await t.owner.db.jobChecklistItem.count({ where: { jobId: j.id } })).toBeGreaterThan(3);
  });

  it("rejects a location that doesn't belong to the customer", async () => {
    const other = await (await import("@/server/domain/customers")).createCustomer(t.owner, { customer: { firstName: "Bob", lastName: "Other" }, location: { name: "Office", addressLine1: "5 Elm", city: "Dallas", state: "TX", postalCode: "75001" } });
    const otherLoc = await t.owner.db.customerLocation.findFirstOrThrow({ where: { customerId: other.id } });
    await expect(jobs.createJob(t.owner, { customerId: base.customer.id, locationId: otherLoc.id, title: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("enforces the status state machine for office transitions", async () => {
    const j = await newJob();
    await expect(jobs.transitionJob(t.owner, j.id, { to: "COMPLETED" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(jobs.transitionJob(t.owner, j.id, { to: "IN_PROGRESS" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(jobs.transitionJob(t.owner, j.id, { to: "ON_HOLD" })).rejects.toMatchObject({ code: "VALIDATION" }); // reason required
    await jobs.transitionJob(t.owner, j.id, { to: "ON_HOLD", reason: "Waiting on part" });
    expect((await t.owner.db.job.findFirstOrThrow({ where: { id: j.id } })).holdReason).toBe("Waiting on part");
    await jobs.transitionJob(t.owner, j.id, { to: "CANCELLED", reason: "Customer moved" });
    await expect(jobs.updateJob(t.owner, j.id, { customerId: base.customer.id, locationId: base.loc.id, title: "x" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    await jobs.transitionJob(t.owner, j.id, { to: "UNSCHEDULED" }); // reopen
  });

  it("exposes the transition table to the UI", () => {
    expect(nextStates("job", "IN_PROGRESS")).toContain("COMPLETED");
    expect(canTransition("job", "COMPLETED", "IN_PROGRESS")).toBe(false);
    expect(canTransition("quote", "SENT", "APPROVED")).toBe(true);
    expect(canTransition("invoice", "VOID", "OPEN")).toBe(false);
  });
});

describe("scheduling & conflicts", () => {
  it("schedules, syncs the job, assigns the technician and notifies them", async () => {
    const j = await newJob();
    const start = slot(3, 14);
    const appt = await sched.scheduleAppointment(t.owner, j.id, { startsAt: start, assigneeIds: [tech.employeeId!] });
    const fresh = await t.owner.db.job.findFirstOrThrow({ where: { id: j.id }, include: { assignees: true } });
    expect(fresh.status).toBe("SCHEDULED");
    expect(fresh.scheduledStart?.getTime()).toBe(start.getTime());
    expect(fresh.assignees.map((a) => a.employeeId)).toEqual([tech.employeeId]);
    expect(appt.endsAt.getTime() - appt.startsAt.getTime()).toBe(fresh.estimatedMinutes * 60_000);
    expect(await t.owner.db.notification.count({ where: { userId: tech.userId, type: "JOB_ASSIGNED", entityId: j.id } })).toBe(1);
  });

  it("blocks double-booking a technician unless the dispatcher forces it", async () => {
    const a = await newJob("A");
    const b = await newJob("B");
    const start = slot(4, 14);
    await sched.scheduleAppointment(t.owner, a.id, { startsAt: start, assigneeIds: [tech2.employeeId!] });
    const clash = new Date(start.getTime() + 30 * 60_000);
    await expect(sched.scheduleAppointment(t.owner, b.id, { startsAt: clash, assigneeIds: [tech2.employeeId!] })).rejects.toMatchObject({ code: "CONFLICT", fieldErrors: { force: "confirm" } });
    expect(await t.owner.db.appointment.count({ where: { jobId: b.id } })).toBe(0);
    await sched.scheduleAppointment(t.owner, b.id, { startsAt: clash, assigneeIds: [tech2.employeeId!], force: true });
    expect(await t.owner.db.appointment.count({ where: { jobId: b.id } })).toBe(1);
  });

  it("back-to-back appointments are not conflicts", async () => {
    const a = await newJob();
    const b = await newJob();
    const start = slot(5, 14);
    const first = await sched.scheduleAppointment(t.owner, a.id, { startsAt: start, assigneeIds: [tech.employeeId!] });
    await expect(sched.scheduleAppointment(t.owner, b.id, { startsAt: first.endsAt, assigneeIds: [tech.employeeId!] })).resolves.toBeTruthy();
  });

  it("warns about time off and hours outside availability", async () => {
    const { addTimeOff, setAvailability } = await import("@/server/domain/employees");
    const j = await newJob();
    const day = slot(8, 15);
    const key = day.toISOString().slice(0, 10);
    await addTimeOff(t.owner, tech.employeeId!, { startsAt: key, endsAt: key, reason: "Vacation" });
    await expect(sched.scheduleAppointment(t.owner, j.id, { startsAt: day, assigneeIds: [tech.employeeId!] })).rejects.toThrow(/time off/);
    const k = await newJob();
    const parttime = await t.as("TECHNICIAN"); // own technician so other tests keep full availability
    await setAvailability(t.owner, parttime.employeeId!, { windows: [{ weekday: 1, startMinute: 480, endMinute: 1020 }] });
    const sunday = slot(10, 15);
    while (sunday.getUTCDay() !== 0) sunday.setUTCDate(sunday.getUTCDate() + 1);
    await expect(sched.scheduleAppointment(t.owner, k.id, { startsAt: sunday, assigneeIds: [parttime.employeeId!] })).rejects.toThrow(/outside their available hours/);
  });

  it("moves appointments (drag-and-drop), re-checking conflicts and notifying", async () => {
    const j = await newJob();
    const appt = await sched.scheduleAppointment(t.owner, j.id, { startsAt: slot(6, 13), assigneeIds: [tech.employeeId!] });
    const newStart = slot(6, 18);
    await sched.moveAppointment(t.owner, appt.id, { startsAt: newStart, assigneeIds: [tech2.employeeId!] });
    const moved = await t.owner.db.appointment.findFirstOrThrow({ where: { id: appt.id }, include: { assignees: true } });
    expect(moved.startsAt.getTime()).toBe(newStart.getTime());
    expect(moved.assignees.map((a) => a.employeeId)).toEqual([tech2.employeeId]);
    expect(await t.owner.db.notification.count({ where: { userId: tech.userId, type: "SCHEDULE_CHANGED", entityId: j.id } })).toBe(1);
  });

  it("cancelling the only appointment returns the job to unscheduled", async () => {
    const j = await newJob();
    const appt = await sched.scheduleAppointment(t.owner, j.id, { startsAt: slot(7, 13), assigneeIds: [tech.employeeId!] });
    await sched.cancelAppointment(t.owner, appt.id, "Customer rescheduled");
    const fresh = await t.owner.db.job.findFirstOrThrow({ where: { id: j.id } });
    expect(fresh.status).toBe("UNSCHEDULED");
    expect(fresh.scheduledStart).toBeNull();
    expect((await sched.unscheduledJobs(t.owner)).map((x) => x.id)).toContain(j.id);
  });

  it("the dispatch board reports each technician's current and next job", async () => {
    const j = await newJob("Board job");
    const tz = await sched.tenantTimezone(t.owner.db);
    const { localDateKey } = await import("@/lib/format");
    const day = new Date(Date.now() + 12 * 86_400_000);
    day.setUTCHours(16, 0, 0, 0);
    await sched.scheduleAppointment(t.owner, j.id, { startsAt: day, assigneeIds: [tech.employeeId!] });
    const board = await sched.dispatchBoard(t.owner, localDateKey(day, tz));
    const row = board.rows.find((r) => r.technician.id === tech.employeeId)!;
    expect(row.appointments).toHaveLength(1);
    expect(row.scheduledMinutes).toBeGreaterThan(0);
    expect(board.rows.find((r) => r.technician.id === tech2.employeeId)?.appointments).toHaveLength(0);
  });
});

describe("technician field workflow", () => {
  it("runs dispatch → travel → arrive → start → pause → resume → complete, with materials and notes", async () => {
    const j = await jobs.createJob(t.owner, { customerId: base.customer.id, locationId: base.loc.id, jobTypeId: base.jobType.id, title: "No cooling", equipmentIds: [base.equipment.id] });
    const appt = await sched.scheduleAppointment(t.owner, j.id, { startsAt: slot(1, 15), assigneeIds: [tech.employeeId!] });
    await sched.dispatchAppointment(t.owner, appt.id);
    expect((await t.owner.db.job.findFirstOrThrow({ where: { id: j.id } })).status).toBe("DISPATCHED");

    await expect(field.fieldAction(tech, j.id, "pause")).rejects.toMatchObject({ code: "INVALID_STATE" }); // not started
    await field.fieldAction(tech, j.id, "travel");
    expect((await t.owner.db.job.findFirstOrThrow({ where: { id: j.id } })).status).toBe("EN_ROUTE");
    await field.fieldAction(tech, j.id, "arrive");
    await field.fieldAction(tech, j.id, "start");
    expect((await t.owner.db.job.findFirstOrThrow({ where: { id: j.id } })).actualStart).not.toBeNull();
    await field.fieldAction(tech, j.id, "pause");
    expect((await t.owner.db.job.findFirstOrThrow({ where: { id: j.id } })).status).toBe("ON_HOLD");
    await field.fieldAction(tech, j.id, "resume");
    expect((await t.owner.db.job.findFirstOrThrow({ where: { id: j.id } })).status).toBe("IN_PROGRESS");

    // Technician adds a catalog service; cannot invent prices or custom lines
    await jobs.addJobLineItem(tech, j.id, { pricebookItemId: base.item.id, quantity: "1" });
    await expect(jobs.addJobLineItem(tech, j.id, { name: "Free labor", unitPrice: "0.01" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const line = await t.owner.db.jobLineItem.findFirstOrThrow({ where: { jobId: j.id } });
    expect(line.unitPriceCents).toBe(12900);

    // Checklist gate
    const open = await t.owner.db.jobChecklistItem.count({ where: { jobId: j.id, isDone: false } });
    if (open > 0) {
      await expect(field.completeJob(tech, j.id, { technicianNotes: "Replaced capacitor" })).rejects.toMatchObject({ code: "CONFLICT" });
    }
    await field.completeJob(tech, j.id, { technicianNotes: "Replaced capacitor", allowIncomplete: true });
    const done = await t.owner.db.job.findFirstOrThrow({ where: { id: j.id }, include: { appointments: true } });
    expect(done.status).toBe("COMPLETED");
    expect(done.actualEnd).not.toBeNull();
    expect(done.technicianNotes).toContain("Replaced capacitor");
    expect(done.appointments[0]!.status).toBe("COMPLETED");
    await expect(field.fieldAction(tech, j.id, "start")).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(await t.owner.db.activity.count({ where: { entityId: j.id, type: "job.completed" } })).toBe(1);
  });

  it("follow-up completion marks the job NEEDS_FOLLOW_UP and requires a reason", async () => {
    const j = await newJob();
    const appt = await sched.scheduleAppointment(t.owner, j.id, { startsAt: slot(2, 15), assigneeIds: [tech2.employeeId!] });
    void appt;
    await field.fieldAction(tech2, j.id, "start");
    await expect(field.completeJob(tech2, j.id, { followUpRequired: true, allowIncomplete: true })).rejects.toMatchObject({ code: "VALIDATION" });
    await field.completeJob(tech2, j.id, { followUpRequired: true, followUpReason: "Needs a new blower motor", allowIncomplete: true });
    expect((await t.owner.db.job.findFirstOrThrow({ where: { id: j.id } })).status).toBe("NEEDS_FOLLOW_UP");
  });

  it("recommending a repair gives the office a task, note and notification", async () => {
    const j = await newJob();
    await sched.scheduleAppointment(t.owner, j.id, { startsAt: slot(2, 18), assigneeIds: [tech.employeeId!] });
    await field.recommendRepair(tech, j.id, { notes: "Evaporator coil leaking — recommend replacement" });
    expect(await t.owner.db.task.count({ where: { jobId: j.id } })).toBe(1);
    expect(await t.owner.db.note.count({ where: { entityId: j.id, type: "TECHNICIAN" } })).toBe(1);
    expect(await t.owner.db.notification.count({ where: { userId: t.owner.userId, entityId: j.id } })).toBeGreaterThan(0);
  });

  it("completing a maintenance visit job updates the agreement's remaining visits", async () => {
    const ag = await maintenance.createAgreement(t.owner, { name: "Silver", customerId: base.customer.id, locationId: base.loc.id, startDate: new Date().toISOString().slice(0, 10), renewalDate: new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10), price: "199.00", includedVisits: 2, discountPercent: "0" });
    const visit = await t.owner.db.maintenanceVisit.findFirstOrThrow({ where: { agreementId: ag.id }, orderBy: { dueDate: "asc" } });
    const job = await maintenance.scheduleVisitJob(t.owner, visit.id);
    await sched.scheduleAppointment(t.owner, job.id, { startsAt: slot(2, 20), assigneeIds: [tech.employeeId!] });
    await field.fieldAction(tech, job.id, "start");
    await field.completeJob(tech, job.id, { allowIncomplete: true });
    const detail = await maintenance.getAgreement(t.owner, ag.id);
    expect(detail.completedVisits).toBe(1);
    expect(detail.remainingVisits).toBe(1);
  });
});
