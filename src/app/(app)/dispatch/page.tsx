import type { Metadata } from "next";
import Link from "next/link";
import { dispatchAppointmentAction } from "@/app/actions/jobs";
import { AutoRefresh } from "@/components/schedule/auto-refresh";
import { QuickAction } from "@/components/ui/client";
import { Avatar, Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
import { requirePermission } from "@/server/auth/context";
import { dispatchBoard, unscheduledJobs } from "@/server/domain/scheduling";
import { formatTime, localDateKey, formatPhone } from "@/lib/format";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Dispatch" };

export default async function DispatchPage() {
  const { ctx, tz } = await pageCtx();
  requirePermission(ctx, "schedule.manage");
  const key = localDateKey(new Date(), tz);
  const [board, unscheduled] = await Promise.all([dispatchBoard(ctx, key), unscheduledJobs(ctx, 8)]);
  const loadPct = (m: number) => Math.min(100, Math.round((m / 480) * 100));
  return (
    <>
      <AutoRefresh />
      <PageHeader title="Dispatch" subtitle={`Live board for ${new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: tz }).format(new Date())} · refreshes automatically`} />
      <div className="grid gap-6 xl:grid-cols-4">
        <div className="space-y-3 xl:col-span-3">
          {board.rows.length === 0 && <div className="rounded-lg border border-line bg-surface"><EmptyState title="No technicians yet" description="Mark employees as technicians to see them here." /></div>}
          {board.rows.map((r) => {
            const t = r.technician;
            const name = `${t.firstName} ${t.lastName}`;
            const cur = r.current;
            const label = cur ? (cur.status === "EN_ROUTE" ? "En route" : cur.status === "ARRIVED" ? "On site" : "Working") : r.timeOff ? "Off" : r.appointments.length ? "Available" : "Free all day";
            return (
              <section key={t.id} className="rounded-lg border border-line bg-surface">
                <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5">
                  <Avatar name={name} color={t.calendarColor} size={32} />
                  <div className="min-w-0 flex-1"><div className="text-[13px] font-semibold">{name}</div><div className="text-xs text-fg-3">{t.phone ? formatPhone(t.phone) : "No phone"} · {r.appointments.length} job{r.appointments.length === 1 ? "" : "s"} · {r.completed} done</div></div>
                  <div className="hidden w-40 sm:block" title={`${Math.round(r.scheduledMinutes)} scheduled minutes`}><div className="mb-0.5 flex justify-between text-[11px] text-fg-3"><span>Workload</span><span>{loadPct(r.scheduledMinutes)}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-surface-2"><div className={`h-full rounded-full ${loadPct(r.scheduledMinutes) > 90 ? "bg-danger" : "bg-primary"}`} style={{ width: `${loadPct(r.scheduledMinutes)}%` }} /></div></div>
                  <StatusBadge status={cur ? (cur.status === "IN_PROGRESS" ? "IN_PROGRESS" : cur.status) : r.timeOff ? "ON_LEAVE" : "ACTIVE"} label={label} />
                </header>
                <div className="grid gap-px bg-line md:grid-cols-2">
                  <div className="bg-surface px-4 py-3"><div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-fg-3">Current</div>
                    {cur ? <Link href={`/jobs/${cur.job.id}`} className="block hover:text-primary"><div className="text-[13px] font-medium">{cur.job.customer.displayName} <span className="font-normal text-fg-3">· {cur.job.number}</span></div><div className="text-xs text-fg-2">{cur.job.title}</div><div className="text-xs text-fg-3"><Icon name="map-pin" size={11} className="mr-1 inline" />{cur.job.location.addressLine1}, {cur.job.location.city}</div></Link> : <p className="text-[13px] text-fg-3">Not on a job</p>}</div>
                  <div className="bg-surface px-4 py-3"><div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-fg-3">Next</div>
                    {r.next ? (
                      <div className="flex items-start justify-between gap-3"><Link href={`/jobs/${r.next.job.id}`} className="block min-w-0 hover:text-primary"><div className="text-[13px] font-medium">{formatTime(r.next.startsAt, tz)} · {r.next.job.customer.displayName}</div><div className="truncate text-xs text-fg-2">{r.next.job.title}</div><div className="truncate text-xs text-fg-3">{r.next.job.location.addressLine1}, {r.next.job.location.city}</div></Link>{r.next.status === "SCHEDULED" && <QuickAction size="sm" label="Dispatch" variant="primary" action={dispatchAppointmentAction.bind(null, r.next.id)} />}{r.next.status !== "SCHEDULED" && <StatusBadge status={r.next.status} />}</div>
                    ) : <p className="text-[13px] text-fg-3">Nothing else today</p>}</div>
                </div>
              </section>
            );
          })}
        </div>
        <Card title="Needs a slot" padded={false} actions={<Link href="/schedule" className="text-xs font-medium text-primary hover:underline">Open schedule</Link>}>
          {unscheduled.length === 0 ? <p className="px-4 py-6 text-center text-[13px] text-fg-3">All jobs are scheduled.</p> : <ul className="divide-y divide-line">{unscheduled.map((j) => <li key={j.id}><Link href={`/jobs/${j.id}`} className="block px-4 py-2.5 hover:bg-surface-2/60"><div className="flex items-center justify-between gap-2"><span className="text-[13px] font-medium">{j.customer.displayName}</span>{(j.priority === "EMERGENCY" || j.priority === "HIGH") && <StatusBadge status={j.priority} />}</div><div className="truncate text-xs text-fg-3">{j.title}</div></Link></li>)}</ul>}
        </Card>
      </div>
    </>
  );
}
