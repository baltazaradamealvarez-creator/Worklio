"use server";

import { run, type ActionResult } from "@/server/actions";
import { requireCtx } from "@/server/auth/server";
import { addLocation, archiveCustomer, archiveLocation, bulkUpdateCustomers, createCustomer, removeContact, restoreCustomer, saveContact, updateCustomer, updateLocation } from "@/server/domain/customers";
import { addNote, deleteNote, editNote, setNotePinned } from "@/server/domain/notes";
import { createEquipment, archiveEquipment, updateEquipment } from "@/server/domain/equipment";
import { deleteAttachment, uploadAttachment } from "@/server/domain/attachments";
import { listCustomerOptions } from "@/server/domain/customers";
import { formToNested, formToObject } from "@/lib/validation";
import { AppError } from "@/server/errors";
import type { EntityType } from "@prisma/client";

export async function createCustomerAction(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireCtx();
    const raw = formToNested(fd);
    const c = await createCustomer(ctx, { ...raw, location: raw.addLocation ? raw.location : undefined });
    return { redirectTo: `/customers/${c.id}`, message: "Customer created" };
  });
}

export async function updateCustomerAction(id: string, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    await updateCustomer(await requireCtx(), id, formToObject(fd));
    return { message: "Customer updated", redirectTo: `/customers/${id}` };
  });
}

export async function archiveCustomerAction(id: string): Promise<ActionResult> {
  return run(async () => { await archiveCustomer(await requireCtx(), id); return { redirectTo: "/customers", message: "Customer archived" }; });
}
export async function restoreCustomerAction(id: string): Promise<ActionResult> {
  return run(async () => { await restoreCustomer(await requireCtx(), id); return { message: "Customer restored" }; });
}

export async function bulkCustomersAction(ids: string[], action: string, value?: string): Promise<ActionResult> {
  return run(async () => {
    const r = await bulkUpdateCustomers(await requireCtx(), { ids, action, value });
    return { message: `${r.updated} updated${r.skipped ? `, ${r.skipped} skipped` : ""}` };
  });
}

export async function addLocationAction(customerId: string, fd: FormData): Promise<ActionResult> {
  return run(async () => { await addLocation(await requireCtx(), customerId, formToObject(fd)); return { message: "Location added" }; });
}
export async function updateLocationAction(locationId: string, fd: FormData): Promise<ActionResult> {
  return run(async () => { await updateLocation(await requireCtx(), locationId, formToObject(fd)); return { message: "Location updated" }; });
}
export async function archiveLocationAction(locationId: string): Promise<ActionResult> {
  return run(async () => { await archiveLocation(await requireCtx(), locationId); return { message: "Location removed" }; });
}
export async function saveContactAction(customerId: string, contactId: string | null, fd: FormData): Promise<ActionResult> {
  return run(async () => { await saveContact(await requireCtx(), customerId, contactId, formToObject(fd)); return { message: "Contact saved" }; });
}
export async function removeContactAction(customerId: string, contactId: string): Promise<ActionResult> {
  return run(async () => { await removeContact(await requireCtx(), customerId, contactId); return { message: "Contact removed" }; });
}

// ── Notes ──
export async function addNoteAction(entityType: EntityType, entityId: string, fd: FormData): Promise<ActionResult> {
  return run(async () => { await addNote(await requireCtx(), { ...formToObject(fd), entityType, entityId }); return { message: "Note added" }; });
}
export async function editNoteAction(noteId: string, fd: FormData): Promise<ActionResult> {
  return run(async () => { await editNote(await requireCtx(), noteId, formToObject(fd)); return { message: "Note updated" }; });
}
export async function pinNoteAction(noteId: string, pinned: boolean): Promise<ActionResult> {
  return run(async () => { await setNotePinned(await requireCtx(), noteId, pinned); return { message: pinned ? "Note pinned" : "Note unpinned" }; });
}
export async function deleteNoteAction(noteId: string): Promise<ActionResult> {
  return run(async () => { await deleteNote(await requireCtx(), noteId); return { message: "Note deleted" }; });
}

// ── Equipment ──
export async function saveEquipmentAction(id: string | null, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireCtx();
    const raw = formToObject(fd);
    const e = id ? await updateEquipment(ctx, id, raw) : await createEquipment(ctx, raw);
    return { message: id ? "Equipment updated" : "Equipment added", redirectTo: `/equipment/${e.id}` };
  });
}
export async function archiveEquipmentAction(id: string): Promise<ActionResult> {
  return run(async () => { await archiveEquipment(await requireCtx(), id); return { message: "Equipment archived", redirectTo: "/equipment" }; });
}

// ── Files ──
const MAX = 25 * 1024 * 1024;
export async function uploadFilesAction(entityType: EntityType, entityId: string, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireCtx();
    const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) throw new AppError("VALIDATION", "Choose at least one file.");
    const kind = String(fd.get("kind") ?? "DOCUMENT");
    const caption = String(fd.get("caption") ?? "");
    for (const f of files) {
      if (f.size > MAX) throw new AppError("VALIDATION", `${f.name} is larger than 25 MB.`);
      await uploadAttachment(ctx, { name: f.name, size: f.size, content: Buffer.from(await f.arrayBuffer()) }, { entityType, entityId, kind, caption });
    }
    return { message: `${files.length} file${files.length === 1 ? "" : "s"} uploaded` };
  });
}
export async function deleteFileAction(id: string): Promise<ActionResult> {
  return run(async () => { await deleteAttachment(await requireCtx(), id); return { message: "File deleted" }; });
}

export async function customerOptionsAction(q: string) {
  const ctx = await requireCtx();
  return listCustomerOptions(ctx, q.trim().slice(0, 60), 12);
}
