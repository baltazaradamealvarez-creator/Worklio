"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export function PlatformNav({ items }: { items: { href: string; label: string; exact?: boolean }[] }) {
  const path = usePathname();
  return (
    <nav className="flex gap-1">{items.map((i) => {
      const active = i.exact ? path === i.href || path.startsWith("/platform/companies") : path.startsWith(i.href);
      return <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined} className={cn("rounded-md px-3 py-1.5 text-[13px] font-medium", active ? "bg-primary-soft text-primary" : "text-fg-2 hover:bg-surface-2")}>{i.label}</Link>;
    })}</nav>
  );
}
