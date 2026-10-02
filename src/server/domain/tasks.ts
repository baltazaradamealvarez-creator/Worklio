import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { can, requirePermission, type Ctx } from "@/server/auth/context";
import { forbidden, notFound } from "@/server/errors";
import { optDateTime, optId, optStr, parseInput, str } from "@/lib/validation";
import { skipTake, toPage, type ListParams } from "./list";
import { audit, notifyUsers } from "./shared";

const taskSchema = z.object({
  title: str(200),
  description: optStr(4000),
  dueAt: optDateTime,
  priority: z.enum(["LOW", "NORMAL", "HIGH", "EMERGENCY"]).default("NORMAL"),
  assigneeUserId: optId,
  customerId: optId,
  jobId: optId,
  quoteId: optId,
  invoiceId: optId,
  status: z.enum(["OPEN", "IN_PROGRESS", "DONE", "CANCELLED"]).default("OPEN"),
});

async function assertLinks(ctx: Ctx, i: z.output<typeof taskSchema>) {
  const checks = await Promise.all([
    i.customerId ? ctx.db.customer.findFirst({ where: { id: i.customerId }, select: { id: true } }) : true,
    i.jobId ? ctx.db.job.findFirst({ where: { id: i.jobId }, select: { id: true } }) : true,
    i.quoteId ? ctx.db.quote.findFirst({ where: { id: i.quoteId }, select: { id: true } }) : true,
    i.invoiceId ? ctx.db.invoice.findFirst({ where: { id: i.invoiceId }, select: { id: true } }) : true,
    i.assigneeUserId ? ctx.db.membership.findFirst({ where: { userId: i.assigneeUserId, status: "ACTIVE" }, select: { id: true } }) : true,
  ]);
  if (checks.some((c) => !c)) throw notFound("Linked record");
}

export async function createTask(ctx: Ctx, raw: unknown) {
  requirePermission(ctx, "tasks.manage");
  const input = parseInput(taskSchema, raw);
  await assertLinks(ctx, input);
  return ctx.db.tx(async (tx) => {
    const t = await tx.task.create({
      data: {
        tenantId: ctx.tenantId, title: input.title, description: input.description ?? null, dueAt: input.dueAt ?? null, priority: input.priority, status: input.status,
        assigneeUserId: input.assigneeUserId ?? ctx.userId, customerId: input.customerId ?? null, jobId: input.jobId ?? null, quoteId: input.quoteId ?? null, invoiceId: input.invoiceId ?? null, createdById: ctx.userId,
      },
    });
    if (t.assigneeUserId && t.assigneeUserId !== ctx.userId) {
      await notifyUsers(tx, ctx.tenantId, [t.assigneeUserId], { type: "TASK_ASSIGNED", title: `New task: ${t.title}`, body: `Assigned by ${ctx.userName}`, href: `/tasks`, entityType: "TASK", entityId: t.id });
    }
    await audit(ctx, "task.created", "Task", t.id, { title: t.title }, tx);
    return t;
  });
}

export async function updateTask(ctx: Ctx, id: string, raw: unknown) {
  requirePermission(ctx, "tasks.view");
  const input = parseInput(taskSchema, raw);
  const t = await ctx.db.task.findFirst({ where: { id } });
  if (!t) throw notFound("Task");
  const mine = t.assigneeUserId === ctx.userId || t.createdById === ctx.userId;
  if (!mine && !can(ctx, "tasks.manage")) throw forbidden();
  await assertLinks(ctx, input);
  return ctx.db.task.update({
    where: { id },
    data: {
      title: input.title, description: input.description ?? null, dueAt: input.dueAt ?? null, priority: input.priority, status: input.status,
      assigneeUserId: input.assigneeUserId ?? null, customerId: input.customerId ?? null, jobId: input.jobId ?? null, quoteId: input.quoteId ?? null, invoiceId: input.invoiceId ?? null,
      completedAt: input.status === "DONE" ? (t.completedAt ?? new Date()) : null,
    },
  });
}

export async function setTaskStatus(ctx: Ctx, id: string, status: "OPEN" | "IN_PROGRESS" | "DONE" | "CANCELLED") {
  requirePermission(ctx, "tasks.view");
  const t = await ctx.db.task.findFirst({ where: { id } });
  if (!t) throw notFound("Task");
  if (t.assigneeUserId !== ctx.userId && t.createdById !== ctx.userId && !can(ctx, "tasks.manage")) throw forbidden();
  await ctx.db.task.update({ where: { id }, data: { status, completedAt: status === "DONE" ? new Date() : null } });
}

export async function deleteTask(ctx: Ctx, id: string) {
  requirePermission(ctx, "tasks.manage");
  await ctx.db.task.deleteMany({ where: { id } });
}

export async function listTasks(ctx: Ctx, p: ListParams) {
  requirePermission(ctx, "tasks.view");
  const and: Prisma.TaskWhereInput[] = [];
  // Users without tasks.manage see only their own tasks.
  if (!can(ctx, "tasks.manage")) and.push({ OR: [{ assigneeUserId: ctx.userId }, { createdById: ctx.userId }] });
  const f = p.filters;
  if (p.q) and.push({ OR: [{ title: { contains: p.q, mode: "insensitive" } }, { description: { contains: p.q, mode: "insensitive" } }] });
  if (f.assignee === "me") and.push({ assigneeUserId: ctx.userId });
  else if (f.assignee) and.push({ assigneeUserId: f.assignee });
  if (f.status === "open" || !f.status) and.push({ status: { in: ["OPEN", "IN_PROGRESS"] } });
  else if (f.status === "done") and.push({ status: "DONE" });
  else if (f.status === "overdue") and.push({ status: { in: ["OPEN", "IN_PROGRESS"] }, dueAt: { lt: new Date() } });
  if (f.customer) and.push({ customerId: f.customer });
  const where = { AND: and };
  const [rows, total] = await Promise.all([
    ctx.db.task.findMany({ where, orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }], ...skipTake(p), include: { customer: { select: { id: true, displayName: true } }, job: { select: { id: true, number: true } }, quote: { select: { id: true, number: true } }, invoice: { select: { id: true, number: true } } } }),
    ctx.db.task.count({ where }),
  ]);
  return toPage(rows, total, p);
}

export async function listCustomerTasks(ctx: Ctx, customerId: string) {
  requirePermission(ctx, "tasks.view");
  return ctx.db.task.findMany({ where: { customerId, status: { in: ["OPEN", "IN_PROGRESS"] } }, orderBy: { dueAt: { sort: "asc", nulls: "last" } }, take: 20 });
}
