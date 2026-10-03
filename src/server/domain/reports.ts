import { Prisma } from "@prisma/client";
import { requirePermission, can, type Ctx } from "@/server/auth/context";
import { notFound } from "@/server/errors";
import { addDays, localDateKey, zonedToUtc } from "@/lib/format";
import { tenantTimezone } from "./scheduling";

/**
 * Operational reporting. These reports answer "how is the business running?" from the
 * operational records in Worklio (jobs, quotes, invoices, payments). They are NOT formal
 * accounting statements: there is no ledger, no accrual/cash-basis accounting, no
 * depreciation — treat them as management information, not as financial statements.
 */

export interface ReportFilters {
  from: string; // yyyy-mm-dd
  to: string;
  technician?: string;
  salesperson?: string;
  customer?: string;
  jobType?: string;
  status?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  tag?: string;
  leadSource?: string;
}

export type ColumnFormat = "text" | "money" | "number" | "percent" | "date";

export interface ReportResult {
  key: ReportKey;
  title: string;
  description: string;
  columns: { key: string; label: string; format: ColumnFormat; align?: "left" | "right" }[];
  rows: Record<string, string | number | null>[];
  totals?: Record<string, string | number | null>;
  chart?: { kind: "bar" | "line" | "area" | "pie" | "stacked"; xKey: string; series: { key: string; label: string; format: ColumnFormat }[]; horizontal?: boolean };
  /** filters that actually affect this report */
  supports: (keyof ReportFilters)[];
  note?: string;
}

export const REPORTS = [
  { key: "revenue", title: "Revenue by month", group: "Revenue", permission: "financials.view" },
  { key: "services", title: "Revenue by service type", group: "Revenue", permission: "financials.view" },
  { key: "customers_revenue", title: "Revenue by customer", group: "Revenue", permission: "financials.view" },
  { key: "technicians", title: "Revenue by technician", group: "Technicians", permission: "financials.view" },
  { key: "jobs", title: "Jobs", group: "Operations", permission: "reports.view" },
  { key: "quotes", title: "Quote conversion", group: "Sales", permission: "reports.view" },
  { key: "salespeople", title: "Sales by salesperson", group: "Sales", permission: "reports.view" },
  { key: "lead_sources", title: "Lead sources", group: "Sales", permission: "reports.view" },
  { key: "receivables", title: "Accounts receivable aging", group: "Billing", permission: "financials.view" },
  { key: "payments", title: "Payments", group: "Billing", permission: "financials.view" },
  { key: "maintenance", title: "Maintenance agreements", group: "Service", permission: "reports.view" },
  { key: "new_customers", title: "New customers", group: "Customers", permission: "reports.view" },
] as const;
export type ReportKey = (typeof REPORTS)[number]["key"];

const num = (v: unknown) => (v == null ? 0 : Number(v));

export function defaultFilters(tz: string, now = new Date()): ReportFilters {
  const today = localDateKey(now, tz);
  return { from: `${today.slice(0, 4)}-01-01`, to: today };
}

export function parseReportFilters(sp: Record<string, string | string[] | undefined>, tz: string): ReportFilters {
  const first = (k: string) => {
    const v = sp[k];
    const s = Array.isArray(v) ? v[0] : v;
    return s && s.trim() ? s.trim().slice(0, 100) : undefined;
  };
  const d = defaultFilters(tz);
  const date = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  return {
    from: date(first("from")) ?? d.from,
    to: date(first("to")) ?? d.to,
    technician: first("technician"),
    salesperson: first("salesperson"),
    customer: first("customer"),
    jobType: first("jobType"),
    status: first("status"),
    city: first("city"),
    state: first("state"),
    postalCode: first("postalCode"),
    tag: first("tag"),
    leadSource: first("leadSource"),
  };
}

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

/** Optional invoice-level filters (customer geography, tags, job type, technician). */
function invoiceConds(f: ReportFilters, tenantId: string): Prisma.Sql {
  const c: Prisma.Sql[] = [Prisma.sql`i."tenantId" = ${tenantId}`, Prisma.sql`i.status NOT IN ('DRAFT','VOID')`, Prisma.sql`i."issueDate" BETWEEN ${D(f.from)} AND ${D(f.to)}`];
  if (f.customer) c.push(Prisma.sql`i."customerId" = ${f.customer}`);
  if (f.jobType) c.push(Prisma.sql`j."jobTypeId" = ${f.jobType}`);
  if (f.technician) c.push(Prisma.sql`EXISTS (SELECT 1 FROM job_assignees ja WHERE ja."jobId" = i."jobId" AND ja."employeeId" = ${f.technician})`);
  if (f.city) c.push(Prisma.sql`lower(l.city) = lower(${f.city})`);
  if (f.state) c.push(Prisma.sql`lower(l.state) = lower(${f.state})`);
  if (f.postalCode) c.push(Prisma.sql`l."postalCode" LIKE ${f.postalCode + "%"}`);
  if (f.tag) c.push(Prisma.sql`${f.tag} = ANY (c.tags)`);
  if (f.status && ["OPEN", "SENT", "VIEWED", "PARTIALLY_PAID", "PAID"].includes(f.status)) c.push(Prisma.sql`i.status = ${f.status}::"InvoiceStatus"`);
  return Prisma.join(c, " AND ");
}

const INVOICE_FROM = Prisma.sql`invoices i JOIN customers c ON c.id = i."customerId" LEFT JOIN customer_locations l ON l.id = i."locationId" LEFT JOIN jobs j ON j.id = i."jobId"`;

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) { m = 1; y++; }
    if (out.length > 600) break;
  }
  // Charts stay readable: show at most the most recent 60 months of the range.
  return out.slice(-60);
}

export async function runReport(ctx: Ctx, key: ReportKey, f: ReportFilters): Promise<ReportResult> {
  const def = REPORTS.find((r) => r.key === key);
  if (!def) throw notFound("Report");
  requirePermission(ctx, def.permission);
  const tenantId = ctx.tenantId;
  const tz = await tenantTimezone(ctx.db);
  const T = (dateKey: string) => zonedToUtc(dateKey, 0, tz); // timestamp columns: day boundaries in the company's timezone
  const db = ctx.db;

  switch (key) {
    case "revenue": {
      const invoiced = await db.$queryRaw<{ m: string; invoiced: number; count: number }[]>`
        SELECT to_char(date_trunc('month', i."issueDate"), 'YYYY-MM') AS m, SUM(i."totalCents")::float8 AS invoiced, COUNT(*)::int AS count
        FROM ${INVOICE_FROM} WHERE ${invoiceConds(f, tenantId)} GROUP BY 1`;
      const collected = await db.$queryRaw<{ m: string; collected: number }[]>`
        SELECT to_char(date_trunc('month', p."receivedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}), 'YYYY-MM') AS m, SUM(p."amountCents")::float8 AS collected
        FROM payments p JOIN invoices i ON i.id = p."invoiceId" JOIN customers c ON c.id = i."customerId" LEFT JOIN customer_locations l ON l.id = i."locationId" LEFT JOIN jobs j ON j.id = i."jobId"
        WHERE p."tenantId" = ${tenantId} AND p.status = 'SUCCEEDED' AND p."receivedAt" >= ${T(f.from)} AND p."receivedAt" < ${T(addDays(f.to, 1))}
        ${f.customer ? Prisma.sql`AND i."customerId" = ${f.customer}` : Prisma.empty} ${f.jobType ? Prisma.sql`AND j."jobTypeId" = ${f.jobType}` : Prisma.empty}
        ${f.city ? Prisma.sql`AND lower(l.city) = lower(${f.city})` : Prisma.empty} ${f.state ? Prisma.sql`AND lower(l.state) = lower(${f.state})` : Prisma.empty}
        ${f.postalCode ? Prisma.sql`AND l."postalCode" LIKE ${f.postalCode + "%"}` : Prisma.empty} ${f.tag ? Prisma.sql`AND ${f.tag} = ANY (c.tags)` : Prisma.empty}
        ${f.technician ? Prisma.sql`AND EXISTS (SELECT 1 FROM job_assignees ja WHERE ja."jobId" = i."jobId" AND ja."employeeId" = ${f.technician})` : Prisma.empty}
        GROUP BY 1`;
      const inv = new Map(invoiced.map((r) => [r.m, r]));
      const col = new Map(collected.map((r) => [r.m, r.collected]));
      const rows = monthsBetween(f.from, f.to).map((m) => ({ month: m, invoiced: Math.round(num(inv.get(m)?.invoiced)), collected: Math.round(num(col.get(m))), invoices: num(inv.get(m)?.count) }));
      return {
        key, title: def.title, description: "Invoiced revenue (by invoice date) alongside cash collected (by payment date).",
        columns: [{ key: "month", label: "Month", format: "text" }, { key: "invoices", label: "Invoices", format: "number", align: "right" }, { key: "invoiced", label: "Invoiced", format: "money", align: "right" }, { key: "collected", label: "Collected", format: "money", align: "right" }],
        rows,
        totals: { month: "Total", invoices: rows.reduce((s, r) => s + r.invoices, 0), invoiced: rows.reduce((s, r) => s + r.invoiced, 0), collected: rows.reduce((s, r) => s + r.collected, 0) },
        chart: { kind: "bar", xKey: "month", series: [{ key: "invoiced", label: "Invoiced", format: "money" }, { key: "collected", label: "Collected", format: "money" }] },
        supports: ["from", "to", "customer", "technician", "jobType", "city", "state", "postalCode", "tag", "status"],
      };
    }

    case "services": {
      const r = await db.$queryRaw<{ name: string; revenue: number; jobs: number }[]>`
        SELECT COALESCE(jt.name, 'No job type') AS name, SUM(i."totalCents")::float8 AS revenue, COUNT(DISTINCT i.id)::int AS jobs
        FROM ${INVOICE_FROM} LEFT JOIN job_types jt ON jt.id = j."jobTypeId" WHERE ${invoiceConds(f, tenantId)} GROUP BY 1 ORDER BY revenue DESC`;
      const total = r.reduce((s, x) => s + num(x.revenue), 0);
      return {
        key, title: def.title, description: "Invoiced revenue grouped by the job type of the linked job.",
        columns: [{ key: "name", label: "Service type", format: "text" }, { key: "jobs", label: "Invoices", format: "number", align: "right" }, { key: "revenue", label: "Revenue", format: "money", align: "right" }, { key: "share", label: "Share", format: "percent", align: "right" }],
        rows: r.map((x) => ({ name: x.name, jobs: x.jobs, revenue: Math.round(num(x.revenue)), share: total ? num(x.revenue) / total : 0 })),
        totals: { name: "Total", jobs: r.reduce((s, x) => s + x.jobs, 0), revenue: Math.round(total), share: 1 },
        chart: { kind: "pie", xKey: "name", series: [{ key: "revenue", label: "Revenue", format: "money" }] },
        supports: ["from", "to", "customer", "technician", "jobType", "city", "state", "postalCode", "tag", "status"],
      };
    }

    case "customers_revenue": {
      const r = await db.$queryRaw<{ id: string; name: string; revenue: number; invoices: number; paid: number }[]>`
        SELECT c.id, c."displayName" AS name, SUM(i."totalCents")::float8 AS revenue, COUNT(*)::int AS invoices, SUM(i."amountPaidCents")::float8 AS paid
        FROM ${INVOICE_FROM} WHERE ${invoiceConds(f, tenantId)} GROUP BY c.id, c."displayName" ORDER BY revenue DESC LIMIT 100`;
      return {
        key, title: def.title, description: "Top customers by invoiced revenue.",
        columns: [{ key: "name", label: "Customer", format: "text" }, { key: "invoices", label: "Invoices", format: "number", align: "right" }, { key: "revenue", label: "Invoiced", format: "money", align: "right" }, { key: "paid", label: "Paid", format: "money", align: "right" }],
        rows: r.map((x) => ({ id: x.id, name: x.name, invoices: x.invoices, revenue: Math.round(num(x.revenue)), paid: Math.round(num(x.paid)) })),
        chart: { kind: "bar", xKey: "name", horizontal: true, series: [{ key: "revenue", label: "Invoiced", format: "money" }] },
        supports: ["from", "to", "customer", "technician", "jobType", "city", "state", "postalCode", "tag", "status"],
      };
    }

    case "technicians": {
      const r = await db.$queryRaw<{ id: string; name: string; revenue: number; jobs: number }[]>`
        WITH inv AS (SELECT i.id, i."totalCents", i."jobId" FROM ${INVOICE_FROM} WHERE ${invoiceConds(f, tenantId)} AND i."jobId" IS NOT NULL),
        n AS (SELECT "jobId", COUNT(*)::numeric AS c FROM job_assignees WHERE "tenantId" = ${tenantId} GROUP BY "jobId")
        SELECT e.id, e."firstName" || ' ' || e."lastName" AS name, SUM(inv."totalCents" / n.c)::float8 AS revenue, COUNT(DISTINCT inv."jobId")::int AS jobs
        FROM inv JOIN n ON n."jobId" = inv."jobId" JOIN job_assignees ja ON ja."jobId" = inv."jobId" AND ja."tenantId" = ${tenantId} JOIN employees e ON e.id = ja."employeeId" AND e."tenantId" = ${tenantId}
        ${f.technician ? Prisma.sql`WHERE e.id = ${f.technician}` : Prisma.empty}
        GROUP BY e.id, e."firstName", e."lastName" ORDER BY revenue DESC`;
      return {
        key, title: def.title, description: "Invoiced revenue from jobs the technician was assigned to. Revenue on jobs with several technicians is split equally.",
        columns: [{ key: "name", label: "Technician", format: "text" }, { key: "jobs", label: "Invoiced jobs", format: "number", align: "right" }, { key: "revenue", label: "Revenue", format: "money", align: "right" }, { key: "avg", label: "Avg per job", format: "money", align: "right" }],
        rows: r.map((x) => ({ id: x.id, name: x.name, jobs: x.jobs, revenue: Math.round(num(x.revenue)), avg: x.jobs ? Math.round(num(x.revenue) / x.jobs) : 0 })),
        chart: { kind: "bar", xKey: "name", series: [{ key: "revenue", label: "Revenue", format: "money" }] },
        supports: ["from", "to", "technician", "customer", "jobType", "city", "state", "postalCode", "tag", "status"],
        note: "Operational attribution only — not payroll or commission data.",
      };
    }

    case "jobs": {
      const conds: Prisma.Sql[] = [Prisma.sql`j."tenantId" = ${tenantId}`, Prisma.sql`j."deletedAt" IS NULL`, Prisma.sql`COALESCE(j."actualEnd", j."scheduledStart", j."createdAt") >= ${T(f.from)}`, Prisma.sql`COALESCE(j."actualEnd", j."scheduledStart", j."createdAt") < ${T(addDays(f.to, 1))}`];
      if (f.technician) conds.push(Prisma.sql`EXISTS (SELECT 1 FROM job_assignees ja WHERE ja."jobId" = j.id AND ja."employeeId" = ${f.technician})`);
      if (f.customer) conds.push(Prisma.sql`j."customerId" = ${f.customer}`);
      if (f.jobType) conds.push(Prisma.sql`j."jobTypeId" = ${f.jobType}`);
      if (f.status) conds.push(Prisma.sql`j.status = ${f.status}::"JobStatus"`);
      if (f.city) conds.push(Prisma.sql`lower(l.city) = lower(${f.city})`);
      if (f.state) conds.push(Prisma.sql`lower(l.state) = lower(${f.state})`);
      if (f.postalCode) conds.push(Prisma.sql`l."postalCode" LIKE ${f.postalCode + "%"}`);
      if (f.tag) conds.push(Prisma.sql`${f.tag} = ANY (c.tags)`);
      const r = await db.$queryRaw<{ name: string; total: number; completed: number; avg_minutes: number | null }[]>`
        SELECT COALESCE(jt.name, 'No job type') AS name, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE j.status = 'COMPLETED')::int AS completed,
          AVG(EXTRACT(EPOCH FROM (j."actualEnd" - j."actualStart")) / 60) FILTER (WHERE j."actualEnd" IS NOT NULL AND j."actualStart" IS NOT NULL)::float8 AS avg_minutes
        FROM jobs j JOIN customers c ON c.id = j."customerId" JOIN customer_locations l ON l.id = j."locationId" LEFT JOIN job_types jt ON jt.id = j."jobTypeId"
        WHERE ${Prisma.join(conds, " AND ")} GROUP BY 1 ORDER BY total DESC`;
      return {
        key, title: def.title, description: "Jobs by type, with completion and average on-site duration.",
        columns: [{ key: "name", label: "Job type", format: "text" }, { key: "total", label: "Jobs", format: "number", align: "right" }, { key: "completed", label: "Completed", format: "number", align: "right" }, { key: "rate", label: "Completion", format: "percent", align: "right" }, { key: "avgMinutes", label: "Avg minutes on site", format: "number", align: "right" }],
        rows: r.map((x) => ({ name: x.name, total: x.total, completed: x.completed, rate: x.total ? x.completed / x.total : 0, avgMinutes: x.avg_minutes == null ? null : Math.round(x.avg_minutes) })),
        totals: { name: "Total", total: r.reduce((s, x) => s + x.total, 0), completed: r.reduce((s, x) => s + x.completed, 0), rate: r.reduce((s, x) => s + x.total, 0) ? r.reduce((s, x) => s + x.completed, 0) / r.reduce((s, x) => s + x.total, 0) : 0, avgMinutes: null },
        chart: { kind: "stacked", xKey: "name", series: [{ key: "completed", label: "Completed", format: "number" }, { key: "total", label: "All jobs", format: "number" }] },
        supports: ["from", "to", "technician", "customer", "jobType", "status", "city", "state", "postalCode", "tag"],
      };
    }

    case "quotes": {
      const conds = quoteConds(f, tenantId);
      const r = await db.$queryRaw<{ m: string; created: number; sent: number; approved: number; declined: number; approved_value: number; sent_value: number }[]>`
        SELECT to_char(date_trunc('month', q."issueDate"), 'YYYY-MM') AS m, COUNT(*)::int AS created,
          COUNT(*) FILTER (WHERE q."sentAt" IS NOT NULL)::int AS sent,
          COUNT(*) FILTER (WHERE q.status IN ('APPROVED','CONVERTED'))::int AS approved,
          COUNT(*) FILTER (WHERE q.status = 'DECLINED')::int AS declined,
          COALESCE(SUM(q."totalCents") FILTER (WHERE q.status IN ('APPROVED','CONVERTED')), 0)::float8 AS approved_value,
          COALESCE(SUM(q."totalCents") FILTER (WHERE q."sentAt" IS NOT NULL), 0)::float8 AS sent_value
        FROM quotes q JOIN customers c ON c.id = q."customerId" LEFT JOIN customer_locations l ON l.id = q."locationId" WHERE ${conds} GROUP BY 1 ORDER BY 1`;
      const rows = r.map((x) => ({ month: x.m, created: x.created, sent: x.sent, approved: x.approved, declined: x.declined, rate: x.sent ? x.approved / x.sent : 0, approvedValue: Math.round(num(x.approved_value)) }));
      const sent = rows.reduce((s, x) => s + x.sent, 0), approved = rows.reduce((s, x) => s + x.approved, 0);
      return {
        key, title: def.title, description: "Quotes issued, sent, approved and declined; conversion = approved ÷ sent.",
        columns: [{ key: "month", label: "Month", format: "text" }, { key: "created", label: "Created", format: "number", align: "right" }, { key: "sent", label: "Sent", format: "number", align: "right" }, { key: "approved", label: "Approved", format: "number", align: "right" }, { key: "declined", label: "Declined", format: "number", align: "right" }, { key: "rate", label: "Conversion", format: "percent", align: "right" }, { key: "approvedValue", label: "Approved value", format: "money", align: "right" }],
        rows,
        totals: { month: "Total", created: rows.reduce((s, x) => s + x.created, 0), sent, approved, declined: rows.reduce((s, x) => s + x.declined, 0), rate: sent ? approved / sent : 0, approvedValue: rows.reduce((s, x) => s + x.approvedValue, 0) },
        chart: { kind: "bar", xKey: "month", series: [{ key: "sent", label: "Sent", format: "number" }, { key: "approved", label: "Approved", format: "number" }] },
        supports: ["from", "to", "customer", "salesperson", "city", "state", "postalCode", "tag"],
      };
    }

    case "salespeople": {
      const conds = quoteConds(f, tenantId);
      const r = await db.$queryRaw<{ id: string | null; name: string; created: number; sent: number; approved: number; sent_value: number; approved_value: number }[]>`
        SELECT e.id, COALESCE(e."firstName" || ' ' || e."lastName", 'Unassigned') AS name, COUNT(*)::int AS created,
          COUNT(*) FILTER (WHERE q."sentAt" IS NOT NULL)::int AS sent, COUNT(*) FILTER (WHERE q.status IN ('APPROVED','CONVERTED'))::int AS approved,
          COALESCE(SUM(q."totalCents") FILTER (WHERE q."sentAt" IS NOT NULL),0)::float8 AS sent_value, COALESCE(SUM(q."totalCents") FILTER (WHERE q.status IN ('APPROVED','CONVERTED')),0)::float8 AS approved_value
        FROM quotes q JOIN customers c ON c.id = q."customerId" LEFT JOIN customer_locations l ON l.id = q."locationId" LEFT JOIN employees e ON e.id = q."salespersonId" AND e."tenantId" = ${tenantId}
        WHERE ${conds} GROUP BY e.id, e."firstName", e."lastName" ORDER BY approved_value DESC`;
      return {
        key, title: def.title, description: "Quote activity and approved value per salesperson.",
        columns: [{ key: "name", label: "Salesperson", format: "text" }, { key: "created", label: "Quotes", format: "number", align: "right" }, { key: "sent", label: "Sent", format: "number", align: "right" }, { key: "approved", label: "Approved", format: "number", align: "right" }, { key: "rate", label: "Close rate", format: "percent", align: "right" }, { key: "approvedValue", label: "Approved value", format: "money", align: "right" }],
        rows: r.map((x) => ({ id: x.id, name: x.name, created: x.created, sent: x.sent, approved: x.approved, rate: x.sent ? x.approved / x.sent : 0, approvedValue: Math.round(num(x.approved_value)) })),
        chart: { kind: "bar", xKey: "name", series: [{ key: "approvedValue", label: "Approved value", format: "money" }] },
        supports: ["from", "to", "customer", "salesperson", "city", "state", "postalCode", "tag"],
      };
    }

    case "lead_sources": {
      const conds: Prisma.Sql[] = [Prisma.sql`ld."tenantId" = ${tenantId}`, Prisma.sql`ld."deletedAt" IS NULL`, Prisma.sql`ld."createdAt" >= ${T(f.from)}`, Prisma.sql`ld."createdAt" < ${T(addDays(f.to, 1))}`];
      if (f.leadSource) conds.push(Prisma.sql`lower(ld.source) = lower(${f.leadSource})`);
      if (f.salesperson) conds.push(Prisma.sql`ld."assignedToId" = ${f.salesperson}`);
      if (f.city) conds.push(Prisma.sql`lower(ld.city) = lower(${f.city})`);
      if (f.state) conds.push(Prisma.sql`lower(ld.state) = lower(${f.state})`);
      if (f.postalCode) conds.push(Prisma.sql`ld."postalCode" LIKE ${f.postalCode + "%"}`);
      const r = await db.$queryRaw<{ source: string; leads: number; won: number; lost: number; value: number }[]>`
        SELECT COALESCE(NULLIF(ld.source, ''), 'Unknown') AS source, COUNT(*)::int AS leads, COUNT(*) FILTER (WHERE ld.status = 'WON')::int AS won, COUNT(*) FILTER (WHERE ld.status = 'LOST')::int AS lost, COALESCE(SUM(ld."estimatedValueCents"),0)::float8 AS value
        FROM leads ld WHERE ${Prisma.join(conds, " AND ")} GROUP BY 1 ORDER BY leads DESC`;
      return {
        key, title: def.title, description: "Where leads come from and how many convert.",
        columns: [{ key: "source", label: "Source", format: "text" }, { key: "leads", label: "Leads", format: "number", align: "right" }, { key: "won", label: "Won", format: "number", align: "right" }, { key: "lost", label: "Lost", format: "number", align: "right" }, { key: "rate", label: "Win rate", format: "percent", align: "right" }, { key: "value", label: "Est. value", format: "money", align: "right" }],
        rows: r.map((x) => ({ source: x.source, leads: x.leads, won: x.won, lost: x.lost, rate: x.leads ? x.won / x.leads : 0, value: Math.round(num(x.value)) })),
        chart: { kind: "bar", xKey: "source", series: [{ key: "leads", label: "Leads", format: "number" }, { key: "won", label: "Won", format: "number" }] },
        supports: ["from", "to", "salesperson", "leadSource", "city", "state", "postalCode"],
      };
    }

    case "receivables": {
      const asOf = D(f.to);
      const conds: Prisma.Sql[] = [Prisma.sql`i."tenantId" = ${tenantId}`, Prisma.sql`i.status IN ('OPEN','SENT','VIEWED','PARTIALLY_PAID')`, Prisma.sql`i."balanceCents" > 0`];
      if (f.customer) conds.push(Prisma.sql`i."customerId" = ${f.customer}`);
      if (f.city) conds.push(Prisma.sql`lower(l.city) = lower(${f.city})`);
      if (f.state) conds.push(Prisma.sql`lower(l.state) = lower(${f.state})`);
      if (f.postalCode) conds.push(Prisma.sql`l."postalCode" LIKE ${f.postalCode + "%"}`);
      if (f.tag) conds.push(Prisma.sql`${f.tag} = ANY (c.tags)`);
      const r = await db.$queryRaw<{ id: string; name: string; current: number; d30: number; d60: number; d90: number; d90p: number; total: number }[]>`
        SELECT c.id, c."displayName" AS name,
          COALESCE(SUM(i."balanceCents") FILTER (WHERE i."dueDate" >= ${asOf}),0)::float8 AS current,
          COALESCE(SUM(i."balanceCents") FILTER (WHERE i."dueDate" < ${asOf} AND i."dueDate" >= ${asOf}::date - 30),0)::float8 AS d30,
          COALESCE(SUM(i."balanceCents") FILTER (WHERE i."dueDate" < ${asOf}::date - 30 AND i."dueDate" >= ${asOf}::date - 60),0)::float8 AS d60,
          COALESCE(SUM(i."balanceCents") FILTER (WHERE i."dueDate" < ${asOf}::date - 60 AND i."dueDate" >= ${asOf}::date - 90),0)::float8 AS d90,
          COALESCE(SUM(i."balanceCents") FILTER (WHERE i."dueDate" < ${asOf}::date - 90),0)::float8 AS d90p,
          SUM(i."balanceCents")::float8 AS total
        FROM invoices i JOIN customers c ON c.id = i."customerId" LEFT JOIN customer_locations l ON l.id = i."locationId" WHERE ${Prisma.join(conds, " AND ")} GROUP BY c.id, c."displayName" ORDER BY total DESC LIMIT 200`;
      const rows = r.map((x) => ({ id: x.id, name: x.name, current: Math.round(x.current), d30: Math.round(x.d30), d60: Math.round(x.d60), d90: Math.round(x.d90), d90p: Math.round(x.d90p), total: Math.round(x.total) }));
      const sum = (k: "current" | "d30" | "d60" | "d90" | "d90p" | "total") => rows.reduce((s, x) => s + x[k], 0);
      return {
        key, title: def.title, description: `Open invoice balances by days past due, as of ${f.to}.`,
        columns: [{ key: "name", label: "Customer", format: "text" }, { key: "current", label: "Current", format: "money", align: "right" }, { key: "d30", label: "1–30", format: "money", align: "right" }, { key: "d60", label: "31–60", format: "money", align: "right" }, { key: "d90", label: "61–90", format: "money", align: "right" }, { key: "d90p", label: "90+", format: "money", align: "right" }, { key: "total", label: "Total", format: "money", align: "right" }],
        rows,
        totals: { name: "Total", current: sum("current"), d30: sum("d30"), d60: sum("d60"), d90: sum("d90"), d90p: sum("d90p"), total: sum("total") },
        chart: { kind: "bar", xKey: "bucket", series: [{ key: "amount", label: "Outstanding", format: "money" }] },
        supports: ["to", "customer", "city", "state", "postalCode", "tag"],
        note: "Chart buckets are summarised from the table totals.",
      };
    }

    case "payments": {
      const conds: Prisma.Sql[] = [Prisma.sql`p."tenantId" = ${tenantId}`, Prisma.sql`p.status = 'SUCCEEDED'`, Prisma.sql`p."receivedAt" >= ${T(f.from)}`, Prisma.sql`p."receivedAt" < ${T(addDays(f.to, 1))}`];
      if (f.customer) conds.push(Prisma.sql`p."customerId" = ${f.customer}`);
      if (f.city || f.state || f.postalCode || f.tag) {
        if (f.city) conds.push(Prisma.sql`lower(l.city) = lower(${f.city})`);
        if (f.state) conds.push(Prisma.sql`lower(l.state) = lower(${f.state})`);
        if (f.postalCode) conds.push(Prisma.sql`l."postalCode" LIKE ${f.postalCode + "%"}`);
        if (f.tag) conds.push(Prisma.sql`${f.tag} = ANY (c.tags)`);
      }
      const r = await db.$queryRaw<{ method: string; count: number; amount: number }[]>`
        SELECT p.method::text AS method, COUNT(*)::int AS count, SUM(p."amountCents")::float8 AS amount
        FROM payments p JOIN invoices i ON i.id = p."invoiceId" JOIN customers c ON c.id = p."customerId" LEFT JOIN customer_locations l ON l.id = i."locationId"
        WHERE ${Prisma.join(conds, " AND ")} GROUP BY 1 ORDER BY amount DESC`;
      const total = r.reduce((s, x) => s + num(x.amount), 0);
      return {
        key, title: def.title, description: "Collected payments by method.",
        columns: [{ key: "method", label: "Method", format: "text" }, { key: "count", label: "Payments", format: "number", align: "right" }, { key: "amount", label: "Amount", format: "money", align: "right" }, { key: "share", label: "Share", format: "percent", align: "right" }],
        rows: r.map((x) => ({ method: x.method.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()), count: x.count, amount: Math.round(num(x.amount)), share: total ? num(x.amount) / total : 0 })),
        totals: { method: "Total", count: r.reduce((s, x) => s + x.count, 0), amount: Math.round(total), share: 1 },
        chart: { kind: "pie", xKey: "method", series: [{ key: "amount", label: "Amount", format: "money" }] },
        supports: ["from", "to", "customer", "city", "state", "postalCode", "tag"],
      };
    }

    case "maintenance": {
      const r = await db.$queryRaw<{ status: string; count: number; value: number; visits_included: number; visits_done: number }[]>`
        SELECT CASE WHEN a.status = 'CANCELLED' THEN 'Cancelled' WHEN a."startDate" > CURRENT_DATE THEN 'Pending' WHEN a."renewalDate" < CURRENT_DATE THEN 'Expired' WHEN a."renewalDate" <= CURRENT_DATE + 45 THEN 'Expiring' ELSE 'Active' END AS status,
          COUNT(*)::int AS count, COALESCE(SUM(a."priceCents"),0)::float8 AS value, COALESCE(SUM(a."includedVisits"),0)::int AS visits_included,
          COALESCE(SUM((SELECT COUNT(*) FROM maintenance_visits v WHERE v."agreementId" = a.id AND v.status = 'COMPLETED')),0)::int AS visits_done
        FROM maintenance_agreements a JOIN customers c ON c.id = a."customerId" LEFT JOIN customer_locations l ON l.id = a."locationId"
        WHERE a."tenantId" = ${tenantId} AND a."deletedAt" IS NULL ${f.customer ? Prisma.sql`AND a."customerId" = ${f.customer}` : Prisma.empty}
        ${f.city ? Prisma.sql`AND lower(l.city) = lower(${f.city})` : Prisma.empty} ${f.state ? Prisma.sql`AND lower(l.state) = lower(${f.state})` : Prisma.empty} ${f.postalCode ? Prisma.sql`AND l."postalCode" LIKE ${f.postalCode + "%"}` : Prisma.empty} ${f.tag ? Prisma.sql`AND ${f.tag} = ANY (c.tags)` : Prisma.empty}
        GROUP BY 1 ORDER BY count DESC`;
      return {
        key, title: def.title, description: "Agreements by status with contract value and visit completion (current snapshot).",
        columns: [{ key: "status", label: "Status", format: "text" }, { key: "count", label: "Agreements", format: "number", align: "right" }, { key: "value", label: "Contract value", format: "money", align: "right" }, { key: "visitsIncluded", label: "Visits included", format: "number", align: "right" }, { key: "visitsDone", label: "Visits completed", format: "number", align: "right" }],
        rows: r.map((x) => ({ status: x.status, count: x.count, value: Math.round(num(x.value)), visitsIncluded: x.visits_included, visitsDone: x.visits_done })),
        chart: { kind: "pie", xKey: "status", series: [{ key: "count", label: "Agreements", format: "number" }] },
        supports: ["customer", "city", "state", "postalCode", "tag"],
      };
    }

    case "new_customers": {
      const conds: Prisma.Sql[] = [Prisma.sql`c."tenantId" = ${tenantId}`, Prisma.sql`c."createdAt" >= ${T(f.from)}`, Prisma.sql`c."createdAt" < ${T(addDays(f.to, 1))}`];
      if (f.tag) conds.push(Prisma.sql`${f.tag} = ANY (c.tags)`);
      if (f.leadSource) conds.push(Prisma.sql`lower(c."referralSource") = lower(${f.leadSource})`);
      if (f.city || f.state || f.postalCode) conds.push(Prisma.sql`EXISTS (SELECT 1 FROM customer_locations l WHERE l."customerId" = c.id ${f.city ? Prisma.sql`AND lower(l.city) = lower(${f.city})` : Prisma.empty} ${f.state ? Prisma.sql`AND lower(l.state) = lower(${f.state})` : Prisma.empty} ${f.postalCode ? Prisma.sql`AND l."postalCode" LIKE ${f.postalCode + "%"}` : Prisma.empty})`);
      const r = await db.$queryRaw<{ m: string; count: number; commercial: number }[]>`
        SELECT to_char(date_trunc('month', c."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}), 'YYYY-MM') AS m, COUNT(*)::int AS count, COUNT(*) FILTER (WHERE c.type = 'COMMERCIAL')::int AS commercial
        FROM customers c WHERE ${Prisma.join(conds, " AND ")} GROUP BY 1`;
      const by = new Map(r.map((x) => [x.m, x]));
      const rows = monthsBetween(f.from, f.to).map((m) => ({ month: m, count: by.get(m)?.count ?? 0, commercial: by.get(m)?.commercial ?? 0, residential: (by.get(m)?.count ?? 0) - (by.get(m)?.commercial ?? 0) }));
      return {
        key, title: def.title, description: "Customers added per month.",
        columns: [{ key: "month", label: "Month", format: "text" }, { key: "residential", label: "Residential", format: "number", align: "right" }, { key: "commercial", label: "Commercial", format: "number", align: "right" }, { key: "count", label: "Total", format: "number", align: "right" }],
        rows, totals: { month: "Total", residential: rows.reduce((s, x) => s + x.residential, 0), commercial: rows.reduce((s, x) => s + x.commercial, 0), count: rows.reduce((s, x) => s + x.count, 0) },
        chart: { kind: "stacked", xKey: "month", series: [{ key: "residential", label: "Residential", format: "number" }, { key: "commercial", label: "Commercial", format: "number" }] },
        supports: ["from", "to", "tag", "leadSource", "city", "state", "postalCode"],
      };
    }
  }
}

function quoteConds(f: ReportFilters, tenantId: string): Prisma.Sql {
  const c: Prisma.Sql[] = [Prisma.sql`q."tenantId" = ${tenantId}`, Prisma.sql`q."deletedAt" IS NULL`, Prisma.sql`q."issueDate" BETWEEN ${D(f.from)} AND ${D(f.to)}`];
  if (f.customer) c.push(Prisma.sql`q."customerId" = ${f.customer}`);
  if (f.salesperson) c.push(Prisma.sql`q."salespersonId" = ${f.salesperson}`);
  if (f.city) c.push(Prisma.sql`lower(l.city) = lower(${f.city})`);
  if (f.state) c.push(Prisma.sql`lower(l.state) = lower(${f.state})`);
  if (f.postalCode) c.push(Prisma.sql`l."postalCode" LIKE ${f.postalCode + "%"}`);
  if (f.tag) c.push(Prisma.sql`${f.tag} = ANY (c.tags)`);
  return Prisma.join(c, " AND ");
}

/** Receivables chart data derived from the aging table totals. */
export function agingChart(result: ReportResult): Record<string, string | number>[] {
  const t = result.totals ?? {};
  return [
    { bucket: "Current", amount: Number(t.current ?? 0) },
    { bucket: "1–30", amount: Number(t.d30 ?? 0) },
    { bucket: "31–60", amount: Number(t.d60 ?? 0) },
    { bucket: "61–90", amount: Number(t.d90 ?? 0) },
    { bucket: "90+", amount: Number(t.d90p ?? 0) },
  ];
}

// ─── CSV export ─────────────────────────────────────────────────────────────────────

function csvCell(v: string | number | null | undefined): string {
  if (v == null) return "";
  let s = String(v);
  // Neutralise spreadsheet formula injection from user-controlled text.
  if (/^[=+\-@\t\r]/.test(s) && typeof v === "string") s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function reportToCsv(r: ReportResult): string {
  const fmt = (v: string | number | null, format: ColumnFormat) => {
    if (v == null) return "";
    if (format === "money") return (Number(v) / 100).toFixed(2);
    if (format === "percent") return (Number(v) * 100).toFixed(1) + "%";
    return v;
  };
  const lines = [r.columns.map((c) => csvCell(c.label)).join(",")];
  for (const row of r.rows) lines.push(r.columns.map((c) => csvCell(fmt(row[c.key] ?? null, c.format))).join(","));
  if (r.totals) lines.push(r.columns.map((c) => csvCell(fmt(r.totals![c.key] ?? null, c.format))).join(","));
  return lines.join("\r\n") + "\r\n";
}

// ─── Financial overview (operational) ──────────────────────────────────────────────────

export async function financialOverview(ctx: Ctx, f: ReportFilters) {
  requirePermission(ctx, "financials.view");
  const tenantId = ctx.tenantId;
  const tz = await tenantTimezone(ctx.db);
  const T = (dateKey: string) => zonedToUtc(dateKey, 0, tz);
  const [inv, coll, open, past, quotesOut, quotesApproved, jobsDone, expenses] = await Promise.all([
    ctx.db.invoice.aggregate({ where: { status: { notIn: ["DRAFT", "VOID"] }, issueDate: { gte: D(f.from), lte: D(f.to) } }, _sum: { totalCents: true }, _count: true }),
    ctx.db.payment.aggregate({ where: { status: "SUCCEEDED", receivedAt: { gte: T(f.from), lt: T(addDays(f.to, 1)) } }, _sum: { amountCents: true } }),
    ctx.db.invoice.aggregate({ where: { status: { in: ["OPEN", "SENT", "VIEWED", "PARTIALLY_PAID"] }, balanceCents: { gt: 0 } }, _sum: { balanceCents: true }, _count: true }),
    ctx.db.invoice.aggregate({ where: { status: { in: ["OPEN", "SENT", "VIEWED", "PARTIALLY_PAID"] }, balanceCents: { gt: 0 }, dueDate: { lt: new Date(`${localDateKey(new Date(), await tenantTimezone(ctx.db))}T00:00:00.000Z`) } }, _sum: { balanceCents: true }, _count: true }),
    ctx.db.quote.aggregate({ where: { deletedAt: null, status: { in: ["SENT", "VIEWED"] } }, _sum: { totalCents: true }, _count: true }),
    ctx.db.quote.aggregate({ where: { deletedAt: null, status: { in: ["APPROVED", "CONVERTED"] }, approvedAt: { gte: T(f.from), lt: T(addDays(f.to, 1)) } }, _sum: { totalCents: true }, _count: true }),
    ctx.db.job.count({ where: { deletedAt: null, status: "COMPLETED", actualEnd: { gte: T(f.from), lt: T(addDays(f.to, 1)) } } }),
    can(ctx, "expenses.view") ? ctx.db.expense.aggregate({ where: { deletedAt: null, expenseDate: { gte: D(f.from), lte: D(f.to) } }, _sum: { amountCents: true } }) : null,
  ]);
  const revenue = inv._sum.totalCents ?? 0;
  void tenantId;
  return {
    revenueCents: revenue,
    invoiceCount: inv._count,
    collectedCents: coll._sum.amountCents ?? 0,
    outstandingCents: open._sum.balanceCents ?? 0,
    outstandingCount: open._count,
    pastDueCents: past._sum.balanceCents ?? 0,
    pastDueCount: past._count,
    quotesOutstandingCents: quotesOut._sum.totalCents ?? 0,
    quotesOutstandingCount: quotesOut._count,
    quotesApprovedCents: quotesApproved._sum.totalCents ?? 0,
    quotesApprovedCount: quotesApproved._count,
    avgTicketCents: inv._count ? Math.round(revenue / inv._count) : 0,
    jobsCompleted: jobsDone,
    expensesCents: expenses ? (expenses._sum.amountCents ?? 0) : null,
  };
}
