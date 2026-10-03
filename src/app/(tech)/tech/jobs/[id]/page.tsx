import Link from "next/link";
import { removeLineAction } from "@/app/actions/jobs";
import { AddLineDialog, ChecklistToggle } from "@/components/jobs/client";
import { CompleteSheet, NextStepButton, PauseButton, PhotoUpload, QuickNote, RecommendRepair, SignaturePad } from "@/components/tech/client";
import { NoteBody } from "@/components/records/note-body";
import { ConfirmAction } from "@/components/ui/client";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/primitives";
import { can } from "@/server/auth/context";
import { requireCtx } from "@/server/auth/server";
import { listAttachments } from "@/server/domain/attachments";
import { fieldJob } from "@/server/domain/field";
import { toNumber } from "@/server/domain/shared";
import { formatAddress, formatDate, formatDateOnly, formatDateTime, formatPhone, humanize, mapsUrl } from "@/lib/format";
import { getSettings } from "@/server/domain/settings";

function Section({ title, children, count }: { title: string; children: React.ReactNode; count?: number }) {
  return <section className="mt-5"><h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-fg-3">{title}{count != null && <span className="rounded-full bg-surface-2 px-1.5 text-[11px]">{count}</span>}</h2><div className="rounded-2xl border border-line bg-surface p-4">{children}</div></section>;
}

export default async function TechJob({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const [{ job, notes, history, locationEquipment, appointment }, settings, photos] = await Promise.all([fieldJob(ctx, id), getSettings(ctx), can(ctx, "files.view") ? listAttachments(ctx, "JOB", id) : []]);
  const addr = formatAddress(job.location);
  const finished = job.status === "COMPLETED" || job.status === "CANCELLED";
  const inProgress = job.status === "IN_PROGRESS";
  const openItems = job.checklist.filter((c) => !c.isDone).length;
  const warnings = notes.filter((n) => n.type === "WARNING" || n.type === "ACCESS");
  const tz = settings.timezone;
  return (
    <>
      <Link href="/tech" className="mb-3 inline-flex items-center gap-1 text-[13px] font-medium text-primary"><Icon name="chevron-left" size={15} /> All jobs</Link>
      <div className="flex items-start justify-between gap-3"><div><h1 className="text-xl font-semibold leading-tight">{job.customer.displayName}</h1><p className="mt-0.5 text-[14px] text-fg-2"><span className="font-mono text-xs text-fg-3">{job.number}</span> · {job.title}</p></div><StatusBadge status={job.status} /></div>
      {appointment && <p className="mt-1 text-[13px] text-fg-3">{formatDateTime(appointment.startsAt, tz)} · {job.estimatedMinutes} min est.</p>}

      {warnings.length > 0 && (
        <div className="mt-4 space-y-2" role="alert">{warnings.map((n) => <div key={n.id} className={`flex gap-3 rounded-2xl border p-3.5 ${n.type === "WARNING" ? "border-red-300 bg-danger-soft" : "border-amber-300 bg-warn-soft"}`}><Icon name="alert-triangle" size={20} className={n.type === "WARNING" ? "shrink-0 text-danger" : "shrink-0 text-warn"} /><div><div className="text-xs font-bold uppercase tracking-wide">{n.type === "WARNING" ? "Important warning" : "Access"}</div><NoteBody body={n.body} /></div></div>)}</div>
      )}

      {!finished && <div className="mt-4 space-y-3"><NextStepButton jobId={id} appointmentStatus={appointment?.status ?? null} jobStatus={job.status} />
        {inProgress && <div className="flex gap-3"><PauseButton jobId={id} /><CompleteSheet jobId={id} openItems={openItems} /></div>}</div>}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <a href={mapsUrl(addr)} target="_blank" rel="noreferrer" className="flex h-12 items-center justify-center gap-2 rounded-xl border border-line-strong bg-surface text-[14px] font-medium text-primary"><Icon name="navigation" size={17} /> Directions</a>
        {job.customer.phone ? <a href={`tel:${job.customer.phone}`} className="flex h-12 items-center justify-center gap-2 rounded-xl border border-line-strong bg-surface text-[14px] font-medium text-primary"><Icon name="phone" size={17} /> Call</a> : <span />}
      </div>

      <Section title="Location"><p className="text-[15px] font-medium">{addr}</p>
        <dl className="mt-2 space-y-1.5 text-[14px]">
          {job.location.gateInstructions && <div><dt className="text-xs text-fg-3">Gate / access</dt><dd>{job.location.gateInstructions}</dd></div>}
          {job.location.parkingInstructions && <div><dt className="text-xs text-fg-3">Parking</dt><dd>{job.location.parkingInstructions}</dd></div>}
          {job.location.accessCodes && <div><dt className="text-xs text-fg-3">Access codes</dt><dd className="font-mono">{job.location.accessCodes}</dd></div>}
          {job.location.onSiteContactName && <div><dt className="text-xs text-fg-3">On-site contact</dt><dd>{job.location.onSiteContactName} {job.location.onSiteContactPhone && <a className="text-primary" href={`tel:${job.location.onSiteContactPhone}`}>{formatPhone(job.location.onSiteContactPhone)}</a>}</dd></div>}
        </dl></Section>

      {job.description && <Section title="Job description"><p className="whitespace-pre-line text-[14px]">{job.description}</p>{job.customerNotes && <p className="mt-2 border-t border-line pt-2 text-[13px] text-fg-2"><strong>Customer note:</strong> {job.customerNotes}</p>}</Section>}

      {notes.filter((n) => !["WARNING", "ACCESS"].includes(n.type)).length > 0 && <Section title="Pinned notes">{notes.filter((n) => !["WARNING", "ACCESS"].includes(n.type)).map((n) => <div key={n.id} className="mb-2 last:mb-0"><NoteBody body={n.body} /></div>)}</Section>}

      {job.checklist.length > 0 && <Section title="Checklist" count={openItems}><div className="divide-y divide-line">{job.checklist.map((c) => <ChecklistToggle key={c.id} jobId={id} itemId={c.id} done={c.isDone} label={c.label} disabled={finished || !inProgress} />)}</div>{!inProgress && !finished && <p className="mt-2 text-xs text-fg-3">Start the job to work through the checklist.</p>}</Section>}

      <Section title="Equipment at this location" count={locationEquipment.length}>
        {locationEquipment.length === 0 ? <p className="text-[14px] text-fg-3">No equipment recorded. Add the data-plate details after your visit.</p> : <ul className="divide-y divide-line">{locationEquipment.map((e) => <li key={e.id} className="py-2.5 first:pt-0 last:pb-0"><div className="text-[14px] font-medium">{[e.manufacturer, e.model].filter(Boolean).join(" ") || humanize(e.type)}</div><div className="text-xs text-fg-3">{humanize(e.type)}{e.serialNumber ? ` · S/N ${e.serialNumber}` : ""}{e.installDate ? ` · installed ${formatDateOnly(e.installDate)}` : ""}</div>{e.laborWarrantyExpiresAt && e.laborWarrantyExpiresAt > new Date() && <div className="mt-0.5 text-xs font-medium text-success">Labor warranty until {formatDateOnly(e.laborWarrantyExpiresAt)}</div>}</li>)}</ul>}
      </Section>

      <Section title="Services & materials" count={job.lineItems.length}>
        {job.lineItems.length === 0 ? <p className="text-[14px] text-fg-3">Nothing added yet.</p> : <ul className="divide-y divide-line">{job.lineItems.map((l) => <li key={l.id} className="flex items-center justify-between gap-3 py-2 first:pt-0"><div className="min-w-0"><div className="truncate text-[14px] font-medium">{l.name}</div><div className="text-xs text-fg-3">{humanize(l.kind)} · qty {toNumber(l.quantity)}</div></div>{!finished && l.addedById === ctx.userId && !l.invoicedAt && <ConfirmAction size="sm" variant="ghost" label={<Icon name="trash-2" size={15} />} title="Remove this item?" confirmLabel="Remove" action={removeLineAction.bind(null, id, l.id)} />}</li>)}</ul>}
        {!finished && <div className="mt-3"><AddLineDialog jobId={id} canCustom={can(ctx, "jobs.edit")} currency={settings.currency} /></div>}
      </Section>

      {can(ctx, "files.upload") && !finished && <Section title="Photos" count={photos.length}>
        {photos.length > 0 && <ul className="mb-3 grid grid-cols-3 gap-2">{photos.filter((p) => p.mimeType.startsWith("image/")).map((p) => <li key={p.id} className="relative aspect-square overflow-hidden rounded-lg bg-surface-2">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={`/api/files/${p.id}`} alt={p.caption ?? p.filename} loading="lazy" className="size-full object-cover" /><span className="absolute bottom-0 left-0 rounded-tr bg-black/60 px-1.5 text-[10px] font-semibold text-white">{p.kind === "BEFORE_PHOTO" ? "Before" : p.kind === "AFTER_PHOTO" ? "After" : "During"}</span></li>)}</ul>}
        <PhotoUpload jobId={id} /></Section>}

      {can(ctx, "notes.create") && !finished && <Section title="Add a note"><QuickNote jobId={id} /></Section>}
      {can(ctx, "quotes.view") && !finished && <div className="mt-5"><RecommendRepair jobId={id} /></div>}

      {!finished && inProgress && <Section title="Customer signature">{job.signatures.length > 0 ? <p className="text-[14px] text-success">Signed by {job.signatures.at(-1)!.signerName} · {formatDateTime(job.signatures.at(-1)!.signedAt, tz)}</p> : <SignaturePad jobId={id} />}</Section>}

      {history.length > 0 && <Section title="Previous visits here" count={history.length}><ul className="divide-y divide-line">{history.map((h) => <li key={h.id} className="py-2.5 first:pt-0 last:pb-0"><div className="text-[14px] font-medium">{h.title} <span className="text-xs font-normal text-fg-3">· {h.actualEnd ? formatDate(h.actualEnd, tz) : ""}</span></div><div className="text-xs text-fg-3">{h.assignees.map((a) => a.employee.firstName).join(", ")}</div>{h.technicianNotes && <p className="mt-1 text-[13px] text-fg-2">{h.technicianNotes}</p>}</li>)}</ul></Section>}
    </>
  );
}

