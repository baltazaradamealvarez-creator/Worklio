import type { Metadata } from "next";
import Link from "next/link";
import { loginAction } from "@/app/actions/auth";
import { ActionForm, FField, SubmitButton } from "@/components/ui/client";
import { Input, Notice } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      <h1 className="text-lg font-semibold">Sign in</h1>
      <p className="mb-5 mt-0.5 text-[13px] text-fg-3">Welcome back. Enter your details to continue.</p>
      {sp.reset && <div className="mb-4"><Notice tone="success">Your password was updated. Sign in with the new one.</Notice></div>}
      <ActionForm action={loginAction} className="space-y-4">
        <input type="hidden" name="next" value={sp.next ?? ""} />
        <FField label="Email" name="email"><Input name="email" type="email" autoComplete="username" required autoFocus /></FField>
        <FField label="Password" name="password"><Input name="password" type="password" autoComplete="current-password" required /></FField>
        <SubmitButton size="lg" className="w-full" pendingLabel="Signing in…">Sign in</SubmitButton>
      </ActionForm>
      <div className="mt-4 text-center text-[13px]"><Link href="/forgot-password" className="text-primary hover:underline">Forgot your password?</Link></div>
    </>
  );
}
