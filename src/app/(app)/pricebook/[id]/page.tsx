import type { Metadata } from "next";
import { archivePricebookItemAction, savePricebookItemAction } from "@/app/actions/sales";
import { PricebookFields } from "@/components/pricebook-form";
import { ActionForm, ConfirmAction, SubmitButton } from "@/components/ui/client";
import { Card, LinkButton, PageHeader } from "@/components/ui/primitives";
import { can, requirePermission } from "@/server/auth/context";
import { getPricebookItem, listCategories } from "@/server/domain/pricebook";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Edit pricebook item" };

export default async function EditItem({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await pageCtx();
  requirePermission(ctx, "pricebook.manage");
  const [item, cats] = await Promise.all([getPricebookItem(ctx, id), listCategories(ctx)]);
  return (
    <>
      <PageHeader title={item.name} breadcrumbs={[{ label: "Pricebook", href: "/pricebook" }, { label: item.name }]} actions={<ConfirmAction label="Archive" title="Archive this item?" description="It disappears from pickers; existing quotes and invoices keep their lines." confirmLabel="Archive" action={archivePricebookItemAction.bind(null, id)} />} />
      <ActionForm action={savePricebookItemAction.bind(null, id)} className="max-w-3xl space-y-5">
        <Card><PricebookFields i={item} categories={cats} canCost={can(ctx, "pricebook.view_costs")} /></Card>
        <div className="flex justify-end gap-2"><LinkButton href="/pricebook" variant="ghost">Cancel</LinkButton><SubmitButton>Save changes</SubmitButton></div>
      </ActionForm>
    </>
  );
}
