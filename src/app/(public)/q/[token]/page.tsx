import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { QuoteResponse } from "@/components/public/response";
import { PublicShell, QuoteBody } from "@/components/public/views";
import { Notice } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
import { resolvePublicLink } from "@/server/domain/public-links";
import { loadPublicQuote, recordQuoteView } from "@/server/domain/quotes";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your quote" };

export default async function PublicQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const h = await headers();
  const meta = { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim(), userAgent: h.get("user-agent") ?? undefined };
  const link = await resolvePublicLink(token, "QUOTE", meta).catch(() => null);
  if (!link) notFound();
  const data = await loadPublicQuote(link);
  if (!data) notFound();
  await recordQuoteView(link, meta);
  const q = data.quote;
  const open = ["SENT", "VIEWED", "READY"].includes(q.status);
  return (
    <PublicShell brand={data.brand}>
      <div className="mb-4 flex justify-end"><a href={`/api/public/q/${token}/pdf`} className="inline-flex items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[13px] font-medium shadow-sm hover:bg-surface-2"><Icon name="download" size={14} /> Download PDF</a></div>
      {q.status === "APPROVED" || q.status === "CONVERTED" ? <div className="mb-5"><Notice tone="success" title="Quote approved">Thank you{q.approvedAt ? ` — approved ${formatDateTime(q.approvedAt, data.timezone)}` : ""}. We'll be in touch to schedule the work.</Notice></div> : null}
      {q.status === "DECLINED" && <div className="mb-5"><Notice tone="warn" title="Quote declined">This quote was declined{q.declinedAt ? ` on ${formatDateTime(q.declinedAt, data.timezone)}` : ""}. Contact us if you'd like a revised quote.</Notice></div>}
      {q.status === "EXPIRED" && <div className="mb-5"><Notice tone="warn" title="This quote has expired">Please contact {data.brand.companyName} for an updated quote.</Notice></div>}
      <QuoteBody data={data} />
      {open && <div className="mt-5"><QuoteResponse token={token} quoteId={null} brandColor={data.brand.brandColor} currency={data.currency} requireSignature={data.requireSignature} options={q.options.map((o) => ({ id: o.id, name: o.name, totalCents: o.totalCents, isRecommended: o.isRecommended }))} /></div>}
    </PublicShell>
  );
}
