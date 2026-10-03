import type { Metadata } from "next";
import Link from "next/link";
import { forgotPasswordAction } from "@/app/actions/auth";
import { ActionForm, FField, SubmitButton } from "@/components/ui/client";
import { Input } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-lg font-semibold">Reset your password</h1>
      <p className="mb-5 mt-0.5 text-[13px] text-fg-3">Enter your email and we'll send you a link to choose a new password.</p>
      <ActionForm action={forgotPasswordAction} className="space-y-4" resetOnSuccess>
        <FField label="Email" name="email"><Input name="email" type="email" required autoFocus /></FField>
        <SubmitButton size="lg" className="w-full" pendingLabel="Sending…">Send reset link</SubmitButton>
      </ActionForm>
      <div className="mt-4 text-center text-[13px]"><Link href="/login" className="text-primary hover:underline">Back to sign in</Link></div>
    </>
  );
}
