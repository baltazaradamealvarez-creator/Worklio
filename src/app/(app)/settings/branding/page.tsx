import type { Metadata } from "next";
import { saveBrandingAction } from "@/app/actions/people";
import { BrandingFields } from "@/components/settings/fields";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { Card, PageHeader } from "@/components/ui/primitives";
import { requirePermission } from "@/server/auth/context";
import { getSettings } from "@/server/domain/settings";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Branding" };

export default async function Page() {
  const { ctx } = await pageCtx();
  requirePermission(ctx, "settings.manage");
  const s = await getSettings(ctx);
  return (
    <>
      <PageHeader title="Branding & documents" subtitle="How your quotes, invoices, emails and customer portal look." />
      <ActionForm action={saveBrandingAction} className="max-w-3xl space-y-5">
        <Card><BrandingFields s={s} tenantId={ctx.tenantId} /></Card>
        <div className="flex justify-end"><SubmitButton>Save changes</SubmitButton></div>
      </ActionForm>
    </>
  );
}
