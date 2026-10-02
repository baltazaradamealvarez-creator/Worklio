import { can, type Ctx } from "@/server/auth/context";
import { customerScope, jobScope } from "./entity-access";
import { formatAddress } from "@/lib/format";

export interface SearchHit {
  kind: "customer" | "job" | "quote" | "invoice" | "equipment" | "employee" | "lead";
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

/**
 * Global search across the records the caller may see. Each group is permission-gated and
 * tenant-scoped by the DB layer; results are capped so the query stays cheap.
 */
export async function globalSearch(ctx: Ctx, rawQuery: string): Promise<SearchHit[]> {
  const q = rawQuery.trim().slice(0, 80);
  if (q.length < 2) return [];
  const digits = q.replace(/\D/g, "");
  const insensitive = { contains: q, mode: "insensitive" as const };
  const hits: SearchHit[] = [];

  const tasks: Promise<void>[] = [];
  if (can(ctx, "customers.view")) {
    tasks.push(
      ctx.db.customer
        .findMany({
          where: {
            deletedAt: null,
            ...customerScope(ctx),
            OR: [
              { displayName: insensitive },
              { email: insensitive },
              { companyName: insensitive },
              ...(digits.length >= 3 ? [{ phone: { contains: digits } }, { phoneAlt: { contains: digits } }] : []),
              { locations: { some: { deletedAt: null, OR: [{ addressLine1: insensitive }, { postalCode: { startsWith: q } }] } } },
            ],
          },
          take: 6,
          orderBy: { displayName: "asc" },
          select: { id: true, displayName: true, phone: true, email: true, locations: { where: { deletedAt: null }, take: 1, orderBy: { isPrimary: "desc" }, select: { addressLine1: true, city: true, state: true, postalCode: true } } },
        })
        .then((rows) => {
          for (const c of rows) hits.push({ kind: "customer", id: c.id, title: c.displayName, subtitle: [c.phone, c.email, c.locations[0] ? formatAddress(c.locations[0]) : null].filter(Boolean).join(" · "), href: `/customers/${c.id}` });
        }),
    );
  }
  if (can(ctx, "jobs.view") || can(ctx, "jobs.view_assigned")) {
    tasks.push(
      ctx.db.job
        .findMany({
          where: { deletedAt: null, ...jobScope(ctx), OR: [{ number: insensitive }, { title: insensitive }, { customer: { displayName: insensitive } }, { location: { addressLine1: insensitive } }] },
          take: 5,
          orderBy: { createdAt: "desc" },
          select: { id: true, number: true, title: true, status: true, customer: { select: { displayName: true } } },
        })
        .then((rows) => {
          for (const j of rows) hits.push({ kind: "job", id: j.id, title: `${j.number} · ${j.title}`, subtitle: `${j.customer.displayName} · ${j.status.toLowerCase().replace(/_/g, " ")}`, href: can(ctx, "jobs.view") ? `/jobs/${j.id}` : `/tech/jobs/${j.id}` });
        }),
    );
  }
  if (can(ctx, "quotes.view")) {
    tasks.push(
      ctx.db.quote
        .findMany({ where: { deletedAt: null, OR: [{ number: insensitive }, { title: insensitive }, { customer: { displayName: insensitive } }] }, take: 5, orderBy: { createdAt: "desc" }, select: { id: true, number: true, title: true, status: true, customer: { select: { displayName: true } } } })
        .then((rows) => {
          for (const x of rows) hits.push({ kind: "quote", id: x.id, title: `${x.number} · ${x.title}`, subtitle: `${x.customer.displayName} · ${x.status.toLowerCase()}`, href: `/quotes/${x.id}` });
        }),
    );
  }
  if (can(ctx, "invoices.view")) {
    tasks.push(
      ctx.db.invoice
        .findMany({ where: { OR: [{ number: insensitive }, { customer: { displayName: insensitive } }] }, take: 5, orderBy: { createdAt: "desc" }, select: { id: true, number: true, status: true, customer: { select: { displayName: true } } } })
        .then((rows) => {
          for (const x of rows) hits.push({ kind: "invoice", id: x.id, title: x.number, subtitle: `${x.customer.displayName} · ${x.status.toLowerCase().replace(/_/g, " ")}`, href: `/invoices/${x.id}` });
        }),
    );
  }
  if (can(ctx, "equipment.view")) {
    tasks.push(
      ctx.db.equipment
        .findMany({ where: { deletedAt: null, customer: customerScope(ctx), OR: [{ serialNumber: insensitive }, { model: insensitive }] }, take: 5, select: { id: true, manufacturer: true, model: true, serialNumber: true, customerId: true, customer: { select: { displayName: true } } } })
        .then((rows) => {
          for (const e of rows) hits.push({ kind: "equipment", id: e.id, title: `${[e.manufacturer, e.model].filter(Boolean).join(" ") || "Equipment"}${e.serialNumber ? ` · S/N ${e.serialNumber}` : ""}`, subtitle: e.customer.displayName, href: `/equipment/${e.id}` });
        }),
    );
  }
  if (can(ctx, "employees.view")) {
    tasks.push(
      ctx.db.employee
        .findMany({ where: { deletedAt: null, OR: [{ firstName: insensitive }, { lastName: insensitive }, { email: insensitive }, { jobTitle: insensitive }] }, take: 4, select: { id: true, firstName: true, lastName: true, jobTitle: true } })
        .then((rows) => {
          for (const e of rows) hits.push({ kind: "employee", id: e.id, title: `${e.firstName} ${e.lastName}`, subtitle: e.jobTitle ?? "Employee", href: `/employees/${e.id}` });
        }),
    );
  }
  if (can(ctx, "leads.view")) {
    tasks.push(
      ctx.db.lead
        .findMany({ where: { deletedAt: null, OR: [{ displayName: insensitive }, { email: insensitive }, ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : [])] }, take: 4, select: { id: true, displayName: true, status: true } })
        .then((rows) => {
          for (const l of rows) hits.push({ kind: "lead", id: l.id, title: l.displayName, subtitle: `Lead · ${l.status.toLowerCase().replace(/_/g, " ")}`, href: `/leads/${l.id}` });
        }),
    );
  }
  await Promise.all(tasks);
  const order = ["customer", "job", "quote", "invoice", "equipment", "lead", "employee"];
  return hits.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}
