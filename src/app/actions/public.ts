"use server";

import { run, type ActionResult } from "@/server/actions";
import { requestMeta } from "@/server/auth/server";
import { AppError } from "@/server/errors";
import { env } from "@/server/env";
import { respondWithLink } from "@/server/domain/quotes";
import { resolveDocumentLink, resolvePublicLink } from "@/server/domain/public-links";
import { getPaymentProvider } from "@/server/payments/provider";
import { sendPortalMessage, updatePortalContact } from "@/server/domain/portal";
import { formToObject } from "@/lib/validation";

/** `quoteId` is set when the customer is acting from their portal (token = portal link). */
export async function respondToQuoteAction(token: string, quoteId: string | null, payload: { action: "approve" | "decline"; optionId?: string; message?: string; signerName?: string; signatureData?: string }): Promise<ActionResult> {
  return run(async () => {
    const meta = await requestMeta();
    const link = await resolveDocumentLink(token, "QUOTE", quoteId ?? undefined, meta);
    if (!link) throw new AppError("NOT_FOUND", "Quote not found.");
    const r = await respondWithLink(link, payload, meta);
    return { message: r.status === "APPROVED" ? "Thank you — your approval has been recorded." : "Your response has been recorded." };
  });
}

/** Start a hosted checkout for the invoice's remaining balance. */
export async function startCheckoutAction(token: string, invoiceId: string | null): Promise<ActionResult<{ url: string }>> {
  return run(async () => {
    const meta = await requestMeta();
    const link = await resolveDocumentLink(token, "INVOICE", invoiceId ?? undefined, meta);
    if (!link) throw new AppError("NOT_FOUND", "Invoice not found.");
    const provider = getPaymentProvider();
    if (!provider.supportsOnlinePayments) throw new AppError("INVALID_STATE", "Online payment isn't available for this company yet.");
    const inv = await link.db.invoice.findFirst({ where: { id: link.entityId }, include: { customer: { select: { email: true } } } });
    if (!inv || inv.balanceCents <= 0 || ["VOID", "DRAFT", "PAID"].includes(inv.status)) throw new AppError("INVALID_STATE", "Nothing is due on this invoice.");
    const settings = await link.db.tenantSettings.findFirst({ where: {} });
    const base = invoiceId ? `${env().APP_URL}/portal/${token}/invoices/${invoiceId}` : `${env().APP_URL}/i/${token}`;
    const { url } = await provider.createCheckout({ tenantId: link.tenantId, invoiceId: inv.id, invoiceNumber: inv.number, amountCents: inv.balanceCents, currency: settings?.currency ?? "USD", customerEmail: inv.customer.email, successUrl: `${base}?paid=1`, cancelUrl: base });
    return { data: { url } };
  }) as Promise<ActionResult<{ url: string }>>;
}

export async function updatePortalContactAction(token: string, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    await updatePortalContact(token, formToObject(fd), await requestMeta());
    return { message: "Your contact information was updated." };
  });
}

export async function portalMessageAction(token: string, fd: FormData): Promise<ActionResult> {
  return run(async () => { await sendPortalMessage(token, formToObject(fd), await requestMeta()); return { message: "Message sent — we'll be in touch soon." }; });
}
void resolvePublicLink;
