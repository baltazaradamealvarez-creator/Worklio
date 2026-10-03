"use server";

import { run, type ActionResult } from "@/server/actions";
import { requireCtx } from "@/server/auth/server";
import { createLead, setLeadStatus, updateLead, convertLead, archiveLead } from "@/server/domain/leads";
import { formToObject } from "@/lib/validation";

export async function saveLeadAction(id: string | null, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireCtx();
    const raw = formToObject(fd);
    const lead = id ? await updateLead(ctx, id, raw) : await createLead(ctx, raw);
    return { message: id ? "Lead updated" : "Lead created", redirectTo: `/leads/${lead.id}` };
  });
}
export async function leadStatusAction(id: string, to: string, lostReason?: string): Promise<ActionResult> {
  return run(async () => { await setLeadStatus(await requireCtx(), id, { to, lostReason }); return { message: "Lead updated" }; });
}
export async function convertLeadAction(id: string, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const r = await convertLead(await requireCtx(), id, formToObject(fd));
    return { message: "Lead converted", redirectTo: r.quoteId ? `/quotes/${r.quoteId}` : r.jobId ? `/jobs/${r.jobId}` : `/customers/${r.customerId}` };
  });
}
export async function archiveLeadAction(id: string): Promise<ActionResult> {
  return run(async () => { await archiveLead(await requireCtx(), id); return { message: "Lead archived", redirectTo: "/leads" }; });
}
