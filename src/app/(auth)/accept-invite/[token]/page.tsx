import type { Metadata } from "next";
import Link from "next/link";
import { acceptInviteAction } from "@/app/actions/auth";
import { ActionForm, FField, SubmitButton } from "@/components/ui/client";
import { Input, Notice } from "@/components/ui/primitives";
import { getInvitationByToken } from "@/server/domain/users";

export const metadata: Metadata = { title: "Accept invitation" };

export default async function AcceptInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = /^[A-Za-z0-9_-]{30,80}$/.test(token) ? await getInvitationByToken(token) : null;
  if (!inv) {
    return (
      <>
        <h1 className="text-lg font-semibold">Invitation unavailable</h1>
        <div className="mt-3"><Notice tone="warn">This invitation has expired, was already used, or was revoked. Ask your administrator to send a new one.</Notice></div>
        <div className="mt-4 text-center text-[13px]"><Link href="/login" className="text-primary hover:underline">Go to sign in</Link></div>
      </>
    );
  }
  const action = acceptInviteAction.bind(null, token);
  return (
    <>
      <h1 className="text-lg font-semibold">Join {inv.companyName}</h1>
      <p className="mb-5 mt-0.5 text-[13px] text-fg-3">You've been invited as <strong className="font-medium text-fg-2">{inv.roleName}</strong> using {inv.email}.</p>
      <ActionForm action={action} className="space-y-4">
        {!inv.hasAccount && <FField label="Your name" name="name"><Input name="name" defaultValue={inv.name ?? ""} required autoComplete="name" /></FField>}
        {inv.hasAccount && <input type="hidden" name="name" value={inv.name ?? inv.email} />}
        <FField label={inv.hasAccount ? "Your existing Worklio password" : "Choose a password"} name="password" hint={inv.hasAccount ? "You already have an account — confirm it to join this company." : "At least 10 characters."}>
          <Input name="password" type="password" autoComplete={inv.hasAccount ? "current-password" : "new-password"} required minLength={inv.hasAccount ? 1 : 10} />
        </FField>
        <SubmitButton size="lg" className="w-full" pendingLabel="Joining…">Accept invitation</SubmitButton>
      </ActionForm>
    </>
  );
}
