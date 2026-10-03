"use client";

import { useState } from "react";
import { toast } from "sonner";
import { inviteUserAction } from "@/app/actions/people";
import { ActionForm, Dialog, FField, SubmitButton } from "@/components/ui/client";
import { Button, Input, Select } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";

export function InviteUser({ roles, employees }: { roles: { id: string; name: string }[]; employees: { id: string; name: string }[] }) {
  const [link, setLink] = useState<string | null>(null);
  return (
    <>
      <Dialog title="Invite a team member" description="They'll get an email with a secure link to set their password." trigger={<Button variant="primary"><Icon name="user-plus" size={14} /> Invite user</Button>}>
        <ActionForm action={inviteUserAction} onSuccess={(r) => setLink((r as { data?: { inviteUrl: string } }).data?.inviteUrl ?? null)} className="space-y-4">
          <FField label="Email" name="email" required><Input name="email" type="email" required autoFocus /></FField>
          <FField label="Name" name="name"><Input name="name" /></FField>
          <FField label="Role" name="roleId" required><Select name="roleId" required defaultValue="">{<option value="" disabled>Choose a role…</option>}{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></FField>
          {employees.length > 0 && <FField label="Link to employee profile" name="employeeId" hint="Optional — for people already added under Employees"><Select name="employeeId" defaultValue=""><option value="">None</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select></FField>}
          <div className="flex justify-end"><SubmitButton pendingLabel="Sending…">Send invitation</SubmitButton></div>
        </ActionForm>
      </Dialog>
      <Dialog open={!!link} onOpenChange={(o) => !o && setLink(null)} title="Invitation sent" description="If the email doesn't arrive, you can share this link yourself. It expires in 7 days.">
        <div className="space-y-3">
          <input readOnly value={link ?? ""} onFocus={(e) => e.currentTarget.select()} className="h-9 w-full rounded-md border border-line-strong bg-surface-2 px-3 font-mono text-xs" />
          <div className="flex justify-end"><Button onClick={() => { void navigator.clipboard.writeText(link ?? ""); toast.success("Link copied"); }}>Copy link</Button></div>
        </div>
      </Dialog>
    </>
  );
}
