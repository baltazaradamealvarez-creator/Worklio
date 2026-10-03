import type { Metadata } from "next";
import { saveEquipmentAction } from "@/app/actions/customers";
import { EquipmentFields } from "@/components/customers/equipment-form";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { Card, LinkButton, PageHeader } from "@/components/ui/primitives";
import { requirePermission } from "@/server/auth/context";
import { getCustomer } from "@/server/domain/customers";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Add equipment" };

export default async function NewEquipmentPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await pageCtx();
  requirePermission(ctx, "equipment.manage");
  const c = sp.customer ? await getCustomer(ctx, sp.customer).catch(() => null) : null;
  return (
    <>
      <PageHeader title="Add equipment" breadcrumbs={[{ label: "Equipment", href: "/equipment" }, { label: "New" }]} />
      <ActionForm action={saveEquipmentAction.bind(null, null)} className="max-w-4xl space-y-5">
        <Card><EquipmentFields customer={c ? { id: c.id, name: c.displayName } : null} /></Card>
        <div className="flex justify-end gap-2"><LinkButton href="/equipment" variant="ghost">Cancel</LinkButton><SubmitButton>Add equipment</SubmitButton></div>
      </ActionForm>
    </>
  );
}
