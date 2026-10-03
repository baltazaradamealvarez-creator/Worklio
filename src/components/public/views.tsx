import Link from "next/link";
import type { ReactNode } from "react";
import { formatAddress, formatDateOnly, formatDateTime, humanize } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { toNumber } from "@/server/domain/shared";
import type { loadPublicQuote } from "@/server/domain/quotes";
import type { loadPublicInvoice } from "@/server/domain/invoices";
import { StatusBadge } from "@/components/ui/primitives";

export function PublicShell({ brand, children, back }: { brand: { companyName: string; brandColor: string; logoUrl: string | null; phone: string | null; email: string | null; address: string | null; website: string | null }; children: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">{brand.logoUrl ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={brand.logoUrl} alt={brand.companyName} className="h-10 max-w-[180px] object-contain" /> : <span className="flex size-10 items-center justify-center rounded-lg text-lg font-bold text-white" style={{ background: brand.brandColor }}>{brand.companyName[0]}</span>}<span className="text-base font-semibold">{brand.companyName}</span></div>
        {back && <Link href={back.href} className="text-[13px] font-medium" style={{ color: brand.brandColor }}>← {back.label}</Link>}
      </header>
      {children}
      <footer className="mt-10 border-t border-line pt-4 text-center text-xs text-fg-3">{[brand.companyName, brand.address, brand.phone, brand.email].filter(Boolean).join(" · ")}<div className="mt-1">Powered by Worklio</div></footer>
    </div>
  );
}

type PQ = NonNullable<Awaited<ReturnType<typeof loadPublicQuote>>>;

export function QuoteBody({ data, selectedOptionId }: { data: PQ; selectedOptionId?: string | null }) {
  const { quote: q, currency, brand, introText, footerText } = data;
  const fmt = (c: number) => formatMoney(c, currency);
  const approved = q.options.find((o) => o.id === q.approvedOptionId);
  const shown = approved ? [approved] : q.options;
  return (
    <article className="space-y-5">
      <section className="rounded-xl border border-line bg-surface p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-xs font-semibold uppercase tracking-wide text-fg-3">Quote {q.number}</p><h1 className="mt-0.5 text-xl font-semibold tracking-tight">{q.title}</h1><p className="mt-1 text-[13px] text-fg-2">Prepared for {q.customerName}{q.location ? ` · ${formatAddress(q.location)}` : ""}</p></div>
          <StatusBadge status={q.status} />
        </div>
        <p className="mt-3 text-[13px] text-fg-3">Issued {formatDateOnly(q.issueDate)}{q.expiresAt ? ` · valid until ${formatDateOnly(q.expiresAt)}` : ""}</p>
        {introText && <p className="mt-3 whitespace-pre-line text-[14px] text-fg-2">{introText}</p>}
      </section>
      {shown.map((o) => (
        <section key={o.id} className={`rounded-xl border bg-surface shadow-sm ${o.id === selectedOptionId ? "border-primary" : "border-line"}`} style={o.isRecommended && shown.length > 1 ? { borderColor: brand.brandColor } : undefined}>
          {shown.length > 1 && <header className="flex items-center justify-between border-b border-line px-5 py-3"><div><h2 className="text-[15px] font-semibold">{o.name}{o.isRecommended && <span className="ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: brand.brandColor }}>Recommended</span>}</h2>{o.description && <p className="text-[13px] text-fg-3">{o.description}</p>}</div><div className="tabular text-lg font-semibold">{fmt(o.totalCents)}</div></header>}
          <ul className="divide-y divide-line px-5">
            {o.lines.map((l) => (
              <li key={l.id} className="flex items-start justify-between gap-4 py-3"><div className="min-w-0"><div className="text-[14px] font-medium">{l.name}</div>{l.description && <div className="text-[13px] text-fg-3">{l.description}</div>}{l.discountType !== "NONE" && <div className="text-xs text-success">{l.discountType === "PERCENT" ? `${l.discountValue / 100}% discount applied` : `${fmt(l.discountValue)} discount applied`}</div>}</div><div className="shrink-0 text-right text-[13px]"><div className="tabular font-medium">{fmt(l.totalCents)}</div>{toNumber(l.quantity) !== 1 && <div className="text-xs text-fg-3">{toNumber(l.quantity)} × {fmt(l.unitPriceCents)}</div>}</div></li>
            ))}
          </ul>
          <dl className="tabular ml-auto max-w-xs space-y-1 border-t border-line px-5 py-4 text-[13px]">
            <div className="flex justify-between"><dt className="text-fg-3">Subtotal</dt><dd>{fmt(o.subtotalCents)}</dd></div>
            {o.discountCents > 0 && <div className="flex justify-between"><dt className="text-fg-3">Discount</dt><dd>−{fmt(o.discountCents)}</dd></div>}
            <div className="flex justify-between"><dt className="text-fg-3">Tax ({(q.taxRateBp / 100).toFixed(2)}%)</dt><dd>{fmt(o.taxCents)}</dd></div>
            <div className="flex justify-between border-t border-line pt-1.5 text-base font-semibold"><dt>Total</dt><dd>{fmt(o.totalCents)}</dd></div>
            {o.depositCents > 0 && <div className="flex justify-between text-fg-2"><dt>Deposit due at approval</dt><dd>{fmt(o.depositCents)}</dd></div>}
          </dl>
        </section>
      ))}
      {q.customerNotes && <section className="rounded-xl border border-line bg-surface p-5 text-[14px] shadow-sm"><h2 className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-fg-3">Notes</h2><p className="whitespace-pre-line">{q.customerNotes}</p></section>}
      {q.terms && <section className="rounded-xl border border-line bg-surface p-5 shadow-sm"><h2 className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-fg-3">Terms & conditions</h2><p className="whitespace-pre-line text-[13px] text-fg-2">{q.terms}</p></section>}
      {footerText && <p className="text-center text-[13px] text-fg-3">{footerText}</p>}
    </article>
  );
}

type PI = NonNullable<Awaited<ReturnType<typeof loadPublicInvoice>>>;

export function InvoiceBody({ data }: { data: PI }) {
  const { invoice: i, currency, timezone, footer } = data;
  const fmt = (c: number) => formatMoney(c, currency);
  const overdue = ["OPEN", "SENT", "VIEWED", "PARTIALLY_PAID"].includes(i.status) && i.balanceCents > 0 && i.dueDate.getTime() + 86_400_000 <= Date.now();
  return (
    <article className="space-y-5">
      <section className="rounded-xl border border-line bg-surface p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-xs font-semibold uppercase tracking-wide text-fg-3">Invoice {i.number}</p><h1 className="mt-0.5 text-xl font-semibold tracking-tight">{i.title ?? "Invoice"}</h1><p className="mt-1 text-[13px] text-fg-2">Billed to {i.customer.displayName}{i.location ? ` · ${formatAddress(i.location)}` : ""}</p></div>
          <StatusBadge status={overdue ? "PAST_DUE" : i.status} />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3"><div><dt className="text-xs text-fg-3">Issued</dt><dd className="text-[14px]">{formatDateOnly(i.issueDate)}</dd></div><div><dt className="text-xs text-fg-3">Due</dt><dd className={`text-[14px] ${overdue ? "font-semibold text-danger" : ""}`}>{formatDateOnly(i.dueDate)}</dd></div><div><dt className="text-xs text-fg-3">Balance due</dt><dd className="tabular text-xl font-semibold">{fmt(i.balanceCents)}</dd></div></dl>
      </section>
      <section className="rounded-xl border border-line bg-surface shadow-sm">
        <ul className="divide-y divide-line px-5">{i.lineItems.map((l) => <li key={l.id} className="flex items-start justify-between gap-4 py-3"><div className="min-w-0"><div className="text-[14px] font-medium">{l.name}</div>{l.description && <div className="text-[13px] text-fg-3">{l.description}</div>}</div><div className="shrink-0 text-right text-[13px]"><div className="tabular font-medium">{fmt(l.totalCents)}</div>{toNumber(l.quantity) !== 1 && <div className="text-xs text-fg-3">{toNumber(l.quantity)} × {fmt(l.unitPriceCents)}</div>}</div></li>)}</ul>
        <dl className="tabular ml-auto max-w-xs space-y-1 border-t border-line px-5 py-4 text-[13px]">
          <div className="flex justify-between"><dt className="text-fg-3">Subtotal</dt><dd>{fmt(i.subtotalCents)}</dd></div>
          {i.discountCents > 0 && <div className="flex justify-between"><dt className="text-fg-3">Discount</dt><dd>−{fmt(i.discountCents)}</dd></div>}
          <div className="flex justify-between"><dt className="text-fg-3">Tax ({(i.taxRateBp / 100).toFixed(2)}%)</dt><dd>{fmt(i.taxCents)}</dd></div>
          <div className="flex justify-between border-t border-line pt-1.5 text-base font-semibold"><dt>Total</dt><dd>{fmt(i.totalCents)}</dd></div>
          {i.amountPaidCents > 0 && <div className="flex justify-between text-success"><dt>Paid</dt><dd>−{fmt(i.amountPaidCents)}</dd></div>}
          <div className="flex justify-between text-base font-semibold"><dt>Balance due</dt><dd>{fmt(i.balanceCents)}</dd></div>
        </dl>
      </section>
      {i.payments.length > 0 && <section className="rounded-xl border border-line bg-surface p-5 shadow-sm"><h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-fg-3">Payments received</h2><ul className="divide-y divide-line text-[13px]">{i.payments.map((p) => <li key={p.id} className="flex justify-between py-2"><span>{formatDateTime(p.receivedAt, timezone)} · {humanize(p.method)}{p.reference ? ` · ${p.reference}` : ""}</span><span className="tabular font-medium">{fmt(p.amountCents)}</span></li>)}</ul></section>}
      {(i.customerNotes || i.terms) && <section className="rounded-xl border border-line bg-surface p-5 text-[13px] shadow-sm">{i.customerNotes && <p className="mb-3 whitespace-pre-line text-[14px]">{i.customerNotes}</p>}{i.terms && <p className="whitespace-pre-line text-fg-2">{i.terms}</p>}</section>}
      {footer && <p className="text-center text-[13px] text-fg-3">{footer}</p>}
    </article>
  );
}
