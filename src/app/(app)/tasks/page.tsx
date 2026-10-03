import type { Metadata } from "next";
import Link from "next/link";
import { deleteTaskAction, taskStatusAction } from "@/app/actions/admin";
import { FilterBar } from "@/components/data/client";
import { DataTable, type Column, type SP } from "@/components/data/data-table";
import { NewTaskDialog } from "@/components/task-form";
import { ConfirmAction, QuickAction } from "@/components/ui/client";
import { Icon } from "@/components/ui/icon";
import { Badge, EmptyState, PageHeader, StatusBadge } from "@/components/ui/primitives";
import { can } from "@/server/auth/context";
import { getCustomer } from "@/server/domain/customers";
import { listAssignableEmployees } from "@/server/domain/employees";
import { parseListParams } from "@/server/domain/list";
import { listTasks } from "@/server/domain/tasks";
import { formatDateTime } from "@/lib/format";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { ctx, tz } = await pageCtx();
  const p = parseListParams(sp, { sortable: ["dueAt"], defaultSort: "dueAt", filters: ["status", "assignee", "customer"] });
  const [page, emps] = await Promise.all([listTasks(ctx, p), listAssignableEmployees(ctx)]);
  const assignees = emps.filter((e) => e.membership?.userId).map((e) => ({ userId: e.membership!.userId, name: `${e.firstName} ${e.lastName}` }));
  const names = new Map(assignees.map((a) => [a.userId, a.name]));
  const cid = typeof sp.customer === "string" ? sp.customer : undefined;
  const cust = cid && sp.new ? await getCustomer(ctx, cid).catch(() => null) : null;
  const manage = can(ctx, "tasks.manage");
  type Row = (typeof page.rows)[number];
  const now = Date.now();
  const cols: Column<Row>[] = [
    { key: "title", header: "Task", fixed: true, cell: (r) => <div><div className={r.status === "DONE" ? "text-fg-3 line-through" : "font-medium"}>{r.title}</div>{r.description && <div className="line-clamp-1 text-xs text-fg-3">{r.description}</div>}</div> },
    { key: "link", header: "Related", from: "md", cell: (r) => r.customer ? <Link href={`/customers/${r.customer.id}`} className="hover:text-primary hover:underline">{r.customer.displayName}</Link> : r.job ? <Link href={`/jobs/${r.job.id}`} className="font-mono text-xs hover:text-primary">{r.job.number}</Link> : r.invoice ? <Link href={`/invoices/${r.invoice.id}`} className="font-mono text-xs hover:text-primary">{r.invoice.number}</Link> : r.quote ? <Link href={`/quotes/${r.quote.id}`} className="font-mono text-xs hover:text-primary">{r.quote.number}</Link> : <span className="text-fg-3">—</span> },
    { key: "assignee", header: "Assignee", from: "lg", cell: (r) => (r.assigneeUserId && names.get(r.assigneeUserId)) || "—" },
    { key: "due", header: "Due", sortKey: "dueAt", cell: (r) => r.dueAt ? <span className={r.status !== "DONE" && r.dueAt.getTime() < now ? "font-medium text-danger" : ""}>{formatDateTime(r.dueAt, tz)}</span> : <span className="text-fg-3">—</span> },
    { key: "priority", header: "Priority", from: "md", cell: (r) => r.priority === "NORMAL" ? <span className="text-fg-3">Normal</span> : <Badge tone={r.priority === "LOW" ? "gray" : "red"}>{r.priority === "EMERGENCY" ? "Urgent" : r.priority === "HIGH" ? "High" : "Low"}</Badge> },
    { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    { key: "actions", header: "", align: "right", fixed: true, cell: (r) => <span className="flex justify-end gap-1">
      {r.status !== "DONE" && <QuickAction size="sm" variant="ghost" label={<span className="flex items-center gap-1"><Icon name="check" size={13} /> Done</span>} action={taskStatusAction.bind(null, r.id, "DONE")} />}
      {r.status === "DONE" && <QuickAction size="sm" variant="ghost" label="Reopen" action={taskStatusAction.bind(null, r.id, "OPEN")} />}
      {manage && <ConfirmAction size="sm" variant="ghost" label="Delete" title="Delete this task?" description="This can't be undone." confirmLabel="Delete" action={deleteTaskAction.bind(null, r.id)} />}
    </span> },
  ];
  return (
    <>
      <PageHeader title="Tasks" subtitle="Follow-ups and to-dos for you and your team." actions={manage && <NewTaskDialog assignees={assignees} currentUserId={ctx.userId} customer={cust ? { id: cust.id, name: cust.displayName } : null} defaultOpen={!!sp.new} />} />
      <FilterBar searchPlaceholder="Search tasks…" filters={[{ name: "status", label: "Status", options: [{ value: "open", label: "Open" }, { value: "overdue", label: "Overdue" }, { value: "done", label: "Done" }] }, { name: "assignee", label: "Assignee", options: [{ value: "me", label: "Me" }, ...assignees.map((a) => ({ value: a.userId, label: a.name }))] }]} />
      <DataTable id="tasks-table" columns={cols} page={page} sp={sp} basePath="/tasks" sort={p.sort} dir={p.dir} empty={<EmptyState icon={<Icon name="list-checks" size={18} />} title="You're all caught up" description="No open tasks match. Create tasks from here or from any customer, job, quote or invoice." />} />
    </>
  );
}
