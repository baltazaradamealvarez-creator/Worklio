import type { Metadata } from "next";
import Link from "next/link";
import { FilterBar } from "@/components/data/client";
import { DataTable, type Column, type SP } from "@/components/data/data-table";
import { Icon } from "@/components/ui/icon";
import { EmptyState, LinkButton, Money, PageHeader, StatusBadge } from "@/components/ui/primitives";
import { can } from "@/server/auth/context";
import { INVOICE_STATUSES, listInvoices } from "@/server/domain/invoices";
import { parseListParams } from "@/server/domain/list";
import { effectiveInvoiceStatus } from "@/lib/state";
import { formatDateOnly, humanize } from "@/lib/format";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Invoices" };

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { ctx, currency } = await pageCtx();
  const p = parseListParams(sp, { sortable: ["issueDate", "dueDate", "total", "balance", "customer", "number"], defaultSort: "issueDate", filters: ["status", "customer", "job", "from", "to", "minAmount", "maxAmount"] });
  const page = await listInvoices(ctx, p);
  type Row = (typeof page.rows)[number];
  const cols: Column<Row>[] = [
    { key: "number", header: "Invoice", sortKey: "number", fixed: true, cell: (r) => <span className="font-mono text-xs">{r.number}</span> },
    { key: "customer", header: "Customer", sortKey: "customer", cell: (r) => <Link href={`/customers/${r.customer.id}`} className="hover:text-primary hover:underline">{r.customer.displayName}</Link> },
    { key: "title", header: "Description", from: "lg", cell: (r) => <span className="text-fg-2">{r.title ?? "—"}</span> },
    { key: "issued", header: "Issued", sortKey: "issueDate", from: "md", cell: (r) => formatDateOnly(r.issueDate) },
    { key: "due", header: "Due", sortKey: "dueDate", from: "md", cell: (r) => formatDateOnly(r.dueDate) },
    { key: "total", header: "Total", sortKey: "total", align: "right", cell: (r) => <Money cents={r.totalCents} currency={currency} /> },
    { key: "balance", header: "Balance", sortKey: "balance", align: "right", cell: (r) => <Money cents={r.balanceCents} currency={currency} muted className={r.balanceCents > 0 ? "font-medium" : ""} /> },
    { key: "status", header: "Status", cell: (r) => <StatusBadge status={effectiveInvoiceStatus(r)} label={effectiveInvoiceStatus(r) === "PAST_DUE" ? "Past due" : undefined} /> },
  ];
  return (
    <>
      <PageHeader title="Invoices" subtitle="Bill customers, track what's owed, and see what's overdue." actions={can(ctx, "invoices.create") && <LinkButton href="/invoices/new" variant="primary"><Icon name="plus" size={14} /> New invoice</LinkButton>} />
      <FilterBar searchPlaceholder="Search invoice #, customer…" filters={[
        { name: "status", label: "Status", options: [{ value: "OUTSTANDING", label: "Outstanding" }, { value: "PAST_DUE", label: "Past due" }, ...INVOICE_STATUSES.map((s) => ({ value: s, label: humanize(s) }))] },
        { name: "from", label: "From", type: "date" }, { name: "to", label: "To", type: "date" },
        { name: "minAmount", label: "Min $", type: "text", width: "w-20" }, { name: "maxAmount", label: "Max $", type: "text", width: "w-20" },
      ]} />
      <DataTable id="invoices-table" columns={cols} page={page} sp={sp} basePath="/invoices" sort={p.sort} dir={p.dir} rowHref={(r) => `/invoices/${r.id}`}
        footer={page.rows.length ? <tfoot><tr className="border-t border-line bg-surface-2/60 text-xs"><td colSpan={99} className="px-3 py-2 text-right text-fg-3">Matching invoices (excl. void): total <Money cents={page.sums.totalCents} currency={currency} className="font-semibold text-fg" /> · balance <Money cents={page.sums.balanceCents} currency={currency} className="font-semibold text-fg" /></td></tr></tfoot> : null}
        empty={<EmptyState icon={<Icon name="receipt" size={18} />} title="No invoices yet" description="Invoices are created from completed jobs or approved quotes, or from scratch. Customers can view and pay them online." action={can(ctx, "invoices.create") && <LinkButton href="/invoices/new" variant="primary">Create an invoice</LinkButton>} />} />
    </>
  );
}
