import type { ExpenseCategory, PaymentMethod, Prisma } from "@prisma/client";
import { z } from "zod";
import { requirePermission, type Ctx } from "@/server/auth/context";
import { notFound } from "@/server/errors";
import { cents, dateReq, optId, optStr, parseInput, str } from "@/lib/validation";
import { skipTake, toPage, parseDate, type ListParams } from "./list";
import { audit } from "./shared";

export const EXPENSE_CATEGORIES = ["EQUIPMENT", "PARTS", "FUEL", "VEHICLE", "TOOLS", "ADVERTISING", "OFFICE", "SOFTWARE", "SUBCONTRACTORS", "OTHER"] as const;
const METHODS = ["CASH", "CHECK", "CREDIT_CARD", "ACH", "EXTERNAL", "MANUAL", "FINANCING", "OTHER"] as const;

const schema = z.object({
  vendorId: optId,
  category: z.enum(EXPENSE_CATEGORIES),
  amount: cents.refine((v) => v > 0, "Enter an amount greater than zero"),
  expenseDate: dateReq,
  description: str(300),
  paymentMethod: z.enum(METHODS).default("CREDIT_CARD"),
  reference: optStr(100),
  jobId: optId,
  customerId: optId,
});

async function assertLinks(ctx: Ctx, i: z.output<typeof schema>) {
  const r = await Promise.all([
    i.vendorId ? ctx.db.vendor.findFirst({ where: { id: i.vendorId }, select: { id: true } }) : true,
    i.jobId ? ctx.db.job.findFirst({ where: { id: i.jobId }, select: { id: true } }) : true,
    i.customerId ? ctx.db.customer.findFirst({ where: { id: i.customerId }, select: { id: true } }) : true,
  ]);
  if (r.some((x) => !x)) throw notFound("Linked record");
}

export async function saveExpense(ctx: Ctx, id: string | null, raw: unknown) {
  requirePermission(ctx, "expenses.manage");
  const input = parseInput(schema, raw);
  await assertLinks(ctx, input);
  const data = {
    vendorId: input.vendorId ?? null, category: input.category as ExpenseCategory, amountCents: input.amount, expenseDate: input.expenseDate, description: input.description,
    paymentMethod: input.paymentMethod as PaymentMethod, reference: input.reference ?? null, jobId: input.jobId ?? null, customerId: input.customerId ?? null,
  };
  return ctx.db.tx(async (tx) => {
    let e;
    if (id) {
      if (!(await tx.expense.findFirst({ where: { id, deletedAt: null } }))) throw notFound("Expense");
      e = await tx.expense.update({ where: { id }, data });
    } else {
      e = await tx.expense.create({ data: { tenantId: ctx.tenantId, ...data, recordedById: ctx.userId, recordedByName: ctx.userName } });
    }
    await audit(ctx, id ? "expense.updated" : "expense.created", "Expense", e.id, { amount: e.amountCents, category: e.category }, tx);
    return e;
  });
}

export async function deleteExpense(ctx: Ctx, id: string) {
  requirePermission(ctx, "expenses.manage");
  const r = await ctx.db.expense.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } });
  if (r.count === 0) throw notFound("Expense");
  await audit(ctx, "expense.deleted", "Expense", id);
}

export async function listExpenses(ctx: Ctx, p: ListParams) {
  requirePermission(ctx, "expenses.view");
  const and: Prisma.ExpenseWhereInput[] = [{ deletedAt: null }];
  if (p.q) and.push({ OR: [{ description: { contains: p.q, mode: "insensitive" } }, { vendor: { name: { contains: p.q, mode: "insensitive" } } }, { reference: { contains: p.q, mode: "insensitive" } }] });
  const f = p.filters;
  if (f.category && (EXPENSE_CATEGORIES as readonly string[]).includes(f.category)) and.push({ category: f.category as ExpenseCategory });
  if (f.vendor) and.push({ vendorId: f.vendor });
  if (f.job) and.push({ jobId: f.job });
  const from = parseDate(f.from), to = parseDate(f.to);
  if (from) and.push({ expenseDate: { gte: from } });
  if (to) and.push({ expenseDate: { lte: to } });
  const where = { AND: and };
  const orderBy: Prisma.ExpenseOrderByWithRelationInput = p.sort === "amount" ? { amountCents: p.dir } : p.sort === "category" ? { category: p.dir } : { expenseDate: p.dir };
  const [rows, total, sum, byCategory] = await Promise.all([
    ctx.db.expense.findMany({ where, orderBy: [orderBy, { id: "desc" }], ...skipTake(p), include: { vendor: { select: { id: true, name: true } }, job: { select: { id: true, number: true } }, customer: { select: { id: true, displayName: true } } } }),
    ctx.db.expense.count({ where }),
    ctx.db.expense.aggregate({ where, _sum: { amountCents: true } }),
    ctx.db.expense.groupBy({ by: ["category"], where, _sum: { amountCents: true }, orderBy: { _sum: { amountCents: "desc" } } }),
  ]);
  return { ...toPage(rows, total, p), sumCents: sum._sum.amountCents ?? 0, byCategory: byCategory.map((c) => ({ category: c.category, cents: c._sum.amountCents ?? 0 })) };
}

export async function getExpense(ctx: Ctx, id: string) {
  requirePermission(ctx, "expenses.view");
  const e = await ctx.db.expense.findFirst({ where: { id, deletedAt: null }, include: { vendor: true, job: { select: { id: true, number: true } }, customer: { select: { id: true, displayName: true } } } });
  if (!e) throw notFound("Expense");
  return e;
}
