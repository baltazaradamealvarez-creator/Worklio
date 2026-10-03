import type { Metadata } from "next";
import { addYears } from "date-fns";
import { saveAgreementAction } from "@/app/actions/admin";
import { AgreementFields } from "@/components/maintenance-form";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { Card, LinkButton, PageHeader } from "@/components/ui/primitives";
import { requirePermission } from "@/server/auth/context";
import { getCustomer } from "@/server/domain/customers";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "New agreement" };

export default async function NewAgreement({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await pageCtx();
  requirePermission(ctx, "maintenance.manage");
  const c = sp.customer ? await getCustomer(ctx, sp.customer).catch(() => null) : null;
  const start = new Date(); start.setUTCHours(0, 0, 0, 0);
  return (
    <>
      <PageHeader title="New maintenance agreement" breadcrumbs={[{ label: "Maintenance", href: "/maintenance" }, { label: "New" }]} />
      <ActionForm action={saveAgreementAction.bind(null, null)} className="max-w-3xl space-y-5">
        <Card><AgreementFields a={{ customer: c ? { id: c.id, displayName: c.displayName } : undefined, startDate: start, renewalDate: addYears(start, 1) }} /></Card>
        <div className="flex justify-end gap-2"><LinkButton href="/maintenance" variant="ghost">Cancel</LinkButton><SubmitButton>Create agreement</SubmitButton></div>
      </ActionForm>
    </>
  );
}
