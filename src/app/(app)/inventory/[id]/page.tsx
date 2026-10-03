import type { Metadata } from "next";
import Link from "next/link";
import { saveInventoryItemAction } from "@/app/actions/admin";
import { AdjustStockDialog, ItemFields, TransferStockDialog } from "@/components/inventory-forms";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { Badge, Card, EmptyState, LinkButton, PageHeader } from "@/components/ui/primitives";
import { can } from "@/server/auth/context";
import { getInventoryItem, listLocations, listVendors } from "@/server/domain/inventory";
import { formatDateTime, humanize } from "@/lib/format";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Inventory item" };

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, tz } = await pageCtx();
  const [item, locations, vendors] = await Promise.all([getInventoryItem(ctx, id), listLocations(ctx), listVendors(ctx)]);
  const manage = can(ctx, "inventory.manage");
  const total = item.stocks.reduce((s, x) => s + Number(x.quantity), 0);
  const low = item.reorderThreshold > 0 && total <= item.reorderThreshold;
  return (
    <>
      <PageHeader title={item.name} subtitle={<span className="font-mono text-xs">{item.sku}</span>} breadcrumbs={[{ label: "Inventory", href: "/inventory" }, { label: item.sku }]} badges={low ? <Badge tone="red">Low stock</Badge> : undefined}
        actions={manage && <><TransferStockDialog itemId={id} locations={locations} /><AdjustStockDialog itemId={id} locations={locations} /></>} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Stock by location" description={`${total} ${item.unit} on hand in total`} padded={false}>
            {item.stocks.length === 0 ? <EmptyState title="No stock recorded" description="Receive stock into the warehouse or a truck to start tracking it." /> : <ul className="divide-y divide-line">{item.stocks.map((s) => <li key={s.id} className="flex items-center justify-between px-4 py-2.5 text-[13px]"><span>{s.location.name} <span className="text-xs text-fg-3">{humanize(s.location.type)}</span></span><span className="tabular font-medium">{Number(s.quantity)} {item.unit}</span></li>)}</ul>}
          </Card>
          <Card title="Recent movements" padded={false}>
            {item.transactions.length === 0 ? <p className="px-4 py-6 text-center text-[13px] text-fg-3">No movements yet.</p> : (
              <div className="overflow-x-auto"><table className="w-full text-[13px]"><tbody className="divide-y divide-line">{item.transactions.map((t) => <tr key={t.id}><td className="px-4 py-2 text-fg-3">{formatDateTime(t.createdAt, tz)}</td><td className="px-3">{humanize(t.type)}</td><td className="px-3 text-fg-2">{t.location.name}</td><td className="tabular px-3 text-right font-medium">{Number(t.quantityDelta) > 0 ? "+" : ""}{Number(t.quantityDelta)}</td><td className="px-3 text-xs text-fg-3">{t.job ? <Link href={`/jobs/${t.job.id}`} className="text-primary hover:underline">{t.job.number}</Link> : t.note}</td></tr>)}</tbody></table></div>
            )}
          </Card>
        </div>
        {manage && (
          <ActionForm action={saveInventoryItemAction.bind(null, id)} className="space-y-4">
            <Card title="Item details"><ItemFields i={{ ...item, costCents: can(ctx, "pricebook.view_costs") ? item.costCents : 0 }} vendors={vendors} canCost={can(ctx, "pricebook.view_costs")} /></Card>
            <div className="flex justify-end"><SubmitButton>Save changes</SubmitButton></div>
          </ActionForm>
        )}
      </div>
      {!manage && <LinkButton href="/inventory" variant="ghost">Back</LinkButton>}
    </>
  );
}
