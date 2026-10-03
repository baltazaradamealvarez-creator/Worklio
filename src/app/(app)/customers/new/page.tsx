import type { Metadata } from "next";
import { createCustomerAction } from "@/app/actions/customers";
import { CustomerFields, LocationFields } from "@/components/customers/forms";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { Card, Checkbox, LinkButton, PageHeader } from "@/components/ui/primitives";
import { requirePermission } from "@/server/auth/context";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "New customer" };

export default async function NewCustomerPage() {
  const { ctx } = await pageCtx();
  requirePermission(ctx, "customers.create");
  return (
    <>
      <PageHeader title="New customer" breadcrumbs={[{ label: "Customers", href: "/customers" }, { label: "New" }]} />
      <ActionForm action={createCustomerAction} className="max-w-4xl space-y-5">
        <input type="hidden" name="addLocation" value="1" />
        <Card title="Customer"><CustomerFields prefix="customer." showInternal /></Card>
        <Card title="Service location" description="Where the equipment is. You can add more properties later."><LocationFields prefix="location." canSeeCodes /></Card>
        <Card padded><Checkbox name="allowDuplicate" label="Create anyway if a customer with the same phone or email already exists" /></Card>
        <div className="flex justify-end gap-2"><LinkButton href="/customers" variant="ghost">Cancel</LinkButton><SubmitButton pendingLabel="Creating…">Create customer</SubmitButton></div>
      </ActionForm>
    </>
  );
}
