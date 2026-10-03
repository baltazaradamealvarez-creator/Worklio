import { FField } from "@/components/ui/client";
import { Input, Select, Textarea } from "@/components/ui/primitives";
import { centsToInput } from "@/lib/money";

type L = Partial<{ firstName: string | null; lastName: string | null; companyName: string | null; phone: string | null; email: string | null; addressLine1: string | null; addressLine2: string | null; city: string | null; state: string | null; postalCode: string | null; requestedService: string | null; source: string | null; assignedToId: string | null; estimatedValueCents: number; notes: string | null }>;

export function LeadFields({ l = {}, salespeople }: { l?: L; salespeople: { id: string; name: string }[] }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <FField label="First name" name="firstName"><Input name="firstName" defaultValue={l.firstName ?? ""} /></FField>
        <FField label="Last name" name="lastName"><Input name="lastName" defaultValue={l.lastName ?? ""} /></FField>
        <FField label="Company" name="companyName"><Input name="companyName" defaultValue={l.companyName ?? ""} /></FField>
        <FField label="Phone" name="phone"><Input name="phone" type="tel" defaultValue={l.phone ?? ""} /></FField>
        <FField label="Email" name="email"><Input name="email" type="email" defaultValue={l.email ?? ""} /></FField>
        <FField label="Lead source" name="source"><Input name="source" list="lead-sources" defaultValue={l.source ?? ""} placeholder="Google, referral…" /><datalist id="lead-sources">{["Google", "Referral", "Facebook", "Nextdoor", "Yelp", "Yard sign", "Walk-in", "Repeat customer"].map((s) => <option key={s} value={s} />)}</datalist></FField>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FField label="Requested service" name="requestedService"><Input name="requestedService" defaultValue={l.requestedService ?? ""} placeholder="AC replacement, no heat…" /></FField>
        <div className="grid grid-cols-2 gap-4">
          <FField label="Estimated value ($)" name="estimatedValue"><Input name="estimatedValue" inputMode="decimal" defaultValue={l.estimatedValueCents ? centsToInput(l.estimatedValueCents) : ""} placeholder="0.00" /></FField>
          <FField label="Assigned salesperson" name="assignedToId"><Select name="assignedToId" defaultValue={l.assignedToId ?? ""}><option value="">Unassigned</option>{salespeople.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></FField>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <FField label="Street address" name="addressLine1" className="sm:col-span-2"><Input name="addressLine1" defaultValue={l.addressLine1 ?? ""} /></FField>
        <FField label="Apt / suite" name="addressLine2"><Input name="addressLine2" defaultValue={l.addressLine2 ?? ""} /></FField>
        <FField label="City" name="city"><Input name="city" defaultValue={l.city ?? ""} /></FField>
        <FField label="State" name="state"><Input name="state" defaultValue={l.state ?? "TX"} /></FField>
        <FField label="ZIP" name="postalCode"><Input name="postalCode" defaultValue={l.postalCode ?? ""} /></FField>
      </div>
      <FField label="Notes" name="notes"><Textarea name="notes" defaultValue={l.notes ?? ""} rows={3} /></FField>
    </div>
  );
}
