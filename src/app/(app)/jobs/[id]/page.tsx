import type { Metadata } from "next";
import Link from "next/link";
import { assignJobAction, cancelAppointmentAction, dispatchAppointmentAction, invoiceJobAction, removeChecklistAction, removeLineAction, addChecklistAction } from "@/app/actions/jobs";
import { AddLineDialog, ChecklistToggle, JobStatusMenu, ScheduleDialog, TechPicker } from "@/components/jobs/client";
import { FilesPanel } from "@/components/records/files-panel";
import { NotesPanel } from "@/components/records/notes-panel";
import { Timeline } from "@/components/records/timeline";
import { ActionForm, ConfirmAction, Dialog, QuickAction, SubmitButton } from "@/components/ui/client";
import { Avatar, Badge, Button, Card, DefList, EmptyState, Input, LinkButton, Money, Notice, PageHeader, StatusBadge, Tabs } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
import { can } from "@/server/auth/context";
import { listAttachments } from "@/server/domain/attachments";
import { listTechnicians } from "@/server/domain/employees";
import { getJob } from "@/server/domain/jobs";
import { pinnedNotesForJob, listMentionable, listNotes } from "@/server/domain/notes";
import { effectiveInvoiceStatus } from "@/lib/state";
import { formatAddress, formatDate, formatDateOnly, formatDateTime, formatPhone, humanize, mapsUrl, toLocalInput } from "@/lib/format";
import { toNumber } from "@/server/domain/shared";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Job" };
const NEEDS_REASON = new Set(["ON_HOLD", "CANCELLED", "NEEDS_FOLLOW_UP"]);

export default async function JobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx, tz, currency } = await pageCtx();
  const job = await getJob(ctx, id);
  const canEdit = can(ctx, "jobs.edit");
  const canSchedule = can(ctx, "schedule.manage");
  const tab = ["overview", "notes", "files", "activity"].includes(sp.tab ?? "") ? sp.tab! : "overview";
  const technicians = can(ctx, "jobs.assign") || canSchedule ? await listTechnicians(ctx) : [];
  const techOpts = technicians.map((t) => ({ id: t.id, name: `${t.firstName} ${t.lastName}`, color: t.calendarColor }));
  const lineTotal = job.lineItems.reduce((s, l) => s + Math.round(toNumber(l.quantity) * 100) * l.unitPriceCents / 100, 0);
  const active = job.appointments.filter((a) => !["CANCELLED", "COMPLETED", "NO_SHOW"].includes(a.status));
  const statusOptions = job.allowedTransitions.filter((s) => !["SCHEDULED", "DISPATCHED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED"].includes(s) || (s === "SCHEDULED" && false)).map((s) => ({ to: s, needsReason: NEEDS_REASON.has(s) }));
  const defaultStart = toLocalInput(new Date(Date.now() + 86_400_000), tz).slice(0, 11) + "09:00";

  return (
    <>
      <PageHeader
        title={<span><span className="font-mono text-base text-fg-3">{job.number}</span> {job.title}</span>}
        breadcrumbs={[{ label: "Jobs", href: "/jobs" }, { label: job.number }]}
        badges={<><StatusBadge status={job.status} />{job.priority !== "NORMAL" && <StatusBadge status={job.priority} />}</>}
        subtitle={<span><Link href={`/customers/${job.customer.id}`} className="hover:text-primary hover:underline">{job.customer.displayName}</Link> · {formatAddress(job.location)}{job.jobType ? ` · ${job.jobType.name}` : ""}</span>}
        actions={<>
          {canSchedule && !["COMPLETED", "CANCELLED"].includes(job.status) && <ScheduleDialog jobId={id} technicians={techOpts} defaultAssigneeIds={job.assignees.map((a) => a.employeeId)} defaultMinutes={job.estimatedMinutes} defaultStart={defaultStart} label={active.length ? "Reschedule / add visit" : "Schedule"} />}
          {canEdit && <JobStatusMenu jobId={id} options={statusOptions} />}
          {can(ctx, "invoices.create") && job.lineItems.some((l) => !l.invoicedAt) && job.status !== "CANCELLED" && <QuickAction label="Create invoice" variant="secondary" action={invoiceJobAction.bind(null, id)} />}
          {can(ctx, "quotes.create") && <LinkButton href={`/quotes/new?customer=${job.customerId}&job=${id}`}>New quote</LinkButton>}
          {canEdit && !["COMPLETED", "CANCELLED"].includes(job.status) && <LinkButton href={`/jobs/${id}/edit`}>Edit</LinkButton>}
          <LinkButton href={`/tech/jobs/${id}`} variant="ghost" title="Open the technician view of this job"><Icon name="wrench" size={14} /> Field view</LinkButton>
        </>}
      />
      {job.holdReason && job.status === "ON_HOLD" && <div className="mb-4"><Notice tone="warn" title="On hold">{job.holdReason}</Notice></div>}
      {job.followUpReason && job.status === "NEEDS_FOLLOW_UP" && <div className="mb-4"><Notice tone="warn" title="Follow-up needed">{job.followUpReason}</Notice></div>}
      {job.cancelReason && job.status === "CANCELLED" && <div className="mb-4"><Notice tone="danger" title="Cancelled">{job.cancelReason}</Notice></div>}
      <Tabs tabs={[{ key: "overview", label: "Overview" }, ...(can(ctx, "notes.view") ? [{ key: "notes", label: "Notes" }] : []), ...(can(ctx, "files.view") ? [{ key: "files", label: "Photos & files" }] : []), { key: "activity", label: "Activity" }]} active={tab} basePath={`/jobs/${id}`} />

      {tab === "overview" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card title="Appointments" padded={false}>
              {job.appointments.length === 0 ? <EmptyState icon={<Icon name="calendar-days" size={18} />} title="Not scheduled yet" description="Schedule a visit to assign technicians and put this job on the dispatch board." /> : (
                <ul className="divide-y divide-line">
                  {job.appointments.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1"><div className="text-[13px] font-medium">{formatDateTime(a.startsAt, tz)} <span className="font-normal text-fg-3">→ {new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(a.endsAt)}</span></div>
                        <div className="mt-1 flex items-center gap-2">{a.assignees.map((x) => <span key={x.employeeId} className="inline-flex items-center gap-1.5 text-xs text-fg-2"><Avatar name={`${x.employee.firstName} ${x.employee.lastName}`} color={x.employee.calendarColor} size={18} />{x.employee.firstName}</span>)}{a.assignees.length === 0 && <span className="text-xs text-warn">No technician assigned</span>}</div></div>
                      <StatusBadge status={a.status} />
                      {canSchedule && a.status === "SCHEDULED" && <QuickAction size="sm" label="Dispatch" action={dispatchAppointmentAction.bind(null, a.id)} />}
                      {canSchedule && ["SCHEDULED", "DISPATCHED"].includes(a.status) && <ConfirmAction size="sm" variant="ghost" label="Cancel" title="Cancel this appointment?" askReason reasonLabel="Reason (shared with the technician)" confirmLabel="Cancel appointment" action={cancelAppointmentAction.bind(null, a.id)} />}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Work performed" description="Services, labor and materials — these become the invoice." padded={false} actions={(canEdit || can(ctx, "jobs.complete")) && !["COMPLETED", "CANCELLED"].includes(job.status) || canEdit ? <AddLineDialog jobId={id} canCustom={canEdit} currency={currency} /> : null}>
              {job.lineItems.length === 0 ? <EmptyState title="Nothing recorded yet" description="Add the services performed and materials used. Technicians can add these from the field." /> : (
                <div className="overflow-x-auto"><table className="w-full text-[13px]">
                  <thead><tr className="border-b border-line bg-surface-2/60 text-left text-xs font-semibold text-fg-3"><th className="px-4 py-2">Item</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Price</th><th className="px-3 py-2 text-right">Total</th><th className="w-10" /></tr></thead>
                  <tbody className="divide-y divide-line">{job.lineItems.map((l) => (
                    <tr key={l.id}><td className="px-4 py-2.5"><div className="font-medium">{l.name}</div><div className="text-xs text-fg-3">{humanize(l.kind)}{l.invoicedAt ? " · invoiced" : ""}</div></td><td className="tabular px-3 text-right">{toNumber(l.quantity)}</td><td className="px-3 text-right"><Money cents={l.unitPriceCents} currency={currency} /></td><td className="px-3 text-right"><Money cents={Math.round(Math.round(toNumber(l.quantity) * 100) * l.unitPriceCents / 100)} currency={currency} /></td>
                      <td className="px-2">{!l.invoicedAt && (canEdit || l.addedById === ctx.userId) && <ConfirmAction size="sm" variant="ghost" label={<Icon name="trash-2" size={13} />} title="Remove this item?" confirmLabel="Remove" action={removeLineAction.bind(null, id, l.id)} />}</td></tr>
                  ))}</tbody>
                  <tfoot><tr className="border-t border-line"><td colSpan={3} className="px-4 py-2 text-right text-xs font-semibold text-fg-3">Subtotal (before tax)</td><td className="px-3 py-2 text-right font-semibold"><Money cents={Math.round(lineTotal)} currency={currency} /></td><td /></tr></tfoot>
                </table></div>
              )}
            </Card>

            {job.checklist.length > 0 || canEdit ? (
              <Card title={`Checklist ${job.checklist.length ? `(${job.checklist.filter((c) => c.isDone).length}/${job.checklist.length})` : ""}`}>
                <div className="divide-y divide-line">{job.checklist.map((c) => <div key={c.id} className="flex items-center justify-between"><ChecklistToggle jobId={id} itemId={c.id} done={c.isDone} label={c.label} disabled={job.status === "COMPLETED" || job.status === "CANCELLED"} />{canEdit && <ConfirmAction size="sm" variant="ghost" label={<Icon name="x" size={13} />} title="Remove checklist item?" confirmLabel="Remove" action={removeChecklistAction.bind(null, id, c.id)} />}</div>)}</div>
                {(canEdit || can(ctx, "jobs.complete")) && <ActionForm action={addChecklistAction.bind(null, id)} resetOnSuccess className="mt-3 flex gap-2"><Input name="label" placeholder="Add a checklist item…" aria-label="Checklist item" /><SubmitButton variant="secondary">Add</SubmitButton></ActionForm>}
              </Card>
            ) : null}

            <Card title="Notes for this job"><DefList cols={1} items={[{ label: "Description", value: job.description && <p className="whitespace-pre-line">{job.description}</p> }, { label: "Customer-facing", value: job.customerNotes }, ...(canEdit ? [{ label: "Internal", value: job.internalNotes }] : []), { label: "Technician notes", value: job.technicianNotes && <p className="whitespace-pre-line">{job.technicianNotes}</p> }]} /></Card>
          </div>

          <div className="space-y-6">
            <Card title="Customer">
              <div className="space-y-2 text-[13px]">
                <Link href={`/customers/${job.customer.id}`} className="font-semibold hover:text-primary hover:underline">{job.customer.displayName}</Link>
                {job.customer.phone && <a href={`tel:${job.customer.phone}`} className="flex items-center gap-2 hover:text-primary"><Icon name="phone" size={13} className="text-fg-3" />{formatPhone(job.customer.phone)}</a>}
                {job.customer.email && <a href={`mailto:${job.customer.email}`} className="flex items-center gap-2 hover:text-primary"><Icon name="mail" size={13} className="text-fg-3" />{job.customer.email}</a>}
                <a href={mapsUrl(formatAddress(job.location))} target="_blank" rel="noreferrer" className="flex items-start gap-2 hover:text-primary"><Icon name="navigation" size={13} className="mt-0.5 text-fg-3" /><span>{formatAddress(job.location)}<span className="block text-xs text-fg-3">Get directions</span></span></a>
                {job.location.gateInstructions && <p className="rounded bg-warn-soft px-2 py-1.5 text-xs"><strong>Access:</strong> {job.location.gateInstructions}</p>}
                {job.location.accessCodes && <p className="rounded bg-surface-2 px-2 py-1.5 text-xs"><strong>Codes:</strong> {job.location.accessCodes}</p>}
              </div>
            </Card>
            <Card title="Technicians" actions={can(ctx, "jobs.assign") && !["COMPLETED", "CANCELLED"].includes(job.status) && (
              <Dialog title="Assign technicians" trigger={<Button size="sm" variant="ghost">Edit</Button>}>
                <ActionForm action={assignJobAction.bind(null, id)} className="space-y-4"><TechPicker technicians={techOpts} defaultIds={job.assignees.map((a) => a.employeeId)} /><div className="flex justify-end"><SubmitButton>Save</SubmitButton></div></ActionForm>
              </Dialog>)}>
              {job.assignees.length === 0 ? <p className="text-[13px] text-fg-3">No one assigned.</p> : <ul className="space-y-2">{job.assignees.map((a) => <li key={a.id} className="flex items-center gap-2 text-[13px]"><Avatar name={`${a.employee.firstName} ${a.employee.lastName}`} color={a.employee.calendarColor} size={24} />{a.employee.firstName} {a.employee.lastName}</li>)}</ul>}
              {job.dispatcher && <p className="mt-3 border-t border-line pt-2 text-xs text-fg-3">Dispatcher: {job.dispatcher.firstName} {job.dispatcher.lastName}</p>}
            </Card>
            {job.equipment.length > 0 && <Card title="Equipment" padded={false}><ul className="divide-y divide-line">{job.equipment.map((e) => <li key={e.id}><Link href={`/equipment/${e.equipmentId}`} className="block px-4 py-2.5 text-[13px] hover:bg-surface-2/60"><span className="font-medium">{[e.equipment.manufacturer, e.equipment.model].filter(Boolean).join(" ") || humanize(e.equipment.type)}</span>{e.installed && <Badge tone="teal" className="ml-2">Installed</Badge>}<span className="block text-xs text-fg-3">{e.equipment.serialNumber ? `S/N ${e.equipment.serialNumber}` : humanize(e.equipment.type)}</span></Link></li>)}</ul></Card>}
            {(job.quotes.length > 0 || job.invoices.length > 0) && (
              <Card title="Billing" padded={false}><ul className="divide-y divide-line text-[13px]">
                {job.quotes.map((q) => <li key={q.id}><Link href={`/quotes/${q.id}`} className="flex items-center justify-between px-4 py-2.5 hover:bg-surface-2/60"><span>Quote {q.number}</span><span className="flex items-center gap-2"><Money cents={q.totalCents} currency={currency} /><StatusBadge status={q.status} /></span></Link></li>)}
                {job.invoices.map((i) => <li key={i.id}><Link href={`/invoices/${i.id}`} className="flex items-center justify-between px-4 py-2.5 hover:bg-surface-2/60"><span>Invoice {i.number}</span><span className="flex items-center gap-2"><Money cents={i.totalCents} currency={currency} /><StatusBadge status={effectiveInvoiceStatus(i)} /></span></Link></li>)}
              </ul></Card>
            )}
            <Card title="Timing"><DefList cols={1} items={[{ label: "Estimated", value: `${job.estimatedMinutes} min` }, { label: "Actual start", value: job.actualStart ? formatDateTime(job.actualStart, tz) : null }, { label: "Actual end", value: job.actualEnd ? formatDateTime(job.actualEnd, tz) : null }, { label: "Created", value: formatDate(job.createdAt, tz) }]} /></Card>
            {job.signatures.length > 0 && <Card title="Customer sign-off"><ul className="text-[13px]">{job.signatures.map((s) => <li key={s.id}>{s.signerName} — {formatDateTime(s.signedAt, tz)}</li>)}</ul></Card>}
          </div>
        </div>
      )}
      {tab === "notes" && <JobNotes />}
      {tab === "files" && <JobFiles />}
      {tab === "activity" && <JobActivity />}
    </>
  );

  async function JobNotes() {
    const [notes, mentionable, pinned] = await Promise.all([listNotes(ctx, "JOB", id), listMentionable(ctx), pinnedNotesForJob(ctx, job)]);
    const jobNoteIds = new Set(notes.map((n) => n.id));
    return (
      <div className="space-y-4">
        {pinned.filter((n) => !jobNoteIds.has(n.id)).length > 0 && <Card title="Pinned on customer & location" padded={false}><ul className="divide-y divide-line">{pinned.filter((n) => !jobNoteIds.has(n.id)).map((n) => <li key={n.id} className="px-4 py-2.5 text-[13px]"><Badge tone={n.type === "WARNING" ? "red" : "amber"}>{humanize(n.type)}</Badge> <span className="ml-1">{n.body}</span></li>)}</ul></Card>}
        <NotesPanel entityType="JOB" entityId={id} mentionable={mentionable} currentUserId={ctx.userId} canCreate={can(ctx, "notes.create")} canManage={can(ctx, "notes.manage")} notes={notes.map((n) => ({ id: n.id, type: n.type, body: n.body, isPinned: n.isPinned, isPrivate: n.isPrivate, authorId: n.authorId, authorName: n.authorName, createdAt: n.createdAt.toISOString(), editedAt: n.editedAt?.toISOString() ?? null, revisions: n._count.revisions }))} />
      </div>
    );
  }
  async function JobFiles() {
    const files = await listAttachments(ctx, "JOB", id);
    return <FilesPanel entityType="JOB" entityId={id} tz={tz} defaultKind="PHOTO" canUpload={can(ctx, "files.upload")} canDelete={can(ctx, "files.delete")} files={files.map((f) => ({ id: f.id, filename: f.filename, mimeType: f.mimeType, sizeBytes: f.sizeBytes, kind: f.kind, caption: f.caption, createdAt: f.createdAt.toISOString() }))} />;
  }
  async function JobActivity() {
    const rows = await ctx.db.activity.findMany({ where: { entityType: "JOB", entityId: id }, orderBy: { createdAt: "desc" }, take: 100 });
    return <Card>{rows.length ? <Timeline items={rows} tz={tz} /> : <EmptyState title="No activity yet" description="Scheduling, dispatch and field events appear here." />}</Card>;
  }
}

void formatDateOnly;
