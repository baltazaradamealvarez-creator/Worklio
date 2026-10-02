import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import type { AttachmentKind, EntityType } from "@prisma/client";
import { z } from "zod";
import { can, requirePermission, type Ctx } from "@/server/auth/context";
import { forbidden, notFound } from "@/server/errors";
import { storage } from "@/server/storage/provider";
import { validateUpload } from "@/server/storage/validate";
import { bool, optStr, parseInput } from "@/lib/validation";
import { resolveEntity } from "./entity-access";
import { assertWithinLimit } from "./limits";
import { audit, recordActivity } from "./shared";

const ENTITY_TYPES = ["CUSTOMER", "LOCATION", "EQUIPMENT", "LEAD", "JOB", "QUOTE", "INVOICE", "AGREEMENT", "EMPLOYEE", "EXPENSE", "PAYMENT"] as const;

const metaSchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
  entityId: z.string().min(1).max(40),
  kind: z
    .enum(["PHOTO", "DOCUMENT", "MANUAL", "WARRANTY", "CONTRACT", "RECEIPT", "BEFORE_PHOTO", "AFTER_PHOTO", "OTHER"])
    .default("DOCUMENT"),
  caption: optStr(300),
  isInternal: bool.optional(),
});

/** Employee documents hold sensitive HR material. */
function assertCanTouchEmployeeFiles(ctx: Ctx, entityId: string) {
  if (ctx.employeeId === entityId) return;
  if (!can(ctx, "employees.manage") && !can(ctx, "employees.view_sensitive")) throw forbidden();
}

export async function uploadAttachment(ctx: Ctx, file: { name: string; size: number; content: Buffer }, rawMeta: unknown) {
  requirePermission(ctx, "files.upload");
  const meta = parseInput(metaSchema, rawMeta);
  if (meta.entityType === "EMPLOYEE") assertCanTouchEmployeeFiles(ctx, meta.entityId);
  const entity = await resolveEntity(ctx, meta.entityType, meta.entityId);
  const checked = validateUpload(file.name, file.size, file.content);
  await assertWithinLimit(ctx, "storageMb", 0, file.size);

  const now = new Date();
  const key = `${ctx.tenantId}/${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}`;
  await storage().put(key, file.content, checked.mimeType);
  try {
    const row = await ctx.db.tx(async (tx) => {
      const a = await tx.attachment.create({
        data: {
          tenantId: ctx.tenantId,
          entityType: meta.entityType,
          entityId: meta.entityId,
          customerId: entity.customerId,
          kind: meta.kind as AttachmentKind,
          filename: checked.filename,
          mimeType: checked.mimeType,
          sizeBytes: file.size,
          storageKey: key,
          sha256: createHash("sha256").update(file.content).digest("hex"),
          caption: meta.caption ?? null,
          isInternal: meta.isInternal ?? false,
          uploadedById: ctx.userId,
        },
      });
      if (entity.customerId && meta.entityType !== "EMPLOYEE") {
        await recordActivity(tx, ctx.tenantId, ctx, {
          customerId: entity.customerId,
          entityType: meta.entityType,
          entityId: meta.entityId,
          type: "file.uploaded",
          summary: `Uploaded ${checked.filename} to ${entity.label}`,
        });
      }
      await audit(ctx, "file.uploaded", "Attachment", a.id, { filename: checked.filename, entityType: meta.entityType, entityId: meta.entityId, size: file.size }, tx);
      return a;
    });
    return row;
  } catch (err) {
    await storage().delete(key).catch(() => undefined);
    throw err;
  }
}

export async function listAttachments(ctx: Ctx, entityType: EntityType, entityId: string) {
  requirePermission(ctx, "files.view");
  if (entityType === "EMPLOYEE") assertCanTouchEmployeeFiles(ctx, entityId);
  await resolveEntity(ctx, entityType, entityId);
  return ctx.db.attachment.findMany({
    where: { entityType, entityId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
}

/** Resolve an attachment the caller is allowed to read (used by the download route). */
export async function getReadableAttachment(ctx: Ctx, attachmentId: string) {
  requirePermission(ctx, "files.view");
  const a = await ctx.db.attachment.findFirst({ where: { id: attachmentId, deletedAt: null } });
  if (!a) throw notFound("File");
  if (a.entityType === "EMPLOYEE") assertCanTouchEmployeeFiles(ctx, a.entityId);
  if (a.entityType === "TENANT") {
    // branding assets are served by the public branding route; direct access needs settings rights
    requirePermission(ctx, "settings.manage");
  } else {
    await resolveEntity(ctx, a.entityType, a.entityId);
  }
  return a;
}

export async function readAttachmentBytes(ctx: Ctx, attachmentId: string) {
  const a = await getReadableAttachment(ctx, attachmentId);
  const bytes = await storage().get(a.storageKey);
  await audit(ctx, "file.downloaded", "Attachment", a.id, { filename: a.filename });
  return { attachment: a, bytes };
}

export async function deleteAttachment(ctx: Ctx, attachmentId: string): Promise<void> {
  const a = await getReadableAttachment(ctx, attachmentId);
  const own = a.uploadedById === ctx.userId;
  if (!can(ctx, "files.delete") && !own) throw forbidden();
  await ctx.db.tx(async (tx) => {
    await tx.attachment.update({ where: { id: a.id }, data: { deletedAt: new Date() } });
    await audit(ctx, "file.deleted", "Attachment", a.id, { filename: a.filename, entityType: a.entityType, entityId: a.entityId }, tx);
  });
  // Object bytes are removed on a retention sweep; soft-deleted files are unreachable meanwhile.
}
