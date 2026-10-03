"use server";

import { run, type ActionResult } from "@/server/actions";
import { requireCtx } from "@/server/auth/server";
import { cancelAgreement, createAgreement, renewAgreement, scheduleVisitJob, updateAgreement } from "@/server/domain/maintenance";
import { createTask, deleteTask, setTaskStatus, updateTask } from "@/server/domain/tasks";
import { deleteExpense, saveExpense } from "@/server/domain/expenses";
import { adjustStock, saveInventoryItem, saveInventoryLocation, saveVendor, transferStock } from "@/server/domain/inventory";
import { formToObject } from "@/lib/validation";

// ── Maintenance agreements ──
export async function saveAgreementAction(id: string | null, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireCtx();
    const raw = { ...formToObject(fd), equipmentIds: fd.getAll("equipmentIds").map(String) };
    const a = id ? await updateAgreement(ctx, id, raw) : await createAgreement(ctx, raw);
    return { message: id ? "Agreement saved" : `Agreement ${a.number} created`, redirectTo: `/maintenance/${a.id}` };
  });
}
export async function cancelAgreementAction(id: string, reason: string): Promise<ActionResult> {
  return run(async () => { await cancelAgreement(await requireCtx(), id, reason); return { message: "Agreement cancelled" }; });
}
export async function renewAgreementAction(id: string, createInvoice: boolean): Promise<ActionResult> {
  return run(async () => {
    const r = await renewAgreement(await requireCtx(), id, { createInvoice });
    return { message: "Agreement renewed", redirectTo: r.invoiceId ? `/invoices/${r.invoiceId}` : undefined };
  });
}
export async function scheduleVisitAction(visitId: string): Promise<ActionResult> {
  return run(async () => { const j = await scheduleVisitJob(await requireCtx(), visitId); return { message: `Job ${j.number} created`, redirectTo: `/jobs/${j.id}` }; });
}

// ── Tasks ──
export async function saveTaskAction(id: string | null, fd: FormData): Promise<ActionResult> {
  return run(async () => { const ctx = await requireCtx(); if (id) await updateTask(ctx, id, formToObject(fd)); else await createTask(ctx, formToObject(fd)); return { message: id ? "Task saved" : "Task created" }; });
}
export async function taskStatusAction(id: string, status: "OPEN" | "IN_PROGRESS" | "DONE" | "CANCELLED"): Promise<ActionResult> {
  return run(async () => { await setTaskStatus(await requireCtx(), id, status); return { message: status === "DONE" ? "Task completed" : "Task updated" }; });
}
export async function deleteTaskAction(id: string): Promise<ActionResult> {
  return run(async () => { await deleteTask(await requireCtx(), id); return { message: "Task deleted" }; });
}

// ── Expenses ──
export async function saveExpenseAction(id: string | null, fd: FormData): Promise<ActionResult> {
  return run(async () => { await saveExpense(await requireCtx(), id, formToObject(fd)); return { message: id ? "Expense saved" : "Expense recorded", redirectTo: "/expenses" }; });
}
export async function deleteExpenseAction(id: string): Promise<ActionResult> {
  return run(async () => { await deleteExpense(await requireCtx(), id); return { message: "Expense deleted", redirectTo: "/expenses" }; });
}

// ── Inventory ──
export async function saveInventoryItemAction(id: string | null, fd: FormData): Promise<ActionResult> {
  return run(async () => { const i = await saveInventoryItem(await requireCtx(), id, formToObject(fd)); return { message: id ? "Item saved" : "Item added", redirectTo: `/inventory/${i.id}` }; });
}
export async function adjustStockAction(fd: FormData): Promise<ActionResult> {
  return run(async () => { await adjustStock(await requireCtx(), formToObject(fd)); return { message: "Stock updated" }; });
}
export async function transferStockAction(fd: FormData): Promise<ActionResult> {
  return run(async () => { await transferStock(await requireCtx(), formToObject(fd)); return { message: "Stock transferred" }; });
}
export async function saveLocationAction(id: string | null, fd: FormData): Promise<ActionResult> {
  return run(async () => { await saveInventoryLocation(await requireCtx(), id, formToObject(fd)); return { message: "Location saved" }; });
}
export async function saveVendorAction(id: string | null, fd: FormData): Promise<ActionResult> {
  return run(async () => { await saveVendor(await requireCtx(), id, formToObject(fd)); return { message: "Vendor saved" }; });
}
