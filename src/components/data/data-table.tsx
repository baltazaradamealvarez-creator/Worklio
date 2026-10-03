import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icon";
import type { Page } from "@/server/domain/list";
import { ColumnToggle } from "./client";

export type SP = Record<string, string | string[] | undefined>;

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  sortKey?: string;
  align?: "left" | "right";
  className?: string;
  /** hidden below this breakpoint */
  from?: "sm" | "md" | "lg" | "xl";
  /** can't be toggled off */
  fixed?: boolean;
  defaultHidden?: boolean;
}

export function withParams(basePath: string, sp: SP, patch: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (val !== undefined && val !== "") q.set(k, val);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === "") q.delete(k);
    else q.set(k, v);
  }
  const s = q.toString();
  return s ? `${basePath}?${s}` : basePath;
}

const FROM = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell", xl: "hidden xl:table-cell" } as const;

export function DataTable<T extends { id: string }>({
  id, columns, page, sp, basePath, sort, dir, rowHref, empty, selectable, footer, density = "normal",
}: {
  id: string;
  columns: Column<T>[];
  page: Page<T>;
  sp: SP;
  basePath: string;
  sort: string;
  dir: "asc" | "desc";
  rowHref?: (row: T) => string;
  empty: ReactNode;
  selectable?: boolean;
  footer?: ReactNode;
  density?: "normal" | "compact";
}) {
  const hasFilters = Object.entries(sp).some(([k, v]) => !["page", "pageSize", "sort", "dir"].includes(k) && v);
  const pad = density === "compact" ? "py-1.5" : "py-2.5";
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
        <div className="text-xs text-fg-3 tabular">
          {page.total === 0 ? "No results" : `${(page.page - 1) * page.pageSize + 1}–${Math.min(page.page * page.pageSize, page.total)} of ${page.total.toLocaleString()}`}
        </div>
        <ColumnToggle tableId={id} columns={columns.filter((c) => !c.fixed).map((c) => ({ key: c.key, label: typeof c.header === "string" ? c.header : c.key, hidden: !!c.defaultHidden }))} />
      </div>
      {page.rows.length === 0 ? (
        hasFilters ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-fg">No matching results</p>
            <p className="mt-1 text-[13px] text-fg-3">Try removing a filter or searching for something else.</p>
            <Link href={basePath} className="mt-3 inline-block text-[13px] font-medium text-primary hover:underline">Clear all filters</Link>
          </div>
        ) : (
          empty
        )
      ) : (
        <div className="overflow-x-auto">
          <table id={id} className="w-full min-w-[640px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line bg-surface-2/60 text-left">
                {selectable && <th className="w-9 px-3"><input type="checkbox" aria-label="Select all" data-bulk-all className="size-4 accent-primary" /></th>}
                {columns.map((c) => {
                  const active = c.sortKey && sort === c.sortKey;
                  return (
                    <th key={c.key} data-col={c.key} scope="col" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined} className={cn("whitespace-nowrap px-3 py-2 text-xs font-semibold text-fg-3", c.align === "right" && "text-right", c.from && FROM[c.from], c.className)}>
                      {c.sortKey ? (
                        <Link href={withParams(basePath, sp, { sort: c.sortKey, dir: active && dir === "asc" ? "desc" : "asc", page: undefined })} className={cn("inline-flex items-center gap-1 hover:text-fg", active && "text-fg")}>
                          {c.header}
                          <Icon name="chevron-down" size={12} className={cn("transition-transform", active ? (dir === "asc" ? "rotate-180 opacity-100" : "opacity-100") : "opacity-0")} />
                        </Link>
                      ) : c.header}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {page.rows.map((row) => (
                <tr key={row.id} className="group hover:bg-primary-soft/40">
                  {selectable && <td className="px-3"><input type="checkbox" data-bulk-id={row.id} aria-label="Select row" className="size-4 accent-primary" /></td>}
                  {columns.map((c, i) => (
                    <td key={c.key} data-col={c.key} className={cn("px-3", pad, c.align === "right" && "text-right tabular", c.from && FROM[c.from], c.className)}>
                      {i === 0 && rowHref ? <Link href={rowHref(row)} className="font-medium text-fg hover:text-primary hover:underline">{c.cell(row)}</Link> : c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {footer}
          </table>
        </div>
      )}
      {page.total > 0 && <Pagination page={page} sp={sp} basePath={basePath} />}
    </div>
  );
}

function Pagination({ page, sp, basePath }: { page: Page<unknown>; sp: SP; basePath: string }) {
  if (page.pageCount <= 1 && page.total <= 10) return null;
  const link = (p: number) => withParams(basePath, sp, { page: p === 1 ? undefined : String(p) });
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-3 py-2 text-xs text-fg-2">
      <div className="flex items-center gap-1.5">
        Rows
        {[25, 50, 100].map((n) => (
          <Link key={n} href={withParams(basePath, sp, { pageSize: n === 25 ? undefined : String(n), page: undefined })} className={cn("rounded px-1.5 py-0.5 hover:bg-surface-2", page.pageSize === n && "bg-surface-2 font-semibold text-fg")}>{n}</Link>
        ))}
      </div>
      <div className="flex items-center gap-1 tabular">
        <span className="mr-2">Page {page.page} of {page.pageCount}</span>
        {page.page > 1 ? <Link href={link(page.page - 1)} aria-label="Previous page" className="rounded border border-line-strong p-1 hover:bg-surface-2"><Icon name="chevron-left" size={14} /></Link> : <span className="rounded border border-line p-1 opacity-40"><Icon name="chevron-left" size={14} /></span>}
        {page.page < page.pageCount ? <Link href={link(page.page + 1)} aria-label="Next page" className="rounded border border-line-strong p-1 hover:bg-surface-2"><Icon name="chevron-right" size={14} /></Link> : <span className="rounded border border-line p-1 opacity-40"><Icon name="chevron-right" size={14} /></span>}
      </div>
    </div>
  );
}
