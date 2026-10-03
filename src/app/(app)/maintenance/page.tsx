import type { Metadata } from "next";
import Link from "next/link";
import { FilterBar } from "@/components/data/client";
import { DataTable, type Column, type SP } from "@/components/data/data-table";
import { Icon } from "@/components/ui/icon";
import { EmptyState, LinkButton, Money, PageHeader, StatusBadge } from "@/components/ui/primitives";
import { can } from "@/server/auth/context";
import { parseListParams } from "@/server/domain/list";
import { listAgreements } from "@/server/domain/maintenance";
import { formatDateOnly, humanize } from "@/lib/format";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Maintenance agreements" };

export default async function MaintenancePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { ctx, currency } = await pageCtx();
  const p = parseListParams(sp, { sortable: ["renewalDate", "startDate", "price", "customer"], defaultSort: "renewalDate", filters: ["status", "customer"] });
  const page = await listAgreements(ctx, p);
  type Row = (typeof page.rows)[number];
  const cols: Column<Row>[] = [
    { key: "number", header: "Agreement", fixed: true, cell: (r) => <span><span className="font-mono text-xs">{r.number}</span> <span className="ml-1 text-fg-2">{r.name}</span></span> },
    { key: "customer", header: "Customer", sortKey: "customer", cell: (r) => <Link href={`/customers/${r.customer.id}`} className="hover:text-primary hover:underline">{r.customer.displayName}</Link> },
    { key: "freq", header: "Billing", from: "lg", cell: (r) => humanize(r.billingFrequency) },
    { key: "price", header: "Price", sortKey: "price", align: "right", cell: (r) => <Money cents={r.priceCents} currency={currency} /> },
    { key: "visits", header: "Visits", from: "md", cell: (r) => `${r.completedVisits} / ${r.includedVisits}` },
    { key: "renewal", header: "Renews", sortKey: "renewalDate", cell: (r) => formatDateOnly(r.renewalDate) },
    { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.effectiveStatus} /> },
  ];
  return (
    <>
      <PageHeader title="Maintenance agreements" subtitle="Recurring revenue: plans, planned visits and renewals." actions={can(ctx, "maintenance.manage") && <LinkButton href="/maintenance/new" variant="primary"><Icon name="plus" size={14} /> New agreement</LinkButton>} />
      <FilterBar searchPlaceholder="Search agreement, customer…" filters={[{ name: "status", label: "Status", options: [["ACTIVE", "Active"], ["EXPIRING", "Expiring (45 days)"], ["EXPIRED", "Expired"], ["PENDING_RENEWAL", "Not started"], ["CANCELLED", "Cancelled"]].map(([value, label]) => ({ value, label })) }]} />
      <DataTable id="agreements-table" columns={cols} page={page} sp={sp} basePath="/maintenance" sort={p.sort} dir={p.dir} rowHref={(r) => `/maintenance/${r.id}`}
        empty={<EmptyState icon={<Icon name="shield-check" size={18} />} title="No maintenance agreements" description="Sell recurring tune-up plans to smooth out seasonal revenue. Visits are planned automatically and can be turned into jobs in one click." action={can(ctx, "maintenance.manage") && <LinkButton href="/maintenance/new" variant="primary">Create an agreement</LinkButton>} />} />
    </>
  );
}
