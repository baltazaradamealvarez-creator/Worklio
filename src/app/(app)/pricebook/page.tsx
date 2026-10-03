import type { Metadata } from "next";
import { deleteCategoryAction, saveCategoryAction } from "@/app/actions/sales";
import { FilterBar } from "@/components/data/client";
import { DataTable, type Column, type SP } from "@/components/data/data-table";
import { ActionForm, ConfirmAction, Dialog, FField, SubmitButton } from "@/components/ui/client";
import { Icon } from "@/components/ui/icon";
import { Badge, Button, EmptyState, Input, LinkButton, Money, PageHeader } from "@/components/ui/primitives";
import { can } from "@/server/auth/context";
import { parseListParams } from "@/server/domain/list";
import { listCategories, listPricebook } from "@/server/domain/pricebook";
import { humanize } from "@/lib/format";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Pricebook" };

export default async function PricebookPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { ctx, currency } = await pageCtx();
  const p = parseListParams(sp, { sortable: ["name", "price", "sku", "category"], defaultSort: "name", defaultDir: "asc", filters: ["category", "kind", "active"] });
  const [page, cats] = await Promise.all([listPricebook(ctx, p), listCategories(ctx)]);
  type Row = (typeof page.rows)[number];
  const costs = can(ctx, "pricebook.view_costs");
  const manage = can(ctx, "pricebook.manage");
  const cols: Column<Row>[] = [
    { key: "name", header: "Item", sortKey: "name", fixed: true, cell: (r) => <div><div>{r.name}</div>{r.description && <div className="max-w-md truncate text-xs font-normal text-fg-3">{r.description}</div>}</div> },
    { key: "sku", header: "SKU", sortKey: "sku", from: "md", cell: (r) => <span className="font-mono text-xs">{r.sku ?? "—"}</span> },
    { key: "category", header: "Category", sortKey: "category", from: "md", cell: (r) => r.category?.name ?? "—" },
    { key: "kind", header: "Type", from: "lg", cell: (r) => <Badge>{humanize(r.kind)}</Badge> },
    ...(costs ? [{ key: "cost", header: "Cost", align: "right" as const, from: "lg" as const, cell: (r: Row) => <Money cents={r.costCents} currency={currency} muted /> }, { key: "margin", header: "Margin", align: "right" as const, from: "xl" as const, cell: (r: Row) => r.priceCents > 0 ? <span>{Math.round(((r.priceCents - r.costCents) / r.priceCents) * 100)}%</span> : "—" }] : []),
    { key: "price", header: "Price", sortKey: "price", align: "right", cell: (r) => <Money cents={r.priceCents} currency={currency} className="font-medium" /> },
    { key: "taxable", header: "Taxable", from: "xl", cell: (r) => r.taxable ? "Yes" : "No" },
    { key: "active", header: "", cell: (r) => r.isActive ? null : <Badge>Inactive</Badge> },
  ];
  return (
    <>
      <PageHeader title="Pricebook" subtitle="Your standard services, labor, parts and equipment. Quotes, invoices and jobs pull from here." actions={<>
        {manage && (
          <Dialog title="Categories" description="Organise the pricebook. A category must be empty before it can be deleted." trigger={<Button>Categories</Button>}>
            <ul className="mb-4 divide-y divide-line rounded-md border border-line">{cats.map((c) => <li key={c.id} className="flex items-center justify-between px-3 py-2 text-[13px]"><span>{c.name} <span className="text-fg-3">· {c._count.items}</span></span><ConfirmAction size="sm" variant="ghost" label={<Icon name="trash-2" size={13} />} title={`Delete “${c.name}”?`} confirmLabel="Delete" action={deleteCategoryAction.bind(null, c.id)} /></li>)}</ul>
            <ActionForm action={saveCategoryAction.bind(null, null)} resetOnSuccess className="flex items-end gap-2"><FField label="New category" name="name" className="flex-1"><Input name="name" required /></FField><SubmitButton variant="secondary">Add</SubmitButton></ActionForm>
          </Dialog>)}
        {manage && <LinkButton href="/pricebook/new" variant="primary"><Icon name="plus" size={14} /> New item</LinkButton>}
      </>} />
      <FilterBar searchPlaceholder="Search name, SKU, description…" filters={[
        { name: "category", label: "Category", options: cats.map((c) => ({ value: c.id, label: c.name })) },
        { name: "kind", label: "Type", options: ["SERVICE", "LABOR", "MATERIAL", "EQUIPMENT", "DISCOUNT", "OTHER"].map((k) => ({ value: k, label: humanize(k) })) },
        { name: "active", label: "Active only", options: [{ value: "0", label: "Inactive only" }, { value: "all", label: "Include inactive" }] },
      ]} />
      <DataTable id="pricebook-table" columns={cols} page={page} sp={sp} basePath="/pricebook" sort={p.sort} dir={p.dir} rowHref={manage ? (r) => `/pricebook/${r.id}` : undefined}
        empty={<EmptyState icon={<Icon name="book-open" size={18} />} title="Your pricebook is empty" description="Add the services, parts and equipment you sell, with cost and price, so quotes and invoices are fast and consistent." action={manage && <LinkButton href="/pricebook/new" variant="primary">Add your first item</LinkButton>} />} />
    </>
  );
}
