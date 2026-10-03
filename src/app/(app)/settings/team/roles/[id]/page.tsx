import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { deleteRoleAction } from "@/app/actions/people";
import { RoleForm } from "@/components/settings/role-form";
import { ConfirmAction } from "@/components/ui/client";
import { PageHeader } from "@/components/ui/primitives";
import { can, requirePermission } from "@/server/auth/context";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Edit role" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await pageCtx();
  requirePermission(ctx, "roles.manage");
  const role = await ctx.db.role.findFirst({ where: { id } });
  if (!role || role.key === "OWNER") notFound();
  return (
    <>
      <PageHeader title={role.name} subtitle={role.isSystem ? "Built-in role — permissions can be adjusted, but it can't be renamed or deleted." : "Custom role"} breadcrumbs={[{ label: "Team & roles", href: "/settings/team?tab=roles" }, { label: role.name }]}
        actions={!role.isSystem && <ConfirmAction label="Delete role" title={`Delete ${role.name}?`} description="Only possible when no users hold this role." confirmLabel="Delete" action={deleteRoleAction.bind(null, id)} />} />
      <RoleForm id={id} role={role} readOnlyName={role.isSystem} canGrant={(p) => ctx.roleKey === "OWNER" || can(ctx, p as never)} />
    </>
  );
}
