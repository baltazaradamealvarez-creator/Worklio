import type { Metadata } from "next";
import { saveFinancialAction } from "@/app/actions/people";
import { FinancialFields } from "@/components/settings/fields";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { Card, PageHeader } from "@/components/ui/primitives";
import { requirePermission } from "@/server/auth/context";
import { getSettings } from "@/server/domain/settings";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Payment settings" };

export default async function Page() {
  const { ctx } = await pageCtx();
  requirePermission(ctx, "settings.manage");
  const s = await getSettings(ctx);
  return (
    <>
      <PageHeader title="Payments & terms" subtitle="Payment terms, deposits and the legal text on your documents." />
      <ActionForm action={saveFinancialAction} className="max-w-3xl space-y-5">
        <Card><FinancialFields s={s} /></Card>
        <div className="flex justify-end"><SubmitButton>Save changes</SubmitButton></div>
      </ActionForm>
    </>
  );
}
