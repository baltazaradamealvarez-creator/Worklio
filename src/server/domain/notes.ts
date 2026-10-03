import type { EntityType, NoteType, Prisma } from "@prisma/client";
import { z } from "zod";
import { can, requirePermission, type Ctx } from "@/server/auth/context";
import { forbidden, notFound } from "@/server/errors";
import { bool, parseInput, str } from "@/lib/validation";
import { isFieldOnly, resolveEntity } from "./entity-access";
import { audit, notifyUsers, recordActivity } from "./shared";

const NOTE_TYPES = ["GENERAL", "TECHNICIAN", "BILLING", "CUSTOMER_SERVICE", "SALES", "INTERNAL", "WARNING", "ACCESS"] as const;
const NOTE_ENTITIES = ["CUSTOMER", "LOCATION", "EQUIPMENT", "LEAD", "JOB", "QUOTE", "INVOICE", "AGREEMENT"] as const;

const noteSchema = z.object({
  entityType: z.enum(NOTE_ENTITIES),
  entityId: str(40),
  type: z.enum(NOTE_TYPES).default("GENERAL"),
  body: str(10_000),
  isPinned: bool.optional(),
  isPrivate: bool.optional(),
});

/** Mentions are stored inline as `@[Display Name](user:<userId>)`. */
const MENTION_RE = /@\[([^\]]{1,80})\]\(user:([A-Za-z0-9_-]{1,40})\)/g;

export function extractMentionIds(body: string): string[] {
  return [...new Set([...body.matchAll(MENTION_RE)].map((m) => m[2]!))];
}

/** Note categories a field-only user (technician) may read: no billing or sales commentary. */
function typeFilter(ctx: Ctx): Prisma.NoteWhereInput {
  if (!isFieldOnly(ctx)) return {};
  return { type: { in: ["GENERAL", "TECHNICIAN", "WARNING", "ACCESS", "CUSTOMER_SERVICE"] } };
}

function privacyFilter(ctx: Ctx): Prisma.NoteWhereInput {
  if (can(ctx, "notes.view_private")) return {};
  return { OR: [{ isPrivate: false }, { authorId: ctx.userId }] };
}

async function validMentions(ctx: Ctx, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const members = await ctx.db.membership.findMany({ where: { userId: { in: ids }, status: "ACTIVE" }, select: { userId: true } });
  return members.map((m) => m.userId);
}

export async function addNote(ctx: Ctx, raw: unknown) {
  requirePermission(ctx, "notes.create");
  const input = parseInput(noteSchema, raw);
  const entity = await resolveEntity(ctx, input.entityType, input.entityId);
  if (input.isPinned && !can(ctx, "notes.manage")) throw forbidden("You don't have permission to pin notes.");
  if (input.isPrivate && !can(ctx, "notes.view_private")) {
    // Anyone may mark their own note private; it just limits who can read it.
  }
  const mentions = await validMentions(ctx, extractMentionIds(input.body));
  return ctx.db.tx(async (tx) => {
    const note = await tx.note.create({
      data: {
        tenantId: ctx.tenantId,
        entityType: input.entityType,
        entityId: input.entityId,
        customerId: entity.customerId,
        type: input.type,
        body: input.body,
        isPinned: input.isPinned ?? false,
        isPrivate: input.isPrivate ?? false,
        mentionedUserIds: mentions,
        authorId: ctx.userId,
        authorName: ctx.userName,
      },
    });
    if (!input.isPrivate) {
      await recordActivity(tx, ctx.tenantId, ctx, {
        customerId: entity.customerId,
        entityType: input.entityType,
        entityId: input.entityId,
        type: "note.added",
        summary: `Added a ${input.type.toLowerCase().replace("_", " ")} note${input.entityType === "CUSTOMER" ? "" : ` on ${entity.label}`}`,
        metadata: { noteId: note.id },
      });
    }
    await notifyUsers(tx, ctx.tenantId, mentions.filter((u) => u !== ctx.userId), {
      type: "MENTION",
      title: `${ctx.userName} mentioned you in a note`,
      body: input.body.replace(MENTION_RE, "@$1").slice(0, 140),
      href: noteHref(input.entityType, input.entityId, entity.customerId),
      entityType: input.entityType,
      entityId: input.entityId,
    });
    return note;
  });
}

export function noteHref(type: EntityType, id: string, customerId: string | null): string {
  switch (type) {
    case "CUSTOMER": return `/customers/${id}?tab=notes`;
    case "JOB": return `/jobs/${id}`;
    case "QUOTE": return `/quotes/${id}`;
    case "INVOICE": return `/invoices/${id}`;
    case "EQUIPMENT": return customerId ? `/customers/${customerId}?tab=equipment` : "/equipment";
    case "LOCATION": return customerId ? `/customers/${customerId}?tab=locations` : "/customers";
    case "AGREEMENT": return `/maintenance/${id}`;
    case "LEAD": return `/leads/${id}`;
    default: return "/";
  }
}

export async function listNotes(ctx: Ctx, entityType: EntityType, entityId: string, opts: { type?: NoteType } = {}) {
  requirePermission(ctx, "notes.view");
  await resolveEntity(ctx, entityType, entityId);
  return ctx.db.note.findMany({
    where: { entityType, entityId, deletedAt: null, ...(opts.type ? { type: opts.type } : {}), AND: [typeFilter(ctx), privacyFilter(ctx)] },
    orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
    include: { _count: { select: { revisions: true } } },
  });
}

/** All notes on a customer and its children, for the customer's notes tab. */
export async function listCustomerNotes(ctx: Ctx, customerId: string, opts: { type?: NoteType } = {}) {
  requirePermission(ctx, "notes.view");
  await resolveEntity(ctx, "CUSTOMER", customerId);
  return ctx.db.note.findMany({
    where: { customerId, deletedAt: null, ...(opts.type ? { type: opts.type } : {}), AND: [typeFilter(ctx), privacyFilter(ctx)] },
    orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
    include: { _count: { select: { revisions: true } } },
    take: 300,
  });
}

/** Pinned warnings/access notes a technician should read before arriving at a job. */
export async function pinnedNotesForJob(ctx: Ctx, job: { id: string; customerId: string; locationId: string }) {
  if (!can(ctx, "notes.view")) return [];
  return ctx.db.note.findMany({
    where: {
      deletedAt: null,
      isPinned: true,
      AND: [typeFilter(ctx), privacyFilter(ctx)],
      OR: [
        { entityType: "JOB", entityId: job.id },
        { entityType: "CUSTOMER", entityId: job.customerId },
        { entityType: "LOCATION", entityId: job.locationId },
        { entityType: "EQUIPMENT", customerId: job.customerId },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
}

const editSchema = z.object({
  body: str(10_000),
  type: z.enum(NOTE_TYPES),
  isPrivate: bool.optional(),
});

export async function editNote(ctx: Ctx, noteId: string, raw: unknown) {
  requirePermission(ctx, "notes.view");
  const input = parseInput(editSchema, raw);
  const note = await ctx.db.note.findFirst({ where: { id: noteId, deletedAt: null, AND: [privacyFilter(ctx)] } });
  if (!note) throw notFound("Note");
  if (note.authorId !== ctx.userId && !can(ctx, "notes.manage")) throw forbidden("You can only edit your own notes.");
  await resolveEntity(ctx, note.entityType, note.entityId);
  const mentions = await validMentions(ctx, extractMentionIds(input.body));
  return ctx.db.tx(async (tx) => {
    await tx.noteRevision.create({
      data: { tenantId: ctx.tenantId, noteId: note.id, body: note.body, type: note.type, editorId: ctx.userId, editorName: ctx.userName },
    });
    const updated = await tx.note.update({
      where: { id: note.id },
      data: { body: input.body, type: input.type, isPrivate: input.isPrivate ?? note.isPrivate, mentionedUserIds: mentions, editedAt: new Date() },
    });
    const fresh = mentions.filter((m) => !note.mentionedUserIds.includes(m) && m !== ctx.userId);
    await notifyUsers(tx, ctx.tenantId, fresh, {
      type: "MENTION",
      title: `${ctx.userName} mentioned you in a note`,
      body: input.body.replace(MENTION_RE, "@$1").slice(0, 140),
      href: noteHref(note.entityType, note.entityId, note.customerId),
    });
    return updated;
  });
}

export async function setNotePinned(ctx: Ctx, noteId: string, pinned: boolean) {
  if (!can(ctx, "notes.manage")) throw forbidden("You don't have permission to pin notes.");
  const note = await ctx.db.note.findFirst({ where: { id: noteId, deletedAt: null } });
  if (!note) throw notFound("Note");
  await resolveEntity(ctx, note.entityType, note.entityId);
  await ctx.db.note.update({ where: { id: note.id }, data: { isPinned: pinned } });
}

export async function deleteNote(ctx: Ctx, noteId: string) {
  requirePermission(ctx, "notes.view");
  const note = await ctx.db.note.findFirst({ where: { id: noteId, deletedAt: null } });
  if (!note) throw notFound("Note");
  if (note.authorId !== ctx.userId && !can(ctx, "notes.manage")) throw forbidden("You can only delete your own notes.");
  await ctx.db.tx(async (tx) => {
    await tx.note.update({ where: { id: note.id }, data: { deletedAt: new Date() } });
    await audit(ctx, "note.deleted", "Note", note.id, { entityType: note.entityType, entityId: note.entityId }, tx);
  });
}

export async function noteHistory(ctx: Ctx, noteId: string) {
  requirePermission(ctx, "notes.view");
  const note = await ctx.db.note.findFirst({ where: { id: noteId, deletedAt: null, AND: [privacyFilter(ctx)] } });
  if (!note) throw notFound("Note");
  await resolveEntity(ctx, note.entityType, note.entityId);
  return ctx.db.noteRevision.findMany({ where: { noteId }, orderBy: { createdAt: "desc" } });
}

/** People who can be @mentioned: active employees that have a login in this company. */
export async function listMentionable(ctx: Ctx) {
  const rows = await ctx.db.employee.findMany({ where: { deletedAt: null, membership: { status: "ACTIVE" } }, select: { firstName: true, lastName: true, membership: { select: { userId: true } } }, orderBy: { firstName: "asc" } });
  return rows.filter((r) => r.membership).map((r) => ({ userId: r.membership!.userId, name: `${r.firstName} ${r.lastName}`.trim() }));
}
