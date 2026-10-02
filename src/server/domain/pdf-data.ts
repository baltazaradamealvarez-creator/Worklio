import { can, requirePermission, type Ctx } from "@/server/auth/context";
import type { DbHandle } from "@/server/db";
import { notFound } from "@/server/errors";
import { formatDateOnly, formatDateTime, formatAddress, humanize, formatPhone } from "@/lib/format";
import { storage } from "@/server/storage/provider";
import { renderPdf, type PdfInput, type PdfSection } from "@/server/pdf/render";
import type { ResolvedLink } from "./public-links";

async function brandBlock(db: DbHandle): Promise<{ brand: PdfInput["brand"]; currency: string; settings: Awaited<ReturnType<DbHandle["tenantSettings"]["findFirst"]>> }> {
  const [tenant, s] = await Promise.all([db.tenant.findFirst({ where: {} }), db.tenantSettings.findFirst({ where: {} })]);
  let logo: Buffer | null = null;
  if (s?.logoKey) {
    try {
      const bytes = await storage().get(s.logoKey);
      // pdfkit supports PNG and JPEG only
      if (bytes[0] === 0x89 || bytes[0] === 0xff) logo = bytes;
    } catch { /* missing logo is not fatal */ }
  }
  return {
    currency: s?.currency ?? "USD",
    settings: s,
    brand: { name: s?.legalName || tenant?.name || "Company", address: s ? formatAddress(s) || null : null, phone: s?.phone ? formatPhone(s.phone) : null, email: s?.email ?? null, website: s?.website ?? null, taxId: s?.taxId ?? null, color: s?.brandColor ?? "#1d4ed8", logo },
  };
}

const discountLabel = (type: string, value: number, currencyFmt: (c: number) => string) =>
  type === "PERCENT" ? `${(value / 100).toFixed(value % 100 ? 2 : 0)}% off` : type === "FIXED" ? `${currencyFmt(value)} off` : null;

function customerBlock(c: { displayName: string; billingLine1?: string | null; billingLine2?: string | null; billingCity?: string | null; billingState?: string | null; billingPostalCode?: string | null; email?: string | null; phone?: string | null }) {
  const cityLine = [c.billingCity, [c.billingState, c.billingPostalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return { name: c.displayName, lines: [c.billingLine1, c.billingLine2, cityLine].filter((x): x is string => !!x), email: c.email, phone: c.phone ? formatPhone(c.phone) : null };
}

interface QuoteLike {
  number: string; title: string; issueDate: Date; expiresAt: Date | null; status: string; terms: string | null; customerNotes: string | null;
  discountType: string; discountValue: number; taxRateBp: number; approvedOptionId: string | null;
  customer: Parameters<typeof customerBlock>[0];
  location: { addressLine1: string; addressLine2: string | null; city: string; state: string; postalCode: string } | null;
  options: { id: string; name: string; description: string | null; isRecommended: boolean; subtotalCents: number; discountCents: number; taxCents: number; totalCents: number; depositCents: number; lineItems: { name: string; description: string | null; quantity: { toString(): string }; unitPriceCents: number; discountType: string; discountValue: number; totalCents: number }[] }[];
}

async function buildQuote(db: DbHandle, q: QuoteLike, signature: { signerName: string; signedAt: Date; storageKey?: string } | null) {
  const { brand, currency, settings } = await brandBlock(db);
  const fmt = (c: number) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(c / 100);
  const approved = q.options.find((o) => o.id === q.approvedOptionId);
  const options = approved ? [approved] : q.options;
  const sections: PdfSection[] = options.map((o) => ({
    heading: options.length > 1 ? o.name : undefined,
    subheading: options.length > 1 ? o.description : null,
    recommended: o.isRecommended && options.length > 1,
    lines: o.lineItems.map((l) => ({ name: l.name, description: l.description, quantity: l.quantity.toString().replace(/\.00$/, ""), unitPriceCents: l.unitPriceCents, discountLabel: discountLabel(l.discountType, l.discountValue, fmt), totalCents: l.totalCents })),
    totals: [
      { label: "Subtotal", cents: o.subtotalCents },
      ...(o.discountCents ? [{ label: "Discount", cents: -o.discountCents }] : []),
      ...(o.taxCents ? [{ label: `Tax (${(q.taxRateBp / 100).toFixed(2)}%)`, cents: o.taxCents }] : []),
      { label: "Total", cents: o.totalCents, bold: true },
      ...(o.depositCents ? [{ label: "Deposit required", cents: o.depositCents }] : []),
    ],
  }));
  let sigImage: Buffer | null = null;
  if (signature?.storageKey) sigImage = await storage().get(signature.storageKey).catch(() => null);
  const input: PdfInput = {
    kind: "QUOTE", number: q.number, title: q.title, currency, brand,
    customer: customerBlock(q.customer),
    serviceLocation: q.location ? formatAddress(q.location) : null,
    meta: [{ label: "Issued", value: formatDateOnly(q.issueDate) }, ...(q.expiresAt ? [{ label: "Valid until", value: formatDateOnly(q.expiresAt) }] : []), { label: "Status", value: humanize(q.status) }],
    intro: settings?.quoteIntro, sections, customerNotes: q.customerNotes, terms: q.terms, footer: settings?.quoteFooter,
    stamp: null,
    signature: signature ? { name: signature.signerName, signedAt: formatDateTime(signature.signedAt, settings?.timezone), image: sigImage } : null,
  };
  return renderPdf(input);
}

const quoteInclude = {
  customer: true, location: true,
  options: { orderBy: { position: "asc" as const }, include: { lineItems: { orderBy: { position: "asc" as const } } } },
};

export async function quotePdf(ctx: Ctx, id: string): Promise<{ bytes: Buffer; filename: string }> {
  requirePermission(ctx, "quotes.view");
  const q = await ctx.db.quote.findFirst({ where: { id, deletedAt: null }, include: quoteInclude });
  if (!q) throw notFound("Quote");
  const sig = q.signatureId ? await ctx.db.signature.findFirst({ where: { id: q.signatureId } }) : null;
  return { bytes: await buildQuote(ctx.db, q, sig), filename: `${q.number}.pdf` };
}

export async function publicQuotePdf(link: ResolvedLink): Promise<{ bytes: Buffer; filename: string }> {
  const q = await link.db.quote.findFirst({ where: { id: link.entityId, deletedAt: null }, include: quoteInclude });
  if (!q) throw notFound("Quote");
  const sig = q.signatureId ? await link.db.signature.findFirst({ where: { id: q.signatureId } }) : null;
  return { bytes: await buildQuote(link.db, q, sig), filename: `${q.number}.pdf` };
}

const invoiceInclude = { customer: true, location: true, lineItems: { orderBy: { position: "asc" as const } }, payments: { where: { status: "SUCCEEDED" as const }, orderBy: { receivedAt: "asc" as const } } };

async function buildInvoice(db: DbHandle, id: string) {
  const inv = await db.invoice.findFirst({ where: { id }, include: invoiceInclude });
  if (!inv) throw notFound("Invoice");
  const { brand, currency, settings } = await brandBlock(db);
  const fmt = (c: number) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(c / 100);
  const input: PdfInput = {
    kind: "INVOICE", number: inv.number, title: inv.title, currency, brand,
    customer: customerBlock(inv.customer),
    serviceLocation: inv.location ? formatAddress(inv.location) : null,
    meta: [{ label: "Issued", value: formatDateOnly(inv.issueDate) }, { label: "Due", value: formatDateOnly(inv.dueDate) }, { label: "Terms", value: inv.paymentTermsDays === 0 ? "Due on receipt" : `Net ${inv.paymentTermsDays}` }],
    sections: [{
      lines: inv.lineItems.map((l) => ({ name: l.name, description: l.description, quantity: l.quantity.toString().replace(/\.00$/, ""), unitPriceCents: l.unitPriceCents, discountLabel: discountLabel(l.discountType, l.discountValue, fmt), totalCents: l.totalCents })),
      totals: [
        { label: "Subtotal", cents: inv.subtotalCents },
        ...(inv.discountCents ? [{ label: "Discount", cents: -inv.discountCents }] : []),
        ...(inv.taxCents ? [{ label: `Tax (${(inv.taxRateBp / 100).toFixed(2)}%)`, cents: inv.taxCents }] : []),
        { label: "Total", cents: inv.totalCents, bold: true },
        ...(inv.depositRequiredCents ? [{ label: "Deposit required", cents: inv.depositRequiredCents }] : []),
        ...(inv.amountPaidCents ? [{ label: "Paid", cents: -inv.amountPaidCents }] : []),
        { label: "Balance due", cents: inv.balanceCents, bold: true },
      ],
    }],
    payments: inv.payments.map((p) => ({ date: formatDateTime(p.receivedAt, settings?.timezone), method: humanize(p.method), reference: p.reference, cents: p.amountCents })),
    customerNotes: inv.customerNotes, terms: inv.terms, footer: settings?.invoiceFooter,
    stamp: inv.status === "VOID" ? { text: "VOID", color: "#dc2626" } : inv.status === "PAID" ? { text: "PAID", color: "#059669" } : null,
  };
  return { bytes: await renderPdf(input), filename: `${inv.number}.pdf` };
}

export async function invoicePdf(ctx: Ctx, id: string) {
  requirePermission(ctx, "invoices.view");
  return buildInvoice(ctx.db, id);
}

export async function publicInvoicePdf(link: ResolvedLink) {
  return buildInvoice(link.db, link.entityId);
}

export async function receiptPdf(ctx: Ctx, paymentId: string) {
  requirePermission(ctx, "payments.view");
  const p = await ctx.db.payment.findFirst({ where: { id: paymentId, status: "SUCCEEDED" }, include: { invoice: true, customer: true } });
  if (!p) throw notFound("Payment");
  const { brand, currency, settings } = await brandBlock(ctx.db);
  const input: PdfInput = {
    kind: "RECEIPT", number: `${p.invoice.number}-R${p.id.slice(-4).toUpperCase()}`, title: `Payment toward invoice ${p.invoice.number}`, currency, brand,
    customer: customerBlock(p.customer),
    meta: [{ label: "Received", value: formatDateTime(p.receivedAt, settings?.timezone) }, { label: "Method", value: humanize(p.method) }, ...(p.reference ? [{ label: "Reference", value: p.reference }] : [])],
    sections: [{ lines: [{ name: `Payment received — ${humanize(p.method)}`, description: p.notes, quantity: "1", unitPriceCents: p.amountCents, totalCents: p.amountCents }], totals: [{ label: "Amount received", cents: p.amountCents, bold: true }, { label: "Invoice balance remaining", cents: p.invoice.balanceCents }] }],
    footer: "Thank you for your business.",
    stamp: { text: "PAID", color: "#059669" },
  };
  void can;
  return { bytes: await renderPdf(input), filename: `receipt-${p.invoice.number}.pdf` };
}
