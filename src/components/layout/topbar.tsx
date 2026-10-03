"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icon";
import { Menu, MenuItem } from "@/components/ui/client";
import { Avatar } from "@/components/ui/primitives";
import { logoutAction, markAllNotificationsReadAction, markNotificationReadAction, notificationsAction, searchAction, switchCompanyAction } from "@/app/actions/shell";
import { relativeTime } from "@/lib/format";
import type { SearchHit } from "@/server/domain/search";

const KIND_LABEL: Record<SearchHit["kind"], string> = { customer: "Customers", job: "Jobs", quote: "Quotes", invoice: "Invoices", equipment: "Equipment", employee: "Employees", lead: "Leads" };

export interface CreateOption { label: string; href: string; icon: string }

export function Topbar({ userName, companyName, companies, createOptions, initialUnread }: { userName: string; companyName: string; companies: { tenantId: string; name: string }[]; createOptions: CreateOption[]; initialUnread: number }) {
  return (
    <header className="app-topbar sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur lg:px-6">
      <div className="w-8 lg:hidden" />
      <SearchPalette />
      <div className="ml-auto flex items-center gap-2">
        {createOptions.length > 0 && (
          <Menu
            trigger={
              <span className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-medium text-white shadow-sm hover:bg-primary-hover">
                <Icon name="plus" size={14} /> Create
              </span>
            }
          >
            {createOptions.map((o) => (
              <Link key={o.href} href={o.href} role="menuitem" className="flex items-center gap-2.5 px-3 py-1.5 text-[13px] text-fg hover:bg-surface-2">
                <Icon name={o.icon} size={14} className="text-fg-3" /> {o.label}
              </Link>
            ))}
          </Menu>
        )}
        <Notifications initialUnread={initialUnread} />
        <Menu
          trigger={
            <span className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-surface-2">
              <Avatar name={userName} size={26} />
              <Icon name="chevron-down" size={13} className="text-fg-3" />
            </span>
          }
        >
          <div className="border-b border-line px-3 py-2">
            <div className="text-[13px] font-medium">{userName}</div>
            <div className="text-xs text-fg-3">{companyName}</div>
          </div>
          {companies.length > 1 && (
            <div className="border-b border-line py-1">
              <div className="px-3 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-fg-3">Switch company</div>
              {companies.map((c) => (
                <MenuItem key={c.tenantId} onClick={() => switchCompanyAction(c.tenantId).then(() => (window.location.href = "/dashboard"))}>
                  <Icon name="building-2" size={14} className="text-fg-3" /> {c.name}
                </MenuItem>
              ))}
            </div>
          )}
          <Link href="/settings/profile" role="menuitem" className="flex items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-surface-2"><Icon name="user" size={14} className="text-fg-3" /> My profile</Link>
          <form action={logoutAction}>
            <button role="menuitem" className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-surface-2"><Icon name="log-out" size={14} className="text-fg-3" /> Sign out</button>
          </form>
        </Menu>
      </div>
    </header>
  );
}

function SearchPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [idx, setIdx] = useState(0);
  const [searching, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(true); }
      if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName) && !(e.target as HTMLElement).isContentEditable) { e.preventDefault(); setOpen(true); }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 10); else { setQ(""); setHits([]); } }, [open]);

  const runSearch = useCallback((value: string) => {
    const my = ++seq.current;
    start(async () => {
      const r = await searchAction(value);
      if (my === seq.current) { setHits(r); setIdx(0); }
    });
  }, []);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => runSearch(q), 180);
    return () => clearTimeout(t);
  }, [q, runSearch]);

  const go = (h: SearchHit) => { setOpen(false); router.push(h.href); };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex h-8 w-full max-w-sm items-center gap-2 rounded-md border border-line bg-surface-2/60 px-2.5 text-[13px] text-fg-3 hover:border-line-strong">
        <Icon name="search" size={14} />
        <span className="flex-1 text-left">Search customers, jobs, invoices…</span>
        <kbd className="hidden rounded border border-line bg-surface px-1.5 text-[10.5px] font-medium sm:block">⌘K</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Search">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
            <div className="flex items-center gap-2 border-b border-line px-3">
              <Icon name="search" size={16} className="text-fg-3" />
              <input
                ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone, address, job #, invoice #, serial number…"
                className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-3"
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, hits.length - 1)); }
                  if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
                  if (e.key === "Enter" && hits[idx]) go(hits[idx]!);
                }}
              />
              {searching && <span className="size-3.5 animate-spin rounded-full border-2 border-fg-3 border-t-transparent" />}
            </div>
            <ul className="max-h-[50vh] overflow-y-auto py-1" role="listbox">
              {q.trim().length < 2 && <li className="px-4 py-6 text-center text-[13px] text-fg-3">Type at least 2 characters. Results respect your permissions.</li>}
              {q.trim().length >= 2 && !searching && hits.length === 0 && <li className="px-4 py-6 text-center text-[13px] text-fg-3">No matches for “{q}”.</li>}
              {hits.map((h, i) => {
                const header = i === 0 || hits[i - 1]!.kind !== h.kind;
                return (
                  <li key={`${h.kind}-${h.id}`} role="option" aria-selected={i === idx}>
                    {header && <div className="px-4 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-fg-3">{KIND_LABEL[h.kind]}</div>}
                    <button type="button" onClick={() => go(h)} onMouseEnter={() => setIdx(i)} className={cn("flex w-full flex-col px-4 py-1.5 text-left", i === idx && "bg-primary-soft")}>
                      <span className="text-[13px] font-medium text-fg">{h.title}</span>
                      <span className="truncate text-xs text-fg-3">{h.subtitle}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

function Notifications({ initialUnread }: { initialUnread: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Awaited<ReturnType<typeof notificationsAction>> | null>(null);
  const [unread, setUnread] = useState(initialUnread);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    notificationsAction().then((d) => { setData(d); setUnread(d.unread); });
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  useEffect(() => {
    const t = setInterval(() => notificationsAction().then((d) => setUnread(d.unread)).catch(() => undefined), 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} className="relative rounded-md p-1.5 text-fg-2 hover:bg-surface-2">
        <Icon name="bell" size={17} />
        {unread > 0 && <span className="absolute right-0.5 top-0.5 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-4 text-white">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1.5 w-80 overflow-hidden rounded-lg border border-line bg-surface shadow-pop">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-[13px] font-semibold">Notifications</span>
            {unread > 0 && <button className="text-xs text-primary hover:underline" onClick={() => markAllNotificationsReadAction().then(() => { setUnread(0); setData((d) => d && { ...d, unread: 0, items: d.items.map((i) => ({ ...i, readAt: i.readAt ?? new Date().toISOString() })) }); })}>Mark all read</button>}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {!data && <li className="px-3 py-6 text-center text-xs text-fg-3">Loading…</li>}
            {data?.items.length === 0 && <li className="px-3 py-8 text-center text-[13px] text-fg-3">You're all caught up.</li>}
            {data?.items.map((n) => (
              <li key={n.id}>
                <button
                  className={cn("flex w-full gap-2.5 border-b border-line/60 px-3 py-2.5 text-left hover:bg-surface-2", !n.readAt && "bg-primary-soft/50")}
                  onClick={() => { markNotificationReadAction(n.id); setOpen(false); if (n.href) router.push(n.href); }}
                >
                  <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-primary")} />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-fg">{n.title}</span>
                    {n.body && <span className="block truncate text-xs text-fg-3">{n.body}</span>}
                    <span className="block text-[11px] text-fg-3">{relativeTime(n.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
