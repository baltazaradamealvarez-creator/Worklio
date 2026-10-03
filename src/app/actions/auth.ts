"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { run, type ActionResult } from "@/server/actions";
import { AppError } from "@/server/errors";
import { loadTenantContext, can } from "@/server/auth/context";
import { authenticate } from "@/server/auth/session";
import { requestMeta, setSessionCookie, requireCtx } from "@/server/auth/server";
import { acceptInvitation, changeOwnPassword, requestPasswordReset, resetPassword } from "@/server/domain/users";
import { createSession } from "@/server/auth/session";
import { email, formToObject, parseInput } from "@/lib/validation";

/** Only same-site relative paths are accepted as post-login destinations (no open redirect). */
function safeNext(next: unknown): string | null {
  return typeof next === "string" && /^\/(?!\/)[^\s\\]*$/.test(next) && !next.startsWith("/login") ? next : null;
}

async function landing(userId: string, tenantId: string | null, isPlatformAdmin: boolean): Promise<string> {
  if (!tenantId) return isPlatformAdmin ? "/platform" : "/no-access";
  const ctx = await loadTenantContext(userId, tenantId);
  if (!ctx) return "/no-access";
  return !can(ctx, "jobs.view") && can(ctx, "jobs.view_assigned") ? "/tech" : "/dashboard";
}

export async function loginAction(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const input = parseInput(z.object({ email, password: z.string().min(1, "Enter your password").max(200), next: z.string().optional() }), formToObject(fd));
    const res = await authenticate(input.email, input.password, await requestMeta());
    await setSessionCookie(res.token, res.expiresAt);
    return { redirectTo: safeNext(input.next) ?? (await landing(res.userId, res.activeTenantId, res.isPlatformAdmin)) };
  });
}

export async function forgotPasswordAction(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { email: addr } = parseInput(z.object({ email }), formToObject(fd));
    await requestPasswordReset(addr, await requestMeta());
    return { message: "If an account exists for that address, a reset link is on its way." };
  });
}

export async function resetPasswordAction(token: string, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const input = parseInput(z.object({ password: z.string().min(1).max(200), confirm: z.string() }), formToObject(fd));
    if (input.password !== input.confirm) throw new AppError("VALIDATION", "Passwords don't match.", { confirm: "Passwords don't match" });
    await resetPassword(token, input.password);
    return { redirectTo: "/login?reset=1" };
  });
}

export async function acceptInviteAction(token: string, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const raw = formToObject(fd);
    const meta = await requestMeta();
    const { userId, tenantId } = await acceptInvitation(token, { name: raw.name, password: raw.password }, meta);
    const { token: session, expiresAt } = await createSession(userId, meta, tenantId);
    await setSessionCookie(session, expiresAt);
    return { redirectTo: "/onboarding" };
  });
}

export async function changePasswordAction(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireCtx();
    const raw = formToObject(fd);
    await changeOwnPassword(ctx, String(raw.current ?? ""), String(raw.next ?? ""));
    return { message: "Password updated" };
  });
}

export async function goHome() {
  redirect("/");
}
