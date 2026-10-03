import type { Metadata } from "next";
import { FilterBar } from "@/components/data/client";
import { DataTable, type Column, type SP } from "@/components/data/data-table";
import { Icon } from "@/components/ui/icon";
import { Badge, EmptyState, PageHeader } from "@/components/ui/primitives";
import { requirePermission } from "@/server/auth/context";
import { listAuditLogs } from "@/server/domain/audit-log";
import { parseListParams } from "@/server/domain/list";
import { formatDateTime } from "@/lib/format";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Audit log" };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { ctx, tz } = await pageCtx();
  requirePermission(ctx, "audit.view");
  const p = parseListParams(sp, { sortable: ["createdAt"], defaultSort: "createdAt", filters: ["entityType", "actor", "support", "from", "to"], pageSize: 50 });
  const page = await listAuditLogs(ctx, p);
  type Row = (typeof page.rows)[number];
  const cols: Column<Row>[] = [
    { key: "when", header: "When", fixed: true, cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.createdAt, tz)}</span> },
    { key: "actor", header: "Who", cell: (r) => <span>{r.actorName ?? "System"}{r.impersonatorUserId && <Badge tone="red" className="ml-2">Support</Badge>}</span> },
    { key: "action", header: "Action", cell: (r) => <span className="font-mono text-xs">{r.action}</span> },
    { key: "entity", header: "Record", from: "md", cell: (r) => r.entityType ? <span className="text-fg-2">{r.entityType}<span className="ml-1 font-mono text-[11px] text-fg-3">{r.entityId?.slice(-8)}</span></span> : "—" },
    { key: "details", header: "Details", from: "lg", cell: (r) => r.metadata && Object.keys(r.metadata as object).length ? <code className="line-clamp-1 max-w-md text-[11px] text-fg-3">{JSON.stringify(r.metadata)}</code> : "—" },
    { key: "ip", header: "IP", from: "xl", cell: (r) => <span className="font-mono text-xs text-fg-3">{r.ip ?? "—"}</span> },
  ];
  return (
    <>
      <PageHeader title="Audit log" subtitle="An append-only record of security-relevant and financial actions in your company. Entries can't be edited or deleted." />
      <FilterBar searchPlaceholder="Search action or person…" filters={[{ name: "entityType", label: "Record type", options: page.entityTypes.map((t) => ({ value: t, label: t })) }, { name: "support", label: "Source", options: [{ value: "1", label: "Platform support sessions" }] }, { name: "from", label: "From", type: "date" }, { name: "to", label: "To", type: "date" }]} />
      <DataTable id="audit-table" columns={cols} page={page} sp={sp} basePath="/activity" sort={p.sort} dir={p.dir} density="compact" empty={<EmptyState icon={<Icon name="history" size={18} />} title="No audit entries match" description="Adjust the filters to see more." />} />
    </>
  );
}
