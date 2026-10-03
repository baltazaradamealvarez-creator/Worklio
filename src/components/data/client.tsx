"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icon";
import { Menu } from "@/components/ui/client";
import { Button } from "@/components/ui/primitives";
import type { ActionResult } from "@/server/actions";

export interface FilterDef {
  name: string;
  label: string;
  type?: "select" | "date" | "text";
  options?: { value: string; label: string }[];
  width?: string;
}

/** URL-driven filters: every change rewrites the query string, so views are shareable & bookmarkable. */
export function FilterBar({ filters, searchPlaceholder = "Search…", extra }: { filters: FilterDef[]; searchPlaceholder?: string; extra?: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const first = useRef(true);

  const push = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    next.delete("page");
    const s = next.toString();
    start(() => router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false }));
  };

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => { if ((sp.get("q") ?? "") !== q) push({ q: q.trim() || null }); }, 280);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  useEffect(() => setQ(sp.get("q") ?? ""), [sp]);

  const active = filters.filter((f) => sp.get(f.name)).length + (sp.get("q") ? 1 : 0);
  return (
    <div className={cn("mb-3 flex flex-wrap items-center gap-2", pending && "opacity-70")} role="search">
      <div className="relative min-w-52 flex-1 sm:max-w-xs">
        <Icon name="search" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-3" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} aria-label="Search" className="h-8 w-full rounded-md border border-line-strong bg-surface pl-8 pr-2.5 text-[13px] shadow-sm placeholder:text-fg-3 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20" />
      </div>
      {filters.map((f) =>
        f.type === "date" ? (
          <label key={f.name} className="flex items-center gap-1.5 text-xs text-fg-3">
            {f.label}
            <input type="date" value={sp.get(f.name) ?? ""} onChange={(e) => push({ [f.name]: e.target.value || null })} className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px] text-fg shadow-sm focus:border-primary focus:outline-none" />
          </label>
        ) : f.type === "text" ? (
          <input key={f.name} defaultValue={sp.get(f.name) ?? ""} placeholder={f.label} aria-label={f.label} onBlur={(e) => e.target.value !== (sp.get(f.name) ?? "") && push({ [f.name]: e.target.value.trim() || null })} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} className={cn("h-8 rounded-md border border-line-strong bg-surface px-2.5 text-[13px] shadow-sm focus:border-primary focus:outline-none", f.width ?? "w-28")} />
        ) : (
          <select key={f.name} value={sp.get(f.name) ?? ""} onChange={(e) => push({ [f.name]: e.target.value || null })} aria-label={f.label} className={cn("h-8 rounded-md border bg-surface px-2 pr-6 text-[13px] shadow-sm focus:border-primary focus:outline-none", sp.get(f.name) ? "border-primary text-primary" : "border-line-strong text-fg-2")}>
            <option value="">{f.label}</option>
            {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ),
      )}
      {active > 0 && <button onClick={() => start(() => router.replace(pathname, { scroll: false }))} className="text-xs font-medium text-primary hover:underline">Clear ({active})</button>}
      {extra && <div className="ml-auto flex items-center gap-2">{extra}</div>}
    </div>
  );
}

/** Column visibility, persisted per table in localStorage and applied with a scoped stylesheet. */
export function ColumnToggle({ tableId, columns }: { tableId: string; columns: { key: string; label: string; hidden: boolean }[] }) {
  const storageKey = `wl:cols:${tableId}`;
  const [hidden, setHidden] = useState<string[]>(columns.filter((c) => c.hidden).map((c) => c.key));
  useEffect(() => {
    try { const v = localStorage.getItem(storageKey); if (v) setHidden(JSON.parse(v)); } catch { /* storage unavailable */ }
  }, [storageKey]);
  const toggle = (key: string) => {
    const next = hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key];
    setHidden(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* ignore */ }
  };
  if (columns.length === 0) return null;
  return (
    <>
      <style>{hidden.map((k) => `#${tableId} [data-col="${k}"]{display:none}`).join("")}</style>
      <Menu align="right" trigger={<span className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-fg-2 hover:bg-surface-2"><Icon name="settings" size={13} /> Columns</span>}>
        <div onClick={(e) => e.stopPropagation()} className="py-1">
          {columns.map((c) => (
            <label key={c.key} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-surface-2">
              <input type="checkbox" checked={!hidden.includes(c.key)} onChange={() => toggle(c.key)} className="size-4 accent-primary" /> {c.label}
            </label>
          ))}
        </div>
      </Menu>
    </>
  );
}

/** Bulk-selection bar: reads ticked rows from the table and hands their ids to a server action. */
export function BulkBar({ tableId, action, actions }: { tableId: string; action: (ids: string[], op: string, value?: string) => Promise<ActionResult<unknown>>; actions: { label: string; op: string; value?: string; confirm?: string; prompt?: string; variant?: "secondary" | "danger-outline" }[] }) {
  const router = useRouter();
  const [ids, setIds] = useState<string[]>([]);
  const [pending, start] = useTransition();

  useEffect(() => {
    const table = document.getElementById(tableId);
    if (!table) return;
    const sync = () => setIds([...table.querySelectorAll<HTMLInputElement>("input[data-bulk-id]:checked")].map((i) => i.dataset.bulkId!));
    const onChange = (e: Event) => {
      const t = e.target as HTMLInputElement;
      if (t.matches("input[data-bulk-all]")) table.querySelectorAll<HTMLInputElement>("input[data-bulk-id]").forEach((i) => (i.checked = t.checked));
      sync();
    };
    table.addEventListener("change", onChange);
    return () => table.removeEventListener("change", onChange);
  }, [tableId]);

  if (ids.length === 0) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary-soft px-3 py-2" role="region" aria-label="Bulk actions">
      <span className="text-[13px] font-medium text-primary">{ids.length} selected</span>
      {actions.map((a) => (
        <Button key={a.label} size="sm" variant={a.variant ?? "secondary"} disabled={pending} onClick={() => {
          if (a.confirm && !window.confirm(a.confirm.replace("{n}", String(ids.length)))) return;
          const value = a.prompt ? window.prompt(a.prompt) : undefined;
          if (a.prompt && !value) return;
          start(async () => {
            const r = await action(ids, a.op, value ?? a.value);
            if (r.ok) { toast.success(r.message ?? "Updated"); router.refresh(); setIds([]); document.querySelectorAll<HTMLInputElement>(`#${tableId} input[type=checkbox]`).forEach((i) => (i.checked = false)); }
            else toast.error(r.error);
          });
        }}>{a.label}</Button>
      ))}
    </div>
  );
}
