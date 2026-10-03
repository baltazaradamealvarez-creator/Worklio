import type { Metadata } from "next";
import { RoleForm } from "@/components/settings/role-form";
import { PageHeader } from "@/components/ui/primitives";
import { can, requirePermission } from "@/server/auth/context";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "New role" };

export default async function Page() {
  const { ctx } = await pageCtx();
  requirePermission(ctx, "roles.manage");
  return (
    <>
      <PageHeader title="New custom role" breadcrumbs={[{ label: "Team & roles", href: "/settings/team?tab=roles" }, { label: "New role" }]} />
      <RoleForm id={null} canGrant={(p) => ctx.roleKey === "OWNER" || can(ctx, p as never)} />
    </>
  );
}
