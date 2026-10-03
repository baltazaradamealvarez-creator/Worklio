import { FField } from "@/components/ui/client";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/primitives";
import { centsToInput } from "@/lib/money";
import { humanize } from "@/lib/format";

type E = Partial<{ firstName: string; lastName: string; email: string | null; phone: string | null; jobTitle: string | null; status: string; hireDate: Date | null; terminationDate: Date | null; isTechnician: boolean; skills: string[]; calendarColor: string; territoryId: string | null; internalNotes: string | null; hourlyCostCents: number | null; emergencyContactName: string | null; emergencyContactPhone: string | null; emergencyContactRelationship: string | null }>;
const d = (x?: Date | null) => (x ? x.toISOString().slice(0, 10) : "");

export function EmployeeFields({ e = {}, territories, sensitive, compensation }: { e?: E; territories: { id: string; name: string }[]; sensitive: boolean; compensation: boolean }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <FField label="First name" name="firstName" required><Input name="firstName" defaultValue={e.firstName ?? ""} required /></FField>
        <FField label="Last name" name="lastName" required><Input name="lastName" defaultValue={e.lastName ?? ""} required /></FField>
        <FField label="Email" name="email"><Input name="email" type="email" defaultValue={e.email ?? ""} /></FField>
        <FField label="Phone" name="phone"><Input name="phone" defaultValue={e.phone ?? ""} /></FField>
        <FField label="Job title" name="jobTitle"><Input name="jobTitle" defaultValue={e.jobTitle ?? ""} /></FField>
        <FField label="Status" name="status"><Select name="status" defaultValue={e.status ?? "ACTIVE"}>{["ACTIVE", "ON_LEAVE", "INVITED", "TERMINATED"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select></FField>
        <FField label="Hire date" name="hireDate"><Input name="hireDate" type="date" defaultValue={d(e.hireDate)} /></FField>
        <FField label="Termination date" name="terminationDate"><Input name="terminationDate" type="date" defaultValue={d(e.terminationDate)} /></FField>
      </div>
      <div className="space-y-4 rounded-md border border-line bg-surface-2/50 p-4">
        <Checkbox name="isTechnician" defaultChecked={e.isTechnician ?? false} label="Field technician (appears on the schedule and dispatch board)" />
        <div className="grid gap-4 sm:grid-cols-3">
          <FField label="Skills" name="skills" hint="Comma-separated" className="sm:col-span-2"><Input name="skills" defaultValue={(e.skills ?? []).join(", ")} placeholder="Heat pumps, Mini-splits, Refrigeration" /></FField>
          <FField label="Calendar color" name="calendarColor"><input name="calendarColor" type="color" defaultValue={e.calendarColor ?? "#2563eb"} className="h-9 w-14 rounded border border-line-strong bg-surface p-1" /></FField>
          <FField label="Territory" name="territoryId"><Select name="territoryId" defaultValue={e.territoryId ?? ""}><option value="">None</option>{territories.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></FField>
        </div>
      </div>
      {(sensitive || compensation) && (
        <div className="space-y-4 rounded-md border border-amber-200 bg-warn-soft/40 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-fg-3">Restricted — visible only to people with HR access</div>
          {compensation && <FField label="Internal hourly cost ($)" name="hourlyCost" hint="Used for job costing only"><Input name="hourlyCost" inputMode="decimal" defaultValue={e.hourlyCostCents != null ? centsToInput(e.hourlyCostCents) : ""} /></FField>}
          {sensitive && (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <FField label="Emergency contact" name="emergencyContactName"><Input name="emergencyContactName" defaultValue={e.emergencyContactName ?? ""} /></FField>
                <FField label="Contact phone" name="emergencyContactPhone"><Input name="emergencyContactPhone" defaultValue={e.emergencyContactPhone ?? ""} /></FField>
                <FField label="Relationship" name="emergencyContactRelationship"><Input name="emergencyContactRelationship" defaultValue={e.emergencyContactRelationship ?? ""} /></FField>
              </div>
              <FField label="Internal notes" name="internalNotes"><Textarea name="internalNotes" rows={2} defaultValue={e.internalNotes ?? ""} /></FField>
            </>
          )}
        </div>
      )}
    </div>
  );
}
