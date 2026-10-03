import type { Metadata } from "next";
import Link from "next/link";
import { FilterBar } from "@/components/data/client";
import { DataTable, type Column, type SP } from "@/components/data/data-table";
import { Icon } from "@/components/ui/icon";
import { Card, EmptyState, LinkButton, Money, PageHeader } from "@/components/ui/primitives";
import { can } from "@/server/auth/context";
import { EXPENSE_CATEGORIES, listExpenses } from "@/server/domain/expenses";
import { listVendors } from "@/server/domain/inventory";
import { parseListParams } from "@/server/domain/list";
import { formatDateOnly, humanize } from "@/lib/format";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Expenses" };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { ctx, currency } = await pageCtx();
  const p = parseListParams(sp, { sortable: ["expenseDate", "amount", "category"], defaultSort: "expenseDate", filters: ["category", "vendor", "job", "from", "to"] });
  const [page, vendors] = await Promise.all([listExpenses(ctx, p), can(ctx, "inventory.view") ? listVendors(ctx) : Promise.resolve([])]);
  type Row = (typeof page.rows)[number];
  const cols: Column<Row>[] = [
    { key: "date", header: "Date", sortKey: "expenseDate", fixed: true, cell: (r) => formatDateOnly(r.expenseDate) },
    { key: "desc", header: "Description", cell: (r) => <span className="font-medium">{r.description}</span> },
    { key: "category", header: "Category", sortKey: "category", from: "md", cell: (r) => humanize(r.category) },
    { key: "vendor", header: "Vendor", from: "lg", cell: (r) => r.vendor?.name ?? "—" },
    { key: "job", header: "Job", from: "lg", cell: (r) => r.job ? <Link href={`/jobs/${r.job.id}`} className="font-mono text-xs hover:text-primary" >{r.job.number}</Link> : "—" },
    { key: "amount", header: "Amount", sortKey: "amount", align: "right", cell: (r) => <Money cents={r.amountCents} currency={currency} /> },
  ];
  return (
    <>
      <PageHeader title="Expenses" subtitle="Operational costs for tracking — not a replacement for your accounting software." actions={can(ctx, "expenses.manage") && <LinkButton href="/expenses/new" variant="primary"><Icon name="plus" size={14} /> Add expense</LinkButton>} />
      <FilterBar searchPlaceholder="Search expenses…" filters={[{ name: "category", label: "Category", options: EXPENSE_CATEGORIES.map((c) => ({ value: c, label: humanize(c) })) }, ...(vendors.length ? [{ name: "vendor", label: "Vendor", options: vendors.map((v) => ({ value: v.id, label: v.name })) }] : []), { name: "from", label: "From", type: "date" as const }, { name: "to", label: "To", type: "date" as const }]} />
      {page.rows.length > 0 && <div className="mb-4 grid gap-3 sm:grid-cols-4"><Card><div className="text-xs text-fg-3">Total (filtered)</div><Money cents={page.sumCents} currency={currency} className="text-xl font-semibold" /></Card>{page.byCategory.slice(0, 3).map((c) => <Card key={c.category}><div className="text-xs text-fg-3">{humanize(c.category)}</div><Money cents={c.cents} currency={currency} className="text-lg font-semibold" /></Card>)}</div>}
      <DataTable id="expenses-table" columns={cols} page={page} sp={sp} basePath="/expenses" sort={p.sort} dir={p.dir} rowHref={(r) => `/expenses/${r.id}`}
        empty={<EmptyState icon={<Icon name="wallet" size={18} />} title="No expenses recorded" description="Track fuel, parts, tools, subcontractors and more, optionally against a job." action={can(ctx, "expenses.manage") && <LinkButton href="/expenses/new" variant="primary">Add an expense</LinkButton>} />} />
    </>
  );
}
