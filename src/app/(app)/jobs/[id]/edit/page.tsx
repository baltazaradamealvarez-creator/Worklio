import type { Metadata } from "next";
import { updateJobAction } from "@/app/actions/jobs";
import { JobFields } from "@/components/jobs/job-form";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { Card, LinkButton, PageHeader } from "@/components/ui/primitives";
import { requirePermission } from "@/server/auth/context";
import { listAssignableEmployees } from "@/server/domain/employees";
import { getJob, listJobTypes } from "@/server/domain/jobs";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Edit job" };

export default async function EditJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await pageCtx();
  requirePermission(ctx, "jobs.edit");
  const [job, types, people] = await Promise.all([getJob(ctx, id), listJobTypes(ctx), listAssignableEmployees(ctx)]);
  return (
    <>
      <PageHeader title={`Edit ${job.number}`} breadcrumbs={[{ label: "Jobs", href: "/jobs" }, { label: job.number, href: `/jobs/${id}` }, { label: "Edit" }]} />
      <ActionForm action={updateJobAction.bind(null, id)} className="max-w-4xl space-y-5">
        <Card><JobFields j={job} editing customer={{ id: job.customer.id, name: job.customer.displayName }} lockCustomer equipmentIds={job.equipment.map((e) => e.equipmentId)} types={types} technicians={[]} dispatchers={people.filter((p) => !p.isTechnician).map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}` }))} /></Card>
        <div className="flex justify-end gap-2"><LinkButton href={`/jobs/${id}`} variant="ghost">Cancel</LinkButton><SubmitButton>Save changes</SubmitButton></div>
      </ActionForm>
    </>
  );
}
