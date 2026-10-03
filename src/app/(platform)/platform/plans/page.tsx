import type { Metadata } from "next";
import { savePlanAction } from "@/app/actions/platform";
import { ActionForm, Dialog, FField, SubmitButton } from "@/components/ui/client";
import { Icon } from "@/components/ui/icon";
import { Badge, Button, Card, Input, PageHeader } from "@/components/ui/primitives";
import { platformDb } from "@/server/db";

export const metadata: Metadata = { title: "Plans · Platform" };

type P = { key: string; name: string; description: string | null; priceMonthlyCents: number; maxUsers: number; maxTechnicians: number; maxCustomers: number; maxStorageMb: number; isActive: boolean };

function PlanDialog({ p, trigger }: { p?: P; trigger: React.ReactNode }) {
  return (
    <Dialog title={p ? `Edit ${p.name}` : "New plan"} trigger={trigger}>
      <ActionForm action={savePlanAction} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FField label="Key" name="key" required hint="Lowercase, immutable"><Input name="key" defaultValue={p?.key} readOnly={!!p} required /></FField>
          <FField label="Name" name="name" required><Input name="name" defaultValue={p?.name} required /></FField>
          <FField label="Description" name="description" className="sm:col-span-2"><Input name="description" defaultValue={p?.description ?? ""} /></FField>
          <FField label="Price / month (cents)" name="priceMonthlyCents"><Input name="priceMonthlyCents" type="number" min={0} defaultValue={p?.priceMonthlyCents ?? 0} /></FField>
          <FField label="Users" name="maxUsers"><Input name="maxUsers" type="number" min={1} defaultValue={p?.maxUsers ?? 5} /></FField>
          <FField label="Technicians" name="maxTechnicians"><Input name="maxTechnicians" type="number" min={0} defaultValue={p?.maxTechnicians ?? 3} /></FField>
          <FField label="Customers" name="maxCustomers"><Input name="maxCustomers" type="number" min={1} defaultValue={p?.maxCustomers ?? 1000} /></FField>
          <FField label="Storage (MB)" name="maxStorageMb"><Input name="maxStorageMb" type="number" min={1} defaultValue={p?.maxStorageMb ?? 5120} /></FField>
        </div>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="isActive" defaultChecked={p?.isActive ?? true} className="h-4 w-4 accent-primary" /> Available for new companies</label>
        <div className="flex justify-end"><SubmitButton>Save plan</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export default async function PlansPage() {
  const plans = await platformDb().plan.findMany({ orderBy: { priceMonthlyCents: "asc" }, include: { _count: { select: { subscriptions: true } } } });
  return (
    <>
      <PageHeader title="Plans" subtitle="Limits are enforced server-side when companies add users, technicians, customers and files." actions={<PlanDialog trigger={<Button variant="primary"><Icon name="plus" size={14} /> New plan</Button>} />} />
      <div className="grid gap-4 md:grid-cols-3">{plans.map((p) => (
        <Card key={p.id}>
          <div className="flex items-start justify-between"><div><div className="text-base font-semibold">{p.name}</div><div className="text-xs text-fg-3">{p.description}</div></div>{!p.isActive && <Badge>Retired</Badge>}</div>
          <div className="mt-3 text-2xl font-semibold tabular">${(p.priceMonthlyCents / 100).toFixed(0)}<span className="text-sm font-normal text-fg-3"> / month</span></div>
          <ul className="mt-3 space-y-1 text-[13px] text-fg-2"><li>{p.maxUsers} users</li><li>{p.maxTechnicians} technicians</li><li>{p.maxCustomers.toLocaleString()} customers</li><li>{(p.maxStorageMb / 1024).toFixed(0)} GB storage</li></ul>
          <div className="mt-4 flex items-center justify-between text-xs text-fg-3"><span>{p._count.subscriptions} compan{p._count.subscriptions === 1 ? "y" : "ies"}</span><PlanDialog p={p} trigger={<Button size="sm" variant="ghost">Edit</Button>} /></div>
        </Card>))}</div>
    </>
  );
}
