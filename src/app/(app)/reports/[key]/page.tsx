import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReportChart } from "@/components/reports/chart";
import { Icon } from "@/components/ui/icon";
import { Button, Card, EmptyState, Input, Money, PageHeader, Select } from "@/components/ui/primitives";
import { listTechnicians } from "@/server/domain/employees";
import { listJobTypes } from "@/server/domain/jobs";
import { REPORTS, agingChart, parseReportFilters, runReport, type ColumnFormat, type ReportKey } from "@/server/domain/reports";
import { formatDateOnly } from "@/lib/format";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Report" };

function Cell({ v, f, currency }: { v: string | number | null | undefined; f: ColumnFormat; currency: string }) {
  if (v == null || v === "") return <span className="text-fg-3">—</span>;
  if (f === "money") return <Money cents={Number(v)} currency={currency} />;
  if (f === "percent") return <>{(Number(v) * 100).toFixed(1)}%</>;
  if (f === "number") return <>{Number(v).toLocaleString()}</>;
  if (f === "date") return <>{formatDateOnly(String(v))}</>;
  return <>{String(v)}</>;
}

export default async function ReportPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { key } = await params;
  const sp = await searchParams;
  if (!REPORTS.some((r) => r.key === key)) notFound();
  const { ctx, tz, currency } = await pageCtx();
  const f = parseReportFilters(sp, tz);
  const [r, techs, types] = await Promise.all([runReport(ctx, key as ReportKey, f), listTechnicians(ctx), listJobTypes(ctx)]);
  const has = (k: keyof typeof f) => (r.supports as string[]).includes(k);
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  const chartData = key === "receivables" ? agingChart(r) : r.rows;
  return (
    <>
      <PageHeader title={r.title} subtitle={r.description} breadcrumbs={[{ label: "Reports", href: "/reports" }, { label: r.title }]} actions={<a href={`/api/reports/${key}/csv?${qs}`} className="inline-flex h-8 items-center gap-2 rounded-md border border-line-strong bg-surface px-3 text-[13px] font-medium shadow-sm hover:bg-surface-2"><Icon name="download" size={14} /> Export CSV</a>} />
      <form className="mb-5 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-3" action={`/reports/${key}`}>
        {has("from") && <label className="text-xs text-fg-3">From<Input name="from" type="date" defaultValue={f.from} className="mt-1 w-36" /></label>}
        {has("to") && <label className="text-xs text-fg-3">To<Input name="to" type="date" defaultValue={f.to} className="mt-1 w-36" /></label>}
        {has("technician") && <label className="text-xs text-fg-3">Technician<Select name="technician" defaultValue={f.technician ?? ""} className="mt-1 w-40"><option value="">All</option>{techs.map((t) => <option key={t.id} value={t.id}>{t.firstName} {t.lastName}</option>)}</Select></label>}
        {has("jobType") && <label className="text-xs text-fg-3">Job type<Select name="jobType" defaultValue={f.jobType ?? ""} className="mt-1 w-40"><option value="">All</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></label>}
        {has("city") && <label className="text-xs text-fg-3">City<Input name="city" defaultValue={f.city ?? ""} className="mt-1 w-32" /></label>}
        {has("state") && <label className="text-xs text-fg-3">State<Input name="state" defaultValue={f.state ?? ""} className="mt-1 w-20" /></label>}
        {has("postalCode") && <label className="text-xs text-fg-3">ZIP<Input name="postalCode" defaultValue={f.postalCode ?? ""} className="mt-1 w-24" /></label>}
        {has("tag") && <label className="text-xs text-fg-3">Customer tag<Input name="tag" defaultValue={f.tag ?? ""} className="mt-1 w-32" /></label>}
        {has("leadSource") && <label className="text-xs text-fg-3">Lead source<Input name="leadSource" defaultValue={f.leadSource ?? ""} className="mt-1 w-32" /></label>}
        <Button type="submit" variant="primary">Apply</Button>
        <Link href={`/reports/${key}`} className="pb-2 text-xs text-fg-3 hover:text-fg">Reset</Link>
      </form>
      {r.note && <p className="mb-4 text-xs text-fg-3">{r.note}</p>}
      {r.rows.length === 0 ? <div className="rounded-lg border border-line bg-surface"><EmptyState title="No data for these filters" description="Widen the date range or clear some filters." /></div> : (
        <div className="space-y-5">
          {r.chart && <Card><ReportChart spec={r.chart} data={chartData} currency={currency} /></Card>}
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full min-w-[560px] text-[13px]">
              <thead><tr className="border-b border-line bg-surface-2/60 text-xs font-semibold text-fg-3">{r.columns.map((c) => <th key={c.key} className={`px-3 py-2 ${c.align === "right" || c.format === "money" || c.format === "number" || c.format === "percent" ? "text-right" : "text-left"}`}>{c.label}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">{r.rows.map((row, i) => <tr key={i} className="hover:bg-surface-2/40">{r.columns.map((c) => <td key={c.key} className={`tabular px-3 py-2 ${c.align === "right" || c.format === "money" || c.format === "number" || c.format === "percent" ? "text-right" : ""}`}><Cell v={row[c.key]} f={c.format} currency={currency} /></td>)}</tr>)}</tbody>
              {r.totals && <tfoot><tr className="border-t border-line-strong bg-surface-2/60 font-semibold">{r.columns.map((c, i) => <td key={c.key} className={`tabular px-3 py-2 ${c.format === "text" ? "" : "text-right"}`}>{i === 0 && r.totals![c.key] == null ? "Total" : <Cell v={r.totals![c.key]} f={c.format} currency={currency} />}</td>)}</tr></tfoot>}
            </table>
          </div>
        </div>
      )}
    </>
  );
}
