import { CustomerLocationPicker } from "@/components/pickers";
import { FField } from "@/components/ui/client";
import { Input, Select, Textarea } from "@/components/ui/primitives";
import { CONDITIONS, EQUIPMENT_TYPES } from "@/server/domain/equipment";
import { humanize } from "@/lib/format";

const d = (v: Date | null | undefined) => (v ? v.toISOString().slice(0, 10) : "");

type E = Partial<{ customerId: string; locationId: string; type: string; systemType: string | null; manufacturer: string | null; model: string | null; serialNumber: string | null; unitLocation: string | null; installDate: Date | null; manufactureDate: Date | null; warrantyExpiresAt: Date | null; laborWarrantyExpiresAt: Date | null; equipmentWarrantyExpiresAt: Date | null; refrigerantType: string | null; capacityTons: { toString(): string } | null; seer: { toString(): string } | null; filterSize: string | null; fuelType: string | null; condition: string; notes: string | null }>;

export function EquipmentFields({ e = {}, customer, lockCustomer }: { e?: E; customer?: { id: string; name: string } | null; lockCustomer?: boolean }) {
  return (
    <div className="space-y-6">
      <CustomerLocationPicker defaultCustomer={customer} defaultLocationId={e.locationId} lockCustomer={lockCustomer} />
      <fieldset className="space-y-4">
        <legend className="mb-1 text-[13px] font-semibold">Unit</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <FField label="Equipment type" name="type" required><Select name="type" defaultValue={e.type ?? "AIR_CONDITIONER"}>{EQUIPMENT_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</Select></FField>
          <FField label="System type" name="systemType"><Input name="systemType" defaultValue={e.systemType ?? ""} placeholder="Split system, package unit…" /></FField>
          <FField label="Condition" name="condition"><Select name="condition" defaultValue={e.condition ?? "GOOD"}>{CONDITIONS.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</Select></FField>
          <FField label="Manufacturer" name="manufacturer"><Input name="manufacturer" defaultValue={e.manufacturer ?? ""} /></FField>
          <FField label="Model" name="model"><Input name="model" defaultValue={e.model ?? ""} /></FField>
          <FField label="Serial number" name="serialNumber"><Input name="serialNumber" defaultValue={e.serialNumber ?? ""} /></FField>
          <FField label="Unit location" name="unitLocation"><Input name="unitLocation" defaultValue={e.unitLocation ?? ""} placeholder="Attic, roof, garage…" /></FField>
          <FField label="Capacity (tons)" name="capacityTons"><Input name="capacityTons" inputMode="decimal" defaultValue={e.capacityTons?.toString() ?? ""} /></FField>
          <FField label="SEER rating" name="seer"><Input name="seer" inputMode="decimal" defaultValue={e.seer?.toString() ?? ""} /></FField>
          <FField label="Refrigerant type" name="refrigerantType"><Input name="refrigerantType" defaultValue={e.refrigerantType ?? ""} placeholder="R-410A" /></FField>
          <FField label="Fuel type" name="fuelType"><Input name="fuelType" defaultValue={e.fuelType ?? ""} placeholder="Natural gas, electric…" /></FField>
          <FField label="Filter size" name="filterSize"><Input name="filterSize" defaultValue={e.filterSize ?? ""} placeholder="16x25x1" /></FField>
        </div>
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="mb-1 text-[13px] font-semibold">Dates & warranty</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <FField label="Install date" name="installDate"><Input name="installDate" type="date" defaultValue={d(e.installDate)} /></FField>
          <FField label="Manufacture date" name="manufactureDate"><Input name="manufactureDate" type="date" defaultValue={d(e.manufactureDate)} /></FField>
          <FField label="Warranty expires" name="warrantyExpiresAt"><Input name="warrantyExpiresAt" type="date" defaultValue={d(e.warrantyExpiresAt)} /></FField>
          <FField label="Labor warranty expires" name="laborWarrantyExpiresAt"><Input name="laborWarrantyExpiresAt" type="date" defaultValue={d(e.laborWarrantyExpiresAt)} /></FField>
          <FField label="Equipment warranty expires" name="equipmentWarrantyExpiresAt"><Input name="equipmentWarrantyExpiresAt" type="date" defaultValue={d(e.equipmentWarrantyExpiresAt)} /></FField>
        </div>
      </fieldset>
      <FField label="Notes" name="notes"><Textarea name="notes" defaultValue={e.notes ?? ""} rows={3} /></FField>
    </div>
  );
}
