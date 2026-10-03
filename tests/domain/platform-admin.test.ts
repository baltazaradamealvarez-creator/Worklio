import { beforeAll, describe, expect, it } from "vitest";
import { platformDb } from "@/server/db";
import { decryptSecret, encryptSecret } from "@/server/security/secrets";
import { clearEmailSettings, emailSettingsSummary, loadEmailSettings, saveEmailSettings } from "@/server/domain/platform-settings";
import { listAllInvoices, listAllUsers, revenueByCompany, setUserActive } from "@/server/domain/platform-admin";
import { getEmailProvider } from "@/server/email/provider";
import { createTestTenant, installProviders } from "../helpers/fixtures";

const actor = { userId: "test-admin", name: "Test Admin" };

beforeAll(() => installProviders());

describe("secret storage", () => {
  it("round-trips and rejects tampering", () => {
    const blob = encryptSecret("re_supersecretkey123");
    expect(blob).not.toContain("supersecret");
    expect(decryptSecret(blob)).toBe("re_supersecretkey123");
    const bad = Buffer.from(blob, "base64"); bad[bad.length - 1] ^= 1;
    expect(decryptSecret(bad.toString("base64"))).toBeNull();
  });
});

describe("platform email settings", () => {
  it("stores the key encrypted, never exposes it, and takes precedence over the environment", async () => {
    await clearEmailSettings(actor);
    await saveEmailSettings(actor, { apiKey: "re_abcdefghijklmnop1234", from: "Worklio <no-reply@example.com>" });
    const row = await platformDb().platformSetting.findUniqueOrThrow({ where: { key: "email" } });
    expect(row.valueEnc).not.toContain("re_abcdefghijklmnop1234");
    const summary = await emailSettingsSummary();
    expect(JSON.stringify(summary)).not.toContain("abcdefghijklmnop");
    expect(summary).toMatchObject({ provider: "resend", source: "database", keyHint: "••••1234" });
    expect((await loadEmailSettings()).apiKey).toBe("re_abcdefghijklmnop1234");
    // updating the sender without re-entering the key keeps the key
    await saveEmailSettings(actor, { from: "Acme <hello@acme.test>" });
    expect(await loadEmailSettings()).toMatchObject({ apiKey: "re_abcdefghijklmnop1234", from: "Acme <hello@acme.test>" });
    await clearEmailSettings(actor);
    expect((await loadEmailSettings()).source).toBe("environment");
  });
  it("rejects malformed keys and addresses", async () => {
    await expect(saveEmailSettings(actor, { apiKey: "not-a-key", from: "Worklio <a@b.co>" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(saveEmailSettings(actor, { apiKey: "re_abcdefghijklmnop1234", from: "nonsense" })).rejects.toMatchObject({ code: "VALIDATION" });
    void getEmailProvider;
  });
});

describe("cross-company platform views", () => {
  it("lists users and invoices from every company and can deactivate a user", async () => {
    const a = await createTestTenant("PlatA");
    const b = await createTestTenant("PlatB");
    const users = await listAllUsers({ page: 1, pageSize: 500 });
    const ids = new Set(users.rows.map((u) => u.id));
    expect(ids.has(a.owner.userId) && ids.has(b.owner.userId)).toBe(true);
    const rev = await revenueByCompany();
    expect(rev.map((r) => r.id)).toEqual(expect.arrayContaining([a.tenantId, b.tenantId]));
    const inv = await listAllInvoices({ page: 1, tenantId: a.tenantId });
    expect(inv.rows.every((r) => r.tenant.id === a.tenantId)).toBe(true);
    await setUserActive(actor, b.owner.userId, false);
    expect((await platformDb().user.findUniqueOrThrow({ where: { id: b.owner.userId } })).isActive).toBe(false);
    await expect(setUserActive({ userId: a.owner.userId, name: "x" }, a.owner.userId, false)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});
