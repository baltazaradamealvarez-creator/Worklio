import Link from "next/link";
import { logoutAction } from "@/app/actions/shell";
import { PlatformNav } from "@/components/platform/nav";
import { Icon } from "@/components/ui/icon";
import { requirePlatformAdmin } from "@/server/auth/server";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const auth = await requirePlatformAdmin();
  return (
    <div className="min-h-dvh bg-bg">
      <header className="sticky top-0 z-30 border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[1300px] items-center gap-6 px-4 py-2.5 lg:px-8">
          <Link href="/platform" className="flex items-center gap-2 text-sm font-semibold"><span className="grid h-7 w-7 place-items-center rounded-md bg-slate-900 text-white"><Icon name="shield" size={15} /></span> Worklio Platform</Link>
          <PlatformNav items={[{ href: "/platform", label: "Companies", exact: true }, { href: "/platform/plans", label: "Plans" }, { href: "/platform/audit", label: "Audit log" }]} />
          <div className="ml-auto flex items-center gap-3 text-[13px] text-fg-2"><span className="hidden sm:inline">{auth.user.email}</span><form action={logoutAction}><button className="rounded-md px-2 py-1 hover:bg-surface-2">Sign out</button></form></div>
        </div>
      </header>
      <main className="mx-auto max-w-[1300px] px-4 py-6 lg:px-8">{children}</main>
    </div>
  );
}
