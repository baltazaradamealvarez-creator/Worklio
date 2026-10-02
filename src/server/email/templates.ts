import { formatMoney } from "@/lib/money";
import { esc, renderLayout, type Branding, type RenderedEmail } from "./layout";

/** Transactional email templates. Each returns subject/html/text rendered in the tenant's branding. */

export function invitationEmail(brand: Branding, d: { inviteeName?: string | null; inviterName: string; roleName: string; url: string; expiresInDays: number }): RenderedEmail {
  const subject = `You're invited to join ${brand.companyName} on Worklio`;
  return renderLayout(
    brand,
    {
      preheader: `${d.inviterName} invited you as ${d.roleName}`,
      heading: `Join ${brand.companyName}`,
      paragraphs: [
        `Hi${d.inviteeName ? ` ${esc(d.inviteeName)}` : ""},`,
        `${esc(d.inviterName)} has invited you to ${esc(brand.companyName)}'s workspace as <strong>${esc(d.roleName)}</strong>. Set your password to get started.`,
      ],
      button: { label: "Accept invitation", url: d.url },
      footnote: `This invitation expires in ${d.expiresInDays} days. If you weren't expecting it, you can ignore this email.`,
    },
    subject,
  );
}

export function passwordResetEmail(brand: Branding, d: { name: string; url: string }): RenderedEmail {
  return renderLayout(
    brand,
    {
      heading: "Reset your password",
      paragraphs: [`Hi ${esc(d.name)},`, "We received a request to reset your password. This link works once and expires in one hour."],
      button: { label: "Choose a new password", url: d.url },
      footnote: "If you didn't request this, no action is needed — your password has not changed.",
    },
    "Reset your Worklio password",
  );
}

export function quoteEmail(
  brand: Branding,
  d: { customerName: string; quoteNumber: string; title: string; totalCents: number; currency: string; expiresOn: string | null; message?: string | null; url: string; optionCount: number },
): RenderedEmail {
  const subject = `Quote ${d.quoteNumber} from ${brand.companyName}`;
  return renderLayout(
    brand,
    {
      preheader: `${d.title} — ${formatMoney(d.totalCents, d.currency)}`,
      heading: `Your quote is ready`,
      paragraphs: [
        `Hi ${esc(d.customerName)},`,
        d.message ? esc(d.message).replace(/\n/g, "<br>") : `Thank you for the opportunity. Your quote for <strong>${esc(d.title)}</strong> is ready to review.`,
      ],
      summary: [
        { label: "Quote", value: d.quoteNumber },
        ...(d.optionCount > 1 ? [{ label: "Options", value: `${d.optionCount} to choose from` }] : [{ label: "Total", value: formatMoney(d.totalCents, d.currency) }]),
        ...(d.expiresOn ? [{ label: "Valid until", value: d.expiresOn }] : []),
      ],
      button: { label: "View quote", url: d.url },
      footnote: "You can review the details, download a PDF, and approve or decline online — no account needed.",
    },
    subject,
  );
}

export function invoiceEmail(
  brand: Branding,
  d: { customerName: string; invoiceNumber: string; totalCents: number; balanceCents: number; currency: string; dueOn: string; message?: string | null; url: string },
): RenderedEmail {
  return renderLayout(
    brand,
    {
      preheader: `Invoice ${d.invoiceNumber} — ${formatMoney(d.balanceCents, d.currency)} due ${d.dueOn}`,
      heading: `Invoice ${d.invoiceNumber}`,
      paragraphs: [`Hi ${esc(d.customerName)},`, d.message ? esc(d.message).replace(/\n/g, "<br>") : "Thank you for your business. Your invoice is ready."],
      summary: [
        { label: "Invoice total", value: formatMoney(d.totalCents, d.currency) },
        { label: "Balance due", value: formatMoney(d.balanceCents, d.currency) },
        { label: "Due", value: d.dueOn },
      ],
      button: { label: "View invoice", url: d.url },
    },
    `Invoice ${d.invoiceNumber} from ${brand.companyName}`,
  );
}

export function receiptEmail(
  brand: Branding,
  d: { customerName: string; invoiceNumber: string; amountCents: number; method: string; currency: string; paidOn: string; balanceCents: number; url: string },
): RenderedEmail {
  return renderLayout(
    brand,
    {
      heading: "Payment received",
      paragraphs: [`Hi ${esc(d.customerName)},`, `Thank you — we received your payment toward invoice ${esc(d.invoiceNumber)}.`],
      summary: [
        { label: "Amount", value: formatMoney(d.amountCents, d.currency) },
        { label: "Method", value: d.method },
        { label: "Date", value: d.paidOn },
        { label: "Remaining balance", value: formatMoney(d.balanceCents, d.currency) },
      ],
      button: { label: "View invoice", url: d.url },
    },
    `Receipt for invoice ${d.invoiceNumber}`,
  );
}

export function appointmentEmail(
  brand: Branding,
  d: { customerName: string; when: string; address: string; jobTitle: string; technicianNames: string[]; reminder: boolean; portalUrl?: string },
): RenderedEmail {
  return renderLayout(
    brand,
    {
      heading: d.reminder ? "Appointment reminder" : "Your appointment is confirmed",
      paragraphs: [
        `Hi ${esc(d.customerName)},`,
        d.reminder ? `This is a reminder about your upcoming service visit.` : `We've scheduled your service visit.`,
      ],
      summary: [
        { label: "Service", value: d.jobTitle },
        { label: "When", value: d.when },
        { label: "Where", value: d.address },
        ...(d.technicianNames.length ? [{ label: "Technician", value: d.technicianNames.join(", ") }] : []),
      ],
      ...(d.portalUrl ? { button: { label: "View appointment", url: d.portalUrl } } : {}),
      footnote: "Need to reschedule? Reply to this email or call us.",
    },
    d.reminder ? `Reminder: service visit ${d.when}` : `Appointment confirmed: ${d.when}`,
  );
}

export function portalAccessEmail(brand: Branding, d: { customerName: string; url: string }): RenderedEmail {
  return renderLayout(
    brand,
    {
      heading: "Your customer portal",
      paragraphs: [`Hi ${esc(d.customerName)},`, "Use the secure link below to view your quotes, invoices, appointments and service history."],
      button: { label: "Open customer portal", url: d.url },
      footnote: "This private link is just for you — please don't forward it.",
    },
    `Your ${brand.companyName} customer portal`,
  );
}
