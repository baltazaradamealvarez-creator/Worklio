import type { Metadata } from "next";
import { FilterBar } from "@/components/data/client";
import { DataTable, type Column, type SP } from "@/components/data/data-table";
import { Icon } from "@/components/ui/icon";
import { Avatar, Badge, EmptyState, LinkButton, PageHeader, StatusBadge } from "@/components/ui/primitives";
import { can } from "@/server/auth/context";
import { listEmployees } from "@/server/domain/employees";
import { parseListParams } from "@/server/domain/list";
import { formatDateOnly } from "@/lib/format";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Employees" };

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { ctx } = await pageCtx();
  const p = parseListParams(sp, { sortable: ["lastName", "jobTitle", "hireDate", "status"], defaultSort: "lastName", defaultDir: "asc", filters: ["status", "type", "role"] });
  const page = await listEmployees(ctx, p);
  const roles = can(ctx, "roles.manage") || can(ctx, "users.manage") ? await ctx.db.role.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }) : [];
  type Row = (typeof page.rows)[number];
  const cols: Column<Row>[] = [
    { key: "name", header: "Name", sortKey: "lastName", fixed: true, cell: (r) => <span className="flex items-center gap-2.5"><Avatar name={`${r.firstName} ${r.lastName}`} color={r.isTechnician ? r.calendarColor : undefined} size={26} /><span><span className="font-medium">{r.firstName} {r.lastName}</span>{r.email && <span className="block text-xs text-fg-3">{r.email}</span>}</span></span> },
    { key: "title", header: "Title", sortKey: "jobTitle", from: "md", cell: (r) => r.jobTitle ?? "—" },
    { key: "role", header: "Access", from: "md", cell: (r) => r.membership ? <Badge tone="blue">{r.membership.role.name}</Badge> : <span className="text-fg-3">No login</span> },
    { key: "type", header: "Type", from: "lg", cell: (r) => r.isTechnician ? "Technician" : "Office" },
    { key: "territory", header: "Territory", from: "xl", cell: (r) => r.territory?.name ?? "—" },
    { key: "hire", header: "Hired", sortKey: "hireDate", from: "lg", cell: (r) => r.hireDate ? formatDateOnly(r.hireDate) : "—" },
    { key: "status", header: "Status", sortKey: "status", cell: (r) => <StatusBadge status={r.status} /> },
  ];
  return (
    <>
      <PageHeader title="Employees" subtitle="Your team, technician profiles and system access." actions={can(ctx, "employees.manage") && <LinkButton href="/employees/new" variant="primary"><Icon name="plus" size={14} /> Add employee</LinkButton>} />
      <FilterBar searchPlaceholder="Search name, email, title…" filters={[{ name: "type", label: "Type", options: [{ value: "technician", label: "Technicians" }, { value: "office", label: "Office" }] }, { name: "status", label: "Status", options: ["ACTIVE", "ON_LEAVE", "INVITED", "TERMINATED"].map((s) => ({ value: s, label: s.replace("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) })) }, ...(roles.length ? [{ name: "role", label: "Role", options: roles.map((r) => ({ value: r.id, label: r.name })) }] : [])]} />
      <DataTable id="employees-table" columns={cols} page={page} sp={sp} basePath="/employees" sort={p.sort} dir={p.dir} rowHref={(r) => `/employees/${r.id}`}
        empty={<EmptyState icon={<Icon name="users" size={18} />} title="No employees yet" description="Add technicians and office staff, then invite them to sign in under Settings → Team." action={can(ctx, "employees.manage") && <LinkButton href="/employees/new" variant="primary">Add an employee</LinkButton>} />} />
    </>
  );
}
