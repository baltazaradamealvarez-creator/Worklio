import type { Metadata } from "next";
import { archiveJobTypeAction, saveJobTypeAction } from "@/app/actions/people";
import { ActionForm, ConfirmAction, Dialog, FField, SubmitButton } from "@/components/ui/client";
import { Icon } from "@/components/ui/icon";
import { Button, Card, EmptyState, Input, PageHeader } from "@/components/ui/primitives";
import { requirePermission } from "@/server/auth/context";
import { listJobTypes } from "@/server/domain/jobs";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Job types" };

function JobTypeDialog({ id, t, trigger }: { id?: string; t?: { name: string; defaultDurationMin: number; color: string }; trigger: React.ReactNode }) {
  return (
    <Dialog title={id ? "Edit job type" : "New job type"} trigger={trigger}>
      <ActionForm action={saveJobTypeAction.bind(null, id ?? null)} className="space-y-4">
        <FField label="Name" name="name" required><Input name="name" defaultValue={t?.name ?? ""} required /></FField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FField label="Default duration (minutes)" name="defaultDurationMin"><Input name="defaultDurationMin" type="number" min={15} defaultValue={t?.defaultDurationMin ?? 90} /></FField>
          <FField label="Calendar color" name="color"><input name="color" type="color" defaultValue={t?.color ?? "#2563eb"} className="h-9 w-14 rounded border border-line-strong bg-surface p-1" /></FField>
        </div>
        <div className="flex justify-end"><SubmitButton>Save</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export default async function Page() {
  const { ctx } = await pageCtx();
  requirePermission(ctx, "settings.manage");
  const types = await listJobTypes(ctx);
  return (
    <>
      <PageHeader title="Job types" subtitle="Categories used when creating jobs. Duration pre-fills the schedule." actions={<JobTypeDialog trigger={<Button variant="primary"><Icon name="plus" size={14} /> New job type</Button>} />} />
      <Card padded={false}>
        {types.length === 0 ? <EmptyState title="No job types" description="Add types like Repair, Install, Maintenance or Estimate." /> : (
          <ul className="divide-y divide-line">{types.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-4 py-3">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: t.color }} />
              <div className="flex-1 text-[13px]"><span className="font-medium">{t.name}</span> <span className="text-fg-3">· {t.defaultDurationMin} min</span></div>
              <JobTypeDialog id={t.id} t={t} trigger={<Button size="sm" variant="ghost">Edit</Button>} />
              <ConfirmAction size="sm" variant="ghost" label="Archive" title={`Archive ${t.name}?`} description="Existing jobs keep their type; it won't be offered for new jobs." confirmLabel="Archive" action={archiveJobTypeAction.bind(null, t.id)} />
            </li>))}</ul>
        )}
      </Card>
    </>
  );
}
