"use server";

import { requireCtx } from "@/server/auth/server";
import { listCustomerOptions, getCustomer } from "@/server/domain/customers";
import { listCustomerEquipment } from "@/server/domain/equipment";
import { searchPricebook } from "@/server/domain/pricebook";
import { formatAddress } from "@/lib/format";

export async function customerSearchAction(q: string) {
  return listCustomerOptions(await requireCtx(), q.trim().slice(0, 60), 12);
}

export async function customerLocationsAction(customerId: string) {
  const ctx = await requireCtx();
  const c = await getCustomer(ctx, customerId);
  return { taxExempt: c.taxExempt, locations: c.locations.map((l) => ({ id: l.id, name: l.name, address: formatAddress(l), isPrimary: l.isPrimary })) };
}

export async function locationEquipmentAction(customerId: string, locationId: string) {
  const ctx = await requireCtx();
  const eq = await listCustomerEquipment(ctx, customerId);
  return eq.filter((e) => e.locationId === locationId).map((e) => ({ id: e.id, label: [e.manufacturer, e.model].filter(Boolean).join(" ") || e.type, type: e.type }));
}

export async function pricebookSearchAction(q: string) {
  const ctx = await requireCtx();
  const items = await searchPricebook(ctx, q.trim().slice(0, 60), 12);
  return items.map((i) => ({ id: i.id, name: i.name, sku: i.sku, kind: i.kind, priceCents: i.priceCents, costCents: i.costCents, taxable: i.taxable, description: i.description, unit: i.unit, category: i.category?.name ?? null }));
}
