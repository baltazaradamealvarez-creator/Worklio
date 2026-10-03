"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { portalMessageAction, respondToQuoteAction, startCheckoutAction, updatePortalContactAction } from "@/app/actions/public";
import { ActionForm, Spinner, SubmitButton } from "@/components/ui/client";
import { Input, Select, Textarea } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/money";

function Signature({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  useEffect(() => {
    const c = ref.current!;
    const r = window.devicePixelRatio || 1;
    c.width = c.clientWidth * r; c.height = c.clientHeight * r;
    const g = c.getContext("2d")!; g.scale(r, r); g.lineWidth = 2.2; g.lineCap = "round"; g.strokeStyle = "#111827";
  }, []);
  const pos = (e: React.PointerEvent) => { const b = ref.current!.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  return (
    <div>
      <canvas ref={ref} aria-label="Signature" className="h-28 w-full touch-none rounded-lg border-2 border-dashed border-line-strong bg-white"
        onPointerDown={(e) => { drawing.current = true; ref.current!.setPointerCapture(e.pointerId); const g = ref.current!.getContext("2d")!; const p = pos(e); g.beginPath(); g.moveTo(p.x, p.y); }}
        onPointerMove={(e) => { if (!drawing.current) return; const g = ref.current!.getContext("2d")!; const p = pos(e); g.lineTo(p.x, p.y); g.stroke(); }}
        onPointerUp={() => { drawing.current = false; onChange(ref.current!.toDataURL("image/png")); }} />
      <button type="button" className="mt-1 text-xs text-primary hover:underline" onClick={() => { const c = ref.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); onChange(null); }}>Clear signature</button>
    </div>
  );
}

export function QuoteResponse({ token, quoteId, options, requireSignature, brandColor, currency }: { token: string; quoteId: string | null; options: { id: string; name: string; totalCents: number; isRecommended: boolean }[]; requireSignature: boolean; brandColor: string; currency: string }) {
  const router = useRouter();
  const [option, setOption] = useState(options.length === 1 ? options[0]!.id : (options.find((o) => o.isRecommended)?.id ?? ""));
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [sig, setSig] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"approve" | "decline" | null>(null);

  const send = (action: "approve" | "decline") =>
    start(async () => {
      setError(null);
      const r = await respondToQuoteAction(token, quoteId, { action, optionId: option || undefined, message: message || undefined, signerName: name || undefined, signatureData: sig ?? undefined });
      if (r.ok) { toast.success(r.message); router.refresh(); } else setError(r.error);
    });

  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-sm" aria-label="Your response">
      <h2 className="text-base font-semibold">Ready to move forward?</h2>
      {options.length > 1 && (
        <fieldset className="mt-3 space-y-2"><legend className="mb-1 text-[13px] text-fg-3">Choose the option you'd like to approve</legend>
          {options.map((o) => (
            <label key={o.id} className={cn("flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3", option === o.id ? "border-primary bg-primary-soft" : "border-line-strong")} style={option === o.id ? { borderColor: brandColor } : undefined}>
              <span className="flex items-center gap-3"><input type="radio" name="option" value={o.id} checked={option === o.id} onChange={() => setOption(o.id)} className="size-4" style={{ accentColor: brandColor }} /><span className="text-[14px] font-medium">{o.name}{o.isRecommended && <span className="ml-2 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary">Recommended</span>}</span></span>
              <span className="tabular text-[14px] font-semibold">{formatMoney(o.totalCents, currency)}</span>
            </label>
          ))}
        </fieldset>
      )}
      {error && <div role="alert" className="mt-3 rounded-md border border-red-200 bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</div>}
      {mode === null && (
        <div className="mt-4 flex flex-wrap gap-3">
          <button disabled={options.length > 1 && !option} onClick={() => setMode("approve")} className="h-11 flex-1 rounded-lg px-5 text-[15px] font-semibold text-white shadow-sm disabled:opacity-50" style={{ background: brandColor }}>Approve quote</button>
          <button onClick={() => setMode("decline")} className="h-11 rounded-lg border border-line-strong bg-surface px-5 text-[14px] font-medium text-fg-2 hover:bg-surface-2">Decline</button>
        </div>
      )}
      {mode && (
        <div className="mt-4 space-y-3">
          {mode === "approve" && (
            <div className="space-y-3">
              <label className="block space-y-1"><span className="text-[13px] font-medium text-fg-2">Type your full name{requireSignature ? "" : " (optional)"}</span><Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
              <div className="space-y-1"><span className="text-[13px] font-medium text-fg-2">Sign below{requireSignature ? "" : " (optional)"}</span><Signature onChange={setSig} /></div>
            </div>
          )}
          <label className="block space-y-1"><span className="text-[13px] font-medium text-fg-2">{mode === "approve" ? "Message for the team (optional)" : "Tell us why (optional)"}</span><Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} /></label>
          <div className="flex gap-3">
            <button disabled={pending} onClick={() => send(mode)} className={cn("flex h-11 flex-1 items-center justify-center gap-2 rounded-lg px-5 text-[15px] font-semibold shadow-sm disabled:opacity-60", mode === "approve" ? "text-white" : "border border-red-300 bg-danger-soft text-danger")} style={mode === "approve" ? { background: brandColor } : undefined}>{pending && <Spinner />}{mode === "approve" ? "Confirm approval" : "Confirm decline"}</button>
            <button onClick={() => setMode(null)} className="h-11 rounded-lg px-4 text-[14px] text-fg-2 hover:bg-surface-2">Back</button>
          </div>
          {mode === "approve" && <p className="text-xs text-fg-3">By approving, you authorise the work and pricing described above. A record of your approval is saved with the date and time.</p>}
        </div>
      )}
    </section>
  );
}

export function PayButton({ token, invoiceId, brandColor, label }: { token: string; invoiceId: string | null; brandColor: string; label: string }) {
  const [pending, start] = useTransition();
  return (
    <button disabled={pending} onClick={() => start(async () => { const r = await startCheckoutAction(token, invoiceId); if (r.ok && r.data?.url) window.location.href = r.data.url; else if (!r.ok) toast.error(r.error); })}
      className="flex h-12 w-full items-center justify-center gap-2 rounded-lg text-[15px] font-semibold text-white shadow-sm disabled:opacity-60" style={{ background: brandColor }}>
      {pending && <Spinner />} {label}
    </button>
  );
}

export function PortalContactForm({ token, customer }: { token: string; customer: { phone: string | null; phoneAlt: string | null; email: string | null; preferredContact: string } }) {
  return (
    <ActionForm action={updatePortalContactAction.bind(null, token)} className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1"><span className="text-[12.5px] font-medium text-fg-2">Phone</span><Input name="phone" type="tel" defaultValue={customer.phone ?? ""} /></label>
      <label className="space-y-1"><span className="text-[12.5px] font-medium text-fg-2">Alternate phone</span><Input name="phoneAlt" type="tel" defaultValue={customer.phoneAlt ?? ""} /></label>
      <label className="space-y-1"><span className="text-[12.5px] font-medium text-fg-2">Email</span><Input name="email" type="email" defaultValue={customer.email ?? ""} /></label>
      <label className="space-y-1"><span className="text-[12.5px] font-medium text-fg-2">Preferred contact</span><Select name="preferredContact" defaultValue={customer.preferredContact}><option value="PHONE">Phone call</option><option value="SMS">Text message</option><option value="EMAIL">Email</option></Select></label>
      <div className="sm:col-span-2"><SubmitButton variant="secondary">Save contact info</SubmitButton></div>
    </ActionForm>
  );
}

export function PortalMessageForm({ token }: { token: string }) {
  return (
    <ActionForm action={portalMessageAction.bind(null, token)} resetOnSuccess className="space-y-3">
      <label className="block space-y-1"><span className="text-[12.5px] font-medium text-fg-2">Subject (optional)</span><Input name="subject" maxLength={120} /></label>
      <label className="block space-y-1"><span className="text-[12.5px] font-medium text-fg-2">Message</span><Textarea name="message" rows={4} required /></label>
      <SubmitButton variant="secondary">Send message</SubmitButton>
    </ActionForm>
  );
}
