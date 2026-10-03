import type { Metadata } from "next";
import { saveOperationsAction } from "@/app/actions/people";
import { OperationsFields } from "@/components/settings/fields";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { Card, PageHeader } from "@/components/ui/primitives";
import { requirePermission } from "@/server/auth/context";
import { getSettings } from "@/server/domain/settings";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Operations settings" };

export default async function Page() {
  const { ctx } = await pageCtx();
  requirePermission(ctx, "settings.manage");
  const s = await getSettings(ctx);
  return (
    <>
      <PageHeader title="Operations & numbering" subtitle="Business hours, default scheduling and document numbers." />
      <ActionForm action={saveOperationsAction} className="max-w-3xl space-y-5">
        <Card><OperationsFields s={s} /></Card>
        <div className="flex justify-end"><SubmitButton>Save changes</SubmitButton></div>
      </ActionForm>
    </>
  );
}
