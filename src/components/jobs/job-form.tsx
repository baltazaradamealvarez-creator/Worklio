import { CustomerLocationPicker } from "@/components/pickers";
import { FField } from "@/components/ui/client";
import { Input, Select, Textarea } from "@/components/ui/primitives";
import { TechPicker, type TechOpt } from "./client";

type J = Partial<{ title: string; description: string | null; jobTypeId: string | null; priority: string; estimatedMinutes: number; dispatcherId: string | null; internalNotes: string | null; customerNotes: string | null; locationId: string }>;

export function JobFields({ j = {}, customer, lockCustomer, equipmentIds = [], types, technicians, dispatchers, withSchedule, defaultStart, editing }: { j?: J; customer?: { id: string; name: string } | null; lockCustomer?: boolean; equipmentIds?: string[]; types: { id: string; name: string; defaultDurationMin: number }[]; technicians: TechOpt[]; dispatchers: { id: string; name: string }[]; withSchedule?: boolean; defaultStart?: string; editing?: boolean }) {
  return (
    <div className="space-y-6">
      <CustomerLocationPicker equipmentName="equipmentIds" defaultCustomer={customer} defaultLocationId={j.locationId} defaultEquipmentIds={equipmentIds} lockCustomer={lockCustomer} />
      <div className="grid gap-4 sm:grid-cols-3">
        <FField label="Job title" name="title" required className="sm:col-span-2"><Input name="title" defaultValue={j.title ?? ""} required placeholder="No cooling, annual tune-up, replace furnace…" /></FField>
        <FField label="Job type" name="jobTypeId"><Select name="jobTypeId" defaultValue={j.jobTypeId ?? ""}><option value="">—</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></FField>
        <FField label="Priority" name="priority"><Select name="priority" defaultValue={j.priority ?? "NORMAL"}><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="EMERGENCY">Emergency</option></Select></FField>
        <FField label="Estimated duration (min)" name="estimatedMinutes" hint="Defaults from the job type"><Input name="estimatedMinutes" type="number" min={15} step={15} defaultValue={j.estimatedMinutes ?? ""} /></FField>
        <FField label="Dispatcher" name="dispatcherId"><Select name="dispatcherId" defaultValue={j.dispatcherId ?? ""}><option value="">—</option>{dispatchers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></FField>
      </div>
      <FField label="Description / issue reported" name="description"><Textarea name="description" rows={4} defaultValue={j.description ?? ""} placeholder="What the customer reported, what to bring, anything the technician should know." /></FField>
      {!editing && (
        <fieldset className="space-y-3"><legend className="mb-1 text-[13px] font-semibold">Technicians</legend><TechPicker technicians={technicians} /></fieldset>
      )}
      {withSchedule && (
        <fieldset className="grid gap-4 sm:grid-cols-3">
          <legend className="mb-2 text-[13px] font-semibold">Schedule now (optional)</legend>
          <FField label="Start" name="startLocal"><Input type="datetime-local" name="startLocal" defaultValue={defaultStart} /></FField>
          <FField label="Duration (min)" name="durationMinutes"><Input type="number" name="durationMinutes" min={15} step={15} placeholder="Use estimate" /></FField>
        </fieldset>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <FField label="Customer-facing notes" name="customerNotes" hint="Shown on documents and the customer portal"><Textarea name="customerNotes" rows={2} defaultValue={j.customerNotes ?? ""} /></FField>
        <FField label="Internal notes" name="internalNotes" hint="Office only"><Textarea name="internalNotes" rows={2} defaultValue={j.internalNotes ?? ""} /></FField>
      </div>
    </div>
  );
}
