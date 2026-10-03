import Link from "next/link";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar, type CreateOption } from "@/components/layout/topbar";
import { NAV } from "@/components/layout/nav";
import { Icon } from "@/components/ui/icon";
import { can } from "@/server/auth/context";
import { requireAuth } from "@/server/auth/server";
import { redirect } from "next/navigation";
import { unreadCount } from "@/server/domain/notifications";
import { getSettings } from "@/server/domain/settings";
import { stopImpersonationAction } from "@/app/actions/shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAuth();
  const ctx = auth.ctx;
  if (!ctx) redirect(auth.user.isPlatformAdmin ? "/platform" : "/no-access");
  const [settings, unread] = await Promise.all([getSettings(ctx), unreadCount(ctx)]);

  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.any.length === 0 || i.any.some((p) => can(ctx, p))) })).filter((g) => g.items.length);
  const create: CreateOption[] = [
    can(ctx, "customers.create") && { label: "Customer", href: "/customers/new", icon: "users" },
    can(ctx, "leads.manage") && { label: "Lead", href: "/leads/new", icon: "funnel" },
    can(ctx, "jobs.create") && { label: "Job", href: "/jobs/new", icon: "clipboard-list" },
    can(ctx, "quotes.create") && { label: "Quote", href: "/quotes/new", icon: "file-text" },
    can(ctx, "invoices.create") && { label: "Invoice", href: "/invoices/new", icon: "receipt" },
    can(ctx, "payments.record") && { label: "Payment", href: "/payments/new", icon: "banknote" },
    can(ctx, "tasks.manage") && { label: "Task", href: "/tasks?new=1", icon: "list-checks" },
  ].filter((x): x is CreateOption => !!x);

  return (
    <div className="flex min-h-dvh flex-col">
      {ctx.impersonator && (
        <div role="alert" className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-red-600 px-4 py-2 text-[13px] font-medium text-white">
          <span className="flex items-center gap-2"><Icon name="alert-triangle" size={15} /> Platform support session: you are acting inside <strong>{ctx.tenantName}</strong> as {ctx.impersonator.name}. Every action is logged and visible to the company.</span>
          {ctx.impersonator.reason && <span className="opacity-90">Reason: {ctx.impersonator.reason}</span>}
          <form action={stopImpersonationAction}><button className="rounded bg-white px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50">Exit company</button></form>
        </div>
      )}
      <div className="flex flex-1">
        <Sidebar groups={groups} companyName={ctx.tenantName} brandColor={settings.brandColor} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar userName={ctx.userName} companyName={ctx.tenantName} companies={auth.companies} createOptions={create} initialUnread={unread} />
          <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 lg:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}

void Link;
