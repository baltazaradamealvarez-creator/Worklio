import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { can, requirePermission, type Ctx } from "@/server/auth/context";
import { conflict, notFound } from "@/server/errors";
import { bool, cents, optId, optStr, parseInput, str } from "@/lib/validation";
import { skipTake, toPage, type ListParams } from "./list";
import { audit } from "./shared";

const KINDS = ["SERVICE", "LABOR", "MATERIAL", "EQUIPMENT", "DISCOUNT", "OTHER"] as const;

const itemSchema = z.object({
  categoryId: optId,
  kind: z.enum(KINDS).default("SERVICE"),
  sku: optStr(60),
  name: str(160),
  description: optStr(2000),
  unit: str(20).default("each"),
  cost: cents,
  price: cents,
  taxable: bool.optional(),
  isActive: bool.optional(),
  notes: optStr(2000),
});

type ItemRow = { costCents: number; [k: string]: unknown };

/** Internal costs are only visible to users who may see margins. */
export function maskCost<T extends ItemRow>(ctx: Pick<Ctx, "permissions">, item: T): T {
  return can(ctx, "pricebook.view_costs") ? item : { ...item, costCents: 0 };
}

export async function listPricebook(ctx: Ctx, p: ListParams) {
  requirePermission(ctx, "pricebook.view");
  const and: Prisma.PricebookItemWhereInput[] = [{ deletedAt: null }];
  if (p.q) and.push({ OR: [{ name: { contains: p.q, mode: "insensitive" } }, { sku: { contains: p.q, mode: "insensitive" } }, { description: { contains: p.q, mode: "insensitive" } }] });
  if (p.filters.category) and.push({ categoryId: p.filters.category });
  if (p.filters.kind && (KINDS as readonly string[]).includes(p.filters.kind)) and.push({ kind: p.filters.kind as (typeof KINDS)[number] });
  if (p.filters.active === "0") and.push({ isActive: false });
  else if (p.filters.active !== "all") and.push({ isActive: true });
  const where = { AND: and };
  const orderBy: Prisma.PricebookItemOrderByWithRelationInput =
    p.sort === "price" ? { priceCents: p.dir } : p.sort === "sku" ? { sku: p.dir } : p.sort === "category" ? { category: { name: p.dir } } : { name: p.dir };
  const [rows, total] = await Promise.all([
    ctx.db.pricebookItem.findMany({ where, orderBy: [orderBy, { id: "asc" }], ...skipTake(p), include: { category: { select: { id: true, name: true } } } }),
    ctx.db.pricebookItem.count({ where }),
  ]);
  return toPage(rows.map((r) => maskCost(ctx, r)), total, p);
}

/** Typeahead for the quote/invoice/job line pickers. */
export async function searchPricebook(ctx: Ctx, q: string, limit = 15) {
  requirePermission(ctx, "pricebook.view");
  const rows = await ctx.db.pricebookItem.findMany({
    where: { deletedAt: null, isActive: true, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }] } : {}) },
    orderBy: { name: "asc" },
    take: limit,
    include: { category: { select: { name: true } } },
  });
  return rows.map((r) => maskCost(ctx, r));
}

export async function getPricebookItem(ctx: Ctx, id: string) {
  requirePermission(ctx, "pricebook.view");
  const item = await ctx.db.pricebookItem.findFirst({ where: { id, deletedAt: null }, include: { category: true } });
  if (!item) throw notFound("Pricebook item");
  return maskCost(ctx, item);
}

export async function listCategories(ctx: Pick<Ctx, "db">) {
  return ctx.db.pricebookCategory.findMany({ orderBy: [{ position: "asc" }, { name: "asc" }], include: { _count: { select: { items: { where: { deletedAt: null } } } } } });
}

async function assertCategory(ctx: Ctx, id?: string | null) {
  if (id && !(await ctx.db.pricebookCategory.findFirst({ where: { id } }))) throw notFound("Category");
}

export async function savePricebookItem(ctx: Ctx, id: string | null, raw: unknown) {
  requirePermission(ctx, "pricebook.manage");
  const input = parseInput(itemSchema, raw);
  await assertCategory(ctx, input.categoryId);
  if (input.sku) {
    const dup = await ctx.db.pricebookItem.findFirst({ where: { sku: input.sku, deletedAt: null, ...(id ? { id: { not: id } } : {}) } });
    if (dup) throw conflict(`SKU ${input.sku} is already used by "${dup.name}".`);
  }
  const data = {
    categoryId: input.categoryId ?? null,
    kind: input.kind,
    sku: input.sku ?? null,
    name: input.name,
    description: input.description ?? null,
    unit: input.unit,
    costCents: can(ctx, "pricebook.view_costs") ? input.cost : undefined,
    priceCents: input.price,
    taxable: input.taxable ?? false,
    isActive: input.isActive ?? true,
    notes: input.notes ?? null,
  };
  return ctx.db.tx(async (tx) => {
    let item;
    if (id) {
      if (!(await tx.pricebookItem.findFirst({ where: { id, deletedAt: null } }))) throw notFound("Pricebook item");
      item = await tx.pricebookItem.update({ where: { id }, data });
    } else {
      item = await tx.pricebookItem.create({ data: { tenantId: ctx.tenantId, ...data, costCents: data.costCents ?? 0 } });
    }
    await audit(ctx, id ? "pricebook.updated" : "pricebook.created", "PricebookItem", item.id, { name: item.name, price: item.priceCents }, tx);
    return item;
  });
}

export async function archivePricebookItem(ctx: Ctx, id: string) {
  requirePermission(ctx, "pricebook.manage");
  const r = await ctx.db.pricebookItem.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date(), isActive: false } });
  if (r.count === 0) throw notFound("Pricebook item");
  await audit(ctx, "pricebook.archived", "PricebookItem", id);
}

const categorySchema = z.object({ name: str(80), kind: z.string().trim().max(20).default("OTHER") });

export async function saveCategory(ctx: Ctx, id: string | null, raw: unknown) {
  requirePermission(ctx, "pricebook.manage");
  const input = parseInput(categorySchema, raw);
  const dup = await ctx.db.pricebookCategory.findFirst({ where: { name: { equals: input.name, mode: "insensitive" }, ...(id ? { id: { not: id } } : {}) } });
  if (dup) throw conflict("A category with that name already exists.");
  if (id) {
    if (!(await ctx.db.pricebookCategory.findFirst({ where: { id } }))) throw notFound("Category");
    await ctx.db.pricebookCategory.update({ where: { id }, data: { name: input.name, kind: input.kind } });
  }
  else {
    const count = await ctx.db.pricebookCategory.count();
    await ctx.db.pricebookCategory.create({ data: { tenantId: ctx.tenantId, name: input.name, kind: input.kind, position: count } });
  }
}

export async function deleteCategory(ctx: Ctx, id: string) {
  requirePermission(ctx, "pricebook.manage");
  const n = await ctx.db.pricebookItem.count({ where: { categoryId: id, deletedAt: null } });
  if (n > 0) throw conflict("Move or archive the items in this category first.");
  await ctx.db.pricebookCategory.deleteMany({ where: { id } });
}
