import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { impersonateAction, reissueInviteAction, setStatusAction, updateSubscriptionAction } from "@/app/actions/platform";
import { InviteLink } from "@/components/platform/invite-link";
import { ActionForm, ConfirmAction, Dialog, FField, QuickAction, SubmitButton } from "@/components/ui/client";
import { Badge, Button, Card, DefList, Input, Notice, PageHeader, Select, StatusBadge } from "@/components/ui/primitives";
import { getLimits } from "@/server/domain/limits";
import { getTenantDetail, listPlans, listTenants } from "@/server/domain/tenants";
import { formatBytes, formatDateOnly, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Company · Platform" };

function Usage({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  return <div><div className="mb-1 flex justify-between text-xs"><span className="text-fg-3">{label}</span><span className="tabular font-medium">{used.toLocaleString()} / {limit.toLocaleString()}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-surface-2"><div className={`h-full rounded-full ${pct >= 90 ? "bg-danger" : pct >= 75 ? "bg-warn" : "bg-primary"}`} style={{ width: `${pct}%` }} /></div></div>;
}

export default async function CompanyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ invite?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const [{ tenant, audit, pendingOwner }, plans, limits, summary] = await Promise.all([
    getTenantDetail(id),
    listPlans(),
    getLimits(id),
    listTenants({}).then((l) => l.find((t) => t.id === id)),
  ]);
  if (!tenant || !summary) notFound();
  const sub = tenant.subscription;
  const suspended = tenant.status === "SUSPENDED";
  return (
    <>
      <PageHeader title={tenant.name} subtitle={`${tenant.slug} · created ${formatDateOnly(tenant.createdAt)}`} breadcrumbs={[{ label: "Companies", href: "/platform" }, { label: tenant.name }]} badges={<><StatusBadge status={tenant.status} />{!tenant.onboardingCompletedAt && <Badge tone="amber">Onboarding</Badge>}</>}
        actions={<>
          {!suspended && (
            <Dialog title={`Open ${tenant.name} as support`} description="You'll act inside this company with a persistent red banner. The reason, your name and everything you change are recorded in both the platform and the company's audit log." trigger={<Button variant="primary">Open as support…</Button>}>
              <ActionForm action={impersonateAction.bind(null, id)} className="space-y-4">
                <FField label="Reason for access" name="reason" required hint="e.g. Ticket #1432 — customer can't see invoices"><Input name="reason" required minLength={5} autoFocus /></FField>
                <div className="flex justify-end"><SubmitButton pendingLabel="Starting…">Start support session</SubmitButton></div>
              </ActionForm>
            </Dialog>)}
          {suspended ? <QuickAction label="Reactivate" action={setStatusAction.bind(null, id, "ACTIVE", undefined)} /> : <ConfirmAction label="Suspend" title={`Suspend ${tenant.name}?`} description="Nobody in this company can sign in until it's reactivated. Data is kept." askReason reasonLabel="Reason" confirmLabel="Suspend company" action={setStatusAction.bind(null, id, "SUSPENDED")} />}
        </>} />
      {sp.invite && <div className="mb-5"><InviteLink url={sp.invite} /></div>}
      {suspended && <div className="mb-5"><Notice tone="danger" title="Suspended">{tenant.suspendedReason ?? "No reason recorded"} · since {formatDateTime(tenant.suspendedAt, "UTC")}</Notice></div>}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Subscription & limits" description="Overrides replace the plan limit for this company only. Leave blank to use the plan.">
            <ActionForm action={updateSubscriptionAction.bind(null, id)} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <FField label="Plan" name="planKey"><Select name="planKey" defaultValue={sub?.plan.key}>{plans.map((p) => <option key={p.key} value={p.key}>{p.name}{!p.isActive ? " (retired)" : ""}</option>)}</Select></FField>
                <FField label="Status" name="status"><Select name="status" defaultValue={sub?.status ?? "ACTIVE"}>{["TRIALING", "ACTIVE", "PAST_DUE", "CANCELLED"].map((s) => <option key={s} value={s}>{s.replace("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}</option>)}</Select></FField>
                <FField label="Trial ends" name="trialEndsAt"><Input name="trialEndsAt" type="date" defaultValue={sub?.trialEndsAt?.toISOString().slice(0, 10) ?? ""} /></FField>
                <FField label="Users override" name="maxUsersOverride"><Input name="maxUsersOverride" type="number" min={1} defaultValue={sub?.maxUsersOverride ?? ""} placeholder={String(sub?.plan.maxUsers ?? "")} /></FField>
                <FField label="Technicians override" name="maxTechniciansOverride"><Input name="maxTechniciansOverride" type="number" min={0} defaultValue={sub?.maxTechniciansOverride ?? ""} placeholder={String(sub?.plan.maxTechnicians ?? "")} /></FField>
                <FField label="Customers override" name="maxCustomersOverride"><Input name="maxCustomersOverride" type="number" min={1} defaultValue={sub?.maxCustomersOverride ?? ""} placeholder={String(sub?.plan.maxCustomers ?? "")} /></FField>
                <FField label="Storage override (MB)" name="maxStorageMbOverride"><Input name="maxStorageMbOverride" type="number" min={1} defaultValue={sub?.maxStorageMbOverride ?? ""} placeholder={String(sub?.plan.maxStorageMb ?? "")} /></FField>
              </div>
              <div className="flex justify-end"><SubmitButton>Save subscription</SubmitButton></div>
            </ActionForm>
          </Card>
          <Card title="Platform & support activity" padded={false}>
            {audit.length === 0 ? <p className="px-4 py-6 text-center text-[13px] text-fg-3">No platform actions recorded for this company.</p> : <ul className="divide-y divide-line">{audit.map((a) => <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2.5 text-[13px]"><span className="font-mono text-xs">{a.action}</span><span className="text-fg-2">{a.actorName}</span>{a.metadata && typeof a.metadata === "object" && "reason" in a.metadata && <span className="text-fg-3">“{String((a.metadata as { reason: unknown }).reason)}”</span>}<span className="ml-auto text-xs text-fg-3">{formatDateTime(a.createdAt, "UTC")}</span></li>)}</ul>}
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Usage"><div className="space-y-3"><Usage label="Users" used={summary.users} limit={limits.users} /><Usage label="Technicians" used={summary.technicians} limit={limits.technicians} /><Usage label="Customers" used={summary.customers} limit={limits.customers} /><Usage label="Storage" used={Math.ceil(summary.storageBytes / 1048576)} limit={limits.storageMb} /></div><p className="mt-3 text-xs text-fg-3">Total storage {formatBytes(summary.storageBytes)}</p></Card>
          <Card title="Owner access">
            {pendingOwner ? (
              <div className="space-y-3 text-[13px]"><p>The owner invitation for <strong>{pendingOwner.email}</strong> hasn't been accepted{pendingOwner.expiresAt < new Date() ? " and has expired" : ""}.</p><QuickAction label="Re-send invitation" action={reissueInviteAction.bind(null, id)} /></div>
            ) : <p className="text-[13px] text-fg-3">The owner has accepted their invitation.</p>}
          </Card>
          <Card title="Details"><DefList cols={1} items={[{ label: "Plan", value: sub ? `${sub.plan.name} · $${(sub.plan.priceMonthlyCents / 100).toFixed(0)}/mo` : "—" }, { label: "Last activity", value: summary.lastActivityAt ? formatDateTime(summary.lastActivityAt, "UTC") : "Never" }, { label: "Onboarding", value: tenant.onboardingCompletedAt ? `Completed ${formatDateOnly(tenant.onboardingCompletedAt)}` : "In progress" }]} /></Card>
        </div>
      </div>
    </>
  );
}
