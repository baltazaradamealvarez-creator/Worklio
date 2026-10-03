"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icon";
import type { NavGroup } from "./nav";

export function Sidebar({ groups, companyName, brandColor }: { groups: NavGroup[]; companyName: string; brandColor: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => pathname === href || (href !== "/dashboard" && pathname.startsWith(href + "/")) || (href === "/inventory" && pathname === "/inventory");
  const content = (
    <nav className="flex h-full flex-col" aria-label="Main">
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line px-4">
        <span className="flex size-6 items-center justify-center rounded-md text-[11px] font-bold text-white" style={{ background: brandColor }}>{companyName.slice(0, 1).toUpperCase()}</span>
        <span className="truncate text-[13px] font-semibold text-fg">{companyName}</span>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-2.5 py-3">
        {groups.map((g, i) => (
          <div key={i}>
            {g.label && <div className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-fg-3">{g.label}</div>}
            <ul className="space-y-0.5">
              {g.items.map((it) => {
                const isActive = active(it.href) && !(it.href === "/inventory" && pathname.startsWith("/inventory/vendors"));
                return (
                  <li key={it.href}>
                    <Link href={it.href} onClick={() => setOpen(false)} aria-current={isActive ? "page" : undefined} className={cn("flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors", isActive ? "bg-surface text-fg shadow-sm ring-1 ring-line" : "text-fg-2 hover:bg-surface hover:text-fg")}>
                      <Icon name={it.icon} size={15} className={isActive ? "text-primary" : "text-fg-3"} />
                      {it.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Open navigation" className="fixed left-3 top-2.5 z-30 rounded-md p-1.5 text-fg-2 hover:bg-surface-2 lg:hidden">
        <Icon name="menu" size={18} />
      </button>
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r border-line bg-surface-2/60 lg:block">{content}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-surface-2 shadow-pop">{content}</aside>
        </div>
      )}
    </>
  );
}
