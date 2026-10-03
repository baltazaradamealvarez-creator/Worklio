import type { Metadata } from "next";
import Link from "next/link";
import { cancelAgreementAction, renewAgreementAction, scheduleVisitAction } from "@/app/actions/admin";
import { FREQUENCIES } from "@/components/maintenance-form";
import { Timeline } from "@/components/records/timeline";
import { ConfirmAction, QuickAction } from "@/components/ui/client";
import { Card, DefList, EmptyState, LinkButton, Money, Notice, PageHeader, StatusBadge } from "@/components/ui/primitives";
import { can } from "@/server/auth/context";
import { getAgreement } from "@/server/domain/maintenance";
import { formatAddress, formatDateOnly, humanize } from "@/lib/format";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Agreement" };

export default async function AgreementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, tz, currency } = await pageCtx();
  const a = await getAgreement(ctx, id);
  const manage = can(ctx, "maintenance.manage") && a.status !== "CANCELLED";
  const activity = await ctx.db.activity.findMany({ where: { entityType: "AGREEMENT", entityId: id }, orderBy: { createdAt: "desc" }, take: 30 });
  return (
    <>
      <PageHeader title={<span><span className="font-mono text-base text-fg-3">{a.number}</span> {a.name}</span>} breadcrumbs={[{ label: "Maintenance", href: "/maintenance" }, { label: a.number }]} badges={<StatusBadge status={a.effectiveStatus} />}
        subtitle={<span><Link href={`/customers/${a.customer.id}`} className="hover:text-primary hover:underline">{a.customer.displayName}</Link> · {formatAddress(a.location)}</span>}
        actions={manage && <>
          <LinkButton href={`/maintenance/${id}/edit`}>Edit</LinkButton>
          <ConfirmAction label="Renew…" variant="secondary" title="Renew for another term?" description="Extends the agreement by a year and plans a new set of visits. You can also generate the renewal invoice now." confirmLabel="Renew and invoice" action={renewAgreementAction.bind(null, id, true)} />
          <ConfirmAction label="Cancel agreement" title={`Cancel ${a.number}?`} description="Remaining planned visits are skipped. This is logged." askReason reasonLabel="Reason" confirmLabel="Cancel agreement" action={cancelAgreementAction.bind(null, id)} />
        </>} />
      {a.status === "CANCELLED" && <div className="mb-4"><Notice tone="warn" title="Cancelled">{a.cancelReason}</Notice></div>}
      {a.effectiveStatus === "EXPIRING" && <div className="mb-4"><Notice tone="warn" title="Renewal approaching">This agreement renews on {formatDateOnly(a.renewalDate)}.</Notice></div>}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Planned visits" description={`${a.completedVisits} of ${a.includedVisits} completed`} padded={false}>
            {a.visits.length === 0 ? <EmptyState title="No visits planned" description="Visits are planned automatically from the included-visit count." /> : (
              <ul className="divide-y divide-line">{a.visits.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1"><div className="text-[13px] font-medium">Due {formatDateOnly(v.dueDate)}</div>{v.job && <Link href={`/jobs/${v.job.id}`} className="text-xs text-primary hover:underline">{v.job.number}</Link>}</div>
                  <StatusBadge status={v.status} />
                  {v.status === "PLANNED" && !v.job && manage && can(ctx, "jobs.create") && <QuickAction size="sm" label="Create job" action={scheduleVisitAction.bind(null, v.id)} />}
                </li>))}</ul>
            )}
          </Card>
          <Card title="Activity">{activity.length ? <Timeline items={activity} tz={tz} /> : <p className="py-4 text-center text-[13px] text-fg-3">No activity yet.</p>}</Card>
        </div>
        <div className="space-y-6">
          <Card title="Plan"><DefList cols={1} items={[{ label: "Price", value: <span><Money cents={a.priceCents} currency={currency} /> / {humanize(FREQUENCIES.find(([k]) => k === a.billingFrequency)?.[1] ?? a.billingFrequency).toLowerCase()}</span> }, { label: "Term", value: `${formatDateOnly(a.startDate)} → ${formatDateOnly(a.renewalDate)}` }, { label: "Member discount", value: `${a.discountPercentBp / 100}%` }, { label: "Auto-renew", value: a.autoRenew ? "Yes" : "No" }, ...(a.includedServices ? [{ label: "Included", value: <span className="whitespace-pre-line">{a.includedServices}</span> }] : []), ...(a.notes ? [{ label: "Notes", value: a.notes }] : [])]} /></Card>
          <Card title="Covered equipment" padded={false}>{a.equipment.length === 0 ? <p className="px-4 py-4 text-[13px] text-fg-3">All equipment at the location.</p> : <ul className="divide-y divide-line">{a.equipment.map((e) => <li key={e.equipmentId}><Link href={`/equipment/${e.equipmentId}`} className="block px-4 py-2.5 text-[13px] hover:bg-surface-2/60">{e.equipment.manufacturer} {e.equipment.model ?? ""}<span className="block text-xs text-fg-3">{humanize(e.equipment.type)}</span></Link></li>)}</ul>}</Card>
        </div>
      </div>
    </>
  );
}
