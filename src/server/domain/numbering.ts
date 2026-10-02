import type { Db } from "@/server/db";

export type SequenceKey = "JOB" | "QUOTE" | "INVOICE" | "AGREEMENT";

/**
 * Atomically allocate the next number for (tenant, key). Gap-free per tenant as long as the
 * caller's transaction commits; two tenants never share a counter. Must run inside `db.tx`.
 */
export async function nextSequence(db: Db, tenantId: string, key: SequenceKey, start: number): Promise<number> {
  const rows = await db.$queryRaw<{ value: number }[]>`
    INSERT INTO sequence_counters ("tenantId", "key", "nextValue")
    VALUES (${tenantId}, ${key}, ${start + 1})
    ON CONFLICT ("tenantId", "key")
    DO UPDATE SET "nextValue" = sequence_counters."nextValue" + 1
    RETURNING "nextValue" - 1 AS value`;
  const value = rows[0]?.value;
  if (value === undefined) throw new Error("Failed to allocate document number");
  return Number(value);
}

export async function nextDocumentNumber(db: Db, tenantId: string, key: SequenceKey): Promise<string> {
  const settings = await db.tenantSettings.findFirst({ where: {} });
  const cfg = {
    JOB: [settings?.jobPrefix ?? "JOB-", settings?.jobStartNumber ?? 1001],
    QUOTE: [settings?.quotePrefix ?? "Q-", settings?.quoteStartNumber ?? 1001],
    INVOICE: [settings?.invoicePrefix ?? "INV-", settings?.invoiceStartNumber ?? 1001],
    AGREEMENT: [settings?.agreementPrefix ?? "MA-", settings?.agreementStartNumber ?? 1001],
  }[key] as [string, number];
  const n = await nextSequence(db, tenantId, key, cfg[1]);
  return `${cfg[0]}${n}`;
}
