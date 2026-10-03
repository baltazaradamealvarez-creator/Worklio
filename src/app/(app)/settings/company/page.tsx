import type { Metadata } from "next";
import { saveCompanyAction } from "@/app/actions/people";
import { CompanyFields } from "@/components/settings/fields";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { Card, PageHeader } from "@/components/ui/primitives";
import { requirePermission } from "@/server/auth/context";
import { getSettings } from "@/server/domain/settings";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Company settings" };

export default async function Page() {
  const { ctx } = await pageCtx();
  requirePermission(ctx, "settings.manage");
  const s = await getSettings(ctx);
  return (
    <>
      <PageHeader title="Company" subtitle="Your business details, timezone and default tax rate." />
      <ActionForm action={saveCompanyAction} className="max-w-3xl space-y-5">
        <Card><CompanyFields s={s} name={ctx.tenantName} /></Card>
        <div className="flex justify-end"><SubmitButton>Save changes</SubmitButton></div>
      </ActionForm>
    </>
  );
}
