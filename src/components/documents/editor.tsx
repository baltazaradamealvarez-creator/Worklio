"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { saveInvoiceAction, saveQuoteAction } from "@/app/actions/sales";
import { pricebookSearchAction } from "@/app/actions/lookup";
import { CustomerLocationPicker } from "@/components/pickers";
import { Spinner } from "@/components/ui/client";
import { Icon } from "@/components/ui/icon";
import { Button, Card, Checkbox, Input, Select, Textarea } from "@/components/ui/primitives";
import { computeDocument, formatMoney, parseMoney, type DiscountType } from "@/lib/money";

export interface EditorLine {
  key: string;
  pricebookItemId: string | null;
  kind: string;
  name: string;
  description: string;
  quantity: string;
  unitPrice: string; // dollars
  discountType: DiscountType;
  discountValue: string; // percent or dollars
  taxable: boolean;
}
export interface EditorOption { key: string; id?: string; name: string; description: string; isRecommended: boolean; lines: EditorLine[] }

export interface EditorInitial {
  id: string | null;
  customer: { id: string; name: string } | null;
  locationId: string | null;
  jobId: string | null;
  salespersonId: string | null;
  title: string;
  issueDate: string;
  expiresAt: string; // quote
  paymentTermsDays: string; // invoice
  taxRate: string;
  discountType: DiscountType;
  discountValue: string;
  depositType: DiscountType; // quote
  depositValue: string; // percent or dollars (quote); dollars (invoice)
  terms: string;
  customerNotes: string;
  internalNotes: string;
  options: EditorOption[];
}

let seq = 0;
export const newKey = () => `k${Date.now().toString(36)}${seq++}`;
export const blankLine = (): EditorLine => ({ key: newKey(), pricebookItemId: null, kind: "SERVICE", name: "", description: "", quantity: "1", unitPrice: "", discountType: "NONE", discountValue: "", taxable: true });

const toBpOrCents = (type: DiscountType, v: string) => {
  if (type === "NONE" || !v.trim()) return 0;
  if (type === "PERCENT") return Math.round(Number(v.replace("%", "")) * 100) || 0;
  return parseMoney(v) ?? 0;
};
const lineInput = (l: EditorLine) => ({ quantity: /^\d+(\.\d{1,2})?$/.test(l.quantity.trim()) ? l.quantity.trim() : "0", unitPriceCents: parseMoney(l.unitPrice) ?? 0, discountType: l.discountType, discountValue: toBpOrCents(l.discountType, l.discountValue), taxable: l.taxable });

export function DocumentEditor({ mode, initial, currency, taxExemptDefault, salespeople, settingsTaxRate }: { mode: "quote" | "invoice"; initial: EditorInitial; currency: string; taxExemptDefault?: boolean; salespeople: { id: string; name: string }[]; settingsTaxRate: string }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [taxExempt, setTaxExempt] = useState(!!taxExemptDefault);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof EditorInitial>(k: K, v: EditorInitial[K]) => setS((p) => ({ ...p, [k]: v }));
  const fmt = (c: number) => formatMoney(c, currency);
  const multi = mode === "quote";

  const taxRateBp = taxExempt ? 0 : Math.round((Number(s.taxRate) || 0) * 100);
  const totals = useMemo(() => s.options.map((o) => computeDocument({
    lines: o.lines.map(lineInput), taxRateBp, discountType: s.discountType, discountValue: toBpOrCents(s.discountType, s.discountValue),
    ...(multi ? { depositType: s.depositType, depositValue: toBpOrCents(s.depositType, s.depositValue) } : {}),
  })), [s.options, s.discountType, s.discountValue, s.depositType, s.depositValue, taxRateBp, multi]);

  const patchOption = (key: string, fn: (o: EditorOption) => EditorOption) => setS((p) => ({ ...p, options: p.options.map((o) => (o.key === key ? fn(o) : o)) }));
  const patchLine = (ok: string, lk: string, patch: Partial<EditorLine>) => patchOption(ok, (o) => ({ ...o, lines: o.lines.map((l) => (l.key === lk ? { ...l, ...patch } : l)) }));

  function submit() {
    setError(null);
    const lineOut = (l: EditorLine) => ({ pricebookItemId: l.pricebookItemId, kind: l.kind, name: l.name.trim(), description: l.description.trim() || null, quantity: l.quantity.trim() || "1", unitPrice: parseMoney(l.unitPrice) ?? 0, discountType: l.discountType, discountValue: toBpOrCents(l.discountType, l.discountValue), taxable: l.taxable });
    const common = { customerId: s.customer?.id ?? "", locationId: s.locationId || null, jobId: s.jobId, title: s.title, issueDate: s.issueDate, taxRate: s.taxRate || "0", discountType: s.discountType, discountValue: toBpOrCents(s.discountType, s.discountValue), terms: s.terms, customerNotes: s.customerNotes, internalNotes: s.internalNotes };
    const payload = multi
      ? { ...common, salespersonId: s.salespersonId, expiresAt: s.expiresAt || null, depositType: s.depositType, depositValue: toBpOrCents(s.depositType, s.depositValue), options: s.options.map((o) => ({ name: o.name, description: o.description, isRecommended: o.isRecommended, lines: o.lines.filter((l) => l.name.trim()).map(lineOut) })) }
      : { ...common, paymentTermsDays: s.paymentTermsDays, depositRequired: parseMoney(s.depositValue) ?? 0, lines: s.options[0]!.lines.filter((l) => l.name.trim()).map(lineOut) };
    start(async () => {
      const r = mode === "quote" ? await saveQuoteAction(s.id, payload) : await saveInvoiceAction(s.id, payload);
      if (r.ok) { toast.success(r.message ?? "Saved"); router.push(r.redirectTo!); router.refresh(); } else setError(r.error);
    });
  }

  return (
    <div className="space-y-5">
      {error && <div role="alert" className="rounded-md border border-red-200 bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</div>}
      <Card title={mode === "quote" ? "Quote details" : "Invoice details"}>
        <div className="space-y-4">
          <CustomerLocationPicker defaultCustomer={initial.customer} defaultLocationId={initial.locationId} requireLocation={false} lockCustomer={!!initial.id}
            onCustomerChange={(info) => { if (!info) { set("customer", null); return; } setTaxExempt(info.taxExempt); setS((p) => (p.customer?.id === info.id ? p : { ...p, customer: { id: info.id, name: "" } })); }} />
          <LocationSync onChange={(v) => set("locationId", v)} />
          <div className="grid gap-4 sm:grid-cols-4">
            <label className="space-y-1 sm:col-span-2"><span className="block text-[12.5px] font-medium text-fg-2">Title</span><Input value={s.title} onChange={(e) => set("title", e.target.value)} placeholder={mode === "quote" ? "System replacement" : "Service call"} /></label>
            <label className="space-y-1"><span className="block text-[12.5px] font-medium text-fg-2">Issue date</span><Input type="date" value={s.issueDate} onChange={(e) => set("issueDate", e.target.value)} /></label>
            {multi ? <label className="space-y-1"><span className="block text-[12.5px] font-medium text-fg-2">Expires</span><Input type="date" value={s.expiresAt} onChange={(e) => set("expiresAt", e.target.value)} /></label>
              : <label className="space-y-1"><span className="block text-[12.5px] font-medium text-fg-2">Payment terms (days)</span><Input type="number" min={0} value={s.paymentTermsDays} onChange={(e) => set("paymentTermsDays", e.target.value)} /></label>}
            {multi && <label className="space-y-1"><span className="block text-[12.5px] font-medium text-fg-2">Salesperson</span><Select value={s.salespersonId ?? ""} onChange={(e) => set("salespersonId", e.target.value || null)}><option value="">—</option>{salespeople.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></label>}
          </div>
        </div>
      </Card>

      {s.options.map((o, oi) => (
        <Card key={o.key} padded={false}
          title={multi ? <div className="flex items-center gap-2"><Input aria-label="Option name" value={o.name} onChange={(e) => patchOption(o.key, (x) => ({ ...x, name: e.target.value }))} className="h-7 w-56 font-semibold" /><label className="flex items-center gap-1.5 text-xs font-normal text-fg-2"><input type="radio" name="recommended" checked={o.isRecommended} onChange={() => setS((p) => ({ ...p, options: p.options.map((x) => ({ ...x, isRecommended: x.key === o.key })) }))} className="accent-primary" /> Recommended</label></div> : "Line items"}
          actions={multi && s.options.length > 1 ? <Button size="sm" variant="ghost" onClick={() => setS((p) => ({ ...p, options: p.options.filter((x) => x.key !== o.key) }))}>Remove option</Button> : null}>
          {multi && <div className="border-b border-line px-4 py-2"><Input aria-label="Option description" value={o.description} onChange={(e) => patchOption(o.key, (x) => ({ ...x, description: e.target.value }))} placeholder="Short description shown to the customer (optional)" className="h-7 text-xs" /></div>}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead><tr className="border-b border-line bg-surface-2/60 text-left text-xs font-semibold text-fg-3"><th className="px-3 py-2">Item</th><th className="w-20 px-2 py-2">Qty</th><th className="w-28 px-2 py-2">Unit price</th><th className="w-36 px-2 py-2">Discount</th><th className="w-12 px-2 py-2 text-center">Tax</th><th className="w-28 px-3 py-2 text-right">Total</th><th className="w-8" /></tr></thead>
              <tbody className="divide-y divide-line">
                {o.lines.map((l, li) => (
                  <tr key={l.key} className="align-top">
                    <td className="px-3 py-2"><Input aria-label="Item name" value={l.name} onChange={(e) => patchLine(o.key, l.key, { name: e.target.value, pricebookItemId: l.pricebookItemId && e.target.value !== l.name ? l.pricebookItemId : l.pricebookItemId })} placeholder="Description" />
                      <Input aria-label="Details" value={l.description} onChange={(e) => patchLine(o.key, l.key, { description: e.target.value })} placeholder="Details (optional)" className="mt-1 h-7 text-xs" /></td>
                    <td className="px-2 py-2"><Input aria-label="Quantity" inputMode="decimal" value={l.quantity} onChange={(e) => patchLine(o.key, l.key, { quantity: e.target.value })} className="text-right" /></td>
                    <td className="px-2 py-2"><Input aria-label="Unit price" inputMode="decimal" value={l.unitPrice} onChange={(e) => patchLine(o.key, l.key, { unitPrice: e.target.value })} placeholder="0.00" className="text-right" /></td>
                    <td className="px-2 py-2"><div className="flex gap-1"><Select aria-label="Discount type" value={l.discountType} onChange={(e) => patchLine(o.key, l.key, { discountType: e.target.value as DiscountType })} className="w-14 px-1"><option value="NONE">—</option><option value="PERCENT">%</option><option value="FIXED">$</option></Select>{l.discountType !== "NONE" && <Input aria-label="Discount value" inputMode="decimal" value={l.discountValue} onChange={(e) => patchLine(o.key, l.key, { discountValue: e.target.value })} className="w-16 text-right" />}</div></td>
                    <td className="px-2 py-2 text-center"><input type="checkbox" aria-label="Taxable" checked={l.taxable} onChange={(e) => patchLine(o.key, l.key, { taxable: e.target.checked })} className="mt-2 size-4 accent-primary" /></td>
                    <td className="tabular px-3 py-2 pt-3.5 text-right font-medium">{fmt(totals[oi]!.lines[li]?.netCents ?? 0)}</td>
                    <td className="px-1 py-2"><button type="button" aria-label="Remove line" onClick={() => patchOption(o.key, (x) => ({ ...x, lines: x.lines.filter((y) => y.key !== l.key) }))} className="mt-1.5 rounded p-1 text-fg-3 hover:bg-surface-2 hover:text-danger"><Icon name="x" size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
            <PricebookAdd currency={currency} onPick={(it) => patchOption(o.key, (x) => ({ ...x, lines: [...x.lines.filter((l) => l.name.trim() || l.unitPrice), { ...blankLine(), pricebookItemId: it.id, kind: it.kind, name: it.name, description: it.description ?? "", unitPrice: (it.priceCents / 100).toFixed(2), taxable: it.taxable }] }))} />
            <Button size="sm" variant="ghost" onClick={() => patchOption(o.key, (x) => ({ ...x, lines: [...x.lines, blankLine()] }))}><Icon name="plus" size={13} /> Custom line</Button>
            <div className="ml-auto tabular text-[13px] text-fg-2">{multi && <>Option subtotal <strong className="ml-1 text-fg">{fmt(totals[oi]!.subtotalCents)}</strong> · </>}Total <strong className="ml-1 text-base text-fg">{fmt(totals[oi]!.totalCents)}</strong></div>
          </div>
        </Card>
      ))}
      {multi && s.options.length < 5 && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setS((p) => ({ ...p, options: [...p.options, { key: newKey(), name: `Option ${p.options.length + 1}`, description: "", isRecommended: false, lines: [blankLine()] }] }))}><Icon name="plus" size={14} /> Add option (Good / Better / Best)</Button>
          {s.options.length > 0 && <Button variant="ghost" onClick={() => setS((p) => ({ ...p, options: [...p.options, { ...p.options[p.options.length - 1]!, key: newKey(), id: undefined, name: `${p.options[p.options.length - 1]!.name} (copy)`, isRecommended: false, lines: p.options[p.options.length - 1]!.lines.map((l) => ({ ...l, key: newKey() })) }] }))}>Duplicate last option</Button>}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Pricing" className="lg:col-span-1">
          <div className="space-y-3">
            <label className="block space-y-1"><span className="text-[12.5px] font-medium text-fg-2">Tax rate (%)</span><Input inputMode="decimal" value={taxExempt ? "0" : s.taxRate} disabled={taxExempt} onChange={(e) => set("taxRate", e.target.value)} />{taxExempt && <span className="text-xs text-fg-3">Customer is tax exempt.</span>}</label>
            <div className="space-y-1"><span className="block text-[12.5px] font-medium text-fg-2">Document discount</span><div className="flex gap-2"><Select aria-label="Discount type" value={s.discountType} onChange={(e) => set("discountType", e.target.value as DiscountType)} className="w-20"><option value="NONE">None</option><option value="PERCENT">%</option><option value="FIXED">$</option></Select>{s.discountType !== "NONE" && <Input aria-label="Discount value" inputMode="decimal" value={s.discountValue} onChange={(e) => set("discountValue", e.target.value)} />}</div></div>
            {multi ? (
              <div className="space-y-1"><span className="block text-[12.5px] font-medium text-fg-2">Deposit required</span><div className="flex gap-2"><Select aria-label="Deposit type" value={s.depositType} onChange={(e) => set("depositType", e.target.value as DiscountType)} className="w-20"><option value="NONE">None</option><option value="PERCENT">%</option><option value="FIXED">$</option></Select>{s.depositType !== "NONE" && <Input aria-label="Deposit value" inputMode="decimal" value={s.depositValue} onChange={(e) => set("depositValue", e.target.value)} />}</div></div>
            ) : (
              <label className="block space-y-1"><span className="text-[12.5px] font-medium text-fg-2">Deposit required ($)</span><Input inputMode="decimal" value={s.depositValue} onChange={(e) => set("depositValue", e.target.value)} placeholder="0.00" /></label>
            )}
          </div>
        </Card>
        <Card title="Totals" className="lg:col-span-2">
          <div className="space-y-4">{s.options.map((o, i) => { const t = totals[i]!; return (
            <div key={o.key}>{multi && <div className="mb-1 text-xs font-semibold text-fg-3">{o.name || `Option ${i + 1}`}</div>}
              <dl className="tabular space-y-1 text-[13px]">
                <Row label="Subtotal" v={fmt(t.subtotalCents)} />
                {t.discountCents > 0 && <Row label="Discount" v={`−${fmt(t.discountCents)}`} />}
                <Row label={`Tax (${(taxRateBp / 100).toFixed(2)}%)`} v={fmt(t.taxCents)} />
                <Row label="Total" v={fmt(t.totalCents)} strong />
                {(multi ? t.depositCents > 0 : (parseMoney(s.depositValue) ?? 0) > 0) && <Row label="Deposit due" v={fmt(multi ? t.depositCents : Math.min(parseMoney(s.depositValue) ?? 0, t.totalCents))} />}
              </dl></div>); })}
          </div>
          <p className="mt-3 text-xs text-fg-3">Preview only — totals are recalculated on the server when you save.</p>
        </Card>
      </div>

      <Card title="Notes & terms">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1"><span className="block text-[12.5px] font-medium text-fg-2">Customer notes</span><Textarea rows={3} value={s.customerNotes} onChange={(e) => set("customerNotes", e.target.value)} placeholder="Shown to the customer" /></label>
          <label className="space-y-1"><span className="block text-[12.5px] font-medium text-fg-2">Internal notes</span><Textarea rows={3} value={s.internalNotes} onChange={(e) => set("internalNotes", e.target.value)} placeholder="Office only" /></label>
        </div>
        <label className="mt-4 block space-y-1"><span className="text-[12.5px] font-medium text-fg-2">Terms & conditions</span><Textarea rows={4} value={s.terms} onChange={(e) => set("terms", e.target.value)} /></label>
      </Card>

      <div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-3 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur lg:-mx-8 lg:px-8">
        <div className="tabular text-[13px] text-fg-2">{multi ? `${s.options.length} option${s.options.length === 1 ? "" : "s"}` : "Invoice total"} · <strong className="text-base text-fg">{fmt(multi ? (totals.find((_, i) => s.options[i]!.isRecommended) ?? totals[0])!.totalCents : totals[0]!.totalCents)}</strong></div>
        <div className="flex gap-2"><Button variant="ghost" onClick={() => router.back()}>Cancel</Button><Button variant="primary" onClick={submit} disabled={pending || !s.customer?.id}>{pending && <Spinner />} {s.id ? "Save changes" : `Create ${mode}`}</Button></div>
      </div>
    </div>
  );
}

function Row({ label, v, strong }: { label: string; v: string; strong?: boolean }) {
  return <div className={cn("flex justify-between", strong && "border-t border-line pt-1 text-sm font-semibold")}><dt className={strong ? "" : "text-fg-3"}>{label}</dt><dd>{v}</dd></div>;
}

/** Mirrors the picker's location <select> into editor state without re-rendering the picker. */
function LocationSync({ onChange }: { onChange: (v: string) => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const sel = ref.current?.parentElement?.querySelector<HTMLSelectElement>("select[name=locationId]");
    if (!sel) return;
    const handler = () => onChange(sel.value);
    handler();
    sel.addEventListener("change", handler);
    const obs = new MutationObserver(handler);
    obs.observe(sel, { childList: true });
    const t = setInterval(handler, 600);
    return () => { sel.removeEventListener("change", handler); obs.disconnect(); clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <span ref={ref} className="hidden" />;
}

function PricebookAdd({ onPick, currency }: { onPick: (i: { id: string; name: string; kind: string; priceCents: number; taxable: boolean; description: string | null }) => void; currency: string }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [res, setRes] = useState<{ id: string; name: string; sku: string | null; kind: string; priceCents: number; taxable: boolean; description: string | null; category: string | null }[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);
  useEffect(() => {
    if (!open) return;
    const my = ++seqRef.current;
    const t = setTimeout(() => pricebookSearchAction(q).then((r) => my === seqRef.current && setRes(r)), 150);
    return () => clearTimeout(t);
  }, [q, open]);
  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  return (
    <div ref={box} className="relative">
      <Input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Add from pricebook…" aria-label="Add from pricebook" className="w-64" />
      {open && (
        <ul className="absolute bottom-full z-30 mb-1 max-h-72 w-96 overflow-auto rounded-lg border border-line bg-surface py-1 shadow-pop" role="listbox">
          {res.length === 0 && <li className="px-3 py-2 text-[13px] text-fg-3">No items found</li>}
          {res.map((i) => <li key={i.id}><button type="button" role="option" aria-selected="false" onClick={() => { onPick(i); setQ(""); setOpen(false); }} className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-primary-soft"><span><span className="block text-[13px] font-medium">{i.name}</span><span className="text-xs text-fg-3">{[i.category, i.sku].filter(Boolean).join(" · ")}</span></span><span className="tabular text-[13px]">{formatMoney(i.priceCents, currency)}</span></button></li>)}
        </ul>
      )}
    </div>
  );
}

void Checkbox;
