import type { Metadata } from "next";
import { saveLeadAction } from "@/app/actions/ops";
import { LeadFields } from "@/components/leads/forms";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { Card, LinkButton, PageHeader } from "@/components/ui/primitives";
import { requirePermission } from "@/server/auth/context";
import { listAssignableEmployees } from "@/server/domain/employees";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "New lead" };

export default async function NewLeadPage() {
  const { ctx } = await pageCtx();
  requirePermission(ctx, "leads.manage");
  const people = await listAssignableEmployees(ctx);
  return (
    <>
      <PageHeader title="New lead" breadcrumbs={[{ label: "Leads", href: "/leads" }, { label: "New" }]} />
      <ActionForm action={saveLeadAction.bind(null, null)} className="max-w-4xl space-y-5">
        <Card><LeadFields salespeople={people.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}` }))} /></Card>
        <div className="flex justify-end gap-2"><LinkButton href="/leads" variant="ghost">Cancel</LinkButton><SubmitButton>Create lead</SubmitButton></div>
      </ActionForm>
    </>
  );
}
