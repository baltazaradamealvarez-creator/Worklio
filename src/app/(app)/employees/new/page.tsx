import type { Metadata } from "next";
import { saveEmployeeAction } from "@/app/actions/people";
import { EmployeeFields } from "@/components/employee-form";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { Card, LinkButton, PageHeader } from "@/components/ui/primitives";
import { can, requirePermission } from "@/server/auth/context";
import { listTerritories } from "@/server/domain/settings";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Add employee" };

export default async function NewEmployee() {
  const { ctx } = await pageCtx();
  requirePermission(ctx, "employees.manage");
  const territories = await listTerritories(ctx);
  return (
    <>
      <PageHeader title="Add employee" breadcrumbs={[{ label: "Employees", href: "/employees" }, { label: "New" }]} />
      <ActionForm action={saveEmployeeAction.bind(null, null)} className="max-w-3xl space-y-5">
        <Card><EmployeeFields territories={territories} sensitive={can(ctx, "employees.view_sensitive")} compensation={can(ctx, "employees.view_compensation")} /></Card>
        <div className="flex justify-end gap-2"><LinkButton href="/employees" variant="ghost">Cancel</LinkButton><SubmitButton>Add employee</SubmitButton></div>
      </ActionForm>
    </>
  );
}
