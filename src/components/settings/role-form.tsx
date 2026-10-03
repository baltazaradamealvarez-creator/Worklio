import { saveRoleAction } from "@/app/actions/people";
import { ActionForm, FField, SubmitButton } from "@/components/ui/client";
import { Card, Input, LinkButton, Textarea } from "@/components/ui/primitives";
import { PERMISSION_GROUPS } from "@/server/auth/permissions";

export function RoleForm({ id, role, canGrant, readOnlyName }: { id: string | null; role?: { name: string; description: string | null; permissions: string[] }; canGrant: (p: string) => boolean; readOnlyName?: boolean }) {
  const has = new Set(role?.permissions ?? []);
  return (
    <ActionForm action={saveRoleAction.bind(null, id)} className="max-w-4xl space-y-5">
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <FField label="Role name" name="name" required><Input name="name" defaultValue={role?.name ?? ""} required readOnly={readOnlyName} /></FField>
          <FField label="Description" name="description"><Textarea name="description" rows={1} defaultValue={role?.description ?? ""} /></FField>
        </div>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">{PERMISSION_GROUPS.map((g) => (
        <Card key={g.key} title={g.label} padded>
          <ul className="space-y-1.5">{g.permissions.map(([key, label]) => {
            const allowed = canGrant(key) || has.has(key);
            return (
              <li key={key}>
                <label className={`flex items-start gap-2 text-[13px] ${allowed ? "" : "opacity-50"}`}>
                  <input type="checkbox" name="permissions" value={key} defaultChecked={has.has(key)} disabled={!allowed} className="mt-0.5 h-4 w-4 rounded border-line-strong accent-primary" />
                  <span>{label}<span className="block font-mono text-[10px] text-fg-3">{key}</span></span>
                </label>
              </li>);
          })}</ul>
        </Card>))}</div>
      <p className="text-xs text-fg-3">You can only grant permissions you hold yourself. Technicians are always limited to jobs and customers assigned to them.</p>
      <div className="flex justify-end gap-2"><LinkButton href="/settings/team?tab=roles" variant="ghost">Cancel</LinkButton><SubmitButton>Save role</SubmitButton></div>
    </ActionForm>
  );
}
