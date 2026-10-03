import type { Prisma } from "@prisma/client";
import { requirePermission, type Ctx } from "@/server/auth/context";
import { skipTake, toPage, type ListParams } from "./list";

/** Read the tenant's append-only audit trail. Metadata never contains secrets (see `audit()` callers). */
export async function listAuditLogs(ctx: Ctx, p: ListParams) {
  requirePermission(ctx, "audit.view");
  const and: Prisma.AuditLogWhereInput[] = [];
  const f = p.filters;
  if (p.q) and.push({ OR: [{ action: { contains: p.q, mode: "insensitive" } }, { actorName: { contains: p.q, mode: "insensitive" } }, { entityId: p.q }] });
  if (f.entityType) and.push({ entityType: f.entityType });
  if (f.actor) and.push({ actorUserId: f.actor });
  if (f.support === "1") and.push({ impersonatorUserId: { not: null } });
  const d = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00.000Z`) : null);
  const from = d(f.from), to = d(f.to);
  if (from) and.push({ createdAt: { gte: from } });
  if (to) and.push({ createdAt: { lt: new Date(to.getTime() + 86_400_000) } });
  const where = { AND: and };
  const [rows, total, types] = await Promise.all([
    ctx.db.auditLog.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...skipTake(p) }),
    ctx.db.auditLog.count({ where }),
    ctx.db.auditLog.findMany({ distinct: ["entityType"], where: { entityType: { not: null } }, select: { entityType: true }, orderBy: { entityType: "asc" }, take: 60 }),
  ]);
  return { ...toPage(rows, total, p), entityTypes: types.map((t) => t.entityType!).filter(Boolean) };
}
