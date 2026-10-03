import type { Metadata } from "next";
import { resetPasswordAction } from "@/app/actions/auth";
import { ActionForm, FField, SubmitButton } from "@/components/ui/client";
import { Input } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const action = resetPasswordAction.bind(null, token);
  return (
    <>
      <h1 className="text-lg font-semibold">Choose a new password</h1>
      <p className="mb-5 mt-0.5 text-[13px] text-fg-3">At least 10 characters. A passphrase works well.</p>
      <ActionForm action={action} className="space-y-4">
        <FField label="New password" name="password"><Input name="password" type="password" autoComplete="new-password" required minLength={10} autoFocus /></FField>
        <FField label="Confirm password" name="confirm"><Input name="confirm" type="password" autoComplete="new-password" required /></FField>
        <SubmitButton size="lg" className="w-full">Update password</SubmitButton>
      </ActionForm>
    </>
  );
}
