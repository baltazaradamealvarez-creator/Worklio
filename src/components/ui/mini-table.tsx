import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { EmptyState } from "./primitives";

export interface MiniColumn<T> {
  header: string;
  cell: (row: T) => ReactNode;
  align?: "right";
  className?: string;
}

/** Compact, non-paginated table for record sub-sections. */
export function MiniTable<T extends { id: string }>({ columns, rows, href, empty }: { columns: MiniColumn<T>[]; rows: T[]; href?: (r: T) => string; empty: { title: string; description: string; action?: ReactNode } }) {
  if (rows.length === 0) return <div className="rounded-lg border border-line bg-surface"><EmptyState {...empty} /></div>;
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[560px] text-[13px]">
        <thead>
          <tr className="border-b border-line bg-surface-2/60 text-left">{columns.map((c) => <th key={c.header} className={cn("px-3 py-2 text-xs font-semibold text-fg-3", c.align === "right" && "text-right", c.className)}>{c.header}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-primary-soft/40">
              {columns.map((c, i) => (
                <td key={c.header} className={cn("px-3 py-2.5", c.align === "right" && "text-right tabular", c.className)}>
                  {i === 0 && href ? <Link href={href(r)} className="font-medium hover:text-primary hover:underline">{c.cell(r)}</Link> : c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
