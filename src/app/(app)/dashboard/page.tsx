import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Avatar, Card, EmptyState, LinkButton, Money, PageHeader, Stat, StatusBadge } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
import { can } from "@/server/auth/context";
import { dashboardData } from "@/server/domain/dashboard";
import { onboardingState } from "@/server/domain/settings";
import { formatDate, formatTime, relativeTime } from "@/lib/format";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const { ctx, tz, currency } = await pageCtx();
  if (!can(ctx, "jobs.view") && can(ctx, "jobs.view_assigned")) redirect("/tech");
  if (can(ctx, "settings.manage")) {
    const ob = await onboardingState(ctx);
    if (!ob.completed) redirect("/onboarding");
  }
  const d = await dashboardData(ctx);
  const firstName = ctx.userName.split(" ")[0];
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: tz }).format(new Date()));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const attention = d.pastDue?.count || d.unscheduled || d.followUps || d.lowStock;

  return (
    <>
      <PageHeader title={`${greeting}, ${firstName}`} subtitle={`${new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: tz }).format(new Date())} · ${attention ? "Here's what needs attention." : "Nothing urgent — you're all caught up."}`} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
        {(can(ctx, "jobs.view") || can(ctx, "jobs.view_assigned")) && <Stat label="Today's jobs" value={d.todayAppts.length} sub={`${d.inProgress} in progress`} href="/jobs?view=today" />}
        {can(ctx, "jobs.view") && <Stat label="Technicians working" value={d.techniciansWorking} sub="en route or on site" href="/dispatch" />}
        {can(ctx, "jobs.view") && <Stat label="Unscheduled jobs" value={d.unscheduled} tone={d.unscheduled ? "warn" : undefined} sub="need a time slot" href="/jobs?view=unscheduled" />}
        {d.quotesAwaiting && <Stat label="Quotes awaiting reply" value={d.quotesAwaiting.count} sub={<Money cents={d.quotesAwaiting.cents} currency={currency} />} href="/quotes?status=OUTSTANDING" />}
        {d.pastDue && <Stat label="Overdue invoices" value={d.pastDue.count} tone={d.pastDue.count ? "danger" : undefined} sub={<Money cents={d.pastDue.cents} currency={currency} />} href="/invoices?status=PAST_DUE" />}
        {d.outstanding && <Stat label="Outstanding balance" value={<Money cents={d.outstanding.cents} currency={currency} />} sub={`${d.outstanding.count} open invoices`} href="/invoices?status=OUTSTANDING" />}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {(can(ctx, "jobs.view") || can(ctx, "jobs.view_assigned")) && (
            <Card title="Today's schedule" padded={false} actions={can(ctx, "schedule.view") && <LinkButton href="/schedule" size="sm" variant="ghost">Open calendar</LinkButton>}>
              {d.todayAppts.length === 0 ? (
                <EmptyState icon={<Icon name="calendar-days" size={18} />} title="Nothing scheduled today" description="Jobs scheduled for today will appear here, with the technician and live status." action={can(ctx, "jobs.create") && <LinkButton href="/jobs/new" variant="primary">Create a job</LinkButton>} />
              ) : (
                <ul className="divide-y divide-line">
                  {d.todayAppts.map((a) => (
                    <li key={a.id}>
                      <Link href={`/jobs/${a.job.id}`} className="flex items-center gap-4 px-4 py-2.5 hover:bg-surface-2/60">
                        <div className="tabular w-[4.5rem] shrink-0 whitespace-nowrap text-[13px] font-medium text-fg-2">{formatTime(a.startsAt, tz)}</div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium">{a.job.customer.displayName} <span className="font-normal text-fg-3">· {a.job.number}</span></div>
                          <div className="truncate text-xs text-fg-3">{a.job.title} — {a.job.location.addressLine1}, {a.job.location.city}</div>
                        </div>
                        <div className="hidden items-center -space-x-1.5 sm:flex">{a.assignees.map((x, i) => <Avatar key={i} name={`${x.employee.firstName} ${x.employee.lastName}`} size={24} />)}</div>
                        <StatusBadge status={a.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {can(ctx, "customers.view") && (
            <Card title="Recent customer activity" padded={false}>
              {d.recent.length === 0 ? <EmptyState title="No activity yet" description="Quotes sent, invoices paid and jobs completed will show up here as they happen." /> : (
                <ul className="divide-y divide-line">
                  {d.recent.map((r) => (
                    <li key={r.id} className="flex items-start gap-3 px-4 py-2.5">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px]">{r.summary}</div>
                        <div className="text-xs text-fg-3">{r.customer && <Link href={`/customers/${r.customerId}`} className="hover:underline">{r.customer.displayName}</Link>} · {r.actorName ?? "System"} · {relativeTime(r.createdAt)}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Needs attention" padded={false}>
            <ul className="divide-y divide-line text-[13px]">
              {[
                d.followUps > 0 && { href: "/jobs?status=NEEDS_FOLLOW_UP", label: "Jobs needing follow-up", n: d.followUps, tone: "text-warn" },
                d.draftQuotes > 0 && { href: "/quotes?status=DRAFT", label: "Draft quotes to finish", n: d.draftQuotes },
                d.visitsDue > 0 && { href: "/maintenance", label: "Maintenance visits due (30 days)", n: d.visitsDue },
                d.agreementsExpiring > 0 && { href: "/maintenance?status=EXPIRING", label: "Agreements up for renewal", n: d.agreementsExpiring },
                d.lowStock > 0 && { href: "/inventory?stock=low", label: "Items below reorder point", n: d.lowStock, tone: "text-danger" },
              ].filter((x): x is { href: string; label: string; n: number; tone?: string } => !!x).map((x) => (
                <li key={x.href}><Link href={x.href} className="flex items-center justify-between px-4 py-2.5 hover:bg-surface-2/60"><span>{x.label}</span><span className={`tabular font-semibold ${x.tone ?? ""}`}>{x.n}</span></Link></li>
              ))}
              {!(d.followUps || d.draftQuotes || d.visitsDue || d.agreementsExpiring || d.lowStock) && <li className="px-4 py-6 text-center text-fg-3">Nothing needs attention.</li>}
            </ul>
          </Card>

          {can(ctx, "tasks.view") && (
            <Card title="My tasks" padded={false} actions={<LinkButton href="/tasks" size="sm" variant="ghost">All tasks</LinkButton>}>
              {d.myTasks.length === 0 ? <p className="px-4 py-6 text-center text-[13px] text-fg-3">No open tasks assigned to you.</p> : (
                <ul className="divide-y divide-line">
                  {d.myTasks.map((t) => (
                    <li key={t.id} className="px-4 py-2.5">
                      <div className="flex items-start justify-between gap-2"><span className="text-[13px] font-medium">{t.title}</span>{t.priority === "HIGH" || t.priority === "EMERGENCY" ? <StatusBadge status={t.priority} /> : null}</div>
                      <div className={`text-xs ${t.dueAt && t.dueAt < new Date() ? "text-danger" : "text-fg-3"}`}>{t.dueAt ? `Due ${formatDate(t.dueAt, tz)}` : "No due date"}{t.customer ? ` · ${t.customer.displayName}` : ""}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
