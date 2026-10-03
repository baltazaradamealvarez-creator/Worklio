import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PortalContactForm, PortalMessageForm } from "@/components/public/response";
import { PublicShell } from "@/components/public/views";
import { StatusBadge } from "@/components/ui/primitives";
import { loadPortal } from "@/server/domain/portal";
import { resolvePublicLink, touchPublicLink } from "@/server/domain/public-links";
import { formatAddress, formatDate, formatDateOnly, formatDateTime } from "@/lib/format";
import { effectiveInvoiceStatus } from "@/lib/state";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";
export const metadata = { title: "Customer portal" };

function Section({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return <section id={id} className="rounded-xl border border-line bg-surface shadow-sm"><h2 className="border-b border-line px-5 py-3 text-[15px] font-semibold">{title}</h2><div className="p-5">{children}</div></section>;
}

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const h = await headers();
  const link = await resolvePublicLink(token, "PORTAL", { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() }).catch(() => null);
  if (!link) notFound();
  const data = await loadPortal(link);
  if (!data) notFound();
  await touchPublicLink(link);
  const fmt = (c: number) => formatMoney(c, data.currency);
  const owing = data.invoices.filter((i) => i.balanceCents > 0 && ["OPEN", "SENT", "VIEWED", "PARTIALLY_PAID"].includes(i.status));
  const totalDue = owing.reduce((s, i) => s + i.balanceCents, 0);
  return (
    <PublicShell brand={data.brand}>
      <h1 className="text-2xl font-semibold tracking-tight">Hello, {data.customer.displayName.split(" ")[0]}</h1>
      <p className="mb-6 mt-1 text-[14px] text-fg-3">Your quotes, invoices, appointments and service history in one place.</p>
      <div className="space-y-5">
        {totalDue > 0 && <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-warn-soft px-5 py-4"><div><div className="text-[13px] text-warn">Balance due</div><div className="tabular text-2xl font-semibold">{fmt(totalDue)}</div></div><a href="#invoices" className="rounded-lg px-4 py-2 text-[14px] font-semibold text-white" style={{ background: data.brand.brandColor }}>View invoices</a></div>}
        <Section title="Upcoming appointments">
          {data.appointments.length === 0 ? <p className="text-[14px] text-fg-3">Nothing scheduled. Message us below to book service.</p> : <ul className="divide-y divide-line">{data.appointments.map((a) => <li key={a.id} className="py-3 first:pt-0 last:pb-0"><div className="flex items-start justify-between gap-3"><div><div className="text-[15px] font-medium">{formatDateTime(a.startsAt, data.timezone)}</div><div className="text-[13px] text-fg-2">{a.job.title}</div><div className="text-xs text-fg-3">{formatAddress(a.job.location)}{a.assignees.length ? ` · ${a.assignees.map((x) => x.employee.firstName).join(", ")}` : ""}</div></div><StatusBadge status={a.status === "SCHEDULED" ? "SCHEDULED" : a.status} /></div></li>)}</ul>}
        </Section>
        <Section title="Quotes">
          {data.quotes.length === 0 ? <p className="text-[14px] text-fg-3">No quotes.</p> : <ul className="divide-y divide-line">{data.quotes.map((q) => <li key={q.id}><Link href={`/portal/${token}/quotes/${q.id}`} className="flex items-center justify-between gap-3 py-3 hover:text-primary"><div><div className="text-[14px] font-medium">{q.number} · {q.title}</div><div className="text-xs text-fg-3">Issued {formatDateOnly(q.issueDate)}</div></div><div className="flex items-center gap-3"><span className="tabular text-[14px]">{fmt(q.totalCents)}</span><StatusBadge status={q.status} /></div></Link></li>)}</ul>}
        </Section>
        <Section title="Invoices" id="invoices">
          {data.invoices.length === 0 ? <p className="text-[14px] text-fg-3">No invoices.</p> : <ul className="divide-y divide-line">{data.invoices.map((i) => <li key={i.id}><Link href={`/portal/${token}/invoices/${i.id}`} className="flex items-center justify-between gap-3 py-3 hover:text-primary"><div><div className="text-[14px] font-medium">{i.number}{i.title ? ` · ${i.title}` : ""}</div><div className="text-xs text-fg-3">Due {formatDateOnly(i.dueDate)}</div></div><div className="flex items-center gap-3"><span className="tabular text-[14px]">{i.balanceCents > 0 ? `${fmt(i.balanceCents)} due` : fmt(i.totalCents)}</span><StatusBadge status={effectiveInvoiceStatus(i)} /></div></Link></li>)}</ul>}
        </Section>
        {data.agreements.length > 0 && <Section title="Maintenance plans"><ul className="divide-y divide-line">{data.agreements.map((a) => <li key={a.id} className="py-3 first:pt-0 last:pb-0"><div className="text-[14px] font-medium">{a.name}</div><div className="text-xs text-fg-3">{a.completed} of {a.includedVisits} visits completed · renews {formatDateOnly(a.renewalDate)}</div>{a.includedServices && <p className="mt-1 text-[13px] text-fg-2">{a.includedServices}</p>}</li>)}</ul></Section>}
        <Section title="Service history">{data.history.length === 0 ? <p className="text-[14px] text-fg-3">No completed visits yet.</p> : <ul className="divide-y divide-line">{data.history.map((j) => <li key={j.id} className="py-3 first:pt-0 last:pb-0"><div className="text-[14px] font-medium">{j.title}</div><div className="text-xs text-fg-3">{j.actualEnd ? formatDate(j.actualEnd, data.timezone) : ""} · {j.jobType?.name ?? "Service"} · {j.location.addressLine1}</div>{j.customerNotes && <p className="mt-1 text-[13px] text-fg-2">{j.customerNotes}</p>}</li>)}</ul>}</Section>
        <Section title="Your contact information"><PortalContactForm token={token} customer={data.customer} /></Section>
        <Section title={`Message ${data.brand.companyName}`}><PortalMessageForm token={token} /></Section>
      </div>
    </PublicShell>
  );
}
