import { FField } from "@/components/ui/client";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/primitives";
import { centsToInput } from "@/lib/money";
import { humanize } from "@/lib/format";

type I = Partial<{ categoryId: string | null; kind: string; sku: string | null; name: string; description: string | null; unit: string; costCents: number; priceCents: number; taxable: boolean; isActive: boolean; notes: string | null }>;

export function PricebookFields({ i = {}, categories, canCost }: { i?: I; categories: { id: string; name: string }[]; canCost: boolean }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <FField label="Name" name="name" required className="sm:col-span-2"><Input name="name" defaultValue={i.name ?? ""} required /></FField>
        <FField label="SKU" name="sku"><Input name="sku" defaultValue={i.sku ?? ""} /></FField>
        <FField label="Category" name="categoryId"><Select name="categoryId" defaultValue={i.categoryId ?? ""}><option value="">Uncategorised</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></FField>
        <FField label="Type" name="kind"><Select name="kind" defaultValue={i.kind ?? "SERVICE"}>{["SERVICE", "LABOR", "MATERIAL", "EQUIPMENT", "DISCOUNT", "OTHER"].map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</Select></FField>
        <FField label="Unit" name="unit"><Input name="unit" defaultValue={i.unit ?? "each"} /></FField>
        <FField label="Customer price ($)" name="price" required><Input name="price" inputMode="decimal" defaultValue={i.priceCents != null ? centsToInput(i.priceCents) : ""} required /></FField>
        {canCost ? <FField label="Internal cost ($)" name="cost" hint="Never shown to customers"><Input name="cost" inputMode="decimal" defaultValue={i.costCents != null ? centsToInput(i.costCents) : "0.00"} /></FField> : <input type="hidden" name="cost" value="0" />}
      </div>
      <FField label="Description" name="description"><Textarea name="description" rows={2} defaultValue={i.description ?? ""} /></FField>
      <FField label="Internal notes" name="notes"><Textarea name="notes" rows={2} defaultValue={i.notes ?? ""} /></FField>
      <div className="flex gap-6"><Checkbox name="taxable" defaultChecked={i.taxable ?? true} label="Taxable" /><Checkbox name="isActive" defaultChecked={i.isActive ?? true} label="Active" /></div>
    </div>
  );
}
