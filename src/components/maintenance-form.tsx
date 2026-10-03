import { CustomerLocationPicker } from "@/components/pickers";
import { FField } from "@/components/ui/client";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/primitives";
import { bpToPercentInput, centsToInput } from "@/lib/money";

type A = Partial<{ name: string; customer: { id: string; displayName: string }; locationId: string; startDate: Date; renewalDate: Date; billingFrequency: string; priceCents: number; includedVisits: number; includedServices: string | null; discountPercentBp: number; autoRenew: boolean; notes: string | null; equipmentIds: string[] }>;
const d = (x?: Date) => (x ? x.toISOString().slice(0, 10) : "");
export const FREQUENCIES: [string, string][] = [["ANNUAL", "Annual"], ["SEMI_ANNUAL", "Semi-annual"], ["QUARTERLY", "Quarterly"], ["MONTHLY", "Monthly"], ["ONE_TIME", "One-time"]];

export function AgreementFields({ a = {}, lock }: { a?: A; lock?: boolean }) {
  return (
    <div className="space-y-4">
      <FField label="Plan name" name="name" required><Input name="name" defaultValue={a.name ?? "Comfort Care Plan"} required /></FField>
      <CustomerLocationPicker equipmentName="equipmentIds" defaultCustomer={a.customer ? { id: a.customer.id, name: a.customer.displayName } : null} defaultLocationId={a.locationId} defaultEquipmentIds={a.equipmentIds} lockCustomer={lock} />
      <div className="grid gap-4 sm:grid-cols-3">
        <FField label="Start date" name="startDate" required><Input name="startDate" type="date" defaultValue={d(a.startDate)} required /></FField>
        <FField label="Renewal date" name="renewalDate" required><Input name="renewalDate" type="date" defaultValue={d(a.renewalDate)} required /></FField>
        <FField label="Billing" name="billingFrequency"><Select name="billingFrequency" defaultValue={a.billingFrequency ?? "ANNUAL"}>{FREQUENCIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></FField>
        <FField label="Price per billing period ($)" name="price" required><Input name="price" inputMode="decimal" defaultValue={a.priceCents != null ? centsToInput(a.priceCents) : ""} required /></FField>
        <FField label="Included visits" name="includedVisits"><Input name="includedVisits" type="number" min={0} max={100} defaultValue={a.includedVisits ?? 2} /></FField>
        <FField label="Member discount (%)" name="discountPercent" hint="Applied to repairs"><Input name="discountPercent" inputMode="decimal" defaultValue={a.discountPercentBp != null ? bpToPercentInput(a.discountPercentBp) : "10"} /></FField>
      </div>
      <FField label="What's included" name="includedServices"><Textarea name="includedServices" rows={3} defaultValue={a.includedServices ?? ""} placeholder="Two seasonal tune-ups, priority scheduling, no overtime fees…" /></FField>
      <FField label="Internal notes" name="notes"><Textarea name="notes" rows={2} defaultValue={a.notes ?? ""} /></FField>
      <Checkbox name="autoRenew" defaultChecked={a.autoRenew ?? false} label="Auto-renew (you'll be reminded before each renewal)" />
    </div>
  );
}
