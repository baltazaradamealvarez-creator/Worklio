import type { Metadata } from "next";
import { savePricebookItemAction } from "@/app/actions/sales";
import { PricebookFields } from "@/components/pricebook-form";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { Card, LinkButton, PageHeader } from "@/components/ui/primitives";
import { can, requirePermission } from "@/server/auth/context";
import { listCategories } from "@/server/domain/pricebook";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "New pricebook item" };

export default async function NewItem() {
  const { ctx } = await pageCtx();
  requirePermission(ctx, "pricebook.manage");
  const cats = await listCategories(ctx);
  return (
    <>
      <PageHeader title="New pricebook item" breadcrumbs={[{ label: "Pricebook", href: "/pricebook" }, { label: "New" }]} />
      <ActionForm action={savePricebookItemAction.bind(null, null)} className="max-w-3xl space-y-5">
        <Card><PricebookFields categories={cats} canCost={can(ctx, "pricebook.view_costs")} /></Card>
        <div className="flex justify-end gap-2"><LinkButton href="/pricebook" variant="ghost">Cancel</LinkButton><SubmitButton>Add item</SubmitButton></div>
      </ActionForm>
    </>
  );
}
