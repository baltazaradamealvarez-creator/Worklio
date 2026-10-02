import type { EntityType } from "@prisma/client";
import { can, type Ctx } from "@/server/auth/context";
import { forbidden, notFound } from "@/server/errors";

/** Field-only users (technicians/installers) are limited to records tied to their own jobs. */
export function isFieldOnly(ctx: Pick<Ctx, "permissions">): boolean {
  return !can(ctx, "jobs.view") && can(ctx, "jobs.view_assigned");
}

/** Prisma `where` limiting jobs to those visible to the user. */
export function jobScope(ctx: Ctx) {
  if (can(ctx, "jobs.view")) return {};
  if (can(ctx, "jobs.view_assigned") && ctx.employeeId) return { assignees: { some: { employeeId: ctx.employeeId } } };
  return { id: "__none__" };
}

/** Prisma `where` limiting customers to those visible to the user. */
export function customerScope(ctx: Ctx) {
  if (!isFieldOnly(ctx)) return {};
  if (!ctx.employeeId) return { id: "__none__" };
  return { jobs: { some: { assignees: { some: { employeeId: ctx.employeeId } }, deletedAt: null } } };
}

export interface ResolvedEntity {
  customerId: string | null;
  label: string;
}

/**
 * Confirm that the entity exists in the caller's tenant AND that the caller may see it.
 * Used by notes and attachments (polymorphic parents) so a client can never attach to, or
 * read from, a record it couldn't open itself. Never trusts `entityId` from the browser.
 */
export async function resolveEntity(ctx: Ctx, type: EntityType, id: string): Promise<ResolvedEntity> {
  const db = ctx.db;
  switch (type) {
    case "CUSTOMER": {
      if (!can(ctx, "customers.view")) throw forbidden();
      const c = await db.customer.findFirst({ where: { id, ...customerScope(ctx) }, select: { id: true, displayName: true } });
      if (!c) throw notFound("Customer");
      return { customerId: c.id, label: c.displayName };
    }
    case "LOCATION": {
      if (!can(ctx, "customers.view")) throw forbidden();
      const l = await db.customerLocation.findFirst({ where: { id, customer: customerScope(ctx) }, select: { customerId: true, name: true } });
      if (!l) throw notFound("Location");
      return { customerId: l.customerId, label: l.name };
    }
    case "EQUIPMENT": {
      if (!can(ctx, "equipment.view")) throw forbidden();
      const e = await db.equipment.findFirst({ where: { id, customer: customerScope(ctx) }, select: { customerId: true, manufacturer: true, model: true, type: true } });
      if (!e) throw notFound("Equipment");
      return { customerId: e.customerId, label: [e.manufacturer, e.model].filter(Boolean).join(" ") || e.type };
    }
    case "LEAD": {
      if (!can(ctx, "leads.view")) throw forbidden();
      const l = await db.lead.findFirst({ where: { id, deletedAt: null }, select: { customerId: true, displayName: true } });
      if (!l) throw notFound("Lead");
      return { customerId: l.customerId, label: l.displayName };
    }
    case "JOB":
    case "APPOINTMENT": {
      if (!can(ctx, "jobs.view") && !can(ctx, "jobs.view_assigned")) throw forbidden();
      const jobId =
        type === "JOB" ? id : (await db.appointment.findFirst({ where: { id }, select: { jobId: true } }))?.jobId;
      if (!jobId) throw notFound("Appointment");
      const j = await db.job.findFirst({ where: { id: jobId, deletedAt: null, ...jobScope(ctx) }, select: { customerId: true, number: true } });
      if (!j) throw notFound("Job");
      return { customerId: j.customerId, label: j.number };
    }
    case "QUOTE": {
      if (!can(ctx, "quotes.view")) throw forbidden();
      const q = await db.quote.findFirst({ where: { id, deletedAt: null }, select: { customerId: true, number: true } });
      if (!q) throw notFound("Quote");
      return { customerId: q.customerId, label: q.number };
    }
    case "INVOICE": {
      if (!can(ctx, "invoices.view")) throw forbidden();
      const i = await db.invoice.findFirst({ where: { id }, select: { customerId: true, number: true } });
      if (!i) throw notFound("Invoice");
      return { customerId: i.customerId, label: i.number };
    }
    case "PAYMENT": {
      if (!can(ctx, "payments.view")) throw forbidden();
      const p = await db.payment.findFirst({ where: { id }, select: { customerId: true } });
      if (!p) throw notFound("Payment");
      return { customerId: p.customerId, label: "Payment" };
    }
    case "AGREEMENT": {
      if (!can(ctx, "maintenance.view")) throw forbidden();
      const a = await db.maintenanceAgreement.findFirst({ where: { id, deletedAt: null }, select: { customerId: true, number: true } });
      if (!a) throw notFound("Agreement");
      return { customerId: a.customerId, label: a.number };
    }
    case "EMPLOYEE": {
      const own = ctx.employeeId === id;
      if (!own && !can(ctx, "employees.view")) throw forbidden();
      const e = await db.employee.findFirst({ where: { id, deletedAt: null }, select: { firstName: true, lastName: true } });
      if (!e) throw notFound("Employee");
      return { customerId: null, label: `${e.firstName} ${e.lastName}` };
    }
    case "EXPENSE": {
      if (!can(ctx, "expenses.view")) throw forbidden();
      const e = await db.expense.findFirst({ where: { id, deletedAt: null }, select: { description: true } });
      if (!e) throw notFound("Expense");
      return { customerId: null, label: e.description };
    }
    case "TASK": {
      if (!can(ctx, "tasks.view")) throw forbidden();
      const t = await db.task.findFirst({ where: { id }, select: { title: true, customerId: true } });
      if (!t) throw notFound("Task");
      return { customerId: t.customerId, label: t.title };
    }
    case "TENANT": {
      if (!can(ctx, "settings.manage")) throw forbidden();
      return { customerId: null, label: ctx.tenantName };
    }
  }
}
