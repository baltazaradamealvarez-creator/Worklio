import type { Metadata } from "next";
import Link from "next/link";
import { FilterBar } from "@/components/data/client";
import { DataTable, type Column, type SP } from "@/components/data/data-table";
import { PAYMENT_METHODS } from "@/components/documents/invoice-actions";
import { Icon } from "@/components/ui/icon";
import { Badge, EmptyState, LinkButton, Money, PageHeader } from "@/components/ui/primitives";
import { can } from "@/server/auth/context";
import { parseListParams } from "@/server/domain/list";
import { listPayments } from "@/server/domain/payments";
import { formatDateTime, humanize } from "@/lib/format";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Payments" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { ctx, tz, currency } = await pageCtx();
  const p = parseListParams(sp, { sortable: ["receivedAt", "amount"], defaultSort: "receivedAt", filters: ["method", "status", "customer", "from", "to"] });
  const page = await listPayments(ctx, p);
  type Row = (typeof page.rows)[number];
  const cols: Column<Row>[] = [
    { key: "date", header: "Received", sortKey: "receivedAt", fixed: true, cell: (r) => formatDateTime(r.receivedAt, tz) },
    { key: "customer", header: "Customer", cell: (r) => <Link href={`/customers/${r.customer.id}`} className="hover:text-primary hover:underline">{r.customer.displayName}</Link> },
    { key: "invoice", header: "Invoice", cell: (r) => <Link href={`/invoices/${r.invoice.id}`} className="font-mono text-xs hover:text-primary hover:underline">{r.invoice.number}</Link> },
    { key: "method", header: "Method", from: "md", cell: (r) => <span>{humanize(r.method)}{r.isDeposit && <Badge tone="blue" className="ml-2">Deposit</Badge>}</span> },
    { key: "ref", header: "Reference", from: "lg", cell: (r) => r.reference ?? "—" },
    { key: "amount", header: "Amount", sortKey: "amount", align: "right", cell: (r) => <Money cents={r.amountCents} currency={currency} className="font-medium" /> },
  ];
  return (
    <>
      <PageHeader title="Payments" subtitle="Every payment received against your invoices." actions={can(ctx, "payments.record") && <LinkButton href="/payments/new" variant="primary"><Icon name="plus" size={14} /> Record payment</LinkButton>} />
      <FilterBar searchPlaceholder="Search reference, invoice #, customer…" filters={[{ name: "method", label: "Method", options: PAYMENT_METHODS.map(([value, label]) => ({ value, label })) }, { name: "status", label: "Status", options: [{ value: "voided", label: "Voided" }] }, { name: "from", label: "From", type: "date" }, { name: "to", label: "To", type: "date" }]} />
      <DataTable id="payments-table" columns={cols} page={page} sp={sp} basePath="/payments" sort={p.sort} dir={p.dir} rowHref={(r) => `/invoices/${r.invoice.id}`}
        footer={page.rows.length ? <tfoot><tr className="border-t border-line bg-surface-2/60 text-xs"><td colSpan={99} className="px-3 py-2 text-right text-fg-3">Total of {page.total} matching payment{page.total === 1 ? "" : "s"}: <Money cents={page.sumCents} currency={currency} className="font-semibold text-fg" /></td></tr></tfoot> : null}
        empty={<EmptyState icon={<Icon name="banknote" size={18} />} title="No payments recorded" description="Record checks, cash, card and ACH payments against open invoices. Partial payments and deposits are supported." action={can(ctx, "payments.record") && <LinkButton href="/payments/new" variant="primary">Record a payment</LinkButton>} />} />
    </>
  );
}
