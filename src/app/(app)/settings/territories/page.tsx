import type { Metadata } from "next";
import { deleteTerritoryAction, saveTerritoryAction } from "@/app/actions/people";
import { ActionForm, ConfirmAction, Dialog, FField, SubmitButton } from "@/components/ui/client";
import { Icon } from "@/components/ui/icon";
import { Button, Card, EmptyState, Input, PageHeader, Textarea } from "@/components/ui/primitives";
import { requirePermission } from "@/server/auth/context";
import { listTerritories } from "@/server/domain/settings";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Service territories" };

function TerritoryDialog({ id, t, trigger }: { id?: string; t?: { name: string; description: string | null; postalCodes: string[] }; trigger: React.ReactNode }) {
  return (
    <Dialog title={id ? "Edit territory" : "New territory"} trigger={trigger}>
      <ActionForm action={saveTerritoryAction.bind(null, id ?? null)} className="space-y-4">
        <FField label="Name" name="name" required><Input name="name" defaultValue={t?.name ?? ""} required /></FField>
        <FField label="Description" name="description"><Input name="description" defaultValue={t?.description ?? ""} /></FField>
        <FField label="ZIP / postal codes" name="postalCodes" hint="Separated by commas or spaces"><Textarea name="postalCodes" rows={3} defaultValue={t?.postalCodes.join(", ") ?? ""} /></FField>
        <div className="flex justify-end"><SubmitButton>Save</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export default async function Page() {
  const { ctx } = await pageCtx();
  requirePermission(ctx, "settings.manage");
  const list = await listTerritories(ctx);
  return (
    <>
      <PageHeader title="Service territories" subtitle="Group the areas you serve and assign technicians to them." actions={<TerritoryDialog trigger={<Button variant="primary"><Icon name="plus" size={14} /> New territory</Button>} />} />
      <Card padded={false}>
        {list.length === 0 ? <EmptyState title="No territories" description="Define the ZIP codes you serve to organise technicians and dispatch." /> : (
          <ul className="divide-y divide-line">{list.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 text-[13px]"><div className="font-medium">{t.name}</div><div className="truncate text-xs text-fg-3">{t.postalCodes.length ? t.postalCodes.join(", ") : "No postal codes"}</div></div>
              <TerritoryDialog id={t.id} t={t} trigger={<Button size="sm" variant="ghost">Edit</Button>} />
              <ConfirmAction size="sm" variant="ghost" label="Delete" title={`Delete ${t.name}?`} description="Employees in this territory become unassigned." confirmLabel="Delete" action={deleteTerritoryAction.bind(null, t.id)} />
            </li>))}</ul>
        )}
      </Card>
    </>
  );
}
