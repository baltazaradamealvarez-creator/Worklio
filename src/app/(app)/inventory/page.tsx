import type { Metadata } from "next";
import Link from "next/link";
import { FilterBar } from "@/components/data/client";
import { DataTable, type Column, type SP } from "@/components/data/data-table";
import { Icon } from "@/components/ui/icon";
import { InventoryTabs } from "@/components/inventory-forms";
import { Badge, EmptyState, LinkButton, Money, PageHeader } from "@/components/ui/primitives";
import { can } from "@/server/auth/context";
import { listInventory, listVendors } from "@/server/domain/inventory";
import { parseListParams } from "@/server/domain/list";
import { humanize } from "@/lib/format";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Inventory" };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { ctx, currency } = await pageCtx();
  const p = parseListParams(sp, { sortable: ["name", "sku"], defaultSort: "name", filters: ["vendor", "stock"] });
  const [page, vendors] = await Promise.all([listInventory(ctx, p), listVendors(ctx)]);
  const costs = can(ctx, "pricebook.view_costs");
  type Row = (typeof page.rows)[number];
  const cols: Column<Row>[] = [
    { key: "sku", header: "SKU", sortKey: "sku", fixed: true, cell: (r) => <span className="font-mono text-xs">{r.sku}</span> },
    { key: "name", header: "Item", sortKey: "name", cell: (r) => <Link href={`/inventory/${r.id}`} className="font-medium hover:text-primary">{r.name}</Link> },
    { key: "vendor", header: "Vendor", from: "lg", cell: (r) => r.vendor?.name ?? "—" },
    { key: "onhand", header: "On hand", align: "right", cell: (r) => <span className={r.low ? "font-semibold text-danger" : ""}>{r.onHand} <span className="text-fg-3">{r.unit}</span></span> },
    { key: "reorder", header: "Reorder at", align: "right", from: "md", cell: (r) => r.reorderThreshold || "—" },
    ...(costs ? [{ key: "cost", header: "Unit cost", align: "right" as const, from: "lg" as const, cell: (r: Row) => <Money cents={r.costCents} currency={currency} muted /> }] : []),
    { key: "status", header: "", cell: (r) => r.low ? <Badge tone="red">Low stock</Badge> : !r.isActive ? <Badge>Inactive</Badge> : null },
  ];
  return (
    <>
      <PageHeader title="Inventory" subtitle="Materials and equipment across the warehouse and each truck." actions={can(ctx, "inventory.manage") && <LinkButton href="/inventory/new" variant="primary"><Icon name="plus" size={14} /> New item</LinkButton>} />
      <InventoryTabs active="items" />
      <FilterBar searchPlaceholder="Search name or SKU…" filters={[{ name: "stock", label: "Stock", options: [{ value: "low", label: "Low stock" }] }, { name: "vendor", label: "Vendor", options: vendors.map((v) => ({ value: v.id, label: v.name })) }]} />
      <DataTable id="inventory-table" columns={cols} page={page} sp={sp} basePath="/inventory" sort={p.sort} dir={p.dir} rowHref={(r) => `/inventory/${r.id}`}
        empty={<EmptyState icon={<Icon name="package" size={18} />} title="No inventory items" description={`Track stock by location (${humanize("warehouse")} and trucks), get low-stock alerts, and decrement automatically when technicians use materials on jobs.`} action={can(ctx, "inventory.manage") && <LinkButton href="/inventory/new" variant="primary">Add an item</LinkButton>} />} />
    </>
  );
}
