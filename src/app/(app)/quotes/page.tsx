import type { Metadata } from "next";
import { FilterBar } from "@/components/data/client";
import { DataTable, type Column, type SP } from "@/components/data/data-table";
import { Icon } from "@/components/ui/icon";
import { Badge, EmptyState, LinkButton, Money, PageHeader, StatusBadge } from "@/components/ui/primitives";
import { can } from "@/server/auth/context";
import { listAssignableEmployees } from "@/server/domain/employees";
import { parseListParams } from "@/server/domain/list";
import { listQuotes, QUOTE_STATUSES } from "@/server/domain/quotes";
import { formatDateOnly, humanize } from "@/lib/format";
import { pageCtx } from "@/server/page-context";
import Link from "next/link";

export const metadata: Metadata = { title: "Quotes" };

export default async function QuotesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { ctx, currency } = await pageCtx();
  const p = parseListParams(sp, { sortable: ["issueDate", "total", "expiresAt", "customer", "number", "status"], defaultSort: "issueDate", filters: ["status", "customer", "salesperson", "from", "to", "minAmount", "maxAmount"] });
  const [page, people] = await Promise.all([listQuotes(ctx, p), listAssignableEmployees(ctx)]);
  type Row = (typeof page.rows)[number];
  const cols: Column<Row>[] = [
    { key: "number", header: "Quote", sortKey: "number", fixed: true, cell: (r) => <span className="font-mono text-xs">{r.number}</span> },
    { key: "customer", header: "Customer", sortKey: "customer", cell: (r) => <Link href={`/customers/${r.customer.id}`} className="hover:text-primary hover:underline">{r.customer.displayName}</Link> },
    { key: "title", header: "Title", from: "md", cell: (r) => <span>{r.title}{r._count.options > 1 && <Badge className="ml-2">{r._count.options} options</Badge>}</span> },
    { key: "owner", header: "Salesperson", from: "xl", cell: (r) => r.salespersonName ?? "—" },
    { key: "issued", header: "Issued", sortKey: "issueDate", from: "lg", cell: (r) => formatDateOnly(r.issueDate) },
    { key: "expires", header: "Expires", sortKey: "expiresAt", from: "lg", cell: (r) => r.expiresAt ? <span className={r.expiresAt < new Date() && ["SENT", "VIEWED", "DRAFT", "READY"].includes(r.status) ? "text-danger" : ""}>{formatDateOnly(r.expiresAt)}</span> : "—" },
    { key: "total", header: "Total", sortKey: "total", align: "right", cell: (r) => <Money cents={r.totalCents} currency={currency} className="font-medium" /> },
    { key: "status", header: "Status", sortKey: "status", cell: (r) => <StatusBadge status={r.status} /> },
  ];
  return (
    <>
      <PageHeader title="Quotes" subtitle="Professional, branded quotes your customers can review and approve online." actions={can(ctx, "quotes.create") && <LinkButton href="/quotes/new" variant="primary"><Icon name="plus" size={14} /> New quote</LinkButton>} />
      <FilterBar searchPlaceholder="Search quote #, title, customer…" filters={[
        { name: "status", label: "Status", options: [{ value: "OUTSTANDING", label: "Awaiting reply" }, ...QUOTE_STATUSES.map((s) => ({ value: s, label: humanize(s) }))] },
        { name: "salesperson", label: "Salesperson", options: people.map((e) => ({ value: e.id, label: `${e.firstName} ${e.lastName}` })) },
        { name: "from", label: "From", type: "date" }, { name: "to", label: "To", type: "date" },
        { name: "minAmount", label: "Min $", type: "text", width: "w-20" }, { name: "maxAmount", label: "Max $", type: "text", width: "w-20" },
      ]} />
      <DataTable id="quotes-table" columns={cols} page={page} sp={sp} basePath="/quotes" sort={p.sort} dir={p.dir} rowHref={(r) => `/quotes/${r.id}`}
        footer={page.rows.length ? <tfoot><tr className="border-t border-line bg-surface-2/60 text-xs"><td colSpan={99} className="px-3 py-2 text-right text-fg-3">Total of {page.total} matching quote{page.total === 1 ? "" : "s"}: <Money cents={page.sumCents} currency={currency} className="ml-1 font-semibold text-fg" /></td></tr></tfoot> : null}
        empty={<EmptyState icon={<Icon name="file-text" size={18} />} title="No quotes yet" description="Quotes let customers compare options (good / better / best), review pricing and approve online. Approved quotes convert to a job or invoice in one click." action={can(ctx, "quotes.create") && <LinkButton href="/quotes/new" variant="primary">Create your first quote</LinkButton>} />} />
    </>
  );
}
