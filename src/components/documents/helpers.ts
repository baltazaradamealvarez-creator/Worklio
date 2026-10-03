import type { EditorInitial, EditorLine, EditorOption } from "./editor";
import { blankLine, newKey } from "./editor";
import { centsToInput } from "@/lib/money";

type DbLine = { pricebookItemId: string | null; kind: string; name: string; description: string | null; quantity: { toString(): string }; unitPriceCents: number; discountType: "NONE" | "PERCENT" | "FIXED"; discountValue: number; taxable: boolean };

export const toEditorLine = (l: DbLine): EditorLine => ({
  key: newKey(), pricebookItemId: l.pricebookItemId, kind: l.kind, name: l.name, description: l.description ?? "", quantity: l.quantity.toString().replace(/\.00$/, ""), unitPrice: centsToInput(l.unitPriceCents),
  discountType: l.discountType, discountValue: l.discountType === "PERCENT" ? String(l.discountValue / 100) : l.discountType === "FIXED" ? centsToInput(l.discountValue) : "", taxable: l.taxable,
});

export const discountToInput = (t: "NONE" | "PERCENT" | "FIXED", v: number) => (t === "PERCENT" ? String(v / 100) : t === "FIXED" ? centsToInput(v) : "");

export const emptyOption = (name = "Option 1"): EditorOption => ({ key: newKey(), name, description: "", isRecommended: false, lines: [blankLine()] });

export const dateInput = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");
export type { EditorInitial };
