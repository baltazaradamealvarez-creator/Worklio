import type { Ctx } from "@/server/auth/context";

/**
 * In-app notifications. Delivery channels are pluggable: `fanOut` is the seam where email /
 * SMS / push dispatchers will be registered later without touching the call sites in the
 * domain services (which only call `notifyUsers`).
 */
export async function listNotifications(ctx: Ctx, opts: { unreadOnly?: boolean; take?: number } = {}) {
  return ctx.db.notification.findMany({
    where: { userId: ctx.userId, ...(opts.unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.take ?? 30, 100),
  });
}

export async function unreadCount(ctx: Ctx): Promise<number> {
  return ctx.db.notification.count({ where: { userId: ctx.userId, readAt: null } });
}

export async function markRead(ctx: Ctx, id: string) {
  await ctx.db.notification.updateMany({ where: { id, userId: ctx.userId, readAt: null }, data: { readAt: new Date() } });
}

export async function markAllRead(ctx: Ctx) {
  await ctx.db.notification.updateMany({ where: { userId: ctx.userId, readAt: null }, data: { readAt: new Date() } });
}
