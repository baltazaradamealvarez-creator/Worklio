"use server";

import { revalidatePath } from "next/cache";
import { run, type ActionResult } from "@/server/actions";
import { getAuth, requireCtx } from "@/server/auth/server";
import { addCertification, addTimeOff, archiveEmployee, createEmployee, removeCertification, removeTimeOff, setAvailability, updateEmployee } from "@/server/domain/employees";
import { changeMemberRole, changeOwnPassword, createRole, deleteRole, inviteUser, revokeInvitation, setMemberStatus, updateRole } from "@/server/domain/users";
import { archiveJobType, saveJobType } from "@/server/domain/jobs";
import { completeOnboarding, deleteTerritory, ONBOARDING_STEPS, saveTerritory, setLogo, skipOnboardingStep, updateBranding, updateCompany, updateFinancial, updateOperations, WEEKDAYS, type OnboardingStep } from "@/server/domain/settings";
import { AppError } from "@/server/errors";
import { formToObject } from "@/lib/validation";

// ── Employees ──
function employeeInput(fd: FormData) {
  return { ...formToObject(fd), skills: String(fd.get("skills") ?? "").split(",").map((s) => s.trim()).filter(Boolean) };
}
export async function saveEmployeeAction(id: string | null, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireCtx();
    const e = id ? await updateEmployee(ctx, id, employeeInput(fd)) : await createEmployee(ctx, employeeInput(fd));
    return { message: id ? "Employee saved" : "Employee added", redirectTo: `/employees/${e.id}` };
  });
}
export async function archiveEmployeeAction(id: string): Promise<ActionResult> {
  return run(async () => { await archiveEmployee(await requireCtx(), id); return { message: "Employee archived", redirectTo: "/employees" }; });
}
export async function addCertificationAction(employeeId: string, fd: FormData): Promise<ActionResult> {
  return run(async () => { await addCertification(await requireCtx(), employeeId, formToObject(fd)); return { message: "Certification added" }; });
}
export async function removeCertificationAction(id: string): Promise<ActionResult> {
  return run(async () => { await removeCertification(await requireCtx(), id); return { message: "Removed" }; });
}
export async function addTimeOffAction(employeeId: string, fd: FormData): Promise<ActionResult> {
  return run(async () => { await addTimeOff(await requireCtx(), employeeId, formToObject(fd)); return { message: "Time off added" }; });
}
export async function removeTimeOffAction(id: string): Promise<ActionResult> {
  return run(async () => { await removeTimeOff(await requireCtx(), id); return { message: "Removed" }; });
}
const toMin = (v: string) => { const [h, m] = v.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };
export async function saveAvailabilityAction(employeeId: string, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const windows: { weekday: number; startMinute: number; endMinute: number }[] = [];
    for (let d = 0; d < 7; d++) {
      if (fd.get(`on${d}`)) windows.push({ weekday: d, startMinute: toMin(String(fd.get(`start${d}`) ?? "08:00")), endMinute: toMin(String(fd.get(`end${d}`) ?? "17:00")) });
    }
    await setAvailability(await requireCtx(), employeeId, { windows });
    return { message: "Availability saved" };
  });
}

// ── Team & roles ──
export async function inviteUserAction(fd: FormData): Promise<ActionResult<{ inviteUrl: string }>> {
  return run(async () => { const r = await inviteUser(await requireCtx(), formToObject(fd)); return { message: "Invitation sent", data: r }; });
}
export async function revokeInvitationAction(id: string): Promise<ActionResult> {
  return run(async () => { await revokeInvitation(await requireCtx(), id); return { message: "Invitation revoked" }; });
}
export async function changeRoleAction(membershipId: string, fd: FormData): Promise<ActionResult> {
  return run(async () => { await changeMemberRole(await requireCtx(), membershipId, String(fd.get("roleId") ?? "")); return { message: "Role updated" }; });
}
export async function memberStatusAction(membershipId: string, status: "ACTIVE" | "SUSPENDED"): Promise<ActionResult> {
  return run(async () => { await setMemberStatus(await requireCtx(), membershipId, status); return { message: status === "ACTIVE" ? "Access restored" : "Access suspended" }; });
}
export async function saveRoleAction(id: string | null, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireCtx();
    const raw = { name: String(fd.get("name") ?? ""), description: String(fd.get("description") ?? ""), permissions: fd.getAll("permissions").map(String) };
    if (id) await updateRole(ctx, id, raw); else await createRole(ctx, raw);
    return { message: id ? "Role saved" : "Role created", redirectTo: "/settings/team?tab=roles" };
  });
}
export async function deleteRoleAction(id: string): Promise<ActionResult> {
  return run(async () => { await deleteRole(await requireCtx(), id); return { message: "Role deleted", redirectTo: "/settings/team?tab=roles" }; });
}

// ── Settings ──
export async function saveCompanyAction(fd: FormData): Promise<ActionResult> {
  return run(async () => { await updateCompany(await requireCtx(), formToObject(fd)); revalidatePath("/", "layout"); return { message: "Company profile saved" }; });
}
export async function saveBrandingAction(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireCtx();
    await updateBranding(ctx, formToObject(fd));
    const logo = fd.get("logo");
    if (logo instanceof File && logo.size > 0) await setLogo(ctx, { name: logo.name, size: logo.size, content: Buffer.from(await logo.arrayBuffer()) });
    revalidatePath("/", "layout");
    return { message: "Branding saved" };
  });
}
function hoursFrom(fd: FormData) {
  const businessHours: Record<string, { closed: boolean; open: string; close: string }> = {};
  for (const d of WEEKDAYS) businessHours[d] = { closed: !fd.get(`${d}_on`), open: String(fd.get(`${d}_open`) ?? "08:00"), close: String(fd.get(`${d}_close`) ?? "17:00") };
  return businessHours;
}
export async function saveOperationsAction(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    await updateOperations(await requireCtx(), { ...formToObject(fd), businessHours: hoursFrom(fd) });
    return { message: "Operations settings saved" };
  });
}
export async function saveFinancialAction(fd: FormData): Promise<ActionResult> {
  return run(async () => { await updateFinancial(await requireCtx(), { ...formToObject(fd), acceptedPaymentMethods: fd.getAll("acceptedPaymentMethods").map(String) }); return { message: "Financial settings saved" }; });
}
export async function saveTerritoryAction(id: string | null, fd: FormData): Promise<ActionResult> {
  return run(async () => { await saveTerritory(await requireCtx(), id, formToObject(fd)); return { message: "Territory saved" }; });
}
export async function deleteTerritoryAction(id: string): Promise<ActionResult> {
  return run(async () => { await deleteTerritory(await requireCtx(), id); return { message: "Territory deleted" }; });
}
export async function saveJobTypeAction(id: string | null, fd: FormData): Promise<ActionResult> {
  return run(async () => { await saveJobType(await requireCtx(), id, formToObject(fd)); return { message: "Job type saved" }; });
}
export async function archiveJobTypeAction(id: string): Promise<ActionResult> {
  return run(async () => { await archiveJobType(await requireCtx(), id); return { message: "Job type archived" }; });
}
export async function changePasswordAction(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const next = String(fd.get("next") ?? "");
    if (next !== String(fd.get("confirm") ?? "")) throw new AppError("VALIDATION", "The new passwords don't match.", { confirm: "Doesn't match" });
    const auth = await getAuth();
    await changeOwnPassword(await requireCtx(), String(fd.get("current") ?? ""), next, auth?.sessionId);
    return { message: "Password changed. Other devices were signed out." };
  });
}

// ── Onboarding ──
export async function onboardingSaveAction(step: OnboardingStep, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireCtx();
    if (step === "company") await updateCompany(ctx, formToObject(fd));
    else if (step === "branding") {
      await updateBranding(ctx, formToObject(fd));
      const logo = fd.get("logo");
      if (logo instanceof File && logo.size > 0) await setLogo(ctx, { name: logo.name, size: logo.size, content: Buffer.from(await logo.arrayBuffer()) });
    } else if (step === "operations") await updateOperations(ctx, { ...formToObject(fd), businessHours: hoursFrom(fd) });
    else if (step === "financial") await updateFinancial(ctx, { ...formToObject(fd), acceptedPaymentMethods: fd.getAll("acceptedPaymentMethods").map(String) });
    else throw new AppError("VALIDATION", "Unknown step");
    revalidatePath("/", "layout");
    const next = ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(step) + 1];
    return { message: "Saved", redirectTo: `/onboarding?step=${next ?? "finish"}` };
  });
}
export async function onboardingSkipAction(step: OnboardingStep): Promise<ActionResult> {
  return run(async () => {
    await skipOnboardingStep(await requireCtx(), step);
    const i = ONBOARDING_STEPS.indexOf(step);
    return { message: "Skipped", redirectTo: i >= ONBOARDING_STEPS.length - 1 ? "/onboarding?step=finish" : `/onboarding?step=${ONBOARDING_STEPS[i + 1]}` };
  });
}
export async function completeOnboardingAction(): Promise<ActionResult> {
  return run(async () => { await completeOnboarding(await requireCtx()); return { message: "You're all set", redirectTo: "/dashboard" }; });
}
