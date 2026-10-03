"use server";

import { redirect } from "next/navigation";
import { run, type ActionResult } from "@/server/actions";
import { requestMeta, requirePlatformAdmin } from "@/server/auth/server";
import { provisionTenant, reissueOwnerInvitation, setTenantStatus, startImpersonation, updateSubscription, upsertPlan } from "@/server/domain/tenants";
import { clearEmailSettings, saveEmailSettings } from "@/server/domain/platform-settings";
import { sendTestEmail, sendUserPasswordReset, setUserActive, unlockUser } from "@/server/domain/platform-admin";
import { formToObject } from "@/lib/validation";

async function actor() {
  const auth = await requirePlatformAdmin();
  return { userId: auth.user.id, name: auth.user.name, sessionId: auth.sessionId };
}

export async function createCompanyAction(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const r = await provisionTenant(await actor(), formToObject(fd) as never);
    return { message: "Company created and owner invited", redirectTo: `/platform/companies/${r.tenantId}?invite=${encodeURIComponent(r.inviteUrl)}` };
  });
}
export async function setStatusAction(tenantId: string, status: "ACTIVE" | "SUSPENDED", reason?: string): Promise<ActionResult> {
  return run(async () => { await setTenantStatus(await actor(), tenantId, status, reason); return { message: status === "SUSPENDED" ? "Company suspended" : "Company reactivated" }; });
}
export async function updateSubscriptionAction(tenantId: string, fd: FormData): Promise<ActionResult> {
  return run(async () => { await updateSubscription(await actor(), tenantId, formToObject(fd)); return { message: "Subscription updated" }; });
}
export async function reissueInviteAction(tenantId: string): Promise<ActionResult> {
  return run(async () => {
    const r = await reissueOwnerInvitation(await actor(), tenantId);
    return { message: `New invitation sent to ${r.email}`, redirectTo: `/platform/companies/${tenantId}?invite=${encodeURIComponent(r.inviteUrl)}` };
  });
}
export async function savePlanAction(fd: FormData): Promise<ActionResult> {
  return run(async () => { await upsertPlan(await actor(), { ...formToObject(fd), isActive: fd.get("isActive") === "on" }); return { message: "Plan saved" }; });
}
export async function impersonateAction(tenantId: string, fd: FormData): Promise<ActionResult> {
  const a = await actor().catch(() => null);
  if (!a) redirect("/login");
  const res = await run<undefined>(async () => { await startImpersonation(a, tenantId, String(fd.get("reason") ?? ""), await requestMeta()); return { message: "Support session started", redirectTo: "/dashboard" }; });
  return res;
}

// ── Platform settings ──
export async function saveEmailSettingsAction(fd: FormData): Promise<ActionResult> {
  return run(async () => { await saveEmailSettings(await actor(), { apiKey: String(fd.get("apiKey") ?? ""), from: String(fd.get("from") ?? "") }); return { message: "Email settings saved" }; });
}
export async function clearEmailSettingsAction(): Promise<ActionResult> {
  return run(async () => { await clearEmailSettings(await actor()); return { message: "Saved key removed; falling back to environment variables" }; });
}
export async function sendTestEmailAction(fd: FormData): Promise<ActionResult> {
  return run(async () => { const r = await sendTestEmail(String(fd.get("to") ?? "")); return { message: r.provider === "console" ? "Provider is 'console' — the message was only logged, not sent" : `Test email sent via ${r.provider}` }; });
}

// ── Users ──
export async function setUserActiveAction(userId: string, active: boolean): Promise<ActionResult> {
  return run(async () => { await setUserActive(await actor(), userId, active); return { message: active ? "User reactivated" : "User deactivated and signed out" }; });
}
export async function unlockUserAction(userId: string): Promise<ActionResult> {
  return run(async () => { await unlockUser(await actor(), userId); return { message: "User unlocked" }; });
}
export async function sendUserResetAction(userId: string): Promise<ActionResult> {
  return run(async () => { await sendUserPasswordReset(await actor(), userId); return { message: "Password reset email sent" }; });
}
