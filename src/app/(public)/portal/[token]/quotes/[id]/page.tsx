import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { QuoteResponse } from "@/components/public/response";
import { PublicShell, QuoteBody } from "@/components/public/views";
import { Icon } from "@/components/ui/icon";
import { Notice } from "@/components/ui/primitives";
import { resolveDocumentLink } from "@/server/domain/public-links";
import { loadPublicQuote, recordQuoteView } from "@/server/domain/quotes";

export const dynamic = "force-dynamic";
export const metadata = { title: "Quote" };

export default async function PortalQuote({ params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const h = await headers();
  const meta = { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim(), userAgent: h.get("user-agent") ?? undefined };
  const link = await resolveDocumentLink(token, "QUOTE", id, meta).catch(() => null);
  if (!link) notFound();
  const data = await loadPublicQuote(link);
  if (!data) notFound();
  await recordQuoteView({ ...link, firstView: false }, meta);
  const q = data.quote;
  return (
    <PublicShell brand={data.brand} back={{ href: `/portal/${token}`, label: "Back to portal" }}>
      <div className="mb-4 flex justify-end"><a href={`/api/public/portal/${token}/quotes/${id}/pdf`} className="inline-flex items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-medium shadow-sm hover:bg-surface-2"><Icon name="download" size={14} /> Download PDF</a></div>
      {(q.status === "APPROVED" || q.status === "CONVERTED") && <div className="mb-5"><Notice tone="success" title="Quote approved">Thank you — we'll be in touch to schedule the work.</Notice></div>}
      {q.status === "DECLINED" && <div className="mb-5"><Notice tone="warn" title="Quote declined">Contact us if you'd like a revised quote.</Notice></div>}
      {q.status === "EXPIRED" && <div className="mb-5"><Notice tone="warn" title="This quote has expired">Please contact us for an updated quote.</Notice></div>}
      <QuoteBody data={data} />
      {["SENT", "VIEWED", "READY"].includes(q.status) && <div className="mt-5"><QuoteResponse token={token} quoteId={id} brandColor={data.brand.brandColor} currency={data.currency} requireSignature={data.requireSignature} options={q.options.map((o) => ({ id: o.id, name: o.name, totalCents: o.totalCents, isRecommended: o.isRecommended }))} /></div>}
    </PublicShell>
  );
}
