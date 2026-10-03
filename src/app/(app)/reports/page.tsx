import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { Card, Notice, PageHeader } from "@/components/ui/primitives";
import { can } from "@/server/auth/context";
import { REPORTS } from "@/server/domain/reports";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage() {
  const { ctx } = await pageCtx();
  const visible = REPORTS.filter((r) => can(ctx, r.permission));
  const groups = [...new Set(visible.map((r) => r.group))];
  return (
    <>
      <PageHeader title="Reports" subtitle="Operational reporting with filters and CSV export." />
      <div className="mb-5"><Notice tone="info" title="Management reports, not accounting">These reports summarise jobs, quotes, invoices and payments recorded in Worklio. They are not formal financial statements — use your accounting software for books, tax and payroll.</Notice></div>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">{groups.map((g) => (
        <Card key={g} title={g} padded={false}><ul className="divide-y divide-line">{visible.filter((r) => r.group === g).map((r) => (
          <li key={r.key}><Link href={`/reports/${r.key}`} className="flex items-center justify-between px-4 py-2.5 text-[13px] font-medium hover:bg-surface-2/60"><span>{r.title}</span><Icon name="chevron-right" size={14} className="text-fg-3" /></Link></li>))}</ul></Card>))}</div>
    </>
  );
}
