"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { moveAppointmentAction, scheduleFromBoardAction } from "@/app/actions/jobs";
import { Icon } from "@/components/ui/icon";
import { Avatar } from "@/components/ui/primitives";
import { addDays, formatTime, zonedToUtc } from "@/lib/format";

export interface BoardAppt {
  id: string;
  jobId: string;
  number: string;
  title: string;
  customer: string;
  address: string;
  status: string;
  priority: string;
  color: string;
  startsAt: string;
  endsAt: string;
  assigneeIds: string[];
}
export interface BoardTech { id: string; name: string; color: string; offToday?: string | null }
export interface BoardJob { id: string; number: string; title: string; customer: string; address: string; minutes: number; priority: string; color: string; assigneeIds: string[] }

const HOUR_START = 6;
const HOUR_END = 20;
const ROW = 56; // px per hour
const SNAP = 15;

const STATUS_STYLE: Record<string, string> = {
  COMPLETED: "opacity-60", CANCELLED: "opacity-40 line-through", IN_PROGRESS: "ring-2 ring-teal-500", EN_ROUTE: "ring-2 ring-purple-400", ARRIVED: "ring-2 ring-teal-400", DISPATCHED: "ring-1 ring-purple-300",
};

function minutesOfDay(iso: string, dateKey: string, tz: string) {
  return (new Date(iso).getTime() - zonedToUtc(dateKey, 0, tz).getTime()) / 60_000;
}

/** Greedy lane assignment so overlapping blocks sit side by side. */
function layout(items: { id: string; start: number; end: number }[]) {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const lanes: number[] = [];
  const placed = new Map<string, { lane: number; lanes: number }>();
  const groups: { ids: string[]; end: number }[] = [];
  for (const it of sorted) {
    let lane = lanes.findIndex((end) => end <= it.start);
    if (lane === -1) { lane = lanes.length; lanes.push(it.end); } else lanes[lane] = it.end;
    placed.set(it.id, { lane, lanes: 0 });
    let g = groups.find((x) => x.end > it.start);
    if (!g) { g = { ids: [], end: it.end }; groups.push(g); }
    g.ids.push(it.id); g.end = Math.max(g.end, it.end);
  }
  for (const g of groups) { const n = Math.max(...g.ids.map((id) => placed.get(id)!.lane)) + 1; for (const id of g.ids) placed.get(id)!.lanes = n; }
  return placed;
}

type Drag = { kind: "appt"; id: string; fromTech?: string; minutes: number } | { kind: "job"; id: string; assigneeIds: string[] };

export function ScheduleBoard({ view, dateKey, days, tz, technicians, appointments, unscheduled, canManage, nowIso }: { view: "day" | "week"; dateKey: string; days: string[]; tz: string; technicians: BoardTech[]; appointments: BoardAppt[]; unscheduled: BoardJob[]; canManage: boolean; nowIso: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<{ col: string; top: number } | null>(null);
  const techById = useMemo(() => new Map(technicians.map((t) => [t.id, t])), [technicians]);
  const hours = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);
  const columns: { key: string; label: string; sub?: string; dateKey: string; techId?: string; tech?: BoardTech }[] =
    view === "day" ? technicians.map((t) => ({ key: t.id, label: t.name, dateKey, techId: t.id, tech: t })) : days.map((d) => ({ key: d, label: new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`)), sub: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`)), dateKey: d }));
  const today = nowIso.slice(0, 0) + new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(nowIso));
  const nowMin = minutesOfDay(nowIso, today, tz);

  const run = (fn: (force: boolean) => ReturnType<typeof moveAppointmentAction>) =>
    start(async () => {
      let r = await fn(false);
      if (!r.ok && r.fieldErrors?.force === "confirm") {
        if (window.confirm(`${r.error}\n\nSchedule it anyway?`)) r = await fn(true);
        else return;
      }
      if (r.ok) { toast.success(r.message ?? "Updated"); router.refresh(); } else toast.error(r.error);
    });

  function onDrop(e: React.DragEvent, col: (typeof columns)[number]) {
    e.preventDefault();
    const d = drag;
    setDrag(null); setHover(null);
    if (!d || !canManage) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const raw = ((e.clientY - rect.top) / ROW) * 60 + HOUR_START * 60;
    const min = Math.max(HOUR_START * 60, Math.min(HOUR_END * 60 - 15, Math.round(raw / SNAP) * SNAP));
    const startsAt = new Date(zonedToUtc(col.dateKey, min, tz)).toISOString();
    if (d.kind === "appt") {
      const a = appointments.find((x) => x.id === d.id);
      if (!a) return;
      let assignees: string[] | null = null;
      if (view === "day" && col.techId) assignees = [...new Set([...a.assigneeIds.filter((x) => x !== d.fromTech), col.techId])];
      run((force) => moveAppointmentAction(d.id, startsAt, assignees, force));
    } else {
      const assignees = view === "day" && col.techId ? [col.techId] : d.assigneeIds;
      run((force) => scheduleFromBoardAction(d.id, startsAt, assignees, force));
    }
  }

  return (
    <div className="flex gap-4">
      <div className={cn("min-w-0 flex-1 overflow-hidden rounded-lg border border-line bg-surface", pending && "opacity-70")}>
        <div className="overflow-x-auto">
          <div style={{ minWidth: 56 + columns.length * 150 }}>
            <div className="z-10 flex border-b border-line bg-surface">
              <div className="w-14 shrink-0" />
              {columns.map((c) => (
                <div key={c.key} className="min-w-[150px] flex-1 border-l border-line px-2 py-2">
                  <div className="flex items-center gap-2">
                    {c.tech && <Avatar name={c.tech.name} color={c.tech.color} size={22} />}
                    <div className="min-w-0"><div className={cn("truncate text-[13px] font-semibold", c.dateKey === today && view === "week" && "text-primary")}>{c.label}</div>{c.sub && <div className="text-xs text-fg-3">{c.sub}</div>}</div>
                  </div>
                  {c.tech?.offToday && <div className="mt-1 rounded bg-warn-soft px-1.5 py-0.5 text-[11px] text-warn">Off: {c.tech.offToday}</div>}
                </div>
              ))}
            </div>
            <div className="relative flex" style={{ height: hours.length * ROW }}>
              <div className="w-14 shrink-0">
                {hours.map((h) => <div key={h} style={{ height: ROW }} className="pr-2 pt-0.5 text-right text-[11px] text-fg-3">{new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(2020, 0, 1, h)))}</div>)}
              </div>
              {columns.map((c) => {
                const items = appointments.filter((a) => (view === "day" ? a.assigneeIds.includes(c.techId!) : (new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(a.startsAt)) === c.dateKey)));
                const boxes = items.map((a) => ({ a, start: Math.max(minutesOfDay(a.startsAt, c.dateKey, tz), HOUR_START * 60), end: Math.min(minutesOfDay(a.endsAt, c.dateKey, tz), HOUR_END * 60) }));
                const lanes = layout(boxes.map((b) => ({ id: b.a.id, start: b.start, end: Math.max(b.end, b.start + 20) })));
                return (
                  <div key={c.key} className="relative min-w-[150px] flex-1 border-l border-line" onDragOver={(e) => { if (!canManage) return; e.preventDefault(); const rect = e.currentTarget.getBoundingClientRect(); setHover({ col: c.key, top: Math.round(((e.clientY - rect.top) / ROW) * 4) * (ROW / 4) }); }} onDragLeave={() => setHover(null)} onDrop={(e) => onDrop(e, c)}>
                    {hours.map((h) => <div key={h} style={{ height: ROW }} className="border-b border-line/70" />)}
                    {c.dateKey === today && nowMin >= HOUR_START * 60 && nowMin <= HOUR_END * 60 && <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-danger" style={{ top: ((nowMin - HOUR_START * 60) / 60) * ROW }}><span className="absolute -left-1 -top-[5px] size-2 rounded-full bg-danger" /></div>}
                    {hover?.col === c.key && drag && <div className="pointer-events-none absolute inset-x-1 z-20 h-1 rounded bg-primary" style={{ top: hover.top }} />}
                    {boxes.map(({ a, start, end }) => {
                      const pos = lanes.get(a.id)!;
                      const top = ((start - HOUR_START * 60) / 60) * ROW;
                      const height = Math.max(((end - start) / 60) * ROW, 22);
                      const draggable = canManage && ["SCHEDULED", "DISPATCHED"].includes(a.status);
                      return (
                        <Link key={`${a.id}-${c.key}`} href={`/jobs/${a.jobId}`} draggable={draggable}
                          onDragStart={(e) => { if (!draggable) return; setDrag({ kind: "appt", id: a.id, fromTech: c.techId, minutes: (end - start) }); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", a.id); }} onDragEnd={() => { setDrag(null); setHover(null); }}
                          title={`${a.number} · ${a.customer}\n${a.title}\n${formatTime(a.startsAt, tz)}–${formatTime(a.endsAt, tz)}`}
                          className={cn("absolute z-[5] overflow-hidden rounded-md border-l-4 bg-white px-1.5 py-1 text-[11.5px] leading-tight shadow-sm ring-1 ring-line hover:z-20 hover:shadow-md", draggable && "cursor-grab active:cursor-grabbing", STATUS_STYLE[a.status])}
                          style={{ top, height, left: `calc(${(pos.lane / pos.lanes) * 100}% + 2px)`, width: `calc(${100 / pos.lanes}% - 4px)`, borderLeftColor: a.color, background: `color-mix(in srgb, ${a.color} 9%, white)` }}>
                          <div className="flex items-center gap-1 font-semibold">{a.priority === "EMERGENCY" && <Icon name="alert-triangle" size={11} className="text-danger" />}<span className="truncate">{a.customer}</span></div>
                          <div className="truncate text-fg-2">{formatTime(a.startsAt, tz)} · {a.title}</div>
                          {height > 56 && <div className="truncate text-fg-3">{a.address}</div>}
                          {view === "week" && height > 44 && <div className="mt-0.5 flex -space-x-1">{a.assigneeIds.map((id) => <Avatar key={id} name={techById.get(id)?.name ?? "?"} color={techById.get(id)?.color} size={14} />)}</div>}
                        </Link>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <aside className="hidden w-64 shrink-0 xl:block" aria-label="Unscheduled jobs">
        <div className="sticky top-16 rounded-lg border border-line bg-surface">
          <header className="flex items-center justify-between border-b border-line px-3 py-2"><h2 className="text-[13px] font-semibold">Unscheduled</h2><span className="rounded-full bg-surface-2 px-2 text-xs font-semibold">{unscheduled.length}</span></header>
          <ul className="max-h-[70vh] space-y-2 overflow-y-auto p-2">
            {unscheduled.length === 0 && <li className="px-2 py-6 text-center text-xs text-fg-3">Everything is scheduled.</li>}
            {unscheduled.map((j) => (
              <li key={j.id} draggable={canManage} onDragStart={(e) => { setDrag({ kind: "job", id: j.id, assigneeIds: j.assigneeIds }); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", j.id); }} onDragEnd={() => { setDrag(null); setHover(null); }}
                className={cn("rounded-md border-l-4 border border-line bg-surface p-2 text-xs shadow-sm", canManage && "cursor-grab active:cursor-grabbing")} style={{ borderLeftColor: j.color }}>
                <Link href={`/jobs/${j.id}`} className="block font-semibold hover:text-primary">{j.customer}</Link>
                <div className="truncate text-fg-2">{j.title}</div>
                <div className="mt-0.5 flex items-center justify-between text-fg-3"><span className="truncate">{j.address}</span><span className="shrink-0">{j.minutes}m</span></div>
                {j.priority !== "NORMAL" && j.priority !== "LOW" && <div className={cn("mt-1 inline-block rounded px-1.5 text-[10.5px] font-semibold", j.priority === "EMERGENCY" ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn")}>{j.priority}</div>}
              </li>
            ))}
          </ul>
          {canManage && <p className="border-t border-line px-3 py-2 text-[11px] text-fg-3">Drag a job onto a time slot to schedule it.</p>}
        </div>
      </aside>
    </div>
  );
}

export const _addDays = addDays;
