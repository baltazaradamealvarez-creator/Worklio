"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { completeJobAction, fieldActionAction, recommendRepairAction, signatureAction } from "@/app/actions/jobs";
import { addNoteAction, uploadFilesAction } from "@/app/actions/customers";
import { ActionForm, Dialog, Spinner, SubmitButton } from "@/components/ui/client";
import { Button, Checkbox, Textarea } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";

type Step = "travel" | "arrive" | "start" | "pause" | "resume";

/** The one big button: always the next sensible step for the visit. */
export function NextStepButton({ jobId, appointmentStatus, jobStatus }: { jobId: string; appointmentStatus: string | null; jobStatus: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const step: { action: Step; label: string; icon: string } | null =
    jobStatus === "ON_HOLD" ? { action: "resume", label: "Resume job", icon: "check" }
    : appointmentStatus === "SCHEDULED" || appointmentStatus === "DISPATCHED" ? { action: "travel", label: "Start travel", icon: "navigation" }
    : appointmentStatus === "EN_ROUTE" ? { action: "arrive", label: "I've arrived", icon: "map-pin" }
    : appointmentStatus === "ARRIVED" ? { action: "start", label: "Start job", icon: "wrench" }
    : null;
  if (!step) return null;
  return (
    <button disabled={pending} onClick={() => start(async () => { const r = await fieldActionAction(jobId, step.action); if (r.ok) { toast.success(r.message); router.refresh(); } else toast.error(r.error); })}
      className="flex h-14 w-full items-center justify-center gap-3 rounded-xl bg-primary text-base font-semibold text-white shadow-lg active:scale-[0.99] disabled:opacity-60">
      {pending ? <Spinner /> : <Icon name={step.icon} size={20} />} {step.label}
    </button>
  );
}

export function PauseButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return <Button size="lg" variant="secondary" className="h-12 flex-1" disabled={pending} onClick={() => start(async () => { const r = await fieldActionAction(jobId, "pause"); if (r.ok) { toast.success(r.message); router.refresh(); } else toast.error(r.error); })}>Pause</Button>;
}

export function CompleteSheet({ jobId, openItems }: { jobId: string; openItems: number }) {
  const [followUp, setFollowUp] = useState(false);
  return (
    <Dialog triggerClassName="flex-1" title="Complete this job" description="Add your notes — the office sees them right away." trigger={<button className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-success text-[15px] font-semibold text-white shadow-md"><Icon name="check" size={18} /> Complete</button>}>
      <ActionForm action={completeJobAction.bind(null, jobId)} className="space-y-4">
        <label className="block space-y-1"><span className="text-[13px] font-medium text-fg-2">What was done? (technician notes)</span><Textarea name="technicianNotes" rows={5} required placeholder="Findings, work performed, readings, recommendations…" /></label>
        <label className="block space-y-1"><span className="text-[13px] font-medium text-fg-2">Note for the customer (optional)</span><Textarea name="customerNotes" rows={2} /></label>
        <Checkbox name="followUpRequired" label="A follow-up visit is needed" onChange={(e) => setFollowUp(e.target.checked)} />
        {followUp && <label className="block space-y-1"><span className="text-[13px] font-medium text-fg-2">What's needed?</span><Textarea name="followUpReason" rows={2} required /></label>}
        {openItems > 0 && <Checkbox name="allowIncomplete" label={`${openItems} checklist item${openItems === 1 ? " is" : "s are"} not done — complete anyway`} />}
        <SubmitButton size="lg" className="w-full" variant="primary">Finish job</SubmitButton>
      </ActionForm>
    </Dialog>
  );
}

export function QuickNote({ jobId }: { jobId: string }) {
  return (
    <ActionForm action={addNoteAction.bind(null, "JOB", jobId)} resetOnSuccess className="space-y-2">
      <input type="hidden" name="type" value="TECHNICIAN" />
      <Textarea name="body" rows={3} required placeholder="Add a note for the office or the next technician…" aria-label="Note" className="text-[15px]" />
      <SubmitButton variant="secondary" size="lg" className="w-full">Save note</SubmitButton>
    </ActionForm>
  );
}

export function PhotoUpload({ jobId }: { jobId: string }) {
  const [kind, setKind] = useState("PHOTO");
  return (
    <ActionForm action={uploadFilesAction.bind(null, "JOB", jobId)} resetOnSuccess className="space-y-3">
      <div className="flex gap-2" role="radiogroup" aria-label="Photo type">
        {[["BEFORE_PHOTO", "Before"], ["PHOTO", "During"], ["AFTER_PHOTO", "After"]].map(([k, l]) => <button type="button" key={k} role="radio" aria-checked={kind === k} onClick={() => setKind(k!)} className={cn("flex-1 rounded-lg border py-2 text-[13px] font-medium", kind === k ? "border-primary bg-primary-soft text-primary" : "border-line-strong bg-surface")}>{l}</button>)}
      </div>
      <input type="hidden" name="kind" value={kind} />
      <label className="flex h-14 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line-strong bg-surface text-[15px] font-medium text-fg-2 hover:bg-surface-2">
        <Icon name="camera" size={20} /> Take or choose photos
        <input type="file" name="files" accept="image/*" capture="environment" multiple required className="sr-only" onChange={(e) => e.currentTarget.form?.requestSubmit()} />
      </label>
    </ActionForm>
  );
}

export function RecommendRepair({ jobId }: { jobId: string }) {
  return (
    <Dialog triggerClassName="w-full" title="Recommend a repair" description="The office gets a task and a notification to prepare a quote." trigger={<Button size="lg" variant="secondary" className="h-12 w-full"><Icon name="file-text" size={16} /> Recommend repair / request quote</Button>}>
      <ActionForm action={recommendRepairAction.bind(null, jobId)} className="space-y-3">
        <Textarea name="notes" rows={5} required placeholder="What needs to be repaired or replaced, and why?" />
        <SubmitButton size="lg" className="w-full">Send to the office</SubmitButton>
      </ActionForm>
    </Dialog>
  );
}

/** Touch/mouse signature capture → PNG data URL. */
export function SignaturePad({ jobId }: { jobId: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [name, setName] = useState("");
  const [empty, setEmpty] = useState(true);
  const [pending, start] = useTransition();
  const router = useRouter();

  useEffect(() => {
    const c = canvas.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio; c.height = c.clientHeight * ratio;
    const ctx = c.getContext("2d")!; ctx.scale(ratio, ratio); ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.strokeStyle = "#111827";
  }, []);
  const pos = (e: React.PointerEvent) => { const r = canvas.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  return (
    <div className="space-y-3">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer's printed name" aria-label="Customer name" className="h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-[15px]" />
      <canvas ref={canvas} aria-label="Signature area" className="h-40 w-full touch-none rounded-lg border-2 border-dashed border-line-strong bg-white"
        onPointerDown={(e) => { drawing.current = true; canvas.current!.setPointerCapture(e.pointerId); const c = canvas.current!.getContext("2d")!; const p = pos(e); c.beginPath(); c.moveTo(p.x, p.y); setEmpty(false); }}
        onPointerMove={(e) => { if (!drawing.current) return; const c = canvas.current!.getContext("2d")!; const p = pos(e); c.lineTo(p.x, p.y); c.stroke(); }}
        onPointerUp={() => { drawing.current = false; }} />
      <div className="flex gap-2">
        <Button variant="secondary" className="h-11 flex-1" onClick={() => { const c = canvas.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); setEmpty(true); }}>Clear</Button>
        <Button variant="primary" className="h-11 flex-[2]" disabled={empty || !name.trim() || pending} onClick={() => start(async () => {
          const r = await signatureAction(jobId, name.trim(), canvas.current!.toDataURL("image/png"));
          if (r.ok) { toast.success("Signature saved"); router.refresh(); } else toast.error(r.error);
        })}>{pending && <Spinner />} Save signature</Button>
      </div>
    </div>
  );
}
