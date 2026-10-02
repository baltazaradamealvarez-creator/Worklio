import { beforeAll, describe, expect, it } from "vitest";
import { addDays, subDays } from "date-fns";
import { hashPassword, validatePasswordStrength, verifyPassword } from "@/server/auth/password";
import { authenticate, createSession, destroyAllSessions, destroySession, resolveSession } from "@/server/auth/session";
import { loadImpersonationContext } from "@/server/auth/context";
import { platformDb } from "@/server/db";
import { acceptInvitation, getInvitationByToken, inviteUser, requestPasswordReset, resetPassword } from "@/server/domain/users";
import { provisionTenant, reissueOwnerInvitation, setTenantStatus, startImpersonation, stopImpersonation, ensureDefaultPlans } from "@/server/domain/tenants";
import * as customers from "@/server/domain/customers";
import { hashToken } from "@/server/security/tokens";
import { createTestTenant, email, installProviders, type TestTenant } from "../helpers/fixtures";

const admin = { userId: "platform-admin-1", name: "Platform Admin" };
let n = 0;
const uniq = () => `${Date.now()}-${++n}`;

beforeAll(async () => {
  installProviders();
  await ensureDefaultPlans();
});

describe("passwords", () => {
  it("hashes with scrypt, verifies, and never stores plaintext", async () => {
    const h = await hashPassword("Correct-Horse-9");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(h).not.toContain("Correct-Horse-9");
    expect(await verifyPassword("Correct-Horse-9", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(await verifyPassword("anything", null)).toBe(false);
    expect(await hashPassword("Correct-Horse-9")).not.toBe(h); // salted
  });
  it("enforces a minimum strength policy", () => {
    expect(validatePasswordStrength("short")).toMatch(/at least/);
    expect(validatePasswordStrength("aaaaaaaaaaaa")).toBeTruthy();
    expect(validatePasswordStrength("password1234")).toBeTruthy();
    expect(validatePasswordStrength("a-long-enough-passphrase")).toBeNull();
  });
});

describe("login & sessions", () => {
  let t: TestTenant;
  let userEmail: string;
  beforeAll(async () => {
    t = await createTestTenant("Auth");
    userEmail = (await platformDb().user.findUniqueOrThrow({ where: { id: t.owner.userId } })).email;
  });

  it("logs in with correct credentials, records the login, and issues an opaque hashed session", async () => {
    const res = await authenticate(userEmail, "Correct-Horse-9", { ip: `10.0.0.${n++}`, userAgent: "vitest" });
    expect(res.activeTenantId).toBe(t.tenantId);
    const stored = await platformDb().session.findFirstOrThrow({ where: { userId: t.owner.userId } });
    expect(stored.tokenHash).toBe(hashToken(res.token));
    expect(stored.tokenHash).not.toContain(res.token);
    expect((await resolveSession(res.token))?.userId).toBe(t.owner.userId);
    expect(await t.owner.db.auditLog.count({ where: { action: "auth.login" } })).toBeGreaterThan(0);
  });

  it("gives the same generic error for unknown users and wrong passwords", async () => {
    const wrong = await authenticate(userEmail, "nope-nope-nope", { ip: "10.1.0.1" }).catch((e) => e);
    const unknown = await authenticate(`ghost-${uniq()}@example.test`, "nope-nope-nope", { ip: "10.1.0.2" }).catch((e) => e);
    expect(wrong.message).toBe(unknown.message);
    expect(wrong.code).toBe("UNAUTHENTICATED");
  });

  it("locks the account after repeated failures and resets on success after expiry", async () => {
    const u = await t.as("SALES");
    const mail = (await platformDb().user.findUniqueOrThrow({ where: { id: u.userId } })).email;
    for (let i = 0; i < 8; i++) await authenticate(mail, "bad-password-x", { ip: `10.2.0.${i}` }).catch(() => undefined);
    await expect(authenticate(mail, "Correct-Horse-9", { ip: "10.2.1.1" })).rejects.toThrow(/Too many failed attempts/);
    await platformDb().user.update({ where: { id: u.userId }, data: { lockedUntil: subDays(new Date(), 1) } });
    await expect(authenticate(mail, "Correct-Horse-9", { ip: "10.2.1.2" })).resolves.toBeTruthy();
    expect((await platformDb().user.findUniqueOrThrow({ where: { id: u.userId } })).failedLoginCount).toBe(0);
  });

  it("throttles bursts per client IP", async () => {
    const ip = `10.3.${n++}.1`;
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => authenticate(`nobody${i}@example.test`, "x-x-x-x-x-x-x-x", { ip }).catch((e) => e.message)));
    expect(results.some((m) => /Too many requests/.test(m))).toBe(true);
  });

  it("expired and destroyed sessions stop working; deactivated users lose sessions", async () => {
    const { token } = await createSession(t.owner.userId, { ip: "1.2.3.4" }, t.tenantId);
    expect(await resolveSession(token)).not.toBeNull();
    await platformDb().session.updateMany({ where: { tokenHash: hashToken(token) }, data: { expiresAt: subDays(new Date(), 1) } });
    expect(await resolveSession(token)).toBeNull();
    const second = await createSession(t.owner.userId, {}, t.tenantId);
    await destroySession(second.token);
    expect(await resolveSession(second.token)).toBeNull();
    const third = await createSession(t.owner.userId, {}, t.tenantId);
    await platformDb().user.update({ where: { id: t.owner.userId }, data: { isActive: false } });
    expect(await resolveSession(third.token)).toBeNull();
    await platformDb().user.update({ where: { id: t.owner.userId }, data: { isActive: true } });
    await destroyAllSessions(t.owner.userId);
  });

  it("suspended companies cannot log in", async () => {
    const s = await createTestTenant("Suspended");
    const mail = (await platformDb().user.findUniqueOrThrow({ where: { id: s.owner.userId } })).email;
    await setTenantStatus(admin, s.tenantId, "SUSPENDED", "non-payment");
    await expect(authenticate(mail, "Correct-Horse-9", { ip: `10.4.${n++}.1` })).rejects.toThrow(/does not have access/);
    await setTenantStatus(admin, s.tenantId, "ACTIVE");
    await expect(authenticate(mail, "Correct-Horse-9", { ip: `10.4.${n++}.2` })).resolves.toBeTruthy();
  });
});

describe("invitations & onboarding a new company", () => {
  it("platform admin creates a company; the owner accepts the single-use invitation and gets full access", async () => {
    email.sent = [];
    const ownerEmail = `new-owner-${uniq()}@example.test`;
    const { tenantId, inviteUrl } = await provisionTenant(admin, { companyName: "Cool Air LLC", ownerName: "Pat Cooler", ownerEmail });
    const token = inviteUrl.split("/").pop()!;
    expect(email.sent.some((m) => m.to === ownerEmail)).toBe(true);
    const inv = await platformDb().invitation.findFirstOrThrow({ where: { tenantId } });
    expect(inv.tokenHash).toBe(hashToken(token)); // only the hash is stored
    expect(await getInvitationByToken(token)).toMatchObject({ companyName: "Cool Air LLC", roleName: "Company Owner" });

    const { userId } = await acceptInvitation(token, { name: "Pat Cooler", password: "a-long-enough-passphrase" });
    await expect(acceptInvitation(token, { name: "Pat Cooler", password: "a-long-enough-passphrase" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    const res = await authenticate(ownerEmail, "a-long-enough-passphrase", { ip: `10.5.${n++}.1` });
    expect(res.activeTenantId).toBe(tenantId);
    const { loadTenantContext } = await import("@/server/auth/context");
    const ctx = (await loadTenantContext(userId, tenantId))!;
    expect(ctx.roleKey).toBe("OWNER");
    expect(ctx.employeeId).not.toBeNull();
    // fresh tenant is seeded with roles, job types and pricebook categories, and is isolated
    expect(await ctx.db.role.count()).toBeGreaterThanOrEqual(10);
    expect(await ctx.db.jobType.count()).toBeGreaterThan(5);
    expect(await ctx.db.customer.count()).toBe(0);
    expect((await ctx.db.tenant.findFirstOrThrow({})).onboardingCompletedAt).toBeNull();
  });

  it("rejects expired, revoked and unknown invitations", async () => {
    const t = await createTestTenant("Invites");
    const role = await t.owner.db.role.findFirstOrThrow({ where: { key: "DISPATCHER" } });
    const { inviteUrl } = await inviteUser(t.owner, { email: `d-${uniq()}@example.test`, roleId: role.id });
    const token = inviteUrl.split("/").pop()!;
    await platformDb().invitation.updateMany({ where: { tenantId: t.tenantId, tokenHash: hashToken(token) }, data: { expiresAt: subDays(new Date(), 1) } });
    await expect(acceptInvitation(token, { name: "x y", password: "a-long-enough-passphrase" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(await getInvitationByToken(token)).toBeNull();
    await expect(acceptInvitation("A".repeat(43), { name: "x y", password: "a-long-enough-passphrase" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    const second = await inviteUser(t.owner, { email: `e-${uniq()}@example.test`, roleId: role.id });
    const tok2 = second.inviteUrl.split("/").pop()!;
    const row = await platformDb().invitation.findFirstOrThrow({ where: { tokenHash: hashToken(tok2) } });
    const { revokeInvitation } = await import("@/server/domain/users");
    await revokeInvitation(t.owner, row.id);
    await expect(acceptInvitation(tok2, { name: "x y", password: "a-long-enough-passphrase" })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("an existing Worklio user joining a second company must prove their password", async () => {
    const t1 = await createTestTenant("Multi1");
    const t2 = await createTestTenant("Multi2");
    const u = await platformDb().user.findUniqueOrThrow({ where: { id: t1.owner.userId } });
    const role = await t2.owner.db.role.findFirstOrThrow({ where: { key: "SALES" } });
    const { inviteUrl } = await inviteUser(t2.owner, { email: u.email, roleId: role.id });
    const token = inviteUrl.split("/").pop()!;
    await expect(acceptInvitation(token, { name: "x", password: "wrong-wrong-wrong" })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(acceptInvitation(token, { name: u.name, password: "Correct-Horse-9" })).resolves.toMatchObject({ tenantId: t2.tenantId });
    // two memberships, two fully separated tenants
    expect(await platformDb().membership.count({ where: { userId: u.id } })).toBe(2);
  });

  it("enforces plan user limits when inviting", async () => {
    const t = await createTestTenant("Limits");
    await platformDb().subscription.update({ where: { tenantId: t.tenantId }, data: { maxUsersOverride: 2 } });
    const role = await t.owner.db.role.findFirstOrThrow({ where: { key: "SALES" } });
    await inviteUser(t.owner, { email: `l1-${uniq()}@example.test`, roleId: role.id });
    await expect(inviteUser(t.owner, { email: `l2-${uniq()}@example.test`, roleId: role.id })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  });

  it("enforces plan customer limits", async () => {
    const t = await createTestTenant("CustLimit");
    await platformDb().subscription.update({ where: { tenantId: t.tenantId }, data: { maxCustomersOverride: 1 } });
    await customers.createCustomer(t.owner, { customer: { firstName: "A", lastName: "One" } });
    await expect(customers.createCustomer(t.owner, { customer: { firstName: "B", lastName: "Two" } })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  });
});

describe("password reset", () => {
  it("emails a single-use, expiring link, revokes sessions, and never reveals whether an account exists", async () => {
    const t = await createTestTenant("Reset");
    const u = await platformDb().user.findUniqueOrThrow({ where: { id: t.owner.userId } });
    const live = await createSession(u.id, {}, t.tenantId);
    email.sent = [];
    await requestPasswordReset(`ghost-${uniq()}@example.test`, { ip: `10.6.${n++}.1` }); // silent
    expect(email.sent).toHaveLength(0);
    await requestPasswordReset(u.email, { ip: `10.6.${n++}.2` });
    expect(email.sent).toHaveLength(1);
    const token = email.lastLink().split("/").pop()!;
    await resetPassword(token, "brand-new-passphrase-1");
    await expect(resetPassword(token, "another-passphrase-22")).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(await resolveSession(live.token)).toBeNull(); // old sessions revoked
    await expect(authenticate(u.email, "Correct-Horse-9", { ip: `10.6.${n++}.3` })).rejects.toBeTruthy();
    await expect(authenticate(u.email, "brand-new-passphrase-1", { ip: `10.6.${n++}.4` })).resolves.toBeTruthy();
  });

  it("rejects weak new passwords and expired tokens", async () => {
    const t = await createTestTenant("Reset2");
    const u = await platformDb().user.findUniqueOrThrow({ where: { id: t.owner.userId } });
    email.sent = [];
    await requestPasswordReset(u.email, { ip: `10.7.${n++}.1` });
    const token = email.lastLink().split("/").pop()!;
    await expect(resetPassword(token, "short")).rejects.toMatchObject({ code: "VALIDATION" });
    await platformDb().authToken.updateMany({ where: { tokenHash: hashToken(token) }, data: { expiresAt: subDays(new Date(), 1) } });
    await expect(resetPassword(token, "a-long-enough-passphrase")).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});

describe("platform admin: impersonation is explicit and audited", () => {
  it("requires a reason, is logged in both the platform and company audit trails, and tags every action", async () => {
    const t = await createTestTenant("Support");
    const adminUser = await platformDb().user.create({ data: { email: `admin-${uniq()}@example.test`, name: "Sam Support", passwordHash: "x", isPlatformAdmin: true } });
    const { token } = await createSession(adminUser.id, {}, null);
    const session = (await resolveSession(token))!;
    const actor = { userId: adminUser.id, name: adminUser.name, sessionId: session.id };

    await expect(startImpersonation(actor, t.tenantId, "hi")).rejects.toMatchObject({ code: "VALIDATION" });
    await startImpersonation(actor, t.tenantId, "Investigating ticket #4412");
    const after = (await resolveSession(token))!;
    expect(after.impersonatingTenantId).toBe(t.tenantId);

    const ctx = (await loadImpersonationContext(adminUser.id, t.tenantId, after.impersonationReason))!;
    expect(ctx.impersonator?.name).toBe("Sam Support");
    const c = await customers.createCustomer(ctx, { customer: { firstName: "Support", lastName: "Made" } });
    const audit = await t.owner.db.auditLog.findFirstOrThrow({ where: { entityId: c.id, action: "customer.created" } });
    expect(audit.impersonatorUserId).toBe(adminUser.id);
    const timeline = await t.owner.db.activity.findFirstOrThrow({ where: { entityId: c.id } });
    expect(timeline.actorName).toContain("platform support");

    await stopImpersonation(actor, t.tenantId);
    const trail = await t.owner.db.auditLog.findMany({ where: { action: { startsWith: "platform.impersonation" } } });
    expect(trail.map((a) => a.action).sort()).toEqual(["platform.impersonation_ended", "platform.impersonation_started"]);
    const platformTrail = await platformDb().auditLog.findMany({ where: { tenantId: null, action: "platform.impersonation_started", entityId: t.tenantId } });
    expect(platformTrail).toHaveLength(1);
    expect((await resolveSession(token))!.impersonatingTenantId).toBeNull();
  });

  it("non-admin users cannot impersonate", async () => {
    const t = await createTestTenant("NoImpersonate");
    expect(await loadImpersonationContext(t.owner.userId, t.tenantId, "x")).toBeNull();
  });

  it("owner invitations can be reissued by the platform and old links stop working", async () => {
    const { tenantId, inviteUrl } = await provisionTenant(admin, { companyName: "Reissue Co", ownerName: "Rex", ownerEmail: `rex-${uniq()}@example.test` });
    const fresh = await reissueOwnerInvitation(admin, tenantId);
    expect(fresh.inviteUrl).not.toBe(inviteUrl);
    await expect(acceptInvitation(inviteUrl.split("/").pop()!, { name: "Rex", password: "a-long-enough-passphrase" })).rejects.toBeTruthy();
    await expect(acceptInvitation(fresh.inviteUrl.split("/").pop()!, { name: "Rex", password: "a-long-enough-passphrase" })).resolves.toBeTruthy();
  });
});

void addDays;
