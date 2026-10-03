import { adjustStockAction, saveLocationAction, saveVendorAction, transferStockAction } from "@/app/actions/admin";
import { ActionForm, Dialog, FField, SubmitButton } from "@/components/ui/client";
import { Button, Checkbox, Input, Select, Tabs, Textarea } from "@/components/ui/primitives";
import { centsToInput } from "@/lib/money";

type Opt = { id: string; name: string };
type I = Partial<{ sku: string; name: string; description: string | null; kind: string; unit: string; vendorId: string | null; costCents: number; priceCents: number; reorderThreshold: number; reorderQuantity: number; isActive: boolean }>;

export function ItemFields({ i = {}, vendors, canCost }: { i?: I; vendors: Opt[]; canCost: boolean }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <FField label="Name" name="name" required className="sm:col-span-2"><Input name="name" defaultValue={i.name ?? ""} required /></FField>
        <FField label="SKU" name="sku" required><Input name="sku" defaultValue={i.sku ?? ""} required /></FField>
        <FField label="Type" name="kind"><Select name="kind" defaultValue={i.kind ?? "MATERIAL"}><option value="MATERIAL">Material</option><option value="EQUIPMENT">Equipment</option><option value="OTHER">Other</option></Select></FField>
        <FField label="Unit" name="unit"><Input name="unit" defaultValue={i.unit ?? "each"} /></FField>
        <FField label="Vendor" name="vendorId"><Select name="vendorId" defaultValue={i.vendorId ?? ""}><option value="">None</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select></FField>
        {canCost ? <FField label="Unit cost ($)" name="cost"><Input name="cost" inputMode="decimal" defaultValue={centsToInput(i.costCents ?? 0)} /></FField> : <input type="hidden" name="cost" value={centsToInput(i.costCents ?? 0)} />}
        <FField label="Sell price ($)" name="price"><Input name="price" inputMode="decimal" defaultValue={centsToInput(i.priceCents ?? 0)} /></FField>
        <div />
        <FField label="Reorder at" name="reorderThreshold" hint="Alert when on-hand ≤ this"><Input name="reorderThreshold" type="number" min={0} defaultValue={i.reorderThreshold ?? 0} /></FField>
        <FField label="Reorder quantity" name="reorderQuantity"><Input name="reorderQuantity" type="number" min={0} defaultValue={i.reorderQuantity ?? 0} /></FField>
      </div>
      <FField label="Description" name="description"><Textarea name="description" rows={2} defaultValue={i.description ?? ""} /></FField>
      <Checkbox name="isActive" defaultChecked={i.isActive ?? true} label="Active" />
    </div>
  );
}

export function AdjustStockDialog({ itemId, locations }: { itemId: string; locations: Opt[] }) {
  return (
    <Dialog title="Adjust stock" description="Receive new stock, record a return, or set a counted quantity." trigger={<Button variant="primary">Adjust stock</Button>}>
      <ActionForm action={adjustStockAction} className="space-y-4">
        <input type="hidden" name="itemId" value={itemId} />
        <FField label="Action" name="type"><Select name="type" defaultValue="RECEIVE"><option value="RECEIVE">Receive stock (add)</option><option value="RETURN">Return to stock (add)</option><option value="ADJUST">Set counted quantity</option></Select></FField>
        <FField label="Location" name="locationId" required><Select name="locationId" required>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></FField>
        <FField label="Quantity" name="quantity" required><Input name="quantity" inputMode="decimal" required /></FField>
        <FField label="Note" name="note"><Input name="note" placeholder="PO number, reason…" /></FField>
        <div className="flex justify-end"><SubmitButton>Update stock</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function TransferStockDialog({ itemId, locations }: { itemId: string; locations: Opt[] }) {
  return (
    <Dialog title="Transfer stock" description="Move stock between the warehouse and trucks." trigger={<Button>Transfer</Button>}>
      <ActionForm action={transferStockAction} className="space-y-4">
        <input type="hidden" name="itemId" value={itemId} />
        <div className="grid gap-4 sm:grid-cols-2">
          <FField label="From" name="fromLocationId" required><Select name="fromLocationId" required>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></FField>
          <FField label="To" name="toLocationId" required><Select name="toLocationId" required defaultValue={locations[1]?.id}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></FField>
        </div>
        <FField label="Quantity" name="quantity" required><Input name="quantity" inputMode="decimal" required /></FField>
        <div className="flex justify-end"><SubmitButton>Transfer</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function LocationDialog({ trigger, id, loc, technicians }: { trigger: React.ReactNode; id?: string; loc?: { name: string; type: string; employeeId: string | null }; technicians: { id: string; firstName: string; lastName: string }[] }) {
  return (
    <Dialog title={id ? "Edit location" : "New location"} trigger={trigger}>
      <ActionForm action={saveLocationAction.bind(null, id ?? null)} className="space-y-4">
        <FField label="Name" name="name" required><Input name="name" defaultValue={loc?.name ?? ""} required /></FField>
        <FField label="Type" name="type"><Select name="type" defaultValue={loc?.type ?? "WAREHOUSE"}><option value="WAREHOUSE">Warehouse / shop</option><option value="TRUCK">Truck</option></Select></FField>
        <FField label="Assigned technician (trucks)" name="employeeId"><Select name="employeeId" defaultValue={loc?.employeeId ?? ""}><option value="">None</option>{technicians.map((t) => <option key={t.id} value={t.id}>{t.firstName} {t.lastName}</option>)}</Select></FField>
        <div className="flex justify-end"><SubmitButton>Save</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

type V = Partial<{ name: string; contactName: string | null; email: string | null; phone: string | null; website: string | null; accountNumber: string | null; notes: string | null; isActive: boolean }>;
export function VendorDialog({ trigger, id, v = {} }: { trigger: React.ReactNode; id?: string; v?: V }) {
  return (
    <Dialog title={id ? "Edit vendor" : "New vendor"} trigger={trigger}>
      <ActionForm action={saveVendorAction.bind(null, id ?? null)} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FField label="Name" name="name" required className="sm:col-span-2"><Input name="name" defaultValue={v.name ?? ""} required /></FField>
          <FField label="Contact" name="contactName"><Input name="contactName" defaultValue={v.contactName ?? ""} /></FField>
          <FField label="Account #" name="accountNumber"><Input name="accountNumber" defaultValue={v.accountNumber ?? ""} /></FField>
          <FField label="Email" name="email"><Input name="email" type="email" defaultValue={v.email ?? ""} /></FField>
          <FField label="Phone" name="phone"><Input name="phone" defaultValue={v.phone ?? ""} /></FField>
          <FField label="Website" name="website" className="sm:col-span-2"><Input name="website" defaultValue={v.website ?? ""} /></FField>
        </div>
        <FField label="Notes" name="notes"><Textarea name="notes" rows={2} defaultValue={v.notes ?? ""} /></FField>
        <Checkbox name="isActive" defaultChecked={v.isActive ?? true} label="Active" />
        <div className="flex justify-end"><SubmitButton>Save vendor</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function InventoryTabs({ active }: { active: string }) {
  return <Tabs tabs={[{ key: "items", label: "Items" }, { key: "locations", label: "Warehouse & trucks" }, { key: "vendors", label: "Vendors" }]} active={active} basePath="/inventory" hrefFor={(k) => (k === "items" ? "/inventory" : `/inventory/${k}`)} />;
}
