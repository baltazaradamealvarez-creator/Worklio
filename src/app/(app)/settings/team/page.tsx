import type { Metadata } from "next";
import Link from "next/link";
import { changeRoleAction, memberStatusAction, revokeInvitationAction } from "@/app/actions/people";
import { InviteUser } from "@/components/settings/team-client";
import { ActionForm, ConfirmAction, QuickAction, SubmitButton } from "@/components/ui/client";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Select, StatusBadge, Tabs } from "@/components/ui/primitives";
import { can, requirePermission } from "@/server/auth/context";
import { listAssignableEmployees } from "@/server/domain/employees";
import { listTeam } from "@/server/domain/users";
import { formatDateTime, humanize } from "@/lib/format";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Team & roles" };

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const { ctx, tz } = await pageCtx();
  requirePermission(ctx, "users.manage");
  const [team, emps] = await Promise.all([listTeam(ctx), listAssignableEmployees(ctx)]);
  const tab = sp.tab === "roles" || sp.tab === "invitations" ? sp.tab : "members";
  const roleOpts = team.roles.map((r) => ({ id: r.id, name: r.name }));
  return (
    <>
      <PageHeader title="Team & roles" subtitle="Who can sign in, and exactly what they can do. Permissions are enforced on the server." actions={<InviteUser roles={roleOpts} employees={emps.filter((e) => !e.membership).map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}` }))} />} />
      <Tabs tabs={[{ key: "members", label: "Users", count: team.members.length }, { key: "invitations", label: "Pending invitations", count: team.invitations.length }, { key: "roles", label: "Roles", count: team.roles.length }]} active={tab} basePath="/settings/team" />
      {tab === "members" && (
        <Card padded={false}><ul className="divide-y divide-line">{team.members.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1"><div className="text-[13px] font-medium">{m.user?.name ?? m.user?.email} {m.userId === ctx.userId && <Badge tone="blue">You</Badge>}</div><div className="text-xs text-fg-3">{m.user?.email}{m.user?.lastLoginAt ? ` · last sign-in ${formatDateTime(m.user.lastLoginAt, tz)}` : " · never signed in"}</div></div>
            <StatusBadge status={m.status} />
            {m.userId !== ctx.userId ? (
              <>
                <ActionForm action={changeRoleAction.bind(null, m.id)} className="flex items-center gap-1.5">
                  <Select name="roleId" defaultValue={m.roleId} className="h-8 w-40 text-xs" aria-label="Role">{roleOpts.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
                  <SubmitButton size="sm" variant="secondary">Change</SubmitButton>
                </ActionForm>
                {m.status === "ACTIVE" ? <ConfirmAction size="sm" variant="ghost" label="Suspend" title="Suspend this user?" description="They're signed out immediately and can't sign in until restored." confirmLabel="Suspend" action={memberStatusAction.bind(null, m.id, "SUSPENDED")} /> : <QuickAction size="sm" variant="ghost" label="Restore" action={memberStatusAction.bind(null, m.id, "ACTIVE")} />}
              </>
            ) : <span className="text-xs text-fg-3">{m.role.name}</span>}
          </li>))}</ul></Card>
      )}
      {tab === "invitations" && (
        <Card padded={false}>{team.invitations.length === 0 ? <EmptyState title="No pending invitations" description="Invitations you send appear here until they're accepted or expire." /> : <ul className="divide-y divide-line">{team.invitations.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3"><div className="flex-1 text-[13px]"><span className="font-medium">{i.email}</span> <span className="text-fg-3">· {i.role.name} · expires {formatDateTime(i.expiresAt, tz)}</span></div><ConfirmAction size="sm" variant="ghost" label="Revoke" title="Revoke invitation?" description="The link will stop working." confirmLabel="Revoke" action={revokeInvitationAction.bind(null, i.id)} /></li>))}</ul>}</Card>
      )}
      {tab === "roles" && (
        <>
          {can(ctx, "roles.manage") && <div className="mb-4 flex justify-end"><LinkButton href="/settings/team/roles/new" variant="primary">New custom role</LinkButton></div>}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{team.roles.map((r) => (
            <Card key={r.id}>
              <div className="flex items-start justify-between gap-2"><div><div className="font-semibold">{r.name}</div><div className="text-xs text-fg-3">{r.description ?? "—"}</div></div>{r.isSystem ? <Badge>Built-in</Badge> : <Badge tone="blue">Custom</Badge>}</div>
              <div className="mt-3 flex items-center justify-between text-xs text-fg-3"><span>{r.key === "OWNER" ? "All permissions" : `${r.permissions.length} permissions`} · {r._count.memberships} user{r._count.memberships === 1 ? "" : "s"}</span>{can(ctx, "roles.manage") && r.key !== "OWNER" && <Link href={`/settings/team/roles/${r.id}`} className="font-medium text-primary hover:underline">{r.isSystem ? "View / adjust" : "Edit"}</Link>}</div>
            </Card>))}</div>
        </>
      )}
    </>
  );
  void humanize;
}
