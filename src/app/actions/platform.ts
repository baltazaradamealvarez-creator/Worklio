"use server";

import { redirect } from "next/navigation";
import { run, type ActionResult } from "@/server/actions";
import { requestMeta, requirePlatformAdmin } from "@/server/auth/server";
import { provisionTenant, reissueOwnerInvitation, setTenantStatus, startImpersonation, updateSubscription, upsertPlan } from "@/server/domain/tenants";
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
