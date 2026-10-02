import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { can, requirePermission, type Ctx } from "@/server/auth/context";
import type { Db } from "@/server/db";
import { AppError, conflict, invalidState, notFound } from "@/server/errors";
import { toHundredths } from "@/lib/money";
import { bool, cents, intField, optCents, optEmail, optId, optPhone, optStr, parseInput, qty, str } from "@/lib/validation";
import { skipTake, toPage, type ListParams } from "./list";
import { audit, notifyWithPermission } from "./shared";

const hundredthsToString = (h: number) => (h / 100).toFixed(2);

// ─── Consumption (used by jobs) ─────────────────────────────────────────────────────────

/**
 * Decrement stock for materials used on a job. Prefers the technician's truck, then the
 * explicit location, then any location holding enough. Must run inside `ctx.db.tx`.
 */
export async function consumeInventoryTx(
  tx: Db,
  ctx: Ctx,
  input: { itemId: string; locationId: string | null; quantity: string; jobId: string },
): Promise<void> {
  const item = await tx.inventoryItem.findFirst({ where: { id: input.itemId, deletedAt: null } });
  if (!item) throw notFound("Inventory item");
  const need = toHundredths(input.quantity);
  if (need <= 0) throw new AppError("VALIDATION", "Quantity must be positive.");

  const stocks = await tx.inventoryStock.findMany({ where: { itemId: item.id }, include: { location: true } });
  const truck = stocks.find((s) => s.location.employeeId && s.location.employeeId === ctx.employeeId);
  const chosen = (input.locationId ? stocks.find((s) => s.locationId === input.locationId) : null) ?? truck ?? stocks.find((s) => toHundredths(s.quantity.toString()) >= need);
  if (!chosen) throw invalidState(`No stock of ${item.name} is available.`);
  const onHand = toHundredths(chosen.quantity.toString());
  if (onHand < need) throw invalidState(`Only ${hundredthsToString(onHand)} ${item.unit} of ${item.name} on hand at ${chosen.location.name}.`);
  const left = onHand - need;
  await tx.inventoryStock.update({ where: { id: chosen.id }, data: { quantity: hundredthsToString(left) } });
  await tx.inventoryTransaction.create({
    data: { tenantId: ctx.tenantId, itemId: item.id, locationId: chosen.locationId, type: "CONSUME", quantityDelta: hundredthsToString(-need), unitCostCents: item.costCents, jobId: input.jobId, employeeId: ctx.employeeId, note: "Used on job" },
  });
  if (item.reorderThreshold > 0 && left <= item.reorderThreshold * 100) {
    await notifyWithPermission(tx, ctx.tenantId, "inventory.manage", {
      type: "LOW_STOCK", title: `Low stock: ${item.name}`, body: `${hundredthsToString(left)} ${item.unit} left at ${chosen.location.name}`, href: `/inventory/items/${item.id}`,
    });
  }
}

// ─── Items ───────────────────────────────────────────────────────────────────────────

const itemSchema = z.object({
  sku: str(60),
  name: str(160),
  description: optStr(1000),
  kind: z.enum(["MATERIAL", "EQUIPMENT", "OTHER"]).default("MATERIAL"),
  unit: str(20).default("each"),
  vendorId: optId,
  pricebookItemId: optId,
  cost: cents,
  price: cents,
  reorderThreshold: intField.pipe(z.number().min(0)).default(0),
  reorderQuantity: intField.pipe(z.number().min(0)).default(0),
  isActive: bool.optional(),
});

export async function listInventory(ctx: Ctx, p: ListParams) {
  requirePermission(ctx, "inventory.view");
  const and: Prisma.InventoryItemWhereInput[] = [{ deletedAt: null }];
  if (p.q) and.push({ OR: [{ name: { contains: p.q, mode: "insensitive" } }, { sku: { contains: p.q, mode: "insensitive" } }] });
  if (p.filters.vendor) and.push({ vendorId: p.filters.vendor });
  const where = { AND: and };
  const orderBy: Prisma.InventoryItemOrderByWithRelationInput = p.sort === "sku" ? { sku: p.dir } : { name: p.dir };
  const [items, total] = await Promise.all([
    ctx.db.inventoryItem.findMany({ where, orderBy, ...skipTake(p), include: { vendor: { select: { name: true } }, stocks: { include: { location: { select: { name: true, type: true } } } } } }),
    ctx.db.inventoryItem.count({ where }),
  ]);
  let rows = items.map((i) => {
    const onHand = i.stocks.reduce((s, x) => s + toHundredths(x.quantity.toString()), 0) / 100;
    return { ...i, onHand, low: i.reorderThreshold > 0 && onHand <= i.reorderThreshold, costCents: can(ctx, "pricebook.view_costs") ? i.costCents : 0 };
  });
  if (p.filters.stock === "low") rows = rows.filter((r) => r.low);
  return toPage(rows, p.filters.stock === "low" ? rows.length : total, p);
}

export async function getInventoryItem(ctx: Ctx, id: string) {
  requirePermission(ctx, "inventory.view");
  const item = await ctx.db.inventoryItem.findFirst({
    where: { id, deletedAt: null },
    include: {
      vendor: true,
      stocks: { include: { location: true } },
      transactions: { orderBy: { createdAt: "desc" }, take: 50, include: { location: { select: { name: true } }, job: { select: { id: true, number: true } } } },
    },
  });
  if (!item) throw notFound("Inventory item");
  return item;
}

export async function saveInventoryItem(ctx: Ctx, id: string | null, raw: unknown) {
  requirePermission(ctx, "inventory.manage");
  const input = parseInput(itemSchema, raw);
  const dup = await ctx.db.inventoryItem.findFirst({ where: { sku: input.sku, ...(id ? { id: { not: id } } : {}) } });
  if (dup) throw conflict(`SKU ${input.sku} already exists.`);
  if (input.vendorId && !(await ctx.db.vendor.findFirst({ where: { id: input.vendorId } }))) throw notFound("Vendor");
  if (input.pricebookItemId && !(await ctx.db.pricebookItem.findFirst({ where: { id: input.pricebookItemId } }))) throw notFound("Pricebook item");
  if (id && !(await ctx.db.inventoryItem.findFirst({ where: { id, deletedAt: null } }))) throw notFound("Inventory item");
  const data = {
    sku: input.sku, name: input.name, description: input.description ?? null, kind: input.kind, unit: input.unit,
    vendorId: input.vendorId ?? null, pricebookItemId: input.pricebookItemId ?? null, costCents: input.cost, priceCents: input.price,
    reorderThreshold: input.reorderThreshold, reorderQuantity: input.reorderQuantity, isActive: input.isActive ?? true,
  };
  return ctx.db.tx(async (tx) => {
    const item = id ? await tx.inventoryItem.update({ where: { id }, data }) : await tx.inventoryItem.create({ data: { tenantId: ctx.tenantId, ...data } });
    await audit(ctx, id ? "inventory.item_updated" : "inventory.item_created", "InventoryItem", item.id, { sku: item.sku }, tx);
    return item;
  });
}

// ─── Locations & stock movements ──────────────────────────────────────────────────────

export async function listLocations(ctx: Pick<Ctx, "db">) {
  return ctx.db.inventoryLocation.findMany({ where: { isActive: true }, orderBy: [{ type: "asc" }, { name: "asc" }], include: { employee: { select: { firstName: true, lastName: true } } } });
}

const locationSchema = z.object({ name: str(80), type: z.enum(["WAREHOUSE", "TRUCK"]), employeeId: optId });

export async function saveInventoryLocation(ctx: Ctx, id: string | null, raw: unknown) {
  requirePermission(ctx, "inventory.manage");
  const input = parseInput(locationSchema, raw);
  const dup = await ctx.db.inventoryLocation.findFirst({ where: { name: { equals: input.name, mode: "insensitive" }, ...(id ? { id: { not: id } } : {}) } });
  if (dup) throw conflict("A location with that name already exists.");
  const data = { name: input.name, type: input.type, employeeId: input.type === "TRUCK" ? (input.employeeId ?? null) : null };
  if (id && !(await ctx.db.inventoryLocation.findFirst({ where: { id } }))) throw notFound("Location");
  if (input.employeeId && !(await ctx.db.employee.findFirst({ where: { id: input.employeeId, deletedAt: null } }))) throw notFound("Employee");
  if (id) await ctx.db.inventoryLocation.update({ where: { id }, data });
  else await ctx.db.inventoryLocation.create({ data: { tenantId: ctx.tenantId, ...data } });
}

const adjustSchema = z.object({
  itemId: str(40),
  locationId: str(40),
  type: z.enum(["RECEIVE", "ADJUST", "RETURN"]),
  quantity: qty, // RECEIVE/RETURN add; ADJUST sets absolute on-hand
  unitCost: optCents,
  note: optStr(300),
});

export async function adjustStock(ctx: Ctx, raw: unknown) {
  requirePermission(ctx, "inventory.manage");
  const input = parseInput(adjustSchema, raw);
  await ctx.db.tx(async (tx) => {
    const [item, loc] = await Promise.all([tx.inventoryItem.findFirst({ where: { id: input.itemId, deletedAt: null } }), tx.inventoryLocation.findFirst({ where: { id: input.locationId } })]);
    if (!item || !loc) throw notFound("Inventory item or location");
    const stock = await tx.inventoryStock.findFirst({ where: { itemId: item.id, locationId: loc.id } });
    const current = stock ? toHundredths(stock.quantity.toString()) : 0;
    const q = toHundredths(input.quantity);
    const target = input.type === "ADJUST" ? q : current + q;
    if (target < 0) throw invalidState("Stock can't go below zero.");
    if (stock) await tx.inventoryStock.update({ where: { id: stock.id }, data: { quantity: hundredthsToString(target) } });
    else await tx.inventoryStock.create({ data: { tenantId: ctx.tenantId, itemId: item.id, locationId: loc.id, quantity: hundredthsToString(target) } });
    await tx.inventoryTransaction.create({
      data: { tenantId: ctx.tenantId, itemId: item.id, locationId: loc.id, type: input.type, quantityDelta: hundredthsToString(target - current), unitCostCents: input.unitCost ?? item.costCents, employeeId: ctx.employeeId, note: input.note ?? null },
    });
    await audit(ctx, "inventory.adjusted", "InventoryItem", item.id, { type: input.type, location: loc.name, from: current / 100, to: target / 100 }, tx);
  });
}

const transferSchema = z.object({ itemId: str(40), fromLocationId: str(40), toLocationId: str(40), quantity: qty });

export async function transferStock(ctx: Ctx, raw: unknown) {
  requirePermission(ctx, "inventory.manage");
  const input = parseInput(transferSchema, raw);
  if (input.fromLocationId === input.toLocationId) throw new AppError("VALIDATION", "Choose two different locations.");
  await ctx.db.tx(async (tx) => {
    const item = await tx.inventoryItem.findFirst({ where: { id: input.itemId, deletedAt: null } });
    const [from, to] = await Promise.all([tx.inventoryLocation.findFirst({ where: { id: input.fromLocationId } }), tx.inventoryLocation.findFirst({ where: { id: input.toLocationId } })]);
    if (!item || !from || !to) throw notFound("Inventory item or location");
    const q = toHundredths(input.quantity);
    const src = await tx.inventoryStock.findFirst({ where: { itemId: item.id, locationId: from.id } });
    const have = src ? toHundredths(src.quantity.toString()) : 0;
    if (!src || have < q) throw invalidState(`Only ${have / 100} ${item.unit} available at ${from.name}.`);
    await tx.inventoryStock.update({ where: { id: src.id }, data: { quantity: hundredthsToString(have - q) } });
    const dst = await tx.inventoryStock.findFirst({ where: { itemId: item.id, locationId: to.id } });
    if (dst) await tx.inventoryStock.update({ where: { id: dst.id }, data: { quantity: hundredthsToString(toHundredths(dst.quantity.toString()) + q) } });
    else await tx.inventoryStock.create({ data: { tenantId: ctx.tenantId, itemId: item.id, locationId: to.id, quantity: hundredthsToString(q) } });
    await tx.inventoryTransaction.createMany({
      data: [
        { tenantId: ctx.tenantId, itemId: item.id, locationId: from.id, type: "TRANSFER_OUT", quantityDelta: hundredthsToString(-q), employeeId: ctx.employeeId, note: `To ${to.name}` },
        { tenantId: ctx.tenantId, itemId: item.id, locationId: to.id, type: "TRANSFER_IN", quantityDelta: hundredthsToString(q), employeeId: ctx.employeeId, note: `From ${from.name}` },
      ],
    });
  });
}

// ─── Vendors ──────────────────────────────────────────────────────────────────────────

const vendorSchema = z.object({ name: str(120), contactName: optStr(100), email: optEmail, phone: optPhone, website: optStr(200), accountNumber: optStr(60), address: optStr(300), notes: optStr(1000), isActive: bool.optional() });

export async function listVendors(ctx: Ctx) {
  requirePermission(ctx, "inventory.view");
  return ctx.db.vendor.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { items: { where: { deletedAt: null } }, expenses: { where: { deletedAt: null } } } } } });
}

export async function saveVendor(ctx: Ctx, id: string | null, raw: unknown) {
  requirePermission(ctx, "inventory.manage");
  const input = parseInput(vendorSchema, raw);
  const dup = await ctx.db.vendor.findFirst({ where: { name: { equals: input.name, mode: "insensitive" }, ...(id ? { id: { not: id } } : {}) } });
  if (dup) throw conflict("A vendor with that name already exists.");
  if (id && !(await ctx.db.vendor.findFirst({ where: { id } }))) throw notFound("Vendor");
  const data = { name: input.name, contactName: input.contactName ?? null, email: input.email ?? null, phone: input.phone ?? null, website: input.website ?? null, accountNumber: input.accountNumber ?? null, address: input.address ?? null, notes: input.notes ?? null, isActive: input.isActive ?? true };
  if (id) await ctx.db.vendor.update({ where: { id }, data });
  else await ctx.db.vendor.create({ data: { tenantId: ctx.tenantId, ...data } });
}

export async function lowStockItems(ctx: Ctx) {
  requirePermission(ctx, "inventory.view");
  const items = await ctx.db.inventoryItem.findMany({ where: { deletedAt: null, isActive: true, reorderThreshold: { gt: 0 } }, include: { stocks: true } });
  return items
    .map((i) => ({ id: i.id, name: i.name, sku: i.sku, reorderThreshold: i.reorderThreshold, onHand: i.stocks.reduce((s, x) => s + toHundredths(x.quantity.toString()), 0) / 100 }))
    .filter((i) => i.onHand <= i.reorderThreshold);
}
