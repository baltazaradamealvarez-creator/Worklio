"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export function SettingsNav({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Settings" className="flex gap-1 overflow-x-auto lg:flex-col lg:self-start lg:overflow-visible">
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={path.startsWith(i.href) ? "page" : undefined} className={cn("whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] font-medium", path.startsWith(i.href) ? "bg-primary-soft text-primary" : "text-fg-2 hover:bg-surface-2")}>{i.label}</Link>
      ))}
    </nav>
  );
}
