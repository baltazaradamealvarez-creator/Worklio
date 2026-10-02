import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { requirePermission, type Ctx } from "@/server/auth/context";
import { notFound } from "@/server/errors";
import { optDate, optStr, parseInput, str } from "@/lib/validation";
import { customerScope } from "./entity-access";
import { skipTake, toPage, type ListParams } from "./list";
import { audit, recordActivity } from "./shared";

export const EQUIPMENT_TYPES = [
  "FURNACE", "AIR_CONDITIONER", "HEAT_PUMP", "AIR_HANDLER", "MINI_SPLIT", "ROOFTOP_UNIT", "BOILER", "THERMOSTAT",
  "HUMIDIFIER", "DEHUMIDIFIER", "VENTILATION", "COMMERCIAL", "OTHER",
] as const;
export const CONDITIONS = ["EXCELLENT", "GOOD", "FAIR", "POOR", "NEEDS_REPLACEMENT", "DECOMMISSIONED"] as const;

const decimal = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v),
    z.union([z.string().regex(/^\d{1,3}(\.\d{1,2})?$/, "Enter a number"), z.number()]).nullable().optional().refine((v) => v == null || Number(v) <= max, "Too large"),
  );

const equipmentSchema = z.object({
  customerId: str(40),
  locationId: str(40),
  type: z.enum(EQUIPMENT_TYPES),
  systemType: optStr(80),
  manufacturer: optStr(80),
  model: optStr(80),
  serialNumber: optStr(80),
  unitLocation: optStr(120),
  installDate: optDate,
  manufactureDate: optDate,
  warrantyExpiresAt: optDate,
  laborWarrantyExpiresAt: optDate,
  equipmentWarrantyExpiresAt: optDate,
  refrigerantType: optStr(30),
  capacityTons: decimal(100),
  seer: decimal(100),
  filterSize: optStr(30),
  fuelType: optStr(30),
  condition: z.enum(CONDITIONS).default("GOOD"),
  notes: optStr(4000),
});

function toData(i: z.output<typeof equipmentSchema>) {
  return {
    type: i.type,
    systemType: i.systemType ?? null,
    manufacturer: i.manufacturer ?? null,
    model: i.model ?? null,
    serialNumber: i.serialNumber ?? null,
    unitLocation: i.unitLocation ?? null,
    installDate: i.installDate ?? null,
    manufactureDate: i.manufactureDate ?? null,
    warrantyExpiresAt: i.warrantyExpiresAt ?? null,
    laborWarrantyExpiresAt: i.laborWarrantyExpiresAt ?? null,
    equipmentWarrantyExpiresAt: i.equipmentWarrantyExpiresAt ?? null,
    refrigerantType: i.refrigerantType ?? null,
    capacityTons: i.capacityTons == null ? null : String(i.capacityTons),
    seer: i.seer == null ? null : String(i.seer),
    filterSize: i.filterSize ?? null,
    fuelType: i.fuelType ?? null,
    condition: i.condition,
    notes: i.notes ?? null,
  };
}

async function assertLocation(ctx: Ctx, customerId: string, locationId: string) {
  const loc = await ctx.db.customerLocation.findFirst({ where: { id: locationId, customerId, deletedAt: null, customer: { deletedAt: null, ...customerScope(ctx) } } });
  if (!loc) throw notFound("Location");
  return loc;
}

export async function createEquipment(ctx: Ctx, raw: unknown) {
  requirePermission(ctx, "equipment.manage");
  const input = parseInput(equipmentSchema, raw);
  await assertLocation(ctx, input.customerId, input.locationId);
  return ctx.db.tx(async (tx) => {
    const e = await tx.equipment.create({ data: { tenantId: ctx.tenantId, customerId: input.customerId, locationId: input.locationId, ...toData(input) } });
    const label = [e.manufacturer, e.model].filter(Boolean).join(" ") || e.type.toLowerCase().replace(/_/g, " ");
    await recordActivity(tx, ctx.tenantId, ctx, { customerId: e.customerId, entityType: "EQUIPMENT", entityId: e.id, type: "equipment.added", summary: `Added equipment: ${label}` });
    await audit(ctx, "equipment.created", "Equipment", e.id, { customerId: e.customerId }, tx);
    return e;
  });
}

export async function updateEquipment(ctx: Ctx, id: string, raw: unknown) {
  requirePermission(ctx, "equipment.manage");
  const input = parseInput(equipmentSchema, raw);
  const existing = await ctx.db.equipment.findFirst({ where: { id, deletedAt: null, customer: customerScope(ctx) } });
  if (!existing) throw notFound("Equipment");
  await assertLocation(ctx, existing.customerId, input.locationId);
  return ctx.db.tx(async (tx) => {
    const e = await tx.equipment.update({ where: { id }, data: { locationId: input.locationId, ...toData(input) } });
    await recordActivity(tx, ctx.tenantId, ctx, { customerId: e.customerId, entityType: "EQUIPMENT", entityId: id, type: "equipment.updated", summary: `Updated equipment ${[e.manufacturer, e.model].filter(Boolean).join(" ") || e.type}` });
    await audit(ctx, "equipment.updated", "Equipment", id, undefined, tx);
    return e;
  });
}

export async function archiveEquipment(ctx: Ctx, id: string) {
  requirePermission(ctx, "equipment.manage");
  const e = await ctx.db.equipment.findFirst({ where: { id, deletedAt: null, customer: customerScope(ctx) } });
  if (!e) throw notFound("Equipment");
  await ctx.db.tx(async (tx) => {
    await tx.equipment.update({ where: { id }, data: { deletedAt: new Date(), condition: "DECOMMISSIONED" } });
    await audit(ctx, "equipment.archived", "Equipment", id, undefined, tx);
  });
}

export async function listEquipment(ctx: Ctx, p: ListParams) {
  requirePermission(ctx, "equipment.view");
  const and: Prisma.EquipmentWhereInput[] = [{ deletedAt: null }, { customer: { deletedAt: null, ...customerScope(ctx) } }];
  if (p.q) {
    and.push({
      OR: [
        { serialNumber: { contains: p.q, mode: "insensitive" } },
        { manufacturer: { contains: p.q, mode: "insensitive" } },
        { model: { contains: p.q, mode: "insensitive" } },
        { customer: { displayName: { contains: p.q, mode: "insensitive" } } },
        { location: { addressLine1: { contains: p.q, mode: "insensitive" } } },
      ],
    });
  }
  if (p.filters.type && (EQUIPMENT_TYPES as readonly string[]).includes(p.filters.type)) and.push({ type: p.filters.type as (typeof EQUIPMENT_TYPES)[number] });
  if (p.filters.condition && (CONDITIONS as readonly string[]).includes(p.filters.condition)) and.push({ condition: p.filters.condition as (typeof CONDITIONS)[number] });
  if (p.filters.customer) and.push({ customerId: p.filters.customer });
  if (p.filters.warranty === "expiring") {
    const soon = new Date(Date.now() + 90 * 86_400_000);
    and.push({ OR: [{ warrantyExpiresAt: { gte: new Date(), lte: soon } }, { equipmentWarrantyExpiresAt: { gte: new Date(), lte: soon } }, { laborWarrantyExpiresAt: { gte: new Date(), lte: soon } }] });
  }
  const where = { AND: and };
  const orderBy: Prisma.EquipmentOrderByWithRelationInput =
    p.sort === "installDate" ? { installDate: p.dir } : p.sort === "type" ? { type: p.dir } : p.sort === "customer" ? { customer: { displayName: p.dir } } : { createdAt: p.dir };
  const [rows, total] = await Promise.all([
    ctx.db.equipment.findMany({ where, orderBy, ...skipTake(p), include: { customer: { select: { id: true, displayName: true } }, location: { select: { name: true, addressLine1: true, city: true } } } }),
    ctx.db.equipment.count({ where }),
  ]);
  return toPage(rows, total, p);
}

export async function listCustomerEquipment(ctx: Ctx, customerId: string) {
  requirePermission(ctx, "equipment.view");
  return ctx.db.equipment.findMany({
    where: { customerId, deletedAt: null, customer: customerScope(ctx) },
    orderBy: [{ locationId: "asc" }, { installDate: "desc" }],
    include: { location: { select: { id: true, name: true } } },
  });
}

export async function getEquipment(ctx: Ctx, id: string) {
  requirePermission(ctx, "equipment.view");
  const e = await ctx.db.equipment.findFirst({
    where: { id, customer: customerScope(ctx) },
    include: {
      customer: { select: { id: true, displayName: true } },
      location: true,
      agreementEquipment: { include: { agreement: { select: { id: true, number: true, name: true, status: true, renewalDate: true } } } },
    },
  });
  if (!e) throw notFound("Equipment");
  return e;
}

/** Every job that touched this unit, newest first — the unit's service history. */
export async function equipmentServiceHistory(ctx: Ctx, equipmentId: string) {
  requirePermission(ctx, "equipment.view");
  await getEquipment(ctx, equipmentId);
  const links = await ctx.db.jobEquipment.findMany({
    where: { equipmentId, job: { deletedAt: null } },
    include: {
      job: {
        select: {
          id: true, number: true, title: true, status: true, actualEnd: true, scheduledStart: true, technicianNotes: true,
          jobType: { select: { name: true } },
          assignees: { select: { employee: { select: { firstName: true, lastName: true } } } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return links;
}
