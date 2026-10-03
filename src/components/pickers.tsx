"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { customerLocationsAction, customerSearchAction, locationEquipmentAction } from "@/app/actions/lookup";
import { Select } from "@/components/ui/primitives";

type CustomerOpt = { id: string; displayName: string; phone: string | null; email: string | null };

/** Typeahead for customers + dependent location select (and optional equipment multi-select). */
export function CustomerLocationPicker({
  customerName = "customerId", locationName = "locationId", equipmentName, defaultCustomer, defaultLocationId, defaultEquipmentIds = [], requireLocation = true, lockCustomer, onCustomerChange, className,
}: {
  customerName?: string; locationName?: string; equipmentName?: string; defaultCustomer?: { id: string; name: string } | null; defaultLocationId?: string | null; defaultEquipmentIds?: string[];
  requireLocation?: boolean; lockCustomer?: boolean; onCustomerChange?: (info: { id: string; taxExempt: boolean } | null) => void; className?: string;
}) {
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(defaultCustomer ?? null);
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<CustomerOpt[]>([]);
  const [open, setOpen] = useState(false);
  const [locations, setLocations] = useState<{ id: string; name: string; address: string; isPrimary: boolean }[]>([]);
  const [locationId, setLocationId] = useState(defaultLocationId ?? "");
  const [equipment, setEquipment] = useState<{ id: string; label: string; type: string }[]>([]);
  const [selectedEq, setSelectedEq] = useState<string[]>(defaultEquipmentIds);
  const box = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!customer) { setLocations([]); setLocationId(""); onCustomerChange?.(null); return; }
    customerLocationsAction(customer.id).then((r) => {
      setLocations(r.locations);
      setLocationId((cur) => (r.locations.some((l) => l.id === cur) ? cur : (r.locations.find((l) => l.isPrimary) ?? r.locations[0])?.id ?? ""));
      onCustomerChange?.({ id: customer.id, taxExempt: r.taxExempt });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.id]);

  useEffect(() => {
    if (!equipmentName || !customer || !locationId) { setEquipment([]); return; }
    locationEquipmentAction(customer.id, locationId).then(setEquipment);
  }, [equipmentName, customer, locationId]);

  useEffect(() => {
    if (!open) return;
    const my = ++seq.current;
    const t = setTimeout(() => customerSearchAction(q).then((r) => my === seq.current && setOptions(r)), 150);
    return () => clearTimeout(t);
  }, [q, open]);
  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div className={cn("grid gap-4 sm:grid-cols-2", className)}>
      <div ref={box} className="relative space-y-1">
        <label className="block text-[12.5px] font-medium text-fg-2">Customer<span className="ml-0.5 text-danger">*</span></label>
        <input type="hidden" name={customerName} value={customer?.id ?? ""} />
        {customer ? (
          <div className="flex h-8 items-center justify-between rounded-md border border-line-strong bg-surface px-2.5 text-[13px] shadow-sm">
            <span className="truncate font-medium">{customer.name}</span>
            {!lockCustomer && <button type="button" onClick={() => { setCustomer(null); setQ(""); setOpen(true); }} className="ml-2 text-xs text-primary hover:underline">Change</button>}
          </div>
        ) : (
          <input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setOpen(true)} placeholder="Search by name, phone or email…" aria-label="Customer" autoComplete="off" required className="h-8 w-full rounded-md border border-line-strong bg-surface px-2.5 text-[13px] shadow-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
        )}
        {!customer && open && (
          <ul className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-line bg-surface py-1 shadow-pop" role="listbox">
            {options.length === 0 && <li className="px-3 py-2 text-[13px] text-fg-3">No customers found</li>}
            {options.map((o) => (
              <li key={o.id}><button type="button" role="option" aria-selected="false" onClick={() => { setCustomer({ id: o.id, name: o.displayName }); setOpen(false); }} className="flex w-full flex-col px-3 py-1.5 text-left hover:bg-primary-soft">
                <span className="text-[13px] font-medium">{o.displayName}</span><span className="text-xs text-fg-3">{[o.phone, o.email].filter(Boolean).join(" · ")}</span></button></li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-1">
        <label className="block text-[12.5px] font-medium text-fg-2">Service location{requireLocation && <span className="ml-0.5 text-danger">*</span>}</label>
        <Select name={locationName} value={locationId} onChange={(e) => setLocationId(e.target.value)} required={requireLocation} disabled={!customer}>
          {!requireLocation && <option value="">—</option>}
          {locations.length === 0 && <option value="">{customer ? "No locations — add one first" : "Select a customer first"}</option>}
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name} — {l.address}</option>)}
        </Select>
      </div>
      {equipmentName && (
        <div className="space-y-1 sm:col-span-2">
          <label className="block text-[12.5px] font-medium text-fg-2">Related equipment</label>
          {equipment.length === 0 ? <p className="text-xs text-fg-3">{customer ? "No equipment recorded at this location." : "Select a customer and location."}</p> : (
            <div className="flex flex-wrap gap-2">
              {equipment.map((e) => (
                <label key={e.id} className={cn("flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1 text-[13px]", selectedEq.includes(e.id) ? "border-primary bg-primary-soft" : "border-line-strong bg-surface")}>
                  <input type="checkbox" name={equipmentName} value={e.id} checked={selectedEq.includes(e.id)} onChange={(ev) => setSelectedEq((s) => (ev.target.checked ? [...s, e.id] : s.filter((x) => x !== e.id)))} className="size-3.5 accent-primary" /> {e.label}
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
