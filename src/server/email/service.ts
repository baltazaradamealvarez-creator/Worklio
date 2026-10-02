import type { EntityType } from "@prisma/client";
import type { Db } from "@/server/db";
import { env } from "@/server/env";
import { AppError } from "@/server/errors";
import { formatAddress } from "@/lib/format";
import type { Branding, RenderedEmail } from "./layout";
import { getEmailProvider } from "./provider";

export async function loadBranding(db: Db, tenantId: string): Promise<Branding> {
  const [tenant, s] = await Promise.all([db.tenant.findFirst({ where: {} }), db.tenantSettings.findFirst({ where: {} })]);
  return {
    companyName: s?.legalName || tenant?.name || "Your HVAC company",
    brandColor: s?.brandColor ?? "#1d4ed8",
    logoUrl: s?.logoKey ? `${env().APP_URL}/api/branding/${tenantId}/logo` : null,
    address: s ? formatAddress(s) || null : null,
    phone: s?.phone ?? null,
    email: s?.email ?? null,
    website: s?.website ?? null,
    signature: s?.emailSignature ?? null,
  };
}

export function fromAddress(companyName: string): string {
  const configured = env().EMAIL_FROM;
  const m = /<([^>]+)>/.exec(configured);
  const addr = m?.[1] ?? configured;
  return `${companyName.replace(/["<>]/g, "")} <${addr}>`;
}

export interface DeliverInput {
  template: string;
  to: string;
  email: RenderedEmail;
  companyName: string;
  replyTo?: string | null;
  customerId?: string | null;
  entityType?: EntityType;
  entityId?: string;
  sentById?: string | null;
}

/**
 * Persist the message, hand it to the configured provider, and record the outcome.
 * Do NOT call inside a database transaction — a failure must still leave a FAILED record.
 * Throws AppError when delivery fails so callers don't mark documents as "sent".
 */
export async function deliverEmail(db: Db, tenantId: string, input: DeliverInput): Promise<{ id: string }> {
  const from = fromAddress(input.companyName);
  const record = await db.emailMessage.create({
    data: {
      tenantId,
      customerId: input.customerId ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      template: input.template,
      toEmail: input.to,
      fromEmail: from,
      subject: input.email.subject,
      bodyHtml: input.email.html,
      status: "QUEUED",
      sentById: input.sentById ?? null,
    },
  });
  try {
    const provider = getEmailProvider();
    const res = await provider.send({
      from,
      to: input.to,
      subject: input.email.subject,
      html: input.email.html,
      text: input.email.text,
      replyTo: input.replyTo ?? undefined,
    });
    await db.emailMessage.update({
      where: { id: record.id },
      data: { status: "SENT", provider: provider.name, providerMessageId: res.id ?? null, sentAt: new Date() },
    });
    return { id: record.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await db.emailMessage.update({ where: { id: record.id }, data: { status: "FAILED", error: message.slice(0, 500) } });
    console.error("[email] delivery failed", message);
    throw new AppError("CONFLICT", "The email could not be sent. Check the recipient address and email settings, then try again.");
  }
}
