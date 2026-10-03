import type { Metadata } from "next";
import Link from "next/link";
import { invoiceOpenAction, sendReceiptAction, voidInvoiceAction, voidPaymentAction } from "@/app/actions/sales";
import { RecordPaymentDialog, SendInvoiceDialog } from "@/components/documents/invoice-actions";
import { FilesPanel } from "@/components/records/files-panel";
import { NotesPanel } from "@/components/records/notes-panel";
import { Timeline } from "@/components/records/timeline";
import { ConfirmAction, QuickAction } from "@/components/ui/client";
import { Badge, Card, DefList, EmptyState, LinkButton, Money, Notice, PageHeader, StatusBadge, Tabs } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
import { can } from "@/server/auth/context";
import { listAttachments } from "@/server/domain/attachments";
import { getInvoice } from "@/server/domain/invoices";
import { listMentionable, listNotes } from "@/server/domain/notes";
import { toNumber } from "@/server/domain/shared";
import { effectiveInvoiceStatus } from "@/lib/state";
import { formatAddress, formatDateOnly, formatDateTime, humanize } from "@/lib/format";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx, tz, currency } = await pageCtx();
  const inv = await getInvoice(ctx, id);
  const tab = ["overview", "notes", "files", "activity"].includes(sp.tab ?? "") ? sp.tab! : "overview";
  const status = effectiveInvoiceStatus(inv);
  const payable = ["OPEN", "SENT", "VIEWED", "PARTIALLY_PAID"].includes(inv.status) && inv.balanceCents > 0;
  const costs = can(ctx, "pricebook.view_costs");
  const cost = costs ? inv.lineItems.reduce((s, l) => s + Math.round(toNumber(l.quantity) * l.unitCostCents), 0) : 0;
  return (
    <>
      <PageHeader title={<span><span className="font-mono text-base text-fg-3">{inv.number}</span> {inv.title ?? "Invoice"}</span>} breadcrumbs={[{ label: "Invoices", href: "/invoices" }, { label: inv.number }]} badges={<StatusBadge status={status} label={status === "PAST_DUE" ? "Past due" : undefined} />}
        subtitle={<span><Link href={`/customers/${inv.customer.id}`} className="hover:text-primary hover:underline">{inv.customer.displayName}</Link>{inv.location ? ` · ${formatAddress(inv.location)}` : ""}</span>}
        actions={<>
          {inv.status === "DRAFT" && can(ctx, "invoices.edit") && <LinkButton href={`/invoices/${id}/edit`}>Edit</LinkButton>}
          {inv.status === "DRAFT" && can(ctx, "invoices.edit") && <QuickAction label="Finalise" action={invoiceOpenAction.bind(null, id)} />}
          {!["VOID", "PAID"].includes(inv.status) && can(ctx, "invoices.send") && <SendInvoiceDialog invoiceId={id} number={inv.number} defaultTo={inv.customer.email ?? ""} />}
          {payable && can(ctx, "payments.record") && <RecordPaymentDialog invoiceId={id} balanceCents={inv.balanceCents} depositCents={inv.depositRequiredCents} />}
          <a href={`/api/invoices/${id}/pdf`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-2 rounded-md border border-line-strong bg-surface px-3 text-[13px] font-medium shadow-sm hover:bg-surface-2"><Icon name="download" size={14} /> PDF</a>
          {inv.status !== "VOID" && inv.amountPaidCents === 0 && can(ctx, "invoices.void") && <ConfirmAction label="Void" title={`Void ${inv.number}?`} description="Voided invoices are kept for the record but can't be paid. This is logged." askReason reasonLabel="Reason for voiding" confirmLabel="Void invoice" action={voidInvoiceAction.bind(null, id)} />}
        </>} />
      {inv.status === "VOID" && <div className="mb-4"><Notice tone="warn" title="Void">{inv.voidReason}</Notice></div>}
      {status === "PAST_DUE" && <div className="mb-4"><Notice tone="danger" title="Past due">This invoice was due {formatDateOnly(inv.dueDate)} and has an open balance.</Notice></div>}
      <Tabs tabs={[{ key: "overview", label: "Overview" }, ...(can(ctx, "notes.view") ? [{ key: "notes", label: "Notes" }] : []), ...(can(ctx, "files.view") ? [{ key: "files", label: "Attachments" }] : []), { key: "activity", label: "Activity" }]} active={tab} basePath={`/invoices/${id}`} />
      {tab === "overview" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card title="Line items" padded={false}>
              <div className="overflow-x-auto"><table className="w-full text-[13px]"><thead><tr className="border-b border-line bg-surface-2/60 text-left text-xs font-semibold text-fg-3"><th className="px-4 py-2">Item</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Unit price</th><th className="px-3 py-2 text-right">Amount</th></tr></thead>
                <tbody className="divide-y divide-line">{inv.lineItems.map((l) => <tr key={l.id}><td className="px-4 py-2.5"><div className="font-medium">{l.name}</div>{l.description && <div className="text-xs text-fg-3">{l.description}</div>}</td><td className="tabular px-3 text-right">{toNumber(l.quantity)}</td><td className="px-3 text-right"><Money cents={l.unitPriceCents} currency={currency} /></td><td className="px-3 text-right"><Money cents={l.totalCents} currency={currency} /></td></tr>)}</tbody></table></div>
              <dl className="tabular ml-auto max-w-sm space-y-1 px-4 py-4 text-[13px]">
                <div className="flex justify-between"><dt className="text-fg-3">Subtotal</dt><dd><Money cents={inv.subtotalCents} currency={currency} /></dd></div>
                {inv.discountCents > 0 && <div className="flex justify-between"><dt className="text-fg-3">Discount</dt><dd>−<Money cents={inv.discountCents} currency={currency} /></dd></div>}
                <div className="flex justify-between"><dt className="text-fg-3">Tax ({(inv.taxRateBp / 100).toFixed(2)}%)</dt><dd><Money cents={inv.taxCents} currency={currency} /></dd></div>
                <div className="flex justify-between border-t border-line pt-1 text-sm font-semibold"><dt>Total</dt><dd><Money cents={inv.totalCents} currency={currency} /></dd></div>
                {inv.depositRequiredCents > 0 && <div className="flex justify-between text-fg-2"><dt>Deposit required</dt><dd><Money cents={inv.depositRequiredCents} currency={currency} /></dd></div>}
                <div className="flex justify-between text-success"><dt>Paid</dt><dd>−<Money cents={inv.amountPaidCents} currency={currency} /></dd></div>
                <div className="flex justify-between border-t border-line pt-1 text-base font-semibold"><dt>Balance due</dt><dd><Money cents={inv.balanceCents} currency={currency} className={inv.balanceCents > 0 ? "text-danger" : ""} /></dd></div>
              </dl>
            </Card>
            <Card title="Payments" padded={false}>
              {inv.payments.length === 0 ? <EmptyState title="No payments yet" description="Payments recorded against this invoice — partial payments and deposits included — appear here." /> : (
                <ul className="divide-y divide-line">{inv.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1"><div className="text-[13px] font-medium"><Money cents={p.amountCents} currency={currency} /> <span className="font-normal text-fg-3">· {humanize(p.method)}{p.reference ? ` · ${p.reference}` : ""}</span> {p.isDeposit && <Badge tone="blue">Deposit</Badge>}</div><div className="text-xs text-fg-3">{formatDateTime(p.receivedAt, tz)}{p.provider ? ` · ${p.provider}` : ""}{p.status === "VOIDED" ? ` · voided: ${p.voidReason}` : ""}</div></div>
                    <StatusBadge status={p.status} />
                    {p.status === "SUCCEEDED" && <a href={`/api/payments/${p.id}/receipt`} target="_blank" rel="noreferrer" className="text-xs font-medium text-primary hover:underline">Receipt</a>}
                    {p.status === "SUCCEEDED" && inv.customer.email && can(ctx, "payments.view") && <QuickAction size="sm" variant="ghost" label="Email receipt" action={sendReceiptAction.bind(null, p.id)} />}
                    {p.status === "SUCCEEDED" && !p.provider && can(ctx, "payments.void") && <ConfirmAction size="sm" variant="ghost" label="Void" title="Void this payment?" description="The invoice balance is restored. The payment stays on record as voided." askReason confirmLabel="Void payment" action={voidPaymentAction.bind(null, p.id)} />}
                  </li>))}</ul>
              )}
            </Card>
            {(inv.customerNotes || inv.terms) && <Card title="Notes & terms"><DefList cols={1} items={[{ label: "Customer notes", value: inv.customerNotes && <p className="whitespace-pre-line">{inv.customerNotes}</p> }, { label: "Terms", value: inv.terms && <p className="whitespace-pre-line text-fg-2">{inv.terms}</p> }]} /></Card>}
          </div>
          <div className="space-y-6">
            <Card title="Details"><DefList cols={1} items={[{ label: "Issued", value: formatDateOnly(inv.issueDate) }, { label: "Due", value: formatDateOnly(inv.dueDate) }, { label: "Terms", value: inv.paymentTermsDays === 0 ? "Due on receipt" : `Net ${inv.paymentTermsDays}` }, { label: "Job", value: inv.job && <Link className="hover:text-primary hover:underline" href={`/jobs/${inv.job.id}`}>{inv.job.number}</Link> }, { label: "Quote", value: inv.quote && <Link className="hover:text-primary hover:underline" href={`/quotes/${inv.quote.id}`}>{inv.quote.number}</Link> }, ...(costs && cost > 0 ? [{ label: "Est. margin", value: <span><Money cents={inv.subtotalCents - inv.discountCents - cost} currency={currency} /> ({Math.round(((inv.subtotalCents - inv.discountCents - cost) / Math.max(1, inv.subtotalCents - inv.discountCents)) * 100)}%)</span> }] : []), ...(inv.internalNotes ? [{ label: "Internal notes", value: inv.internalNotes }] : [])]} /></Card>
            <Card title="Customer delivery">
              <ol className="space-y-2 text-[13px]">{([["Emailed", inv.sentAt], ["Viewed", inv.viewedAt], ["Paid in full", inv.paidAt]] as const).filter(([, d]) => d).map(([l, d]) => <li key={l} className="flex justify-between"><span className="text-fg-3">{l}</span><span>{formatDateTime(d, tz)}</span></li>)}{!inv.sentAt && <li className="text-fg-3">Not sent yet.</li>}</ol>
              {inv.link && <p className="mt-3 border-t border-line pt-2 text-xs text-fg-3">Secure link opened {inv.link.viewCount} time{inv.link.viewCount === 1 ? "" : "s"}.</p>}
              {inv.emails.length > 0 && <ul className="mt-3 space-y-1 border-t border-line pt-2 text-xs">{inv.emails.map((m) => <li key={m.id} className="flex justify-between gap-2"><span className="truncate text-fg-2">{m.toEmail}</span><span className={m.status === "FAILED" ? "text-danger" : "text-fg-3"}>{humanize(m.status)}</span></li>)}</ul>}
            </Card>
          </div>
        </div>
      )}
      {tab === "notes" && <INotes />}
      {tab === "files" && <IFiles />}
      {tab === "activity" && <IActivity />}
    </>
  );

  async function INotes() {
    const [notes, mentionable] = await Promise.all([listNotes(ctx, "INVOICE", id), listMentionable(ctx)]);
    return <NotesPanel entityType="INVOICE" entityId={id} mentionable={mentionable} currentUserId={ctx.userId} canCreate={can(ctx, "notes.create")} canManage={can(ctx, "notes.manage")} notes={notes.map((n) => ({ id: n.id, type: n.type, body: n.body, isPinned: n.isPinned, isPrivate: n.isPrivate, authorId: n.authorId, authorName: n.authorName, createdAt: n.createdAt.toISOString(), editedAt: n.editedAt?.toISOString() ?? null, revisions: n._count.revisions }))} />;
  }
  async function IFiles() {
    const files = await listAttachments(ctx, "INVOICE", id);
    return <FilesPanel entityType="INVOICE" entityId={id} tz={tz} defaultKind="RECEIPT" canUpload={can(ctx, "files.upload")} canDelete={can(ctx, "files.delete")} files={files.map((f) => ({ id: f.id, filename: f.filename, mimeType: f.mimeType, sizeBytes: f.sizeBytes, kind: f.kind, caption: f.caption, createdAt: f.createdAt.toISOString() }))} />;
  }
  async function IActivity() {
    const rows = await ctx.db.activity.findMany({ where: { entityType: "INVOICE", entityId: id }, orderBy: { createdAt: "desc" }, take: 100 });
    return <Card>{rows.length ? <Timeline items={rows} tz={tz} /> : <EmptyState title="No activity yet" description="Sends, views and payments are recorded here." />}</Card>;
  }
}
