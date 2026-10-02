import { can, type Ctx } from "@/server/auth/context";
import { OPEN_INVOICE_STATUSES } from "@/lib/state";
import { localDateKey } from "@/lib/format";
import { customerScope, jobScope } from "./entity-access";
import { pastDueWhere } from "./invoices";
import { dayBounds, tenantTimezone } from "./scheduling";
import { expireStaleQuotes } from "./quotes";

/** "What needs attention today?" — every number here is a live database query. */
export async function dashboardData(ctx: Ctx) {
  const tz = await tenantTimezone(ctx.db);
  const todayKey = localDateKey(new Date(), tz);
  const { start, end } = await dayBounds(ctx.db, todayKey, 1);
  const showJobs = can(ctx, "jobs.view") || can(ctx, "jobs.view_assigned");
  const allJobs = can(ctx, "jobs.view");
  const showQuotes = can(ctx, "quotes.view");
  const showInvoices = can(ctx, "invoices.view");
  const in30 = new Date(Date.now() + 30 * 86_400_000);
  if (showQuotes) await expireStaleQuotes(ctx.db);
  const scope = jobScope(ctx);

  const [todayAppts, inProgress, workingAppts, unscheduled, draftQuotes, awaiting, pastDueAgg, outstandingAgg, visitsDue, agreementsExpiring, recent, myTasks, lowStock, followUps] = await Promise.all([
    showJobs
      ? ctx.db.appointment.findMany({
          where: { startsAt: { gte: start, lt: end }, status: { notIn: ["CANCELLED"] }, job: { deletedAt: null, ...scope } },
          orderBy: { startsAt: "asc" },
          take: 12,
          select: { id: true, startsAt: true, status: true, job: { select: { id: true, number: true, title: true, customer: { select: { displayName: true } }, location: { select: { addressLine1: true, city: true } } } }, assignees: { select: { employee: { select: { firstName: true, lastName: true } } } } },
        })
      : [],
    showJobs ? ctx.db.job.count({ where: { deletedAt: null, status: "IN_PROGRESS", ...scope } }) : 0,
    allJobs ? ctx.db.appointmentAssignee.findMany({ where: { appointment: { status: { in: ["EN_ROUTE", "ARRIVED", "IN_PROGRESS"] } } }, select: { employeeId: true }, distinct: ["employeeId"] }) : [],
    allJobs ? ctx.db.job.count({ where: { deletedAt: null, status: { in: ["NEW", "UNSCHEDULED"] }, appointments: { none: { status: { in: ["SCHEDULED", "DISPATCHED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS"] } } } } }) : 0,
    showQuotes ? ctx.db.quote.count({ where: { deletedAt: null, status: { in: ["DRAFT", "READY"] } } }) : 0,
    showQuotes ? ctx.db.quote.aggregate({ where: { deletedAt: null, status: { in: ["SENT", "VIEWED"] } }, _sum: { totalCents: true }, _count: true }) : null,
    showInvoices ? ctx.db.invoice.aggregate({ where: await pastDueWhere(ctx.db), _sum: { balanceCents: true }, _count: true }) : null,
    showInvoices ? ctx.db.invoice.aggregate({ where: { status: { in: [...OPEN_INVOICE_STATUSES] }, balanceCents: { gt: 0 } }, _sum: { balanceCents: true }, _count: true }) : null,
    can(ctx, "maintenance.view") ? ctx.db.maintenanceVisit.count({ where: { status: "PLANNED", dueDate: { lte: in30 }, agreement: { status: { not: "CANCELLED" }, deletedAt: null, customer: customerScope(ctx) } } }) : 0,
    can(ctx, "maintenance.view") ? ctx.db.maintenanceAgreement.count({ where: { deletedAt: null, status: { not: "CANCELLED" }, renewalDate: { gte: new Date(), lte: in30 } } }) : 0,
    can(ctx, "customers.view") ? ctx.db.activity.findMany({ where: { customerId: { not: null }, ...(showInvoices ? {} : { NOT: [{ type: { startsWith: "invoice." } }, { type: { startsWith: "payment." } }] }) }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, summary: true, createdAt: true, customerId: true, actorName: true, actorType: true, customer: { select: { displayName: true } } } }) : [],
    can(ctx, "tasks.view") ? ctx.db.task.findMany({ where: { status: { in: ["OPEN", "IN_PROGRESS"] }, assigneeUserId: ctx.userId }, orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }], take: 6, select: { id: true, title: true, dueAt: true, priority: true, customer: { select: { id: true, displayName: true } } } }) : [],
    can(ctx, "inventory.view")
      ? ctx.db.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM (SELECT i.id FROM inventory_items i LEFT JOIN inventory_stock s ON s."itemId" = i.id WHERE i."deletedAt" IS NULL AND i."isActive" AND i."reorderThreshold" > 0 GROUP BY i.id, i."reorderThreshold" HAVING COALESCE(SUM(s.quantity), 0) <= i."reorderThreshold") t`
      : [{ n: 0 }],
    allJobs ? ctx.db.job.count({ where: { deletedAt: null, status: "NEEDS_FOLLOW_UP" } }) : 0,
  ]);

  return {
    todayKey,
    tz,
    todayAppts,
    inProgress,
    techniciansWorking: workingAppts.length,
    unscheduled,
    draftQuotes,
    quotesAwaiting: awaiting ? { count: awaiting._count, cents: awaiting._sum.totalCents ?? 0 } : null,
    pastDue: pastDueAgg ? { count: pastDueAgg._count, cents: pastDueAgg._sum.balanceCents ?? 0 } : null,
    outstanding: outstandingAgg ? { count: outstandingAgg._count, cents: outstandingAgg._sum.balanceCents ?? 0 } : null,
    visitsDue,
    agreementsExpiring,
    recent,
    myTasks,
    lowStock: lowStock[0]?.n ?? 0,
    followUps,
  };
}
