import type { Metadata } from "next";
import Link from "next/link";
import { FilterBar } from "@/components/data/client";
import { DataTable, type Column, type SP } from "@/components/data/data-table";
import { Icon } from "@/components/ui/icon";
import { Avatar, EmptyState, LinkButton, PageHeader, StatusBadge } from "@/components/ui/primitives";
import { can } from "@/server/auth/context";
import { listTechnicians } from "@/server/domain/employees";
import { jobFilters, listJobs, listJobTypes } from "@/server/domain/jobs";
import { parseListParams } from "@/server/domain/list";
import { formatDateTime, humanize } from "@/lib/format";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Jobs" };
const STATUSES = ["NEW", "UNSCHEDULED", "SCHEDULED", "DISPATCHED", "EN_ROUTE", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "NEEDS_FOLLOW_UP", "CANCELLED"];

export default async function JobsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { ctx, tz } = await pageCtx();
  const p = parseListParams(sp, { sortable: ["createdAt", "scheduledStart", "priority", "status", "customer"], defaultSort: "createdAt", filters: [...jobFilters] });
  const [page, types, techs] = await Promise.all([listJobs(ctx, p), listJobTypes(ctx), can(ctx, "jobs.view") ? listTechnicians(ctx) : []]);
  type Row = (typeof page.rows)[number];
  const cols: Column<Row>[] = [
    { key: "number", header: "Job", fixed: true, cell: (r) => <span className="font-mono text-xs">{r.number}</span> },
    { key: "title", header: "Title", cell: (r) => <div className="max-w-xs"><div className="truncate font-medium">{r.title}</div>{r.jobType && <div className="flex items-center gap-1.5 text-xs text-fg-3"><span className="size-2 rounded-full" style={{ background: r.jobType.color }} />{r.jobType.name}</div>}</div> },
    { key: "customer", header: "Customer", sortKey: "customer", cell: (r) => <Link href={`/customers/${r.customer.id}`} className="hover:text-primary hover:underline">{r.customer.displayName}</Link> },
    { key: "location", header: "Location", from: "lg", cell: (r) => <span className="text-fg-2">{r.location.addressLine1}, {r.location.city}</span> },
    { key: "tech", header: "Technicians", from: "md", cell: (r) => <div className="flex -space-x-1.5">{r.assignees.length ? r.assignees.map((a) => <Avatar key={a.employee.id} name={`${a.employee.firstName} ${a.employee.lastName}`} color={a.employee.calendarColor} size={24} />) : <span className="text-fg-3">—</span>}</div> },
    { key: "scheduled", header: "Scheduled", sortKey: "scheduledStart", from: "md", cell: (r) => r.scheduledStart ? formatDateTime(r.scheduledStart, tz) : <span className="text-fg-3">—</span> },
    { key: "priority", header: "Priority", sortKey: "priority", from: "xl", cell: (r) => r.priority === "NORMAL" ? <span className="text-fg-3">Normal</span> : <StatusBadge status={r.priority} /> },
    { key: "status", header: "Status", sortKey: "status", cell: (r) => <StatusBadge status={r.status} /> },
  ];
  const viewTabs = [["", "All"], ["open", "Open"], ["today", "Today"], ["unscheduled", "Unscheduled"]] as const;
  return (
    <>
      <PageHeader title="Jobs" subtitle="Every service call, repair, installation and maintenance visit." actions={can(ctx, "jobs.create") && <LinkButton href="/jobs/new" variant="primary"><Icon name="plus" size={14} /> New job</LinkButton>} />
      <div className="mb-3 flex gap-1" role="tablist" aria-label="Quick views">
        {viewTabs.map(([v, label]) => {
          const q = new URLSearchParams(Object.entries(sp).filter(([k, x]) => k !== "view" && k !== "page" && typeof x === "string") as [string, string][]);
          if (v) q.set("view", v);
          const active = (sp.view ?? "") === v;
          return <Link key={v} href={`/jobs${q.size ? `?${q}` : ""}`} role="tab" aria-selected={active} className={`rounded-full px-3 py-1 text-xs font-medium ${active ? "bg-fg text-white" : "bg-surface-2 text-fg-2 hover:bg-line"}`}>{label}</Link>;
        })}
      </div>
      <FilterBar searchPlaceholder="Search job #, title, customer, address…" filters={[
        { name: "status", label: "Status", options: STATUSES.map((s) => ({ value: s, label: humanize(s) })) },
        { name: "priority", label: "Priority", options: ["LOW", "NORMAL", "HIGH", "EMERGENCY"].map((s) => ({ value: s, label: humanize(s) })) },
        { name: "type", label: "Job type", options: types.map((t) => ({ value: t.id, label: t.name })) },
        ...(techs.length ? [{ name: "tech", label: "Technician", options: techs.map((t) => ({ value: t.id, label: `${t.firstName} ${t.lastName}` })) }] : []),
        { name: "from", label: "From", type: "date" as const }, { name: "to", label: "To", type: "date" as const },
      ]} />
      <DataTable id="jobs-table" columns={cols} page={page} sp={sp} basePath="/jobs" sort={p.sort} dir={p.dir} rowHref={(r) => `/jobs/${r.id}`}
        empty={<EmptyState icon={<Icon name="clipboard-list" size={18} />} title="No jobs yet" description="A job is a unit of work at a customer's location. Create one, schedule a technician, and track it through completion and invoicing." action={can(ctx, "jobs.create") && <LinkButton href="/jobs/new" variant="primary">Create a job</LinkButton>} />} />
    </>
  );
}
