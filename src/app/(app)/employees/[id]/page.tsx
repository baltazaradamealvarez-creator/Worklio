import type { Metadata } from "next";
import Link from "next/link";
import { addCertificationAction, addTimeOffAction, archiveEmployeeAction, removeCertificationAction, removeTimeOffAction, saveAvailabilityAction, saveEmployeeAction } from "@/app/actions/people";
import { EmployeeFields } from "@/components/employee-form";
import { FilesPanel } from "@/components/records/files-panel";
import { ActionForm, ConfirmAction, Dialog, FField, SubmitButton } from "@/components/ui/client";
import { Icon } from "@/components/ui/icon";
import { Badge, Button, Card, EmptyState, Input, PageHeader, StatusBadge, Tabs } from "@/components/ui/primitives";
import { can } from "@/server/auth/context";
import { listAttachments } from "@/server/domain/attachments";
import { getEmployee } from "@/server/domain/employees";
import { listTerritories } from "@/server/domain/settings";
import { formatDateOnly } from "@/lib/format";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Employee" };

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx, tz } = await pageCtx();
  const e = await getEmployee(ctx, id);
  const manage = can(ctx, "employees.manage");
  const territories = await listTerritories(ctx);
  const tabs = [{ key: "profile", label: "Profile" }, { key: "certs", label: "Certifications", count: e.certifications.length }, ...(e.isTechnician ? [{ key: "availability", label: "Availability" }] : []), { key: "timeoff", label: "Time off", count: e.timeOffs.length }, ...(can(ctx, "files.view") && (can(ctx, "employees.view_sensitive") || ctx.employeeId === id) ? [{ key: "files", label: "Documents" }] : [])];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : "profile";
  const now = Date.now();
  return (
    <>
      <PageHeader title={`${e.firstName} ${e.lastName}`} subtitle={[e.jobTitle, e.isTechnician ? "Technician" : "Office"].filter(Boolean).join(" · ")} breadcrumbs={[{ label: "Employees", href: "/employees" }, { label: `${e.firstName} ${e.lastName}` }]} badges={<><StatusBadge status={e.status} />{e.membership ? <Badge tone="blue">{e.membership.role.name}</Badge> : <Badge>No login</Badge>}</>}
        actions={<>
          {!e.membership && can(ctx, "users.manage") && <Link href="/settings/team" className="inline-flex h-8 items-center gap-2 rounded-md border border-line-strong bg-surface px-3 text-[13px] font-medium hover:bg-surface-2"><Icon name="user-plus" size={14} /> Invite to sign in</Link>}
          {manage && id !== ctx.employeeId && <ConfirmAction label="Archive" title={`Archive ${e.firstName}?`} description="They lose access immediately. Their history is kept. Upcoming appointments must be reassigned first." confirmLabel="Archive" action={archiveEmployeeAction.bind(null, id)} />}
        </>} />
      <Tabs tabs={tabs} active={tab} basePath={`/employees/${id}`} />
      {tab === "profile" && (manage ? (
        <ActionForm action={saveEmployeeAction.bind(null, id)} className="max-w-3xl space-y-5">
          <Card><EmployeeFields e={e} territories={territories} sensitive={can(ctx, "employees.view_sensitive")} compensation={can(ctx, "employees.view_compensation")} /></Card>
          <div className="flex justify-end"><SubmitButton>Save changes</SubmitButton></div>
        </ActionForm>
      ) : (
        <Card><dl className="grid gap-3 text-[13px] sm:grid-cols-2"><div><dt className="text-fg-3">Email</dt><dd>{e.email ?? "—"}</dd></div><div><dt className="text-fg-3">Phone</dt><dd>{e.phone ?? "—"}</dd></div><div><dt className="text-fg-3">Skills</dt><dd>{e.skills.join(", ") || "—"}</dd></div><div><dt className="text-fg-3">Territory</dt><dd>{e.territory?.name ?? "—"}</dd></div></dl></Card>
      ))}
      {tab === "certs" && (
        <Card title="Certifications & licenses" actions={manage && (
          <Dialog title="Add certification" trigger={<Button size="sm" variant="primary"><Icon name="plus" size={13} /> Add</Button>}>
            <ActionForm action={addCertificationAction.bind(null, id)} className="space-y-4">
              <FField label="Name" name="name" required><Input name="name" placeholder="EPA Section 608 Universal" required /></FField>
              <div className="grid gap-4 sm:grid-cols-2"><FField label="Number" name="number"><Input name="number" /></FField><FField label="Issuer" name="issuer"><Input name="issuer" /></FField><FField label="Issued" name="issuedAt"><Input name="issuedAt" type="date" /></FField><FField label="Expires" name="expiresAt"><Input name="expiresAt" type="date" /></FField></div>
              <div className="flex justify-end"><SubmitButton>Add certification</SubmitButton></div>
            </ActionForm>
          </Dialog>)} padded={false}>
          {e.certifications.length === 0 ? <EmptyState title="No certifications on file" description="Track EPA, NATE and state licenses and see expiries at a glance." /> : <ul className="divide-y divide-line">{e.certifications.map((c) => {
            const exp = c.expiresAt ? c.expiresAt.getTime() : null;
            return <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3"><div className="min-w-0 flex-1 text-[13px]"><div className="font-medium">{c.name}</div><div className="text-xs text-fg-3">{[c.number, c.issuer].filter(Boolean).join(" · ") || "—"}</div></div>{exp != null && <Badge tone={exp < now ? "red" : exp < now + 60 * 86_400_000 ? "amber" : "green"}>{exp < now ? "Expired" : "Expires"} {formatDateOnly(c.expiresAt!)}</Badge>}{manage && <ConfirmAction size="sm" variant="ghost" label="Remove" title="Remove certification?" description="This can't be undone." confirmLabel="Remove" action={removeCertificationAction.bind(null, c.id)} />}</li>;
          })}</ul>}
        </Card>
      )}
      {tab === "availability" && (
        <ActionForm action={saveAvailabilityAction.bind(null, id)} className="max-w-xl space-y-4">
          <Card title="Weekly availability" description="Recurring working hours. Dispatch warns when scheduling outside these windows.">
            <div className="space-y-2">{DAYS.map((name, d) => {
              const w = e.availabilities.find((a) => a.weekday === d);
              return <div key={d} className="flex flex-wrap items-center gap-3 text-[13px]"><label className="flex w-32 items-center gap-2"><input type="checkbox" name={`on${d}`} defaultChecked={!!w} disabled={!manage} className="h-4 w-4 rounded border-line-strong accent-primary" />{name}</label><Input name={`start${d}`} type="time" defaultValue={hhmm(w?.startMinute ?? 480)} disabled={!manage} className="w-28" /><span className="text-fg-3">to</span><Input name={`end${d}`} type="time" defaultValue={hhmm(w?.endMinute ?? 1020)} disabled={!manage} className="w-28" /></div>;
            })}</div>
          </Card>
          {manage && <div className="flex justify-end"><SubmitButton>Save availability</SubmitButton></div>}
        </ActionForm>
      )}
      {tab === "timeoff" && (
        <Card title="Upcoming time off" actions={manage && (
          <Dialog title="Add time off" trigger={<Button size="sm" variant="primary"><Icon name="plus" size={13} /> Add</Button>}>
            <ActionForm action={addTimeOffAction.bind(null, id)} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2"><FField label="First day" name="startsAt" required><Input name="startsAt" type="date" required /></FField><FField label="Last day" name="endsAt" required><Input name="endsAt" type="date" required /></FField></div>
              <FField label="Reason" name="reason"><Input name="reason" placeholder="Vacation, training…" /></FField>
              <div className="flex justify-end"><SubmitButton>Add time off</SubmitButton></div>
            </ActionForm>
          </Dialog>)} padded={false}>
          {e.timeOffs.length === 0 ? <EmptyState title="No upcoming time off" description="Time off blocks scheduling for this person." /> : <ul className="divide-y divide-line">{e.timeOffs.map((t) => <li key={t.id} className="flex items-center gap-3 px-4 py-3 text-[13px]"><div className="flex-1"><span className="font-medium">{formatDateOnly(t.startsAt)} → {formatDateOnly(new Date(t.endsAt.getTime() - 86_400_000))}</span>{t.reason && <span className="text-fg-3"> · {t.reason}</span>}</div>{manage && <ConfirmAction size="sm" variant="ghost" label="Remove" title="Remove time off?" description="Scheduling will be allowed again for these days." confirmLabel="Remove" action={removeTimeOffAction.bind(null, t.id)} />}</li>)}</ul>}
        </Card>
      )}
      {tab === "files" && <EmpFiles />}
    </>
  );

  async function EmpFiles() {
    const files = await listAttachments(ctx, "EMPLOYEE", id);
    return <FilesPanel entityType="EMPLOYEE" entityId={id} tz={tz} defaultKind="DOCUMENT" canUpload={manage} canDelete={manage} files={files.map((f) => ({ id: f.id, filename: f.filename, mimeType: f.mimeType, sizeBytes: f.sizeBytes, kind: f.kind, caption: f.caption, createdAt: f.createdAt.toISOString() }))} />;
  }
}
