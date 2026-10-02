import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { platformDb } from "@/server/db";
import { createTestTenant, installProviders, type TestTenant } from "../helpers/fixtures";

/** These tests bypass the application layer entirely and talk to Postgres as the app role. */
const raw = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

describe("database-level tenant isolation (row-level security)", () => {
  let a: TestTenant;
  let b: TestTenant;

  beforeAll(async () => {
    installProviders();
    a = await createTestTenant("RLS-A");
    b = await createTestTenant("RLS-B");
    await a.owner.db.vendor.create({ data: { tenantId: a.tenantId, name: "Vendor of A" } });
    await b.owner.db.vendor.create({ data: { tenantId: b.tenantId, name: "Vendor of B" } });
  });
  afterAll(async () => {
    await raw.$disconnect();
  });

  it("the application database role is not a superuser and cannot bypass RLS", async () => {
    const [row] = await raw.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(row?.rolsuper).toBe(false);
    expect(row?.rolbypassrls).toBe(false);
  });

  it("returns zero rows when no tenant context is set (fails closed)", async () => {
    expect(await raw.$queryRaw`SELECT * FROM vendors`).toHaveLength(0);
    expect(await raw.$queryRaw`SELECT * FROM customers`).toHaveLength(0);
  });

  it("only exposes the current tenant's rows, even with hand-written SQL", async () => {
    const rows = await raw.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${a.tenantId}, true)`;
      return tx.$queryRaw<{ name: string }[]>`SELECT name FROM vendors`;
    });
    expect(rows.map((r) => r.name)).toEqual(["Vendor of A"]);
  });

  it("cannot read another tenant's row by primary key", async () => {
    const vb = await b.owner.db.vendor.findFirstOrThrow({});
    const rows = await raw.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${a.tenantId}, true)`;
      return tx.$queryRaw`SELECT * FROM vendors WHERE id = ${vb.id}`;
    });
    expect(rows).toHaveLength(0);
  });

  it("rejects writes into another tenant (WITH CHECK)", async () => {
    await expect(
      raw.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${a.tenantId}, true)`;
        await tx.$executeRaw`INSERT INTO vendors (id, "tenantId", name, "isActive", "createdAt", "updatedAt") VALUES ('x1', ${b.tenantId}, 'Injected', true, now(), now())`;
      }),
    ).rejects.toThrow();
  });

  it("cannot update or delete another tenant's rows", async () => {
    const result = await raw.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${a.tenantId}, true)`;
      const upd = await tx.$executeRaw`UPDATE vendors SET name = 'pwned' WHERE "tenantId" = ${b.tenantId}`;
      const del = await tx.$executeRaw`DELETE FROM vendors WHERE "tenantId" = ${b.tenantId}`;
      return { upd, del };
    });
    expect(result).toEqual({ upd: 0, del: 0 });
    expect(await b.owner.db.vendor.count()).toBe(1);
  });

  it("the bypass flag is not enabled by default and requires explicit setting", async () => {
    expect(await raw.$queryRaw`SELECT * FROM tenants`).toHaveLength(0);
    const rows = await raw.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${a.tenantId}, true)`;
      return tx.$queryRaw`SELECT id FROM tenants`;
    });
    expect(rows).toHaveLength(1);
  });

  it("every table with a tenantId column has RLS enabled, forced, and a policy", async () => {
    const rows = await platformDb().$queryRaw<{ table_name: string; rls: boolean; forced: boolean; policies: number }[]>`
      SELECT c.table_name, cl.relrowsecurity AS rls, cl.relforcerowsecurity AS forced,
        (SELECT COUNT(*)::int FROM pg_policies p WHERE p.tablename = c.table_name AND p.schemaname = 'public') AS policies
      FROM information_schema.columns c JOIN pg_class cl ON cl.relname = c.table_name AND cl.relnamespace = 'public'::regnamespace
      WHERE c.table_schema = 'public' AND c.column_name = 'tenantId'`;
    expect(rows.length).toBeGreaterThan(40);
    const bad = rows.filter((r) => !r.rls || !r.forced || r.policies < 1).map((r) => r.table_name);
    expect(bad).toEqual([]);
  });

  it("cross-tenant references are impossible: composite foreign keys reject them", async () => {
    const custB = await b.owner.db.customer.create({ data: { tenantId: b.tenantId, displayName: "B Customer" } });
    await expect(
      platformDb().$executeRaw`INSERT INTO customer_locations (id, "tenantId", "customerId", name, "addressLine1", city, state, "postalCode", country, "isPrimary", "billToCustomer", "createdAt", "updatedAt")
        VALUES ('loc-x', ${a.tenantId}, ${custB.id}, 'x', '1 st', 'c', 's', '1', 'US', false, true, now(), now())`,
    ).rejects.toThrow(/foreign key/i);
  });

  it("the audit log is append-only (no update, delete or truncate)", async () => {
    const rows = await a.owner.db.auditLog.findMany({ take: 1 });
    if (!rows.length) await a.owner.db.auditLog.create({ data: { tenantId: a.tenantId, action: "test.event" } });
    const row = await a.owner.db.auditLog.findFirstOrThrow({});
    await expect(a.owner.db.auditLog.update({ where: { id: row.id }, data: { action: "tampered" } })).rejects.toThrow();
    await expect(a.owner.db.auditLog.delete({ where: { id: row.id } })).rejects.toThrow();
    await expect(platformDb().$executeRaw`DELETE FROM audit_logs`).rejects.toThrow(/append-only|permission denied/i);
  });

  it("database constraints reject invalid money and time ranges", async () => {
    const { customer } = await (async () => ({ customer: await a.owner.db.customer.create({ data: { tenantId: a.tenantId, displayName: "C" } }) }))();
    await expect(
      platformDb().$executeRaw`INSERT INTO invoices (id, "tenantId", number, "customerId", status, "issueDate", "dueDate", "paymentTermsDays", "taxRateBp", "discountType", "discountValue", "depositRequiredCents", "subtotalCents", "discountCents", "taxCents", "totalCents", "amountPaidCents", "balanceCents", "createdAt", "updatedAt")
       VALUES ('inv-bad', ${a.tenantId}, 'X-1', ${customer.id}, 'DRAFT', '2026-01-10', '2026-01-01', 0, 0, 'NONE', 0, 0, 0, 0, 0, 0, 0, 0, now(), now())`,
    ).rejects.toThrow(/check constraint/i);
  });
});
