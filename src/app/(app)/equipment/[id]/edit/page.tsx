import type { Metadata } from "next";
import { saveEquipmentAction } from "@/app/actions/customers";
import { EquipmentFields } from "@/components/customers/equipment-form";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { Card, LinkButton, PageHeader } from "@/components/ui/primitives";
import { requirePermission } from "@/server/auth/context";
import { getEquipment } from "@/server/domain/equipment";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Edit equipment" };

export default async function EditEquipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await pageCtx();
  requirePermission(ctx, "equipment.manage");
  const e = await getEquipment(ctx, id);
  return (
    <>
      <PageHeader title="Edit equipment" breadcrumbs={[{ label: "Equipment", href: "/equipment" }, { label: [e.manufacturer, e.model].filter(Boolean).join(" ") || "Unit", href: `/equipment/${id}` }, { label: "Edit" }]} />
      <ActionForm action={saveEquipmentAction.bind(null, id)} className="max-w-4xl space-y-5">
        <Card><EquipmentFields e={e} customer={{ id: e.customer.id, name: e.customer.displayName }} lockCustomer /></Card>
        <div className="flex justify-end gap-2"><LinkButton href={`/equipment/${id}`} variant="ghost">Cancel</LinkButton><SubmitButton>Save changes</SubmitButton></div>
      </ActionForm>
    </>
  );
}
