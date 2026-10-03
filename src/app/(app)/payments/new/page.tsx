import type { Metadata } from "next";
import Link from "next/link";
import { PaymentForm } from "@/components/documents/invoice-actions";
import { Card, EmptyState, Money, PageHeader } from "@/components/ui/primitives";
import { requirePermission } from "@/server/auth/context";
import { listInvoices } from "@/server/domain/invoices";
import { parseListParams } from "@/server/domain/list";
import { formatDateOnly } from "@/lib/format";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Record payment" };

export default async function NewPaymentPage({ searchParams }: { searchParams: Promise<{ invoice?: string }> }) {
  const sp = await searchParams;
  const { ctx, currency } = await pageCtx();
  requirePermission(ctx, "payments.record");
  const open = await listInvoices(ctx, parseListParams({ status: "OUTSTANDING", pageSize: "100", sort: "dueDate", dir: "asc" }, { sortable: ["dueDate"], defaultSort: "dueDate", filters: ["status"] }));
  const chosen = open.rows.find((r) => r.id === sp.invoice);
  return (
    <>
      <PageHeader title="Record payment" subtitle="Choose the invoice the payment applies to." breadcrumbs={[{ label: "Payments", href: "/payments" }, { label: "Record" }]} />
      {open.rows.length === 0 ? <div className="rounded-lg border border-line bg-surface"><EmptyState title="Nothing to collect" description="There are no open invoices with a balance. Create or send an invoice first." /></div> : (
        <div className="grid gap-6 lg:grid-cols-5">
          <Card title="Open invoices" padded={false} className="lg:col-span-2"><ul className="max-h-[60vh] divide-y divide-line overflow-auto">{open.rows.map((r) => <li key={r.id}><Link href={`/payments/new?invoice=${r.id}`} className={`flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-2/60 ${r.id === sp.invoice ? "bg-primary-soft" : ""}`}><span><span className="block text-[13px] font-medium">{r.number} · {r.customer.displayName}</span><span className="text-xs text-fg-3">Due {formatDateOnly(r.dueDate)}</span></span><Money cents={r.balanceCents} currency={currency} className="text-[13px] font-semibold" /></Link></li>)}</ul></Card>
          <Card title={chosen ? `Payment for ${chosen.number}` : "Payment details"} className="lg:col-span-3">{chosen ? <PaymentForm invoiceId={chosen.id} balanceCents={chosen.balanceCents} depositCents={chosen.depositRequiredCents} /> : <p className="py-8 text-center text-[13px] text-fg-3">Select an invoice from the list.</p>}</Card>
        </div>
      )}
    </>
  );
}
