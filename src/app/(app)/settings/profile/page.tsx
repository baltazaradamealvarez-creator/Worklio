import type { Metadata } from "next";
import { changePasswordAction } from "@/app/actions/people";
import { ActionForm, FField, SubmitButton } from "@/components/ui/client";
import { Card, DefList, Input, PageHeader } from "@/components/ui/primitives";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "My account" };

export default async function Page() {
  const { ctx } = await pageCtx();
  return (
    <>
      <PageHeader title="My account" subtitle="Your sign-in details." />
      <div className="max-w-xl space-y-6">
        <Card title="Profile"><DefList cols={1} items={[{ label: "Name", value: ctx.userName }, { label: "Company", value: ctx.tenantName }, { label: "Role", value: ctx.roleName }]} /></Card>
        <Card title="Change password" description="You'll stay signed in here; other devices are signed out.">
          <ActionForm action={changePasswordAction} resetOnSuccess className="space-y-4">
            <FField label="Current password" name="current" required><Input name="current" type="password" autoComplete="current-password" required /></FField>
            <FField label="New password" name="next" required hint="At least 12 characters"><Input name="next" type="password" autoComplete="new-password" required /></FField>
            <FField label="Confirm new password" name="confirm" required><Input name="confirm" type="password" autoComplete="new-password" required /></FField>
            <div className="flex justify-end"><SubmitButton>Update password</SubmitButton></div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
