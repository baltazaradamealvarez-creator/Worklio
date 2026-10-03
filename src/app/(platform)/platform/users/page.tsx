import type { Metadata } from "next";
import Link from "next/link";
import { sendUserResetAction, setUserActiveAction, unlockUserAction } from "@/app/actions/platform";
import { ConfirmAction, QuickAction } from "@/components/ui/client";
import { Badge, Button, EmptyState, Input, PageHeader } from "@/components/ui/primitives";
import { requirePlatformAdmin } from "@/server/auth/server";
import { listAllUsers } from "@/server/domain/platform-admin";
import { formatDateTime, relativeTime } from "@/lib/format";

export const metadata: Metadata = { title: "Users · Platform" };

export default async function PlatformUsers({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const sp = await searchParams;
  const me = (await requirePlatformAdmin()).user.id;
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, total, pageSize } = await listAllUsers({ q: sp.q, page });
  const now = new Date();
  return (
    <>
      <PageHeader title="Users" subtitle={`${total.toLocaleString()} people across every company.`} />
      <form action="/platform/users" className="mb-4 flex gap-3"><Input name="q" defaultValue={sp.q ?? ""} placeholder="Search name or email…" className="w-72" /><Button type="submit">Search</Button></form>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        {rows.length === 0 ? <EmptyState title="No users found" description="Try a different search." /> : (
          <table className="w-full min-w-[900px] text-[13px]">
            <thead><tr className="border-b border-line bg-surface-2/60 text-left text-xs font-semibold text-fg-3"><th className="px-3 py-2">User</th><th className="px-3 py-2">Companies & roles</th><th className="px-3 py-2">Last sign-in</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Actions</th></tr></thead>
            <tbody className="divide-y divide-line">{rows.map((u) => {
              const locked = u.lockedUntil && u.lockedUntil > now;
              return (
                <tr key={u.id}>
                  <td className="px-3 py-2.5"><div className="font-medium">{u.name} {u.isPlatformAdmin && <Badge tone="blue">Platform admin</Badge>}</div><div className="text-xs text-fg-3">{u.email}</div></td>
                  <td className="px-3">{u.memberships.length === 0 ? <span className="text-fg-3">—</span> : <ul className="space-y-0.5">{u.memberships.map((m) => <li key={m.tenant.id}><Link href={`/platform/companies/${m.tenant.id}`} className="hover:text-primary hover:underline">{m.tenant.name}</Link> <span className="text-fg-3">· {m.role.name}{m.status !== "ACTIVE" ? ` (${m.status.toLowerCase()})` : ""}</span></li>)}</ul>}</td>
                  <td className="px-3 text-fg-3" title={u.lastLoginAt ? formatDateTime(u.lastLoginAt, "UTC") : undefined}>{u.lastLoginAt ? relativeTime(u.lastLoginAt) : "Never"}</td>
                  <td className="px-3">{!u.isActive ? <Badge tone="red">Deactivated</Badge> : locked ? <Badge tone="amber">Locked</Badge> : <Badge tone="green">Active</Badge>}</td>
                  <td className="px-3"><span className="flex flex-wrap justify-end gap-1">
                    {locked && <QuickAction size="sm" variant="ghost" label="Unlock" action={unlockUserAction.bind(null, u.id)} />}
                    <QuickAction size="sm" variant="ghost" label="Send reset link" action={sendUserResetAction.bind(null, u.id)} />
                    {u.id !== me && (u.isActive ? <ConfirmAction size="sm" variant="ghost" label="Deactivate" title={`Deactivate ${u.name}?`} description="They're signed out everywhere and can't sign in to any company until reactivated." confirmLabel="Deactivate" action={setUserActiveAction.bind(null, u.id, false)} /> : <QuickAction size="sm" variant="ghost" label="Reactivate" action={setUserActiveAction.bind(null, u.id, true)} />)}
                  </span></td>
                </tr>);
            })}</tbody>
          </table>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-fg-3"><span>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString()}</span><span className="flex gap-3">{page > 1 && <Link className="text-primary" href={`/platform/users?page=${page - 1}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`}>← Newer</Link>}{page * pageSize < total && <Link className="text-primary" href={`/platform/users?page=${page + 1}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`}>Older →</Link>}</span></div>
    </>
  );
}
