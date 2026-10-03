import type { Metadata } from "next";
import Link from "next/link";
import { createCompanyAction } from "@/app/actions/platform";
import { ActionForm, Dialog, FField, SubmitButton } from "@/components/ui/client";
import { Icon } from "@/components/ui/icon";
import { Badge, Button, EmptyState, Input, PageHeader, Select, Stat, StatusBadge } from "@/components/ui/primitives";
import { listTenants, platformMetrics } from "@/server/domain/tenants";
import { platformDb } from "@/server/db";
import { formatBytes, formatDateOnly, relativeTime } from "@/lib/format";

export const metadata: Metadata = { title: "Companies · Platform" };

export default async function PlatformHome({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const sp = await searchParams;
  const [tenants, m, plans] = await Promise.all([listTenants({ q: sp.q, status: sp.status }), platformMetrics(), platformDb().plan.findMany({ where: { isActive: true }, orderBy: { priceMonthlyCents: "asc" } })]);
  return (
    <>
      <PageHeader title="Companies" subtitle="Every HVAC business on Worklio. Open a company to manage its plan, access and support sessions."
        actions={
          <Dialog title="Create company" description="Provisions the company with default roles, job types and pricebook categories, then emails the owner an invitation." trigger={<Button variant="primary"><Icon name="plus" size={14} /> New company</Button>}>
            <ActionForm action={createCompanyAction} className="space-y-4">
              <FField label="Company name" name="companyName" required><Input name="companyName" required autoFocus /></FField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FField label="Owner name" name="ownerName" required><Input name="ownerName" required /></FField>
                <FField label="Owner email" name="ownerEmail" required><Input name="ownerEmail" type="email" required /></FField>
                <FField label="Plan" name="planKey"><Select name="planKey" defaultValue="starter">{plans.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</Select></FField>
                <FField label="Trial (days)" name="trialDays"><Input name="trialDays" type="number" min={0} max={120} defaultValue={14} /></FField>
              </div>
              <div className="flex justify-end"><SubmitButton pendingLabel="Creating…">Create and invite owner</SubmitButton></div>
            </ActionForm>
          </Dialog>} />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Stat label="Companies" value={m.tenants} sub={`${m.suspended} suspended`} />
        <Stat label="In trial" value={m.trialing} />
        <Stat label="Active users" value={m.users} />
        <Stat label="Customers" value={m.customers.toLocaleString()} />
        <Stat label="Jobs" value={m.jobs.toLocaleString()} />
        <Stat label="File storage" value={formatBytes(m.storageBytes)} />
      </div>
      <form className="mb-4 flex flex-wrap gap-3" action="/platform">
        <Input name="q" defaultValue={sp.q ?? ""} placeholder="Search companies…" className="w-64" />
        <Select name="status" defaultValue={sp.status ?? ""} className="w-40"><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option></Select>
        <Button type="submit">Filter</Button>
      </form>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        {tenants.length === 0 ? <EmptyState title="No companies found" description="Create the first company to onboard an HVAC business." /> : (
          <table className="w-full min-w-[820px] text-[13px]">
            <thead><tr className="border-b border-line bg-surface-2/60 text-left text-xs font-semibold text-fg-3"><th className="px-3 py-2">Company</th><th className="px-3 py-2">Plan</th><th className="px-3 py-2 text-right">Users</th><th className="px-3 py-2 text-right">Techs</th><th className="px-3 py-2 text-right">Customers</th><th className="px-3 py-2 text-right">Storage</th><th className="px-3 py-2">Last activity</th><th className="px-3 py-2">Status</th></tr></thead>
            <tbody className="divide-y divide-line">{tenants.map((t) => (
              <tr key={t.id} className="hover:bg-primary-soft/40">
                <td className="px-3 py-2.5"><Link href={`/platform/companies/${t.id}`} className="font-medium hover:text-primary hover:underline">{t.name}</Link><div className="text-xs text-fg-3">{t.slug} · created {formatDateOnly(t.createdAt)}{!t.onboardingCompletedAt && " · onboarding"}</div></td>
                <td className="px-3">{t.plan ?? "—"} {t.subscriptionStatus === "TRIALING" && <Badge tone="blue">Trial</Badge>}{t.subscriptionStatus === "PAST_DUE" && <Badge tone="red">Past due</Badge>}</td>
                <td className="tabular px-3 text-right">{t.users}</td><td className="tabular px-3 text-right">{t.technicians}</td><td className="tabular px-3 text-right">{t.customers.toLocaleString()}</td><td className="tabular px-3 text-right">{formatBytes(t.storageBytes)}</td>
                <td className="px-3 text-fg-3">{t.lastActivityAt ? relativeTime(t.lastActivityAt) : "Never"}</td>
                <td className="px-3"><StatusBadge status={t.status} /></td>
              </tr>))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}
