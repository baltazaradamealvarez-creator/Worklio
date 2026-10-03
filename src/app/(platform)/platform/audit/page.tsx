import type { Metadata } from "next";
import Link from "next/link";
import { Badge, PageHeader } from "@/components/ui/primitives";
import { platformDb } from "@/server/db";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Audit log · Platform" };
const PAGE = 100;

export default async function PlatformAudit({ searchParams }: { searchParams: Promise<{ page?: string; q?: string }> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where = { tenantId: null, ...(sp.q ? { OR: [{ action: { contains: sp.q, mode: "insensitive" as const } }, { actorName: { contains: sp.q, mode: "insensitive" as const } }] } : {}) };
  const [rows, total] = await Promise.all([platformDb().auditLog.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: PAGE, skip: (page - 1) * PAGE }), platformDb().auditLog.count({ where })]);
  return (
    <>
      <PageHeader title="Platform audit log" subtitle="Append-only record of platform-level actions: company creation, suspension, plan changes and support sessions." />
      <form className="mb-4" action="/platform/audit"><input name="q" defaultValue={sp.q ?? ""} placeholder="Search action or person…" className="h-9 w-72 rounded-md border border-line-strong bg-surface px-3 text-[13px]" /></form>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[720px] text-[13px]"><thead><tr className="border-b border-line bg-surface-2/60 text-left text-xs font-semibold text-fg-3"><th className="px-3 py-2">When (UTC)</th><th className="px-3 py-2">Who</th><th className="px-3 py-2">Action</th><th className="px-3 py-2">Company / record</th><th className="px-3 py-2">Details</th></tr></thead>
          <tbody className="divide-y divide-line">{rows.map((r) => (
            <tr key={r.id}><td className="whitespace-nowrap px-3 py-2">{formatDateTime(r.createdAt, "UTC")}</td><td className="px-3">{r.actorName ?? "—"}{r.impersonatorUserId && <Badge tone="red" className="ml-2">Support</Badge>}</td><td className="px-3 font-mono text-xs">{r.action}</td><td className="px-3 text-xs">{r.entityType === "Tenant" && r.entityId ? <Link href={`/platform/companies/${r.entityId}`} className="text-primary hover:underline">{r.entityId.slice(-8)}</Link> : (r.entityId ?? "—")}</td><td className="px-3"><code className="line-clamp-1 max-w-sm text-[11px] text-fg-3">{r.metadata ? JSON.stringify(r.metadata) : ""}</code></td></tr>))}</tbody></table>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-fg-3"><span>{total.toLocaleString()} entries</span><span className="flex gap-3">{page > 1 && <Link className="text-primary" href={`/platform/audit?page=${page - 1}${sp.q ? `&q=${sp.q}` : ""}`}>← Newer</Link>}{page * PAGE < total && <Link className="text-primary" href={`/platform/audit?page=${page + 1}${sp.q ? `&q=${sp.q}` : ""}`}>Older →</Link>}</span></div>
    </>
  );
}
