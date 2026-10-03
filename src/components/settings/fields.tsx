import { FField } from "@/components/ui/client";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/primitives";
import { bpToPercentInput } from "@/lib/money";
import { PAYMENT_METHODS } from "@/components/documents/invoice-actions";
import { WEEKDAYS } from "@/server/domain/settings";
import type { TenantSettings } from "@prisma/client";

const TZ: string[] = (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
const DAY = { sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday" } as const;

export function CompanyFields({ s, name }: { s: TenantSettings; name: string }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FField label="Company name" name="name" required><Input name="name" defaultValue={name} required /></FField>
        <FField label="Legal name" name="legalName"><Input name="legalName" defaultValue={s.legalName ?? ""} /></FField>
        <FField label="Phone" name="phone"><Input name="phone" defaultValue={s.phone ?? ""} /></FField>
        <FField label="Email" name="email"><Input name="email" type="email" defaultValue={s.email ?? ""} /></FField>
        <FField label="Website" name="website"><Input name="website" defaultValue={s.website ?? ""} /></FField>
        <FField label="License #" name="licenseNumber"><Input name="licenseNumber" defaultValue={s.licenseNumber ?? ""} /></FField>
        <FField label="Address" name="addressLine1" className="sm:col-span-2"><Input name="addressLine1" defaultValue={s.addressLine1 ?? ""} /></FField>
        <FField label="Address line 2" name="addressLine2" className="sm:col-span-2"><Input name="addressLine2" defaultValue={s.addressLine2 ?? ""} /></FField>
        <FField label="City" name="city"><Input name="city" defaultValue={s.city ?? ""} /></FField>
        <div className="grid grid-cols-2 gap-4"><FField label="State" name="state"><Input name="state" defaultValue={s.state ?? ""} /></FField><FField label="ZIP" name="postalCode"><Input name="postalCode" defaultValue={s.postalCode ?? ""} /></FField></div>
        <FField label="Country" name="country"><Input name="country" maxLength={2} defaultValue={s.country} /></FField>
        <FField label="Tax ID / EIN" name="taxId"><Input name="taxId" defaultValue={s.taxId ?? ""} /></FField>
        <FField label="Registration #" name="registrationNumber"><Input name="registrationNumber" defaultValue={s.registrationNumber ?? ""} /></FField>
      </div>
      <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-3">
        <FField label="Timezone" name="timezone" required hint="Schedules and reports use this"><Select name="timezone" defaultValue={s.timezone}>{TZ.map((t) => <option key={t} value={t}>{t}</option>)}</Select></FField>
        <FField label="Currency" name="currency" required><Select name="currency" defaultValue={s.currency}>{["USD", "CAD", "GBP", "EUR", "AUD"].map((c) => <option key={c}>{c}</option>)}</Select></FField>
        <FField label="Default sales tax (%)" name="defaultTaxRate"><Input name="defaultTaxRate" inputMode="decimal" defaultValue={bpToPercentInput(s.defaultTaxRateBp)} /></FField>
      </div>
    </div>
  );
}

export function BrandingFields({ s, tenantId }: { s: TenantSettings; tenantId: string }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-6">
        {s.logoKey && /* eslint-disable-next-line @next/next/no-img-element */ <img src={`/api/branding/${tenantId}/logo?v=${s.updatedAt.getTime()}`} alt="Current logo" className="h-14 max-w-[180px] rounded border border-line bg-white object-contain p-1" />}
        <FField label="Logo" name="logo" hint="PNG, JPG or WebP under 2 MB. Shown on quotes, invoices and emails."><input name="logo" type="file" accept="image/png,image/jpeg,image/webp" className="block text-[13px] file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-[13px] file:font-medium" /></FField>
        <FField label="Brand color" name="brandColor"><input name="brandColor" type="color" defaultValue={s.brandColor} className="h-9 w-14 cursor-pointer rounded border border-line-strong bg-surface p-1" /></FField>
      </div>
      <FField label="Quote introduction" name="quoteIntro" hint="Shown at the top of every quote"><Textarea name="quoteIntro" rows={3} defaultValue={s.quoteIntro ?? ""} /></FField>
      <FField label="Quote footer" name="quoteFooter"><Textarea name="quoteFooter" rows={2} defaultValue={s.quoteFooter ?? ""} /></FField>
      <FField label="Invoice footer" name="invoiceFooter"><Textarea name="invoiceFooter" rows={2} defaultValue={s.invoiceFooter ?? ""} /></FField>
      <FField label="Email signature" name="emailSignature"><Textarea name="emailSignature" rows={2} defaultValue={s.emailSignature ?? ""} /></FField>
    </div>
  );
}

type Hours = Record<string, { closed?: boolean; open?: string; close?: string }>;
export function OperationsFields({ s }: { s: TenantSettings }) {
  const hours = (s.businessHours ?? {}) as Hours;
  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 text-[13px] font-medium">Business hours</div>
        <div className="space-y-1.5">{WEEKDAYS.map((d) => {
          const h = hours[d];
          const weekend = d === "sun" || d === "sat";
          return (
            <div key={d} className="flex flex-wrap items-center gap-3 text-[13px]">
              <label className="flex w-32 items-center gap-2"><input type="checkbox" name={`${d}_on`} defaultChecked={h ? !h.closed : !weekend} className="h-4 w-4 rounded border-line-strong accent-primary" />{DAY[d]}</label>
              <Input name={`${d}_open`} type="time" defaultValue={h?.open ?? "08:00"} className="w-28" /><span className="text-fg-3">to</span><Input name={`${d}_close`} type="time" defaultValue={h?.close ?? "17:00"} className="w-28" />
            </div>);
        })}</div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FField label="Default appointment length (minutes)" name="defaultAppointmentMinutes"><Input name="defaultAppointmentMinutes" type="number" min={15} defaultValue={s.defaultAppointmentMinutes} /></FField>
        <FField label="Service area notes" name="serviceAreaNotes"><Textarea name="serviceAreaNotes" rows={2} defaultValue={s.serviceAreaNotes ?? ""} /></FField>
      </div>
      <div>
        <div className="mb-2 text-[13px] font-medium">Document numbering</div>
        <p className="mb-3 text-xs text-fg-3">Numbers are sequential per company. Changing a start number never reuses numbers already issued.</p>
        <div className="grid gap-4 sm:grid-cols-4">{([["job", "Jobs"], ["quote", "Quotes"], ["invoice", "Invoices"], ["agreement", "Agreements"]] as const).map(([k, l]) => (
          <div key={k} className="space-y-2"><FField label={`${l} prefix`} name={`${k}Prefix`}><Input name={`${k}Prefix`} defaultValue={s[`${k}Prefix` as "jobPrefix"]} /></FField><FField label="Starts at" name={`${k}StartNumber`}><Input name={`${k}StartNumber`} type="number" min={1} defaultValue={s[`${k}StartNumber` as "jobStartNumber"]} /></FField></div>))}</div>
      </div>
    </div>
  );
}

export function FinancialFields({ s }: { s: TenantSettings }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <FField label="Default payment terms (days)" name="paymentTermsDays" hint="0 = due on receipt"><Input name="paymentTermsDays" type="number" min={0} defaultValue={s.paymentTermsDays} /></FField>
        <FField label="Default deposit (%)" name="defaultDeposit"><Input name="defaultDeposit" inputMode="decimal" defaultValue={bpToPercentInput(s.defaultDepositBp)} /></FField>
        <FField label="Quotes expire after (days)" name="quoteExpirationDays"><Input name="quoteExpirationDays" type="number" min={1} defaultValue={s.quoteExpirationDays} /></FField>
      </div>
      <div>
        <div className="mb-2 text-[13px] font-medium">Accepted payment methods</div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">{PAYMENT_METHODS.map(([v, l]) => <Checkbox key={v} name="acceptedPaymentMethods" value={v} defaultChecked={s.acceptedPaymentMethods.includes(v)} label={l} />)}</div>
      </div>
      <Checkbox name="requireQuoteSignature" defaultChecked={s.requireQuoteSignature} label="Require a signature when customers approve a quote" />
      <FField label="Quote terms & conditions" name="quoteTerms"><Textarea name="quoteTerms" rows={4} defaultValue={s.quoteTerms ?? ""} /></FField>
      <FField label="Invoice terms" name="invoiceTerms"><Textarea name="invoiceTerms" rows={3} defaultValue={s.invoiceTerms ?? ""} /></FField>
    </div>
  );
}
