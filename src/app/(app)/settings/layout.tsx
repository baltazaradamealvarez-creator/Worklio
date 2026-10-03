import { SettingsNav } from "@/components/settings/nav";
import { can } from "@/server/auth/context";
import { pageCtx } from "@/server/page-context";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { ctx } = await pageCtx();
  const items = [
    can(ctx, "settings.manage") && { href: "/settings/company", label: "Company" },
    can(ctx, "settings.manage") && { href: "/settings/branding", label: "Branding & documents" },
    can(ctx, "settings.manage") && { href: "/settings/operations", label: "Operations & numbering" },
    can(ctx, "settings.manage") && { href: "/settings/financial", label: "Payments & terms" },
    can(ctx, "settings.manage") && { href: "/settings/job-types", label: "Job types" },
    can(ctx, "settings.manage") && { href: "/settings/territories", label: "Service territories" },
    (can(ctx, "users.manage") || can(ctx, "roles.manage")) && { href: "/settings/team", label: "Team & roles" },
    { href: "/settings/profile", label: "My account" },
  ].filter((x): x is { href: string; label: string } => !!x);
  return (
    <div className="grid gap-6 lg:grid-cols-[210px_1fr]">
      <SettingsNav items={items} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
