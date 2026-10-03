import type { Metadata } from "next";
import Link from "next/link";
import { archiveEquipmentAction } from "@/app/actions/customers";
import { FilesPanel } from "@/components/records/files-panel";
import { NotesPanel } from "@/components/records/notes-panel";
import { ConfirmAction } from "@/components/ui/client";
import { Badge, Card, DefList, EmptyState, LinkButton, PageHeader, StatusBadge, Tabs } from "@/components/ui/primitives";
import { can } from "@/server/auth/context";
import { listAttachments } from "@/server/domain/attachments";
import { equipmentServiceHistory, getEquipment } from "@/server/domain/equipment";
import { listMentionable, listNotes } from "@/server/domain/notes";
import { formatAddress, formatDate, formatDateOnly, humanize } from "@/lib/format";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Equipment" };

export default async function EquipmentDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx, tz } = await pageCtx();
  const e = await getEquipment(ctx, id);
  const tabs = [{ key: "overview", label: "Overview" }, { key: "history", label: "Service history" }, ...(can(ctx, "files.view") ? [{ key: "files", label: "Manuals & files" }] : []), ...(can(ctx, "notes.view") ? [{ key: "notes", label: "Notes" }] : [])];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : "overview";
  const title = [e.manufacturer, e.model].filter(Boolean).join(" ") || humanize(e.type);
  const warr = (label: string, d: Date | null) => ({ label, value: d ? <span className={d < new Date() ? "text-fg-3" : d.getTime() - Date.now() < 90 * 86_400_000 ? "font-medium text-warn" : ""}>{formatDateOnly(d)}{d < new Date() ? " (expired)" : ""}</span> : null });
  return (
    <>
      <PageHeader title={title} breadcrumbs={[{ label: "Equipment", href: "/equipment" }, { label: title }]} badges={<><StatusBadge status={e.condition} />{e.deletedAt && <Badge tone="red">Archived</Badge>}</>}
        subtitle={<span>{humanize(e.type)}{e.serialNumber ? ` · S/N ${e.serialNumber}` : ""} · <Link className="hover:text-primary hover:underline" href={`/customers/${e.customer.id}`}>{e.customer.displayName}</Link> · {e.location.name}</span>}
        actions={can(ctx, "equipment.manage") && !e.deletedAt && <><LinkButton href={`/equipment/${id}/edit`}>Edit</LinkButton><ConfirmAction label="Archive" title="Archive this equipment?" description="The unit is hidden from lists but its service history is kept." confirmLabel="Archive" action={archiveEquipmentAction.bind(null, id)} /></>} />
      <Tabs tabs={tabs} active={tab} basePath={`/equipment/${id}`} />
      {tab === "overview" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card title="Specifications" className="lg:col-span-2"><DefList cols={3} items={[
            { label: "Manufacturer", value: e.manufacturer }, { label: "Model", value: e.model }, { label: "Serial number", value: e.serialNumber && <span className="font-mono text-xs">{e.serialNumber}</span> }, { label: "System type", value: e.systemType }, { label: "Capacity", value: e.capacityTons ? `${e.capacityTons} tons` : null }, { label: "SEER", value: e.seer?.toString() },
            { label: "Refrigerant", value: e.refrigerantType }, { label: "Fuel type", value: e.fuelType }, { label: "Filter size", value: e.filterSize }, { label: "Unit location", value: e.unitLocation }, { label: "Installed", value: formatDateOnly(e.installDate) }, { label: "Manufactured", value: formatDateOnly(e.manufactureDate) },
            { label: "Property", value: formatAddress(e.location), wide: true }, ...(e.notes ? [{ label: "Notes", value: e.notes, wide: true }] : []),
          ]} /></Card>
          <div className="space-y-6">
            <Card title="Warranty"><DefList cols={1} items={[warr("General warranty", e.warrantyExpiresAt), warr("Equipment warranty", e.equipmentWarrantyExpiresAt), warr("Labor warranty", e.laborWarrantyExpiresAt)]} /></Card>
            {e.agreementEquipment.length > 0 && <Card title="Maintenance plans" padded={false}><ul className="divide-y divide-line">{e.agreementEquipment.map((a) => <li key={a.agreement.id}><Link href={`/maintenance/${a.agreement.id}`} className="flex items-center justify-between px-4 py-2.5 text-[13px] hover:bg-surface-2/60"><span className="font-medium">{a.agreement.name}</span><StatusBadge status={a.agreement.status} /></Link></li>)}</ul></Card>}
          </div>
        </div>
      )}
      {tab === "history" && <History />}
      {tab === "files" && <Files />}
      {tab === "notes" && <Notes />}
    </>
  );

  async function History() {
    const h = await equipmentServiceHistory(ctx, id);
    if (!h.length) return <div className="rounded-lg border border-line bg-surface"><EmptyState title="No service history" description="Jobs that service this unit will be listed here, newest first, with the technician's notes." /></div>;
    return (
      <ol className="space-y-3">
        {h.map(({ job, installed }) => (
          <li key={job.id} className="rounded-lg border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><Link href={`/jobs/${job.id}`} className="text-[13px] font-semibold hover:text-primary hover:underline">{job.number} · {job.title}</Link><span className="flex items-center gap-2">{installed && <Badge tone="teal">Installed</Badge>}<StatusBadge status={job.status} /></span></div>
            <div className="mt-0.5 text-xs text-fg-3">{job.jobType?.name} · {job.actualEnd ? formatDate(job.actualEnd, tz) : job.scheduledStart ? formatDate(job.scheduledStart, tz) : "Unscheduled"}{job.assignees.length > 0 && ` · ${job.assignees.map((a) => `${a.employee.firstName} ${a.employee.lastName}`).join(", ")}`}</div>
            {job.technicianNotes && <p className="mt-2 whitespace-pre-line border-t border-line pt-2 text-[13px] text-fg-2">{job.technicianNotes}</p>}
          </li>
        ))}
      </ol>
    );
  }
  async function Files() {
    const files = await listAttachments(ctx, "EQUIPMENT", id);
    return <FilesPanel entityType="EQUIPMENT" entityId={id} tz={tz} defaultKind="MANUAL" canUpload={can(ctx, "files.upload")} canDelete={can(ctx, "files.delete")} files={files.map((f) => ({ id: f.id, filename: f.filename, mimeType: f.mimeType, sizeBytes: f.sizeBytes, kind: f.kind, caption: f.caption, createdAt: f.createdAt.toISOString() }))} />;
  }
  async function Notes() {
    const [notes, mentionable] = await Promise.all([listNotes(ctx, "EQUIPMENT", id), listMentionable(ctx)]);
    return <NotesPanel entityType="EQUIPMENT" entityId={id} mentionable={mentionable} currentUserId={ctx.userId} canCreate={can(ctx, "notes.create")} canManage={can(ctx, "notes.manage")} notes={notes.map((n) => ({ id: n.id, type: n.type, body: n.body, isPinned: n.isPinned, isPrivate: n.isPrivate, authorId: n.authorId, authorName: n.authorName, createdAt: n.createdAt.toISOString(), editedAt: n.editedAt?.toISOString() ?? null, revisions: n._count.revisions }))} />;
  }
}
