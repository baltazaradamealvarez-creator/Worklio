import type { Metadata } from "next";
import { saveInventoryItemAction } from "@/app/actions/admin";
import { ItemFields } from "@/components/inventory-forms";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { Card, LinkButton, PageHeader } from "@/components/ui/primitives";
import { can, requirePermission } from "@/server/auth/context";
import { listVendors } from "@/server/domain/inventory";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "New inventory item" };

export default async function NewItem() {
  const { ctx } = await pageCtx();
  requirePermission(ctx, "inventory.manage");
  const vendors = await listVendors(ctx);
  return (
    <>
      <PageHeader title="New inventory item" breadcrumbs={[{ label: "Inventory", href: "/inventory" }, { label: "New" }]} />
      <ActionForm action={saveInventoryItemAction.bind(null, null)} className="max-w-3xl space-y-5">
        <Card><ItemFields vendors={vendors} canCost={can(ctx, "pricebook.view_costs")} /></Card>
        <div className="flex justify-end gap-2"><LinkButton href="/inventory" variant="ghost">Cancel</LinkButton><SubmitButton>Add item</SubmitButton></div>
      </ActionForm>
    </>
  );
}
