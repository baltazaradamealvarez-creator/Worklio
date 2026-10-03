import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { can } from "@/server/auth/context";
import { requireAuth } from "@/server/auth/server";
import { logoutAction } from "@/app/actions/shell";
import { redirect } from "next/navigation";
import { getSettings } from "@/server/domain/settings";

export const metadata = { title: { default: "Field", template: "%s · Field · Worklio" } };

export default async function TechLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAuth();
  if (!auth.ctx) redirect("/no-access");
  const ctx = auth.ctx;
  if (!can(ctx, "jobs.view_assigned") && !can(ctx, "jobs.view")) redirect("/dashboard");
  const settings = await getSettings(ctx);
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col bg-bg">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface px-4">
        <Link href="/tech" className="flex items-center gap-2.5"><span className="flex size-7 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ background: settings.brandColor }}>{ctx.tenantName[0]}</span><span className="text-[15px] font-semibold">Today's work</span></Link>
        <div className="flex items-center gap-1">
          {can(ctx, "jobs.view") && <Link href="/dashboard" className="rounded-lg px-2.5 py-2 text-[13px] font-medium text-fg-2 hover:bg-surface-2">Office</Link>}
          <form action={logoutAction}><button aria-label="Sign out" className="rounded-lg p-2.5 text-fg-2 hover:bg-surface-2"><Icon name="log-out" size={18} /></button></form>
        </div>
      </header>
      <main className="flex-1 px-4 pb-24 pt-4">{children}</main>
    </div>
  );
}
