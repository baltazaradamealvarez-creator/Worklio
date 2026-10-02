import { addDays, addHours } from "date-fns";
import { z } from "zod";
import { platformDb, tenantDb } from "@/server/db";
import { ALL_PERMISSIONS, isPermission, type Permission } from "@/server/auth/permissions";
import { requirePermission, type Ctx } from "@/server/auth/context";
import { hashPassword, validatePasswordStrength, verifyPassword } from "@/server/auth/password";
import { destroyAllSessions } from "@/server/auth/session";
import { env } from "@/server/env";
import { AppError, conflict, forbidden, invalidState, notFound } from "@/server/errors";
import { generateToken, hashToken } from "@/server/security/tokens";
import { rateLimit } from "@/server/security/rate-limit";
import { email as emailSchema, optStr, parseInput, str } from "@/lib/validation";
import { invitationEmail, passwordResetEmail } from "@/server/email/templates";
import { deliverEmail, loadBranding } from "@/server/email/service";
import { getEmailProvider } from "@/server/email/provider";
import { fromAddress } from "@/server/email/service";
import type { Branding } from "@/server/email/layout";
import { audit } from "./shared";
import { assertWithinLimit } from "./limits";
import { INVITE_TTL_DAYS } from "./tenants";

// ─── Privilege-escalation guard ─────────────────────────────────────────────────

/** A user may only grant permissions they themselves hold (owners may grant anything). */
function assertCanGrant(ctx: Ctx, permissions: readonly string[]) {
  if (ctx.roleKey === "OWNER" || ctx.impersonator) return;
  const missing = permissions.filter((p) => !ctx.permissions.has(p));
  if (missing.length) throw forbidden("You can't grant permissions you don't have yourself.");
}

// ─── Invitations ──────────────────────────────────────────────────────────────

const inviteSchema = z.object({
  email: emailSchema,
  name: optStr(120),
  roleId: str(40),
  employeeId: optStr(40),
});

export async function inviteUser(ctx: Ctx, raw: unknown): Promise<{ inviteUrl: string }> {
  requirePermission(ctx, "users.manage");
  const input = parseInput(inviteSchema, raw);
  const role = await ctx.db.role.findFirst({ where: { id: input.roleId } });
  if (!role) throw notFound("Role");
  if (role.key === "OWNER" && ctx.roleKey !== "OWNER" && !ctx.impersonator) throw forbidden("Only a company owner can invite another owner.");
  assertCanGrant(ctx, role.permissions);

  const existingUser = await platformDb().user.findUnique({ where: { email: input.email } });
  if (existingUser) {
    const m = await ctx.db.membership.findFirst({ where: { userId: existingUser.id } });
    if (m) throw conflict("That person already has access to this company.");
  }
  if (input.employeeId) {
    const emp = await ctx.db.employee.findFirst({ where: { id: input.employeeId, deletedAt: null } });
    if (!emp) throw notFound("Employee");
    if (emp.membershipId) throw conflict("This employee already has a login.");
  }
  await assertWithinLimit(ctx, "users");

  const token = generateToken();
  const invitation = await ctx.db.tx(async (tx) => {
    // Supersede any prior pending invitation for the same address.
    await tx.invitation.updateMany({ where: { email: input.email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    const inv = await tx.invitation.create({
      data: {
        tenantId: ctx.tenantId,
        email: input.email,
        name: input.name ?? null,
        roleId: role.id,
        employeeId: input.employeeId ?? null,
        tokenHash: hashToken(token),
        invitedById: ctx.userId,
        expiresAt: addDays(new Date(), INVITE_TTL_DAYS),
      },
    });
    await audit(ctx, "user.invited", "Invitation", inv.id, { email: input.email, role: role.name }, tx);
    return inv;
  });

  const inviteUrl = `${env().APP_URL}/accept-invite/${token}`;
  const brand = await loadBranding(ctx.db, ctx.tenantId);
  await deliverEmail(ctx.db, ctx.tenantId, {
    template: "invitation",
    to: input.email,
    email: invitationEmail(brand, { inviteeName: input.name, inviterName: ctx.userName, roleName: role.name, url: inviteUrl, expiresInDays: INVITE_TTL_DAYS }),
    companyName: brand.companyName,
    sentById: ctx.userId,
  }).catch((e) => {
    // Invitation exists; surface the link so the admin can share it manually.
    if (e instanceof AppError) return;
    throw e;
  });
  void invitation;
  return { inviteUrl };
}

export async function revokeInvitation(ctx: Ctx, invitationId: string): Promise<void> {
  requirePermission(ctx, "users.manage");
  const inv = await ctx.db.invitation.findFirst({ where: { id: invitationId, acceptedAt: null } });
  if (!inv) throw notFound("Invitation");
  await ctx.db.tx(async (tx) => {
    await tx.invitation.update({ where: { id: inv.id }, data: { revokedAt: new Date() } });
    await audit(ctx, "user.invitation_revoked", "Invitation", inv.id, { email: inv.email }, tx);
  });
}

export async function getInvitationByToken(token: string) {
  const inv = await platformDb().invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { tenant: { select: { name: true, status: true } }, role: { select: { name: true } } },
  });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date() || inv.tenant.status === "SUSPENDED") return null;
  const existing = await platformDb().user.findUnique({ where: { email: inv.email }, select: { id: true } });
  return { email: inv.email, name: inv.name, companyName: inv.tenant.name, roleName: inv.role.name, hasAccount: !!existing };
}

const acceptSchema = z.object({ name: str(120), password: z.string().min(1).max(200) });

/** Accept an invitation: create/verify the user, create the membership, link/create the employee. */
export async function acceptInvitation(token: string, raw: unknown, meta: { ip?: string } = {}): Promise<{ userId: string; tenantId: string }> {
  await rateLimit(`invite:${meta.ip ?? "unknown"}`, 20, 15 * 60 * 1000);
  const input = parseInput(acceptSchema, raw);
  const db = platformDb();
  const inv = await db.invitation.findUnique({ where: { tokenHash: hashToken(token) }, include: { tenant: true, role: true } });
  if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt < new Date()) {
    throw invalidState("This invitation is no longer valid. Ask your administrator to send a new one.");
  }
  if (inv.tenant.status === "SUSPENDED") throw invalidState("This company account is currently suspended.");

  let user = await db.user.findUnique({ where: { email: inv.email } });
  if (user) {
    if (!(await verifyPassword(input.password, user.passwordHash))) {
      throw new AppError("UNAUTHENTICATED", "You already have a Worklio account — enter your existing password to join this company.");
    }
  } else {
    const weak = validatePasswordStrength(input.password);
    if (weak) throw new AppError("VALIDATION", weak, { password: weak });
    user = await db.user.create({
      data: { email: inv.email, name: input.name, passwordHash: await hashPassword(input.password), emailVerifiedAt: new Date() },
    });
  }
  const userId = user.id;

  await db.tx(async (tx) => {
    const membership = await tx.membership.upsert({
      where: { tenantId_userId: { tenantId: inv.tenantId, userId } },
      update: { status: "ACTIVE", roleId: inv.roleId },
      create: { tenantId: inv.tenantId, userId, roleId: inv.roleId },
    });
    if (inv.employeeId) {
      await tx.employee.update({ where: { id: inv.employeeId }, data: { membershipId: membership.id, status: "ACTIVE", email: inv.email } });
    } else {
      const existing = await tx.employee.findFirst({ where: { tenantId: inv.tenantId, membershipId: membership.id } });
      if (!existing) {
        const [first, ...rest] = (user!.name || input.name).split(/\s+/);
        await tx.employee.create({
          data: { tenantId: inv.tenantId, membershipId: membership.id, firstName: first || input.name, lastName: rest.join(" "), email: inv.email, status: "ACTIVE" },
        });
      }
    }
    await tx.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
    await tx.auditLog.create({
      data: { tenantId: inv.tenantId, actorUserId: userId, actorName: user!.name, action: "user.joined", entityType: "Membership", entityId: membership.id, metadata: { role: inv.role.name }, ip: meta.ip ?? null },
    });
  });
  return { userId, tenantId: inv.tenantId };
}

// ─── Membership & roles ───────────────────────────────────────────────────────

async function ownerCount(ctx: Ctx, excludingMembershipId?: string): Promise<number> {
  return ctx.db.membership.count({
    where: { status: "ACTIVE", role: { key: "OWNER" }, ...(excludingMembershipId ? { id: { not: excludingMembershipId } } : {}) },
  });
}

export async function changeMemberRole(ctx: Ctx, membershipId: string, roleId: string): Promise<void> {
  requirePermission(ctx, "users.manage");
  const [m, role] = await Promise.all([
    ctx.db.membership.findFirst({ where: { id: membershipId }, include: { role: true, user: true } }),
    ctx.db.role.findFirst({ where: { id: roleId } }),
  ]);
  if (!m) throw notFound("User");
  if (!role) throw notFound("Role");
  if ((role.key === "OWNER" || m.role.key === "OWNER") && ctx.roleKey !== "OWNER" && !ctx.impersonator) {
    throw forbidden("Only a company owner can change owner access.");
  }
  assertCanGrant(ctx, role.permissions);
  if (m.role.key === "OWNER" && role.key !== "OWNER" && (await ownerCount(ctx, m.id)) === 0) {
    throw invalidState("A company must keep at least one owner.");
  }
  await ctx.db.tx(async (tx) => {
    await tx.membership.update({ where: { id: m.id }, data: { roleId: role.id } });
    await audit(ctx, "user.role_changed", "Membership", m.id, { user: m.user.email, from: m.role.name, to: role.name }, tx);
  });
}

export async function setMemberStatus(ctx: Ctx, membershipId: string, status: "ACTIVE" | "SUSPENDED"): Promise<void> {
  requirePermission(ctx, "users.manage");
  const m = await ctx.db.membership.findFirst({ where: { id: membershipId }, include: { role: true, user: true } });
  if (!m) throw notFound("User");
  if (m.id === ctx.membershipId) throw invalidState("You can't suspend your own access.");
  if (m.role.key === "OWNER" && ctx.roleKey !== "OWNER" && !ctx.impersonator) throw forbidden("Only a company owner can change owner access.");
  if (status === "SUSPENDED" && m.role.key === "OWNER" && (await ownerCount(ctx, m.id)) === 0) {
    throw invalidState("A company must keep at least one active owner.");
  }
  await ctx.db.tx(async (tx) => {
    await tx.membership.update({ where: { id: m.id }, data: { status } });
    await audit(ctx, status === "SUSPENDED" ? "user.suspended" : "user.reactivated", "Membership", m.id, { user: m.user.email }, tx);
  });
}

const roleSchema = z.object({
  name: str(60),
  description: optStr(200),
  permissions: z.array(z.string()).default([]),
});

function cleanPermissions(perms: string[]): Permission[] {
  const set = new Set<Permission>();
  for (const p of perms) if (isPermission(p)) set.add(p);
  return [...set];
}

export async function createRole(ctx: Ctx, raw: unknown) {
  requirePermission(ctx, "roles.manage");
  const input = parseInput(roleSchema, raw);
  const permissions = cleanPermissions(input.permissions);
  assertCanGrant(ctx, permissions);
  if (await ctx.db.role.findFirst({ where: { name: { equals: input.name, mode: "insensitive" } } })) throw conflict("A role with that name already exists.");
  return ctx.db.tx(async (tx) => {
    const role = await tx.role.create({
      data: { tenantId: ctx.tenantId, name: input.name, description: input.description ?? null, permissions, isSystem: false },
    });
    await audit(ctx, "role.created", "Role", role.id, { name: role.name, permissions }, tx);
    return role;
  });
}

export async function updateRole(ctx: Ctx, roleId: string, raw: unknown) {
  requirePermission(ctx, "roles.manage");
  const input = parseInput(roleSchema, raw);
  const role = await ctx.db.role.findFirst({ where: { id: roleId } });
  if (!role) throw notFound("Role");
  if (role.key === "OWNER") throw invalidState("The owner role always has full access and can't be edited.");
  const permissions = cleanPermissions(input.permissions);
  assertCanGrant(ctx, permissions);
  const dup = await ctx.db.role.findFirst({ where: { name: { equals: input.name, mode: "insensitive" }, id: { not: role.id } } });
  if (dup) throw conflict("A role with that name already exists.");
  await ctx.db.tx(async (tx) => {
    await tx.role.update({ where: { id: role.id }, data: { name: role.isSystem ? role.name : input.name, description: input.description ?? null, permissions } });
    await audit(ctx, "role.updated", "Role", role.id, { name: role.name, before: role.permissions, after: permissions }, tx);
  });
}

export async function deleteRole(ctx: Ctx, roleId: string): Promise<void> {
  requirePermission(ctx, "roles.manage");
  const role = await ctx.db.role.findFirst({ where: { id: roleId }, include: { _count: { select: { memberships: true, invitations: true } } } });
  if (!role) throw notFound("Role");
  if (role.isSystem) throw invalidState("Built-in roles can't be deleted.");
  if (role._count.memberships > 0 || role._count.invitations > 0) throw invalidState("Reassign users with this role before deleting it.");
  await ctx.db.tx(async (tx) => {
    await tx.role.delete({ where: { id: role.id } });
    await audit(ctx, "role.deleted", "Role", role.id, { name: role.name }, tx);
  });
}

export async function listTeam(ctx: Ctx) {
  requirePermission(ctx, "users.manage");
  const [members, invitations, roles] = await Promise.all([
    ctx.db.membership.findMany({ include: { role: true, employee: { select: { id: true, firstName: true, lastName: true, jobTitle: true } } }, orderBy: { createdAt: "asc" } }),
    ctx.db.invitation.findMany({ where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, include: { role: true }, orderBy: { createdAt: "desc" } }),
    ctx.db.role.findMany({ orderBy: [{ isSystem: "desc" }, { name: "asc" }], include: { _count: { select: { memberships: true } } } }),
  ]);
  const users = await platformDb().user.findMany({
    where: { id: { in: members.map((m) => m.userId) } },
    select: { id: true, email: true, name: true, lastLoginAt: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  return {
    members: members.map((m) => ({ ...m, user: byId.get(m.userId) ?? null })),
    invitations,
    roles,
  };
}

// ─── Password flows ─────────────────────────────────────────────────────────────

const platformBrand: Branding = {
  companyName: "Worklio",
  brandColor: "#1d4ed8",
  logoUrl: null,
  address: null,
  phone: null,
  email: null,
  website: null,
  signature: null,
};

/** Always resolves silently so the endpoint can't be used to discover registered emails. */
export async function requestPasswordReset(emailInput: string, meta: { ip?: string } = {}): Promise<void> {
  const email = emailInput.trim().toLowerCase();
  await rateLimit(`reset:ip:${meta.ip ?? "unknown"}`, 10, 60 * 60 * 1000);
  await rateLimit(`reset:acct:${email}`, 3, 60 * 60 * 1000);
  const db = platformDb();
  const user = await db.user.findUnique({ where: { email } });
  if (!user || !user.isActive) return;
  const token = generateToken();
  await db.authToken.create({
    data: { userId: user.id, type: "PASSWORD_RESET", tokenHash: hashToken(token), expiresAt: addHours(new Date(), 1) },
  });
  const message = passwordResetEmail(platformBrand, { name: user.name, url: `${env().APP_URL}/reset-password/${token}` });
  try {
    await getEmailProvider().send({ from: fromAddress("Worklio"), to: user.email, subject: message.subject, html: message.html, text: message.text });
  } catch (err) {
    console.error("[auth] password reset email failed", err instanceof Error ? err.message : err);
  }
}

export async function resetPassword(token: string, password: string): Promise<void> {
  const weak = validatePasswordStrength(password);
  if (weak) throw new AppError("VALIDATION", weak, { password: weak });
  const db = platformDb();
  const rec = await db.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!rec || rec.usedAt || rec.expiresAt < new Date() || rec.type !== "PASSWORD_RESET") {
    throw invalidState("This reset link is invalid or has expired. Request a new one.");
  }
  const passwordHash = await hashPassword(password);
  await db.tx(async (tx) => {
    await tx.authToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } });
    await tx.user.update({ where: { id: rec.userId }, data: { passwordHash, failedLoginCount: 0, lockedUntil: null } });
    await tx.auditLog.create({ data: { actorUserId: rec.userId, action: "auth.password_reset", entityType: "User", entityId: rec.userId } });
  });
  await destroyAllSessions(rec.userId);
}

export async function changeOwnPassword(ctx: Ctx, current: string, next: string): Promise<void> {
  const weak = validatePasswordStrength(next);
  if (weak) throw new AppError("VALIDATION", weak, { next: weak });
  const db = platformDb();
  const user = await db.user.findUnique({ where: { id: ctx.userId } });
  if (!user || !(await verifyPassword(current, user.passwordHash))) throw new AppError("VALIDATION", "Current password is incorrect.", { current: "Incorrect password" });
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next) } });
  await audit(ctx, "auth.password_changed", "User", user.id);
}

export { ALL_PERMISSIONS };
void tenantDb;
