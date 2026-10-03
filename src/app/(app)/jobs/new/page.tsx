import type { Metadata } from "next";
import { createJobAction } from "@/app/actions/jobs";
import { JobFields } from "@/components/jobs/job-form";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { Card, LinkButton, PageHeader } from "@/components/ui/primitives";
import { can, requirePermission } from "@/server/auth/context";
import { getCustomer } from "@/server/domain/customers";
import { listAssignableEmployees, listTechnicians } from "@/server/domain/employees";
import { listJobTypes } from "@/server/domain/jobs";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "New job" };

export default async function NewJobPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await pageCtx();
  requirePermission(ctx, "jobs.create");
  const [c, types, techs, people] = await Promise.all([sp.customer ? getCustomer(ctx, sp.customer).catch(() => null) : null, listJobTypes(ctx), listTechnicians(ctx), listAssignableEmployees(ctx)]);
  return (
    <>
      <PageHeader title="New job" breadcrumbs={[{ label: "Jobs", href: "/jobs" }, { label: "New" }]} />
      <ActionForm action={createJobAction} className="max-w-4xl space-y-5">
        <Card>
          <JobFields customer={c ? { id: c.id, name: c.displayName } : null} types={types} technicians={can(ctx, "jobs.assign") ? techs.map((t) => ({ id: t.id, name: `${t.firstName} ${t.lastName}`, color: t.calendarColor })) : []} dispatchers={people.filter((p) => !p.isTechnician).map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}` }))} withSchedule={can(ctx, "schedule.manage")} />
        </Card>
        <div className="flex justify-end gap-2"><LinkButton href="/jobs" variant="ghost">Cancel</LinkButton><SubmitButton pendingLabel="Creating…">Create job</SubmitButton></div>
      </ActionForm>
    </>
  );
}
