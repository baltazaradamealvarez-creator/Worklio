import type { DiscountType, LineItemKind } from "@prisma/client";
import { z } from "zod";
import type { Ctx } from "@/server/auth/context";
import { computeDocument, type DocumentTotals } from "@/lib/money";
import { AppError, notFound } from "@/server/errors";
import { bool, cents, optCents, optId, optStr, qty, str } from "@/lib/validation";

/** Shared line-item input for quotes and invoices. Money fields are integer cents / basis points. */
export const lineInputSchema = z.object({
  pricebookItemId: optId,
  kind: z.enum(["SERVICE", "LABOR", "MATERIAL", "EQUIPMENT", "DISCOUNT", "OTHER"]).default("SERVICE"),
  name: str(160),
  description: optStr(1000),
  quantity: qty.default("1"),
  unitPrice: cents,
  unitCost: optCents,
  discountType: z.enum(["NONE", "PERCENT", "FIXED"]).default("NONE"),
  discountValue: z.preprocess((v) => (v === "" || v == null ? 0 : Number(v)), z.number().int().min(0).max(100_000_000)).default(0),
  taxable: bool.default(true),
});
export type LineInput = z.output<typeof lineInputSchema>;

export const discountSchema = {
  discountType: z.enum(["NONE", "PERCENT", "FIXED"]).default("NONE"),
  discountValue: z.preprocess((v) => (v === "" || v == null ? 0 : Number(v)), z.number().int().min(0).max(100_000_000)).default(0),
};

export interface PreparedLine {
  position: number;
  kind: LineItemKind;
  pricebookItemId: string | null;
  name: string;
  description: string | null;
  quantity: string;
  unitPriceCents: number;
  unitCostCents: number;
  discountType: DiscountType;
  discountValue: number;
  taxable: boolean;
  totalCents: number;
}

/**
 * Turn client line input into DB rows. Internal costs always come from the pricebook on the
 * server (never from the browser), and every total is recomputed here.
 */
export async function prepareLines(ctx: Ctx, lines: LineInput[]): Promise<PreparedLine[]> {
  const ids = [...new Set(lines.map((l) => l.pricebookItemId).filter((x): x is string => !!x))];
  const items = ids.length ? await ctx.db.pricebookItem.findMany({ where: { id: { in: ids } }, select: { id: true, costCents: true } }) : [];
  if (items.length !== ids.length) throw notFound("Pricebook item");
  const cost = new Map(items.map((i) => [i.id, i.costCents]));
  return lines.map((l, position) => {
    if (l.discountType === "PERCENT" && l.discountValue > 10000) throw new AppError("VALIDATION", "Line discount can't exceed 100%.");
    return {
      position,
      kind: l.kind,
      pricebookItemId: l.pricebookItemId ?? null,
      name: l.name,
      description: l.description ?? null,
      quantity: l.quantity,
      unitPriceCents: l.unitPrice,
      unitCostCents: l.pricebookItemId ? (cost.get(l.pricebookItemId) ?? 0) : 0,
      discountType: l.discountType,
      discountValue: l.discountType === "NONE" ? 0 : l.discountValue,
      taxable: l.taxable,
      totalCents: 0,
    };
  });
}

export interface DocParams {
  taxRateBp: number;
  discountType: DiscountType;
  discountValue: number;
  depositType?: DiscountType;
  depositValue?: number;
  amountPaidCents?: number;
}

/** Compute totals for prepared lines and write each line's net total back onto it. */
export function totalsFor(lines: PreparedLine[], p: DocParams): DocumentTotals {
  const totals = computeDocument({
    lines: lines.map((l) => ({ quantity: l.quantity, unitPriceCents: l.unitPriceCents, unitCostCents: l.unitCostCents, discountType: l.discountType, discountValue: l.discountValue, taxable: l.taxable })),
    taxRateBp: p.taxRateBp,
    discountType: p.discountType,
    discountValue: p.discountValue,
    depositType: p.depositType,
    depositValue: p.depositValue,
    amountPaidCents: p.amountPaidCents,
  });
  lines.forEach((l, i) => {
    l.totalCents = totals.lines[i]!.netCents;
  });
  return totals;
}

export function stripCosts<T extends { unitCostCents: number }>(rows: T[]): T[] {
  return rows.map((r) => ({ ...r, unitCostCents: 0 }));
}
