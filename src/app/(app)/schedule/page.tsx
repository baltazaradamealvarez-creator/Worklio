import type { Metadata } from "next";
import Link from "next/link";
import { ScheduleBoard } from "@/components/schedule/board";
import { Icon } from "@/components/ui/icon";
import { LinkButton, PageHeader } from "@/components/ui/primitives";
import { can } from "@/server/auth/context";
import { scheduleRange, unscheduledJobs } from "@/server/domain/scheduling";
import { addDays, localDateKey } from "@/lib/format";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Schedule" };

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ date?: string; view?: string; tech?: string }> }) {
  const sp = await searchParams;
  const { ctx, tz } = await pageCtx();
  const todayKey = localDateKey(new Date(), tz);
  const view = sp.view === "week" ? "week" : "day";
  const picked = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayKey;
  // Weeks start on Monday
  const dow = new Date(`${picked}T12:00:00Z`).getUTCDay();
  const start = view === "week" ? addDays(picked, -((dow + 6) % 7)) : picked;
  const numDays = view === "week" ? 7 : 1;
  const days = Array.from({ length: numDays }, (_, i) => addDays(start, i));
  const techFilter = sp.tech ? sp.tech.split(",").filter(Boolean) : [];
  const [data, unscheduled] = await Promise.all([scheduleRange(ctx, start, numDays, { employeeIds: techFilter.length ? techFilter : undefined }), unscheduledJobs(ctx)]);
  const allTechs = data.technicians;
  const q = (patch: Record<string, string | undefined>) => { const p = new URLSearchParams({ ...(view === "week" ? { view } : {}), ...(sp.tech ? { tech: sp.tech } : {}), date: start, ...patch }); for (const [k, v] of [...p]) if (!v) p.delete(k); return `/schedule?${p}`; };
  const step = view === "week" ? 7 : 1;
  const label = view === "week" ? `${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${days[0]}T12:00:00Z`))} – ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${days[6]}T12:00:00Z`))}` : new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${start}T12:00:00Z`));
  const techs = allTechs.map((t) => {
    const off = data.timeOff.find((o) => o.employeeId === t.id);
    return { id: t.id, name: `${t.firstName} ${t.lastName}`, color: t.calendarColor, offToday: off?.reason ?? (off ? "Time off" : null) };
  });
  return (
    <>
      <PageHeader title="Schedule" subtitle={label} actions={<>
        <div className="inline-flex rounded-md border border-line-strong bg-surface p-0.5 text-xs font-medium shadow-sm">{(["day", "week"] as const).map((v) => <Link key={v} href={q({ view: v === "week" ? "week" : undefined })} className={`rounded px-2.5 py-1 capitalize ${view === v ? "bg-fg text-white" : "text-fg-2 hover:bg-surface-2"}`}>{v}</Link>)}</div>
        <div className="inline-flex items-center gap-1"><Link href={q({ date: addDays(start, -step) })} aria-label="Previous" className="rounded-md border border-line-strong bg-surface p-1.5 shadow-sm hover:bg-surface-2"><Icon name="chevron-left" size={15} /></Link><Link href={q({ date: todayKey })} className="rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-[13px] font-medium shadow-sm hover:bg-surface-2">Today</Link><Link href={q({ date: addDays(start, step) })} aria-label="Next" className="rounded-md border border-line-strong bg-surface p-1.5 shadow-sm hover:bg-surface-2"><Icon name="chevron-right" size={15} /></Link></div>
        {can(ctx, "jobs.create") && <LinkButton href="/jobs/new" variant="primary"><Icon name="plus" size={14} /> New job</LinkButton>}
      </>} />
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="mr-1 text-fg-3">Technicians</span>
        <Link href={q({ tech: undefined })} className={`rounded-full px-2.5 py-1 font-medium ${techFilter.length === 0 ? "bg-fg text-white" : "bg-surface-2 text-fg-2 hover:bg-line"}`}>All</Link>
        {allTechs.map((t) => { const on = techFilter.includes(t.id); const next = on ? techFilter.filter((x) => x !== t.id) : [...techFilter, t.id]; return <Link key={t.id} href={q({ tech: next.join(",") || undefined })} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${on ? "bg-fg text-white" : "bg-surface-2 text-fg-2 hover:bg-line"}`}><span className="size-2 rounded-full" style={{ background: t.calendarColor }} />{t.firstName}</Link>; })}
      </div>
      <ScheduleBoard view={view} dateKey={start} days={days} tz={tz} nowIso={new Date().toISOString()} canManage={can(ctx, "schedule.manage")}
        technicians={view === "day" ? techs : techs}
        appointments={data.appointments.map((a) => ({ id: a.id, jobId: a.job.id, number: a.job.number, title: a.job.title, customer: a.job.customer.displayName, address: `${a.job.location.addressLine1}, ${a.job.location.city}`, status: a.status, priority: a.job.priority, color: a.job.jobType?.color ?? "#2563eb", startsAt: a.startsAt.toISOString(), endsAt: a.endsAt.toISOString(), assigneeIds: a.assignees.map((x) => x.employeeId) }))}
        unscheduled={unscheduled.map((j) => ({ id: j.id, number: j.number, title: j.title, customer: j.customer.displayName, address: `${j.location.addressLine1}, ${j.location.city}`, minutes: j.estimatedMinutes, priority: j.priority, color: j.jobType?.color ?? "#2563eb", assigneeIds: j.assignees.map((a) => a.employeeId) }))} />
    </>
  );
}
