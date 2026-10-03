import type { Metadata } from "next";
import Link from "next/link";
import { deleteQuoteAction, quoteReadyAction, reviseQuoteAction } from "@/app/actions/sales";
import { ConvertDialog, DecisionDialog, SendQuoteDialog } from "@/components/documents/quote-actions";
import { FilesPanel } from "@/components/records/files-panel";
import { NotesPanel } from "@/components/records/notes-panel";
import { Timeline } from "@/components/records/timeline";
import { ConfirmAction, QuickAction } from "@/components/ui/client";
import { Badge, Card, DefList, EmptyState, LinkButton, Money, PageHeader, StatusBadge, Tabs } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
import { can } from "@/server/auth/context";
import { listAttachments } from "@/server/domain/attachments";
import { listMentionable, listNotes } from "@/server/domain/notes";
import { getQuote } from "@/server/domain/quotes";
import { toNumber } from "@/server/domain/shared";
import { formatAddress, formatDateOnly, formatDateTime, humanize } from "@/lib/format";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Quote" };

export default async function QuotePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx, tz, currency } = await pageCtx();
  const q = await getQuote(ctx, id);
  const tab = ["overview", "notes", "files", "activity"].includes(sp.tab ?? "") ? sp.tab! : "overview";
  const editable = q.status === "DRAFT" || q.status === "READY";
  const sendable = !["APPROVED", "CONVERTED", "DECLINED"].includes(q.status);
  const costs = can(ctx, "pricebook.view_costs");
  const locs = q.locationId ? [] : (await ctx.db.customerLocation.findMany({ where: { customerId: q.customerId, deletedAt: null }, select: { id: true, name: true } }));
  return (
    <>
      <PageHeader title={<span><span className="font-mono text-base text-fg-3">{q.number}</span> {q.title}</span>} breadcrumbs={[{ label: "Quotes", href: "/quotes" }, { label: q.number }]} badges={<StatusBadge status={q.status} />}
        subtitle={<span><Link href={`/customers/${q.customer.id}`} className="hover:text-primary hover:underline">{q.customer.displayName}</Link>{q.location ? ` · ${formatAddress(q.location)}` : ""}</span>}
        actions={<>
          {editable && can(ctx, "quotes.edit") && <LinkButton href={`/quotes/${id}/edit`}>Edit</LinkButton>}
          {q.status === "DRAFT" && can(ctx, "quotes.edit") && <QuickAction label="Mark ready" action={quoteReadyAction.bind(null, id)} />}
          {sendable && can(ctx, "quotes.send") && <SendQuoteDialog quoteId={id} number={q.number} defaultTo={q.customer.email ?? ""} resend={q.status === "SENT" || q.status === "VIEWED"} />}
          {["SENT", "VIEWED", "READY", "DRAFT"].includes(q.status) && can(ctx, "quotes.approve") && <><DecisionDialog quoteId={id} decision="APPROVED" options={q.options.map((o) => ({ id: o.id, name: o.name }))} /><DecisionDialog quoteId={id} decision="DECLINED" options={[]} /></>}
          {q.status === "APPROVED" && can(ctx, "quotes.edit") && <ConvertDialog quoteId={id} needsLocation={!q.locationId} locations={locs} canJob={can(ctx, "jobs.create")} canInvoice={can(ctx, "invoices.create")} />}
          {["SENT", "VIEWED", "DECLINED", "EXPIRED"].includes(q.status) && can(ctx, "quotes.edit") && <ConfirmAction variant="secondary" label="Revise" title="Reopen this quote for editing?" description="The customer's current link stops working until you send the revised quote." confirmLabel="Reopen" action={reviseQuoteAction.bind(null, id)} />}
          <a href={`/api/quotes/${id}/pdf`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-2 rounded-md border border-line-strong bg-surface px-3 text-[13px] font-medium shadow-sm hover:bg-surface-2"><Icon name="download" size={14} /> PDF</a>
          {["DRAFT", "READY", "DECLINED", "EXPIRED"].includes(q.status) && can(ctx, "quotes.edit") && <ConfirmAction label="Delete" title="Delete this quote?" confirmLabel="Delete" action={deleteQuoteAction.bind(null, id)} />}
        </>} />
      <Tabs tabs={[{ key: "overview", label: "Overview" }, ...(can(ctx, "notes.view") ? [{ key: "notes", label: "Notes" }] : []), ...(can(ctx, "files.view") ? [{ key: "files", label: "Attachments" }] : []), { key: "activity", label: "Activity" }]} active={tab} basePath={`/quotes/${id}`} />
      {tab === "overview" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {q.options.map((o) => {
              const chosen = o.id === q.approvedOptionId;
              return (
                <Card key={o.id} padded={false} title={<span className="flex items-center gap-2">{q.options.length > 1 ? o.name : "Line items"}{o.isRecommended && q.options.length > 1 && <Badge tone="blue">Recommended</Badge>}{chosen && <Badge tone="green">Approved</Badge>}</span>} description={o.description ?? undefined} className={chosen ? "ring-2 ring-success/40" : undefined}>
                  <div className="overflow-x-auto"><table className="w-full text-[13px]"><thead><tr className="border-b border-line bg-surface-2/60 text-left text-xs font-semibold text-fg-3"><th className="px-4 py-2">Item</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Unit price</th><th className="px-3 py-2 text-right">Total</th>{costs && <th className="px-3 py-2 text-right text-fg-3">Cost</th>}</tr></thead>
                    <tbody className="divide-y divide-line">{o.lineItems.map((l) => <tr key={l.id}><td className="px-4 py-2.5"><div className="font-medium">{l.name}</div>{l.description && <div className="text-xs text-fg-3">{l.description}</div>}{l.discountType !== "NONE" && <div className="text-xs text-success">{l.discountType === "PERCENT" ? `${l.discountValue / 100}% off` : <>−<Money cents={l.discountValue} currency={currency} /></>}</div>}</td><td className="tabular px-3 text-right">{toNumber(l.quantity)}</td><td className="px-3 text-right"><Money cents={l.unitPriceCents} currency={currency} /></td><td className="px-3 text-right"><Money cents={l.totalCents} currency={currency} /></td>{costs && <td className="px-3 text-right text-fg-3"><Money cents={Math.round(toNumber(l.quantity) * l.unitCostCents)} currency={currency} /></td>}</tr>)}</tbody></table></div>
                  <dl className="tabular ml-auto max-w-xs space-y-1 px-4 py-3 text-[13px]">
                    <div className="flex justify-between"><dt className="text-fg-3">Subtotal</dt><dd><Money cents={o.subtotalCents} currency={currency} /></dd></div>
                    {o.discountCents > 0 && <div className="flex justify-between"><dt className="text-fg-3">Discount</dt><dd>−<Money cents={o.discountCents} currency={currency} /></dd></div>}
                    <div className="flex justify-between"><dt className="text-fg-3">Tax ({(q.taxRateBp / 100).toFixed(2)}%)</dt><dd><Money cents={o.taxCents} currency={currency} /></dd></div>
                    <div className="flex justify-between border-t border-line pt-1 text-sm font-semibold"><dt>Total</dt><dd><Money cents={o.totalCents} currency={currency} /></dd></div>
                    {o.depositCents > 0 && <div className="flex justify-between text-fg-2"><dt>Deposit required</dt><dd><Money cents={o.depositCents} currency={currency} /></dd></div>}
                  </dl>
                </Card>
              );
            })}
            {(q.customerNotes || q.terms) && <Card title="Notes & terms"><DefList cols={1} items={[{ label: "Customer notes", value: q.customerNotes && <p className="whitespace-pre-line">{q.customerNotes}</p> }, { label: "Terms", value: q.terms && <p className="whitespace-pre-line text-fg-2">{q.terms}</p> }]} /></Card>}
          </div>
          <div className="space-y-6">
            <Card title="Customer response">
              <ol className="space-y-3 text-[13px]">
                {([["Created", q.createdAt], ["Emailed", q.sentAt], ["Viewed", q.viewedAt], ["Approved", q.approvedAt], ["Declined", q.declinedAt]] as const).filter(([, d]) => d).map(([label, d]) => <li key={label} className="flex justify-between"><span className="text-fg-3">{label}</span><span>{formatDateTime(d, tz)}</span></li>)}
              </ol>
              {q.link && <p className="mt-3 border-t border-line pt-2 text-xs text-fg-3">Secure link opened {q.link.viewCount} time{q.link.viewCount === 1 ? "" : "s"}{q.link.revokedAt ? " · link revoked" : q.link.expiresAt ? ` · expires ${formatDateOnly(q.link.expiresAt)}` : ""}</p>}
              {q.customerMessage && <p className="mt-3 rounded-md bg-surface-2 p-2.5 text-[13px]">“{q.customerMessage}”</p>}
              {q.declineReason && <p className="mt-3 rounded-md bg-danger-soft p-2.5 text-[13px]">Declined: {q.declineReason}</p>}
              {q.signature && <p className="mt-3 text-xs text-fg-3">Signed by <strong className="text-fg">{q.signature.signerName}</strong> on {formatDateTime(q.signature.signedAt, tz)}</p>}
            </Card>
            <Card title="Details"><DefList cols={1} items={[{ label: "Issued", value: formatDateOnly(q.issueDate) }, { label: "Expires", value: formatDateOnly(q.expiresAt) }, { label: "Salesperson", value: q.salesperson ? `${q.salesperson.firstName} ${q.salesperson.lastName}` : null }, { label: "Version", value: `v${q.version}` }, ...(q.internalNotes ? [{ label: "Internal notes", value: q.internalNotes }] : [])]} /></Card>
            {(q.job || q.invoices.length > 0) && <Card title="Created from this quote" padded={false}><ul className="divide-y divide-line text-[13px]">{q.job && <li><Link href={`/jobs/${q.job.id}`} className="flex items-center justify-between px-4 py-2.5 hover:bg-surface-2/60"><span>Job {q.job.number}</span><StatusBadge status={q.job.status} /></Link></li>}{q.invoices.map((i) => <li key={i.id}><Link href={`/invoices/${i.id}`} className="flex items-center justify-between px-4 py-2.5 hover:bg-surface-2/60"><span>Invoice {i.number}</span><StatusBadge status={i.status} /></Link></li>)}</ul></Card>}
            <Card title="Emails" padded={false}>{q.emails.length === 0 ? <p className="px-4 py-5 text-center text-[13px] text-fg-3">Not emailed yet.</p> : <ul className="divide-y divide-line text-[13px]">{q.emails.map((m) => <li key={m.id} className="px-4 py-2.5"><div className="flex items-center justify-between gap-2"><span className="truncate">{m.toEmail}</span><StatusBadge status={m.status === "SENT" ? "ACTIVE" : m.status === "FAILED" ? "FAILED" : "PENDING"} label={humanize(m.status)} /></div><div className="text-xs text-fg-3">{m.sentAt ? formatDateTime(m.sentAt, tz) : "—"}{m.error ? ` · ${m.error}` : ""}</div></li>)}</ul>}</Card>
          </div>
        </div>
      )}
      {tab === "notes" && <QNotes />}
      {tab === "files" && <QFiles />}
      {tab === "activity" && <QActivity />}
    </>
  );

  async function QNotes() {
    const [notes, mentionable] = await Promise.all([listNotes(ctx, "QUOTE", id), listMentionable(ctx)]);
    return <NotesPanel entityType="QUOTE" entityId={id} mentionable={mentionable} currentUserId={ctx.userId} canCreate={can(ctx, "notes.create")} canManage={can(ctx, "notes.manage")} notes={notes.map((n) => ({ id: n.id, type: n.type, body: n.body, isPinned: n.isPinned, isPrivate: n.isPrivate, authorId: n.authorId, authorName: n.authorName, createdAt: n.createdAt.toISOString(), editedAt: n.editedAt?.toISOString() ?? null, revisions: n._count.revisions }))} />;
  }
  async function QFiles() {
    const files = await listAttachments(ctx, "QUOTE", id);
    return <FilesPanel entityType="QUOTE" entityId={id} tz={tz} canUpload={can(ctx, "files.upload")} canDelete={can(ctx, "files.delete")} files={files.map((f) => ({ id: f.id, filename: f.filename, mimeType: f.mimeType, sizeBytes: f.sizeBytes, kind: f.kind, caption: f.caption, createdAt: f.createdAt.toISOString() }))} />;
  }
  async function QActivity() {
    const rows = await ctx.db.activity.findMany({ where: { entityType: "QUOTE", entityId: id }, orderBy: { createdAt: "desc" }, take: 100 });
    return <Card>{rows.length ? <Timeline items={rows} tz={tz} /> : <EmptyState title="No activity yet" description="Sends, views and responses are recorded here." />}</Card>;
  }
}

