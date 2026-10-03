"use server";

import { redirect } from "next/navigation";
import { getAuth, logout as doLogout, requireAuth, requireCtx, requestMeta } from "@/server/auth/server";
import { switchTenant } from "@/server/auth/session";
import { globalSearch, type SearchHit } from "@/server/domain/search";
import { listNotifications, markAllRead, markRead, unreadCount } from "@/server/domain/notifications";
import { stopImpersonation } from "@/server/domain/tenants";
import { run, type ActionResult } from "@/server/actions";

export async function searchAction(q: string): Promise<SearchHit[]> {
  const ctx = await requireCtx();
  return globalSearch(ctx, q);
}

export async function notificationsAction() {
  const ctx = await requireCtx();
  const [items, unread] = await Promise.all([listNotifications(ctx, { take: 15 }), unreadCount(ctx)]);
  return { unread, items: items.map((n) => ({ id: n.id, title: n.title, body: n.body, href: n.href, readAt: n.readAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString() })) };
}

export async function markNotificationReadAction(id: string) {
  const ctx = await requireCtx();
  await markRead(ctx, id);
}

export async function markAllNotificationsReadAction() {
  const ctx = await requireCtx();
  await markAllRead(ctx);
}

export async function logoutAction() {
  await doLogout();
  redirect("/login");
}

export async function switchCompanyAction(tenantId: string): Promise<ActionResult> {
  return run(async () => {
    const auth = await requireAuth();
    const ok = await switchTenant(auth.sessionId, auth.user.id, tenantId);
    if (!ok) throw new Error("You don't have access to that company.");
    return { redirectTo: "/dashboard" };
  });
}

export async function stopImpersonationAction() {
  const auth = await getAuth();
  if (!auth?.impersonatingTenantId) redirect("/platform");
  await stopImpersonation({ userId: auth.user.id, name: auth.user.name, sessionId: auth.sessionId }, auth.impersonatingTenantId);
  void requestMeta;
  redirect("/platform");
}
