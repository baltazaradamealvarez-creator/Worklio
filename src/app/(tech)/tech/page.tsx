import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/primitives";
import { myDay, upcomingForMe } from "@/server/domain/field";
import { formatAddress, formatDate, formatTime, mapsUrl, formatPhone } from "@/lib/format";
import { requireCtx } from "@/server/auth/server";
import { AutoRefresh } from "@/components/schedule/auto-refresh";

export default async function TechHome() {
  const ctx = await requireCtx();
  const [day, upcoming] = await Promise.all([myDay(ctx), upcomingForMe(ctx)]);
  const open = day.appointments.filter((a) => !["COMPLETED", "CANCELLED", "NO_SHOW"].includes(a.status));
  const done = day.appointments.filter((a) => a.status === "COMPLETED");
  const nextId = open.find((a) => ["IN_PROGRESS", "ARRIVED", "EN_ROUTE"].includes(a.status))?.id ?? open[0]?.id;
  return (
    <>
      <AutoRefresh seconds={60} />
      <p className="mb-3 text-[13px] text-fg-3">{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: day.tz }).format(new Date())} · {open.length} to do · {done.length} done</p>
      {day.appointments.length === 0 && (
        <div className="rounded-2xl border border-line bg-surface px-6 py-12 text-center"><Icon name="check" size={28} className="mx-auto mb-2 text-success" /><h2 className="text-base font-semibold">No jobs today</h2><p className="mt-1 text-[13px] text-fg-3">You're all clear. New assignments will show up here and notify you.</p></div>
      )}
      <ul className="space-y-3">
        {day.appointments.map((a) => {
          const addr = formatAddress(a.job.location);
          const isNext = a.id === nextId;
          return (
            <li key={a.id} className={`overflow-hidden rounded-2xl border bg-surface shadow-sm ${isNext ? "border-primary ring-2 ring-primary/20" : "border-line"} ${a.status === "COMPLETED" ? "opacity-60" : ""}`}>
              <Link href={`/tech/jobs/${a.job.id}`} className="block p-4 active:bg-surface-2">
                <div className="flex items-start justify-between gap-3"><div><div className="text-lg font-semibold leading-tight">{formatTime(a.startsAt, day.tz)}</div><div className="mt-0.5 text-[15px] font-medium">{a.job.customer.displayName}</div></div><StatusBadge status={a.status} /></div>
                <p className="mt-1.5 text-[14px] text-fg-2">{a.job.title}</p>
                <p className="mt-0.5 flex items-start gap-1.5 text-[13px] text-fg-3"><Icon name="map-pin" size={14} className="mt-0.5 shrink-0" />{addr}</p>
                {a.job.priority !== "NORMAL" && <div className="mt-2"><StatusBadge status={a.job.priority} /></div>}
              </Link>
              <div className="grid grid-cols-2 divide-x divide-line border-t border-line text-[14px] font-medium">
                <a href={mapsUrl(addr)} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 py-3 text-primary active:bg-surface-2"><Icon name="navigation" size={16} /> Directions</a>
                {a.job.customer.phone ? <a href={`tel:${a.job.customer.phone}`} className="flex items-center justify-center gap-2 py-3 text-primary active:bg-surface-2"><Icon name="phone" size={16} /> {formatPhone(a.job.customer.phone)}</a> : <span className="py-3 text-center text-fg-3">No phone</span>}
              </div>
            </li>
          );
        })}
      </ul>
      {upcoming.length > 0 && (
        <section className="mt-8"><h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-3">Coming up</h2>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">{upcoming.map((a) => <li key={a.id}><Link href={`/tech/jobs/${a.job.id}`} className="flex items-center justify-between gap-3 px-4 py-3"><div className="min-w-0"><div className="truncate text-[14px] font-medium">{a.job.customer.displayName}</div><div className="truncate text-xs text-fg-3">{a.job.title}</div></div><div className="shrink-0 text-right text-xs text-fg-2"><div>{formatDate(a.startsAt, day.tz)}</div><div>{formatTime(a.startsAt, day.tz)}</div></div></Link></li>)}</ul>
        </section>
      )}
    </>
  );
}
