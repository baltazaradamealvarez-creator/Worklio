import type { Metadata } from "next";
import Link from "next/link";
import { Notice, PageHeader, Stat } from "@/components/ui/primitives";
import { Button, Input } from "@/components/ui/primitives";
import { requirePermission } from "@/server/auth/context";
import { financialOverview, parseReportFilters } from "@/server/domain/reports";
import { formatMoney } from "@/lib/money";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Financial overview" };

export default async function FinancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { ctx, tz, currency } = await pageCtx();
  requirePermission(ctx, "financials.view");
  const f = parseReportFilters(sp, tz);
  const o = await financialOverview(ctx, f);
  const $ = (c: number) => formatMoney(c, currency);
  return (
    <>
      <PageHeader title="Financial overview" subtitle={`${f.from} → ${f.to}`} />
      <div className="mb-5"><Notice tone="info" title="Operational view, not accounting">Figures come from the invoices, payments and expenses recorded in Worklio. They are not a profit-and-loss statement or formal accounting.</Notice></div>
      <form action="/finance" className="mb-5 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-3">
        <label className="text-xs text-fg-3">From<Input name="from" type="date" defaultValue={f.from} className="mt-1 w-36" /></label>
        <label className="text-xs text-fg-3">To<Input name="to" type="date" defaultValue={f.to} className="mt-1 w-36" /></label>
        <Button type="submit" variant="primary">Apply</Button>
      </form>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Invoiced" value={$(o.revenueCents)} sub={`${o.invoiceCount} invoices issued`} href="/reports/revenue" />
        <Stat label="Collected" value={$(o.collectedCents)} sub="Payments received" tone="success" href="/reports/payments" />
        <Stat label="Outstanding" value={$(o.outstandingCents)} sub={`${o.outstandingCount} open invoices`} href="/invoices?status=OUTSTANDING" />
        <Stat label="Past due" value={$(o.pastDueCents)} sub={`${o.pastDueCount} overdue invoices`} tone={o.pastDueCents > 0 ? "danger" : undefined} href="/invoices?status=PAST_DUE" />
        <Stat label="Quotes awaiting decision" value={$(o.quotesOutstandingCents)} sub={`${o.quotesOutstandingCount} quotes`} href="/quotes?status=SENT" />
        <Stat label="Quotes approved" value={$(o.quotesApprovedCents)} sub={`${o.quotesApprovedCount} in period`} href="/reports/quotes" />
        <Stat label="Average invoice" value={$(o.avgTicketCents)} sub={`${o.jobsCompleted} jobs completed`} />
        {o.expensesCents != null && <Stat label="Expenses recorded" value={$(o.expensesCents)} sub={`Collected − expenses: ${$(o.collectedCents - o.expensesCents)}`} href="/expenses" />}
      </div>
      <p className="mt-6 text-xs text-fg-3">Want a breakdown? See <Link href="/reports" className="text-primary hover:underline">Reports</Link> for revenue by month, service, customer and technician, receivables aging and more.</p>
    </>
  );
}
