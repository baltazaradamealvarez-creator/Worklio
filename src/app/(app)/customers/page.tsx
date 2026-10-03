import type { Metadata } from "next";
import { bulkCustomersAction } from "@/app/actions/customers";
import { BulkBar, FilterBar } from "@/components/data/client";
import { DataTable, type Column, type SP } from "@/components/data/data-table";
import { Badge, EmptyState, LinkButton, Money, PageHeader, StatusBadge } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
import { can } from "@/server/auth/context";
import { listCustomerTags, listCustomers } from "@/server/domain/customers";
import { parseListParams } from "@/server/domain/list";
import { formatDate, formatPhone } from "@/lib/format";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { ctx, tz, currency } = await pageCtx();
  const p = parseListParams(sp, { sortable: ["name", "createdAt", "status", "type"], defaultSort: "name", defaultDir: "asc", filters: ["status", "type", "tag", "balance", "city", "postalCode", "state", "source", "archived"] });
  const [page, tags] = await Promise.all([listCustomers(ctx, p), listCustomerTags(ctx)]);
  type Row = (typeof page.rows)[number];
  const showBalance = can(ctx, "invoices.view");
  const columns: Column<Row>[] = [
    { key: "name", header: "Customer", sortKey: "name", fixed: true, cell: (r) => <span className="inline-flex items-center gap-2">{r.type === "COMMERCIAL" && <Icon name="building-2" size={13} className="text-fg-3" />}{r.displayName}</span> },
    { key: "contact", header: "Contact", from: "md", cell: (r) => <div className="leading-tight"><div>{formatPhone(r.phone)}</div><div className="text-xs text-fg-3">{r.email}</div></div> },
    { key: "location", header: "Location", from: "lg", cell: (r) => r.locations[0] ? <span>{r.locations[0].city}, {r.locations[0].state}{r._count.locations > 1 && <span className="ml-1 text-xs text-fg-3">+{r._count.locations - 1}</span>}</span> : <span className="text-fg-3">—</span> },
    { key: "tags", header: "Tags", from: "xl", cell: (r) => <div className="flex flex-wrap gap-1">{r.tags.slice(0, 3).map((t) => <Badge key={t}>{t}</Badge>)}</div> },
    ...(showBalance ? [{ key: "balance", header: "Balance", align: "right" as const, cell: (r: Row) => <Money cents={r.balanceCents} currency={currency} muted className={r.balanceCents > 0 ? "font-medium" : ""} /> }] : []),
    { key: "status", header: "Status", sortKey: "status", cell: (r) => <StatusBadge status={r.status} /> },
    { key: "created", header: "Added", sortKey: "createdAt", from: "xl", defaultHidden: false, cell: (r) => <span className="text-fg-3">{formatDate(r.createdAt, tz)}</span> },
  ];
  const canEdit = can(ctx, "customers.edit");
  return (
    <>
      <PageHeader title="Customers" subtitle="Every homeowner and business you serve — the source of truth for jobs, equipment and billing." actions={can(ctx, "customers.create") && <LinkButton href="/customers/new" variant="primary"><Icon name="plus" size={14} /> New customer</LinkButton>} />
      <FilterBar searchPlaceholder="Search name, phone, email, address, serial #…" filters={[
        { name: "status", label: "Status", options: [["ACTIVE", "Active"], ["PROSPECT", "Prospect"], ["INACTIVE", "Inactive"], ["DO_NOT_SERVICE", "Do not service"]].map(([value, label]) => ({ value: value!, label: label! })) },
        { name: "type", label: "Type", options: [{ value: "RESIDENTIAL", label: "Residential" }, { value: "COMMERCIAL", label: "Commercial" }] },
        ...(tags.length ? [{ name: "tag", label: "Tag", options: tags.map((t) => ({ value: t, label: t })) }] : []),
        ...(showBalance ? [{ name: "balance", label: "Balance", options: [{ value: "owing", label: "Has balance due" }] }] : []),
        { name: "city", label: "City", type: "text" as const }, { name: "postalCode", label: "ZIP", type: "text" as const, width: "w-20" },
        { name: "archived", label: "Archived", options: [{ value: "1", label: "Show archived" }] },
      ]} />
      {canEdit && <BulkBar tableId="customers-table" action={bulkCustomersAction} actions={[
        { label: "Add tag…", op: "add_tag", prompt: "Tag to add to the selected customers:" },
        { label: "Mark inactive", op: "set_status", value: "INACTIVE" },
        ...(can(ctx, "customers.delete") ? [{ label: "Archive", op: "archive", variant: "danger-outline" as const, confirm: "Archive {n} customer(s)? Customers with open balances are skipped." }] : []),
      ]} />}
      <DataTable id="customers-table" columns={columns} page={page} sp={sp} basePath="/customers" sort={p.sort} dir={p.dir} rowHref={(r) => `/customers/${r.id}`} selectable={canEdit}
        empty={<EmptyState icon={<Icon name="users" size={18} />} title="No customers yet" description="Customers hold everything about a household or business: locations, equipment, jobs, quotes, invoices and notes. Add your first customer to get started." action={can(ctx, "customers.create") && <LinkButton href="/customers/new" variant="primary">Add a customer</LinkButton>} />} />
    </>
  );
}
