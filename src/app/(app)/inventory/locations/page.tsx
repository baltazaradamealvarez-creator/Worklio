import type { Metadata } from "next";
import { InventoryTabs, LocationDialog } from "@/components/inventory-forms";
import { Icon } from "@/components/ui/icon";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requirePermission } from "@/server/auth/context";
import { listTechnicians } from "@/server/domain/employees";
import { listLocations } from "@/server/domain/inventory";
import { humanize } from "@/lib/format";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Stock locations" };

export default async function LocationsPage() {
  const { ctx } = await pageCtx();
  requirePermission(ctx, "inventory.view");
  const [locs, techs] = await Promise.all([listLocations(ctx), listTechnicians(ctx)]);
  const manage = can(ctx, "inventory.manage");
  const counts = await ctx.db.inventoryStock.groupBy({ by: ["locationId"], _count: { _all: true } });
  const count = new Map(counts.map((c) => [c.locationId, c._count._all]));
  return (
    <>
      <PageHeader title="Inventory" subtitle="Materials and equipment across the warehouse and each truck." actions={manage && <LocationDialog technicians={techs} trigger={<Button variant="primary"><Icon name="plus" size={14} /> New location</Button>} />} />
      <InventoryTabs active="locations" />
      {locs.length === 0 ? <div className="rounded-lg border border-line bg-surface"><EmptyState title="No locations" description="Add your warehouse and a truck per technician to track where stock lives." /></div> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{locs.map((l) => (
          <Card key={l.id}>
            <div className="flex items-start justify-between"><div><div className="font-semibold">{l.name}</div><div className="text-xs text-fg-3">{humanize(l.type)}{l.employee ? ` · ${l.employee.firstName} ${l.employee.lastName}` : ""}</div></div><Badge tone={l.type === "TRUCK" ? "blue" : "gray"}>{count.get(l.id) ?? 0} SKUs</Badge></div>
            {manage && <div className="mt-3"><LocationDialog id={l.id} loc={l} technicians={techs} trigger={<Button size="sm" variant="ghost">Edit</Button>} /></div>}
          </Card>))}</div>
      )}
    </>
  );
}
