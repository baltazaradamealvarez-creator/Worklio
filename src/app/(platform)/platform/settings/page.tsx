import type { Metadata } from "next";
import { clearEmailSettingsAction, saveEmailSettingsAction, sendTestEmailAction } from "@/app/actions/platform";
import { ActionForm, ConfirmAction, FField, SubmitButton } from "@/components/ui/client";
import { Badge, Card, Input, Notice, PageHeader } from "@/components/ui/primitives";
import { emailSettingsSummary } from "@/server/domain/platform-settings";

export const metadata: Metadata = { title: "Settings · Platform" };

export default async function PlatformSettings() {
  const s = await emailSettingsSummary();
  return (
    <>
      <PageHeader title="Platform settings" subtitle="Configuration shared by every company on this installation." />
      <div className="grid max-w-3xl gap-6">
        <Card title="Email (Resend)" description="Used for invitations, password resets, quotes, invoices and receipts across all companies." actions={s.provider === "resend" ? <Badge tone="green">Active · {s.source === "database" ? "saved here" : "environment"}</Badge> : <Badge tone="amber">Not sending — logging only</Badge>}>
          {s.provider !== "resend" && <div className="mb-4"><Notice tone="warn" title="Emails are not being delivered">Paste a Resend API key below to start sending. Until then messages are only written to the server log.</Notice></div>}
          <ActionForm action={saveEmailSettingsAction} className="space-y-4">
            <FField label="Resend API key" name="apiKey" hint={s.keyHint ? `Current key ${s.keyHint}. Leave blank to keep it.` : "Starts with re_. Stored encrypted; it's never shown again."}><Input name="apiKey" type="password" autoComplete="off" placeholder={s.keyHint ?? "re_xxxxxxxxxxxx"} /></FField>
            <FField label="From address" name="from" required hint="The domain must be verified in Resend (or use onboarding@resend.dev to test with your own address)."><Input name="from" defaultValue={s.from ?? ""} placeholder="Worklio <no-reply@yourdomain.com>" required /></FField>
            <div className="flex justify-end gap-2">{s.source === "database" && <ConfirmAction label="Remove saved key" title="Remove the saved key?" description="Email falls back to the RESEND_API_KEY environment variable, if one is set." confirmLabel="Remove" action={clearEmailSettingsAction} />}<SubmitButton>Save email settings</SubmitButton></div>
          </ActionForm>
        </Card>
        <Card title="Send a test email">
          <ActionForm action={sendTestEmailAction} className="flex flex-wrap items-end gap-3">
            <FField label="Send to" name="to" className="min-w-64 flex-1"><Input name="to" type="email" required placeholder="you@example.com" /></FField>
            <SubmitButton variant="secondary" pendingLabel="Sending…">Send test</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
