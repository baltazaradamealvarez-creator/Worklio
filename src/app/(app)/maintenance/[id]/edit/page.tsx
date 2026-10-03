import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { saveAgreementAction } from "@/app/actions/admin";
import { AgreementFields } from "@/components/maintenance-form";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { Card, LinkButton, PageHeader } from "@/components/ui/primitives";
import { requirePermission } from "@/server/auth/context";
import { getAgreement } from "@/server/domain/maintenance";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Edit agreement" };

export default async function EditAgreement({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await pageCtx();
  requirePermission(ctx, "maintenance.manage");
  const a = await getAgreement(ctx, id);
  if (a.status === "CANCELLED") redirect(`/maintenance/${id}`);
  return (
    <>
      <PageHeader title={`Edit ${a.number}`} breadcrumbs={[{ label: "Maintenance", href: "/maintenance" }, { label: a.number, href: `/maintenance/${id}` }, { label: "Edit" }]} />
      <ActionForm action={saveAgreementAction.bind(null, id)} className="max-w-3xl space-y-5">
        <Card><AgreementFields lock a={{ ...a, equipmentIds: a.equipment.map((e) => e.equipmentId) }} /></Card>
        <div className="flex justify-end gap-2"><LinkButton href={`/maintenance/${id}`} variant="ghost">Cancel</LinkButton><SubmitButton>Save changes</SubmitButton></div>
      </ActionForm>
    </>
  );
}
