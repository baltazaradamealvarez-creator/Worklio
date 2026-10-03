import { FField } from "@/components/ui/client";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/primitives";
import { bpToPercentInput } from "@/lib/money";

type C = Partial<{
  type: string; status: string; firstName: string | null; lastName: string | null; companyName: string | null; phone: string | null; phoneAlt: string | null; email: string | null; preferredContact: string; preferredLanguage: string;
  billingLine1: string | null; billingLine2: string | null; billingCity: string | null; billingState: string | null; billingPostalCode: string | null; referralSource: string | null; tags: string[]; taxExempt: boolean; taxExemptReason: string | null; accountNotes: string | null; internalNotes: string | null;
}>;

export function CustomerFields({ c = {}, prefix = "", showInternal = true }: { c?: C; prefix?: string; showInternal?: boolean }) {
  const n = (k: string) => `${prefix}${k}`;
  return (
    <div className="space-y-6">
      <fieldset className="space-y-4">
        <legend className="mb-1 text-[13px] font-semibold">Identity</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <FField label="Customer type" name={n("type")}>
            <Select name={n("type")} defaultValue={c.type ?? "RESIDENTIAL"}><option value="RESIDENTIAL">Residential</option><option value="COMMERCIAL">Commercial</option></Select>
          </FField>
          <FField label="Status" name={n("status")}>
            <Select name={n("status")} defaultValue={c.status ?? "ACTIVE"}><option value="ACTIVE">Active</option><option value="PROSPECT">Prospect</option><option value="INACTIVE">Inactive</option><option value="DO_NOT_SERVICE">Do not service</option></Select>
          </FField>
          <FField label="Referral source" name={n("referralSource")}><Input name={n("referralSource")} defaultValue={c.referralSource ?? ""} placeholder="Google, referral, yard sign…" /></FField>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <FField label="First name" name={n("firstName")}><Input name={n("firstName")} defaultValue={c.firstName ?? ""} autoComplete="off" /></FField>
          <FField label="Last name" name={n("lastName")}><Input name={n("lastName")} defaultValue={c.lastName ?? ""} autoComplete="off" /></FField>
          <FField label="Company name" name={n("companyName")} hint="Required for commercial customers"><Input name={n("companyName")} defaultValue={c.companyName ?? ""} autoComplete="off" /></FField>
        </div>
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="mb-1 text-[13px] font-semibold">Contact</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <FField label="Phone" name={n("phone")}><Input name={n("phone")} type="tel" defaultValue={c.phone ?? ""} placeholder="(214) 555-0142" /></FField>
          <FField label="Alternate phone" name={n("phoneAlt")}><Input name={n("phoneAlt")} type="tel" defaultValue={c.phoneAlt ?? ""} /></FField>
          <FField label="Email" name={n("email")}><Input name={n("email")} type="email" defaultValue={c.email ?? ""} /></FField>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <FField label="Preferred contact method" name={n("preferredContact")}>
            <Select name={n("preferredContact")} defaultValue={c.preferredContact ?? "PHONE"}><option value="PHONE">Phone call</option><option value="SMS">Text message</option><option value="EMAIL">Email</option></Select>
          </FField>
          <FField label="Preferred language" name={n("preferredLanguage")}>
            <Select name={n("preferredLanguage")} defaultValue={c.preferredLanguage ?? "en"}><option value="en">English</option><option value="es">Spanish</option><option value="vi">Vietnamese</option><option value="zh">Chinese</option><option value="other">Other</option></Select>
          </FField>
          <FField label="Tags" name={n("tags")} hint="Comma-separated"><Input name={n("tags")} defaultValue={(c.tags ?? []).join(", ")} placeholder="VIP, Senior, Landlord" /></FField>
        </div>
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="mb-1 text-[13px] font-semibold">Billing address</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <FField label="Street" name={n("billingLine1")}><Input name={n("billingLine1")} defaultValue={c.billingLine1 ?? ""} /></FField>
          <FField label="Apt / suite" name={n("billingLine2")}><Input name={n("billingLine2")} defaultValue={c.billingLine2 ?? ""} /></FField>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <FField label="City" name={n("billingCity")}><Input name={n("billingCity")} defaultValue={c.billingCity ?? ""} /></FField>
          <FField label="State" name={n("billingState")}><Input name={n("billingState")} defaultValue={c.billingState ?? ""} /></FField>
          <FField label="ZIP" name={n("billingPostalCode")}><Input name={n("billingPostalCode")} defaultValue={c.billingPostalCode ?? ""} /></FField>
        </div>
        <p className="text-xs text-fg-3">Leave blank to bill the service address.</p>
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="mb-1 text-[13px] font-semibold">Account</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Checkbox name={n("taxExempt")} defaultChecked={c.taxExempt} label="Tax exempt" /><FField label="Exemption reason / certificate #" name={n("taxExemptReason")}><Input name={n("taxExemptReason")} defaultValue={c.taxExemptReason ?? ""} /></FField></div>
          <FField label="Account notes" name={n("accountNotes")} hint="Visible on the customer record"><Textarea name={n("accountNotes")} defaultValue={c.accountNotes ?? ""} rows={3} /></FField>
        </div>
        {showInternal && <FField label="Internal notes" name={n("internalNotes")} hint="Staff with edit access only"><Textarea name={n("internalNotes")} defaultValue={c.internalNotes ?? ""} rows={2} /></FField>}
      </fieldset>
    </div>
  );
}

type L = Partial<{ name: string; addressLine1: string; addressLine2: string | null; city: string; state: string; postalCode: string; isPrimary: boolean; billToCustomer: boolean; gateInstructions: string | null; parkingInstructions: string | null; accessCodes: string | null; onSiteContactName: string | null; onSiteContactPhone: string | null; notes: string | null }>;

export function LocationFields({ l = {}, prefix = "", canSeeCodes = true }: { l?: L; prefix?: string; canSeeCodes?: boolean }) {
  const n = (k: string) => `${prefix}${k}`;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FField label="Property name" name={n("name")} required><Input name={n("name")} defaultValue={l.name ?? "Home"} placeholder="Home, Main office, Unit 4B…" required /></FField>
        <FField label="Street address" name={n("addressLine1")} required><Input name={n("addressLine1")} defaultValue={l.addressLine1 ?? ""} required autoComplete="off" /></FField>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <FField label="Apt / suite" name={n("addressLine2")}><Input name={n("addressLine2")} defaultValue={l.addressLine2 ?? ""} /></FField>
        <FField label="City" name={n("city")} required><Input name={n("city")} defaultValue={l.city ?? ""} required /></FField>
        <FField label="State" name={n("state")} required><Input name={n("state")} defaultValue={l.state ?? "TX"} required maxLength={40} /></FField>
        <FField label="ZIP" name={n("postalCode")} required><Input name={n("postalCode")} defaultValue={l.postalCode ?? ""} required /></FField>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FField label="Gate / access instructions" name={n("gateInstructions")}><Textarea name={n("gateInstructions")} defaultValue={l.gateInstructions ?? ""} rows={2} /></FField>
        <FField label="Parking instructions" name={n("parkingInstructions")}><Textarea name={n("parkingInstructions")} defaultValue={l.parkingInstructions ?? ""} rows={2} /></FField>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {canSeeCodes && <FField label="Access codes" name={n("accessCodes")} hint="Shown only to staff with access-code permission"><Input name={n("accessCodes")} defaultValue={l.accessCodes ?? ""} /></FField>}
        <FField label="On-site contact" name={n("onSiteContactName")}><Input name={n("onSiteContactName")} defaultValue={l.onSiteContactName ?? ""} /></FField>
        <FField label="On-site contact phone" name={n("onSiteContactPhone")}><Input name={n("onSiteContactPhone")} type="tel" defaultValue={l.onSiteContactPhone ?? ""} /></FField>
      </div>
      <FField label="Notes" name={n("notes")}><Textarea name={n("notes")} defaultValue={l.notes ?? ""} rows={2} /></FField>
      <div className="flex gap-6"><Checkbox name={n("isPrimary")} defaultChecked={l.isPrimary} label="Primary location" /><Checkbox name={n("billToCustomer")} defaultChecked={l.billToCustomer ?? true} label="Bill to customer" /></div>
    </div>
  );
}

void bpToPercentInput;
