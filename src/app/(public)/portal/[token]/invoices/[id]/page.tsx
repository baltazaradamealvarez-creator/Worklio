import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PayButton } from "@/components/public/response";
import { InvoiceBody, PublicShell } from "@/components/public/views";
import { Icon } from "@/components/ui/icon";
import { loadPublicInvoice, recordInvoiceView } from "@/server/domain/invoices";
import { resolveDocumentLink } from "@/server/domain/public-links";
import { getPaymentProvider } from "@/server/payments/provider";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invoice" };

export default async function PortalInvoice({ params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const h = await headers();
  const meta = { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim(), userAgent: h.get("user-agent") ?? undefined };
  const link = await resolveDocumentLink(token, "INVOICE", id, meta).catch(() => null);
  if (!link) notFound();
  const data = await loadPublicInvoice(link);
  if (!data) notFound();
  await recordInvoiceView({ ...link, firstView: false }, meta);
  const i = data.invoice;
  const payable = i.balanceCents > 0 && ["OPEN", "SENT", "VIEWED", "PARTIALLY_PAID"].includes(i.status);
  let online = false;
  try { online = getPaymentProvider().supportsOnlinePayments; } catch { online = false; }
  return (
    <PublicShell brand={data.brand} back={{ href: `/portal/${token}`, label: "Back to portal" }}>
      <div className="mb-4 flex justify-end"><a href={`/api/public/portal/${token}/invoices/${id}/pdf`} className="inline-flex items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-medium shadow-sm hover:bg-surface-2"><Icon name="download" size={14} /> Download PDF</a></div>
      <InvoiceBody data={data} />
      {payable && <div className="mt-5 rounded-xl border border-line bg-surface p-5 shadow-sm">{online ? <PayButton token={token} invoiceId={id} brandColor={data.brand.brandColor} label={`Pay ${formatMoney(i.balanceCents, data.currency)} securely`} /> : <p className="text-[14px] text-fg-2">To pay this invoice, please contact {data.brand.companyName}{data.brand.phone ? ` at ${data.brand.phone}` : ""}.</p>}</div>}
    </PublicShell>
  );
}
