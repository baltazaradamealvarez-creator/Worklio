"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { addLineAction, scheduleJobAction, toggleChecklistAction, transitionJobAction } from "@/app/actions/jobs";
import { pricebookSearchAction } from "@/app/actions/lookup";
import { ActionForm, Dialog, FField, Menu, MenuItem, Spinner, SubmitButton, useDialog } from "@/components/ui/client";
import { Button, Checkbox, Input } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
import { formatMoney } from "@/lib/money";
import { humanize } from "@/lib/format";

export interface TechOpt { id: string; name: string; color: string }

export function TechPicker({ technicians, defaultIds = [], name = "assigneeIds" }: { technicians: TechOpt[]; defaultIds?: string[]; name?: string }) {
  const [sel, setSel] = useState<string[]>(defaultIds);
  return (
    <div className="flex flex-wrap gap-2">
      {technicians.map((t) => (
        <label key={t.id} className={cn("flex cursor-pointer items-center gap-2 rounded-full border px-2.5 py-1 text-[13px]", sel.includes(t.id) ? "border-primary bg-primary-soft font-medium" : "border-line-strong bg-surface")}>
          <input type="checkbox" name={name} value={t.id} checked={sel.includes(t.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, t.id] : s.filter((x) => x !== t.id)))} className="sr-only" />
          <span className="size-2.5 rounded-full" style={{ background: t.color }} />{t.name}
        </label>
      ))}
      {technicians.length === 0 && <p className="text-xs text-fg-3">No technicians yet — add employees marked as technicians.</p>}
    </div>
  );
}

/** Schedule form with an explicit "schedule anyway" step when the server reports a conflict. */
export function ScheduleDialog({ jobId, technicians, defaultAssigneeIds, defaultMinutes, defaultStart, label = "Schedule" }: { jobId: string; technicians: TechOpt[]; defaultAssigneeIds: string[]; defaultMinutes: number; defaultStart: string; label?: string }) {
  return (
    <Dialog title="Schedule appointment" description="Conflicts with bookings, time off and working hours are checked automatically." trigger={<Button variant="primary"><Icon name="calendar-days" size={14} /> {label}</Button>}>
      <ScheduleForm jobId={jobId} technicians={technicians} defaultAssigneeIds={defaultAssigneeIds} defaultMinutes={defaultMinutes} defaultStart={defaultStart} />
    </Dialog>
  );
}

function ScheduleForm({ jobId, technicians, defaultAssigneeIds, defaultMinutes, defaultStart }: { jobId: string; technicians: TechOpt[]; defaultAssigneeIds: string[]; defaultMinutes: number; defaultStart: string }) {
  const router = useRouter();
  const dialog = useDialog();
  const [error, setError] = useState<{ message: string; conflict: boolean } | null>(null);
  const [pending, start] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  const submit = (force: boolean) => {
    const fd = new FormData(form.current!);
    if (force) fd.set("force", "on");
    start(async () => {
      const r = await scheduleJobAction(jobId, fd);
      if (r.ok) { toast.success("Appointment scheduled"); dialog?.close(); router.refresh(); }
      else setError({ message: r.error, conflict: r.fieldErrors?.force === "confirm" });
    });
  };
  return (
    <form ref={form} onSubmit={(e) => { e.preventDefault(); submit(false); }} className="space-y-4">
      {error && (
        <div role="alert" className={cn("rounded-md border px-3 py-2 text-[13px]", error.conflict ? "border-amber-200 bg-warn-soft text-warn" : "border-red-200 bg-danger-soft text-danger")}>
          {error.message}
          {error.conflict && <div className="mt-2"><Button size="sm" variant="secondary" onClick={() => submit(true)} disabled={pending}>Schedule anyway</Button></div>}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <FField label="Start" name="startLocal" required><Input type="datetime-local" name="startLocal" defaultValue={defaultStart} required /></FField>
        <FField label="Duration (minutes)" name="durationMinutes"><Input type="number" name="durationMinutes" min={15} step={15} defaultValue={defaultMinutes} /></FField>
      </div>
      <div className="space-y-1"><label className="block text-[12.5px] font-medium text-fg-2">Technicians</label><TechPicker technicians={technicians} defaultIds={defaultAssigneeIds} /></div>
      <div className="flex justify-end"><Button type="submit" variant="primary" disabled={pending}>{pending && <Spinner />} Schedule</Button></div>
    </form>
  );
}

type Item = { id: string; name: string; sku: string | null; kind: string; priceCents: number; costCents: number; taxable: boolean; category: string | null; unit: string };

/** Add a pricebook item (typeahead) or — for office staff — a custom line to a job. */
export function AddLineDialog({ jobId, canCustom, currency }: { jobId: string; canCustom: boolean; currency: string }) {
  return (
    <Dialog title="Add service, labor or material" trigger={<Button size="sm"><Icon name="plus" size={13} /> Add item</Button>} width="max-w-xl">
      <AddLineForm jobId={jobId} canCustom={canCustom} currency={currency} />
    </Dialog>
  );
}

function AddLineForm({ jobId, canCustom, currency }: { jobId: string; canCustom: boolean; currency: string }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Item[]>([]);
  const [chosen, setChosen] = useState<Item | null>(null);
  const [custom, setCustom] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const my = ++seq.current;
    const t = setTimeout(() => pricebookSearchAction(q).then((r) => my === seq.current && setResults(r as Item[])), 150);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <ActionForm action={addLineAction.bind(null, jobId)} className="space-y-4">
      {chosen && <input type="hidden" name="pricebookItemId" value={chosen.id} />}
      {!chosen && !custom && (
        <>
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the pricebook…" aria-label="Search pricebook" />
          <ul className="max-h-64 divide-y divide-line overflow-auto rounded-md border border-line">
            {results.length === 0 && <li className="px-3 py-4 text-center text-[13px] text-fg-3">No items found</li>}
            {results.map((i) => (
              <li key={i.id}><button type="button" onClick={() => setChosen(i)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-primary-soft"><span><span className="block text-[13px] font-medium">{i.name}</span><span className="text-xs text-fg-3">{[i.category, i.sku].filter(Boolean).join(" · ")}</span></span><span className="tabular text-[13px]">{formatMoney(i.priceCents, currency)}</span></button></li>
            ))}
          </ul>
          {canCustom && <button type="button" onClick={() => setCustom(true)} className="text-[13px] font-medium text-primary hover:underline">Add a custom line instead</button>}
        </>
      )}
      {chosen && (
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-md bg-surface-2 px-3 py-2"><div><div className="text-[13px] font-medium">{chosen.name}</div><div className="text-xs text-fg-3">{formatMoney(chosen.priceCents, currency)} / {chosen.unit}</div></div><button type="button" onClick={() => setChosen(null)} className="text-xs text-primary hover:underline">Change</button></div>
          <div className="grid gap-4 sm:grid-cols-2"><FField label="Quantity" name="quantity"><Input name="quantity" inputMode="decimal" defaultValue="1" required /></FField>{canCustom && <FField label="Unit price override ($)" name="unitPrice" hint="Leave blank to use the pricebook price"><Input name="unitPrice" inputMode="decimal" /></FField>}</div>
          {chosen.kind === "MATERIAL" && <Checkbox name="__consume" label="Material comes from truck/warehouse stock" disabled />}
          <div className="flex justify-end"><SubmitButton>Add to job</SubmitButton></div>
        </div>
      )}
      {custom && !chosen && (
        <div className="space-y-3">
          <FField label="Description" name="name" required><Input name="name" required autoFocus /></FField>
          <div className="grid gap-4 sm:grid-cols-3"><FField label="Type" name="kind"><select name="kind" className="h-8 w-full rounded-md border border-line-strong bg-surface px-2 text-[13px]">{["SERVICE", "LABOR", "MATERIAL", "EQUIPMENT", "OTHER"].map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select></FField><FField label="Quantity" name="quantity"><Input name="quantity" defaultValue="1" inputMode="decimal" /></FField><FField label="Unit price ($)" name="unitPrice"><Input name="unitPrice" inputMode="decimal" required /></FField></div>
          <div className="flex items-center justify-between"><button type="button" onClick={() => setCustom(false)} className="text-[13px] text-primary hover:underline">Back to pricebook</button><SubmitButton>Add to job</SubmitButton></div>
        </div>
      )}
    </ActionForm>
  );
}

export function ChecklistToggle({ jobId, itemId, done, label, disabled }: { jobId: string; itemId: string; done: boolean; label: string; disabled?: boolean }) {
  const router = useRouter();
  const [checked, setChecked] = useState(done);
  const [pending, start] = useTransition();
  return (
    <label className={cn("flex cursor-pointer items-center gap-3 py-2", disabled && "cursor-default opacity-70")}>
      <input type="checkbox" checked={checked} disabled={disabled || pending} className="size-5 shrink-0 accent-primary" onChange={(e) => {
        setChecked(e.target.checked);
        start(async () => { const r = await toggleChecklistAction(jobId, itemId, e.target.checked); if (!r.ok) { setChecked(!e.target.checked); toast.error(r.error); } else router.refresh(); });
      }} />
      <span className={cn("text-[13px]", checked && "text-fg-3 line-through")}>{label}</span>
    </label>
  );
}

export function JobStatusMenu({ jobId, options }: { jobId: string; options: { to: string; needsReason: boolean }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (options.length === 0) return null;
  return (
    <Menu trigger={<span className={cn("inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 text-[13px] font-medium shadow-sm hover:bg-surface-2", pending && "opacity-60")}>Change status <Icon name="chevron-down" size={13} /></span>}>
      {options.map((o) => (
        <MenuItem key={o.to} onClick={() => {
          let reason: string | undefined;
          if (o.needsReason) { const r = window.prompt(`Reason for ${humanize(o.to).toLowerCase()}:`); if (!r) return; reason = r; }
          start(async () => { const res = await transitionJobAction(jobId, o.to, reason); if (res.ok) { toast.success(`Job is now ${humanize(o.to).toLowerCase()}`); router.refresh(); } else toast.error(res.error); });
        }}>{humanize(o.to)}</MenuItem>
      ))}
    </Menu>
  );
}
