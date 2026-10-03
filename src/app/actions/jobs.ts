"use server";

import { run, type ActionResult } from "@/server/actions";
import { requireCtx } from "@/server/auth/server";
import { addChecklistItem, addJobLineItem, assignJob, createJob, removeChecklistItem, removeJobLineItem, toggleChecklistItem, transitionJob, updateJob } from "@/server/domain/jobs";
import { cancelAppointment, dispatchAppointment, moveAppointment, scheduleAppointment } from "@/server/domain/scheduling";
import { captureJobSignature, completeJob, fieldAction, recommendRepair } from "@/server/domain/field";
import { createInvoiceFromJob } from "@/server/domain/invoices";
import { formToObject } from "@/lib/validation";
import { fromLocalInput } from "@/lib/format";
import { tenantTimezone } from "@/server/domain/scheduling";
import { requestMeta } from "@/server/auth/server";

function asArray(v: unknown): string[] { return Array.isArray(v) ? (v as string[]) : v ? [String(v)] : []; }

/** `startLocal` is wall-clock time in the company's timezone; convert on the server. */
async function toSchedule(ctx: Awaited<ReturnType<typeof requireCtx>>, raw: Record<string, unknown>) {
  const tz = await tenantTimezone(ctx.db);
  const startLocal = String(raw.startLocal ?? "");
  const minutes = Number(raw.durationMinutes ?? 0);
  if (!startLocal) return null;
  const startsAt = fromLocalInput(startLocal, tz);
  const endsAt = minutes > 0 ? new Date(startsAt.getTime() + minutes * 60_000) : undefined;
  return { startsAt, endsAt, assigneeIds: asArray(raw.assigneeIds), force: raw.force, notes: raw.notes };
}

export async function createJobAction(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireCtx();
    const raw = formToObject(fd);
    const schedule = await toSchedule(ctx, raw);
    const job = await createJob(ctx, { ...raw, assigneeIds: asArray(raw.assigneeIds), equipmentIds: asArray(raw.equipmentIds) }, schedule as never);
    return { message: `Job ${job.number} created`, redirectTo: `/jobs/${job.id}` };
  });
}

export async function updateJobAction(id: string, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireCtx();
    const raw = formToObject(fd);
    await updateJob(ctx, id, { ...raw, equipmentIds: asArray(raw.equipmentIds) });
    return { message: "Job updated", redirectTo: `/jobs/${id}` };
  });
}

export async function transitionJobAction(id: string, to: string, reason?: string): Promise<ActionResult> {
  return run(async () => { await transitionJob(await requireCtx(), id, { to, reason }); return { message: "Status updated" }; });
}

export async function assignJobAction(id: string, fd: FormData): Promise<ActionResult> {
  return run(async () => { await assignJob(await requireCtx(), id, asArray(formToObject(fd).assigneeIds)); return { message: "Technicians updated" }; });
}

export async function scheduleJobAction(jobId: string, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireCtx();
    const s = await toSchedule(ctx, formToObject(fd));
    if (!s) throw new (await import("@/server/errors")).AppError("VALIDATION", "Choose a start date and time.", { startLocal: "Required" });
    await scheduleAppointment(ctx, jobId, s);
    return { message: "Appointment scheduled" };
  });
}

/** Drag-and-drop / reassignment from the schedule board. `startsAtIso` is an absolute instant. */
export async function moveAppointmentAction(appointmentId: string, startsAtIso: string, assigneeIds: string[] | null, force: boolean): Promise<ActionResult> {
  return run(async () => {
    await moveAppointment(await requireCtx(), appointmentId, { startsAt: startsAtIso, ...(assigneeIds ? { assigneeIds } : {}), force });
    return { message: "Appointment moved" };
  });
}

export async function scheduleFromBoardAction(jobId: string, startsAtIso: string, assigneeIds: string[], force: boolean): Promise<ActionResult> {
  return run(async () => {
    await scheduleAppointment(await requireCtx(), jobId, { startsAt: startsAtIso, assigneeIds, force });
    return { message: "Job scheduled" };
  });
}

export async function cancelAppointmentAction(id: string, reason: string): Promise<ActionResult> {
  return run(async () => { await cancelAppointment(await requireCtx(), id, reason); return { message: "Appointment cancelled" }; });
}
export async function dispatchAppointmentAction(id: string): Promise<ActionResult> {
  return run(async () => { await dispatchAppointment(await requireCtx(), id); return { message: "Dispatched" }; });
}

export async function addLineAction(jobId: string, fd: FormData): Promise<ActionResult> {
  return run(async () => { await addJobLineItem(await requireCtx(), jobId, formToObject(fd)); return { message: "Item added" }; });
}
export async function removeLineAction(jobId: string, lineId: string): Promise<ActionResult> {
  return run(async () => { await removeJobLineItem(await requireCtx(), jobId, lineId); return { message: "Item removed" }; });
}
export async function toggleChecklistAction(jobId: string, itemId: string, done: boolean): Promise<ActionResult> {
  return run(async () => { await toggleChecklistItem(await requireCtx(), jobId, itemId, done); });
}
export async function addChecklistAction(jobId: string, fd: FormData): Promise<ActionResult> {
  return run(async () => { await addChecklistItem(await requireCtx(), jobId, String(fd.get("label") ?? "")); return { message: "Checklist item added" }; });
}
export async function removeChecklistAction(jobId: string, itemId: string): Promise<ActionResult> {
  return run(async () => { await removeChecklistItem(await requireCtx(), jobId, itemId); });
}

export async function invoiceJobAction(jobId: string): Promise<ActionResult> {
  return run(async () => { const inv = await createInvoiceFromJob(await requireCtx(), jobId); return { message: `Invoice ${inv.number} created`, redirectTo: `/invoices/${inv.id}` }; });
}

// ── Field (technician) ──
export async function fieldActionAction(jobId: string, action: "travel" | "arrive" | "start" | "pause" | "resume"): Promise<ActionResult> {
  return run(async () => {
    await fieldAction(await requireCtx(), jobId, action);
    return { message: { travel: "On the way", arrive: "Marked arrived", start: "Job started", pause: "Job paused", resume: "Job resumed" }[action] };
  });
}
export async function completeJobAction(jobId: string, fd: FormData): Promise<ActionResult> {
  return run(async () => { await completeJob(await requireCtx(), jobId, formToObject(fd)); return { message: "Job completed", redirectTo: "/tech" }; });
}
export async function signatureAction(jobId: string, signerName: string, dataUrl: string): Promise<ActionResult> {
  return run(async () => { await captureJobSignature(await requireCtx(), jobId, { signerName, dataUrl }, await requestMeta()); return { message: "Signature saved" }; });
}
export async function recommendRepairAction(jobId: string, fd: FormData): Promise<ActionResult> {
  return run(async () => { await recommendRepair(await requireCtx(), jobId, formToObject(fd)); return { message: "Sent to the office for a quote" }; });
}
