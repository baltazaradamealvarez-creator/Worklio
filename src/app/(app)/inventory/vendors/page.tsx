import type { Metadata } from "next";
import { InventoryTabs, VendorDialog } from "@/components/inventory-forms";
import { Icon } from "@/components/ui/icon";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requirePermission } from "@/server/auth/context";
import { listVendors } from "@/server/domain/inventory";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Vendors" };

export default async function VendorsPage() {
  const { ctx } = await pageCtx();
  requirePermission(ctx, "inventory.view");
  const vendors = await listVendors(ctx);
  const manage = can(ctx, "inventory.manage");
  return (
    <>
      <PageHeader title="Inventory" subtitle="Materials and equipment across the warehouse and each truck." actions={manage && <VendorDialog trigger={<Button variant="primary"><Icon name="plus" size={14} /> New vendor</Button>} />} />
      <InventoryTabs active="vendors" />
      {vendors.length === 0 ? <div className="rounded-lg border border-line bg-surface"><EmptyState title="No vendors" description="Keep supply houses and distributors here to link them to items and expenses." /></div> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{vendors.map((v) => (
          <Card key={v.id}>
            <div className="flex items-start justify-between gap-2"><div><div className="font-semibold">{v.name}</div><div className="text-xs text-fg-3">{[v.contactName, v.phone, v.email].filter(Boolean).join(" · ") || "No contact details"}</div></div>{!v.isActive && <Badge>Inactive</Badge>}</div>
            <div className="mt-2 text-xs text-fg-3">{v._count.items} items · {v._count.expenses} expenses{v.accountNumber ? ` · Acct ${v.accountNumber}` : ""}</div>
            {manage && <div className="mt-3"><VendorDialog id={v.id} v={v} trigger={<Button size="sm" variant="ghost">Edit</Button>} /></div>}
          </Card>))}</div>
      )}
    </>
  );
}
