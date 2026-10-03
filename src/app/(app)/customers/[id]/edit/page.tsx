import type { Metadata } from "next";
import { updateCustomerAction } from "@/app/actions/customers";
import { CustomerFields } from "@/components/customers/forms";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { Card, LinkButton, PageHeader } from "@/components/ui/primitives";
import { requirePermission } from "@/server/auth/context";
import { getCustomer } from "@/server/domain/customers";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Edit customer" };

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await pageCtx();
  requirePermission(ctx, "customers.edit");
  const c = await getCustomer(ctx, id);
  return (
    <>
      <PageHeader title={`Edit ${c.displayName}`} breadcrumbs={[{ label: "Customers", href: "/customers" }, { label: c.displayName, href: `/customers/${id}` }, { label: "Edit" }]} />
      <ActionForm action={updateCustomerAction.bind(null, id)} className="max-w-4xl space-y-5">
        <Card title="Customer"><CustomerFields c={c} /></Card>
        <div className="flex justify-end gap-2"><LinkButton href={`/customers/${id}`} variant="ghost">Cancel</LinkButton><SubmitButton>Save changes</SubmitButton></div>
      </ActionForm>
    </>
  );
}
