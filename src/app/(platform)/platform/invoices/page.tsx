import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Button, Card, EmptyState, Input, Money, PageHeader, Select, StatusBadge } from "@/components/ui/primitives";
import { listAllInvoices, revenueByCompany } from "@/server/domain/platform-admin";
import { formatDateOnly } from "@/lib/format";

export const metadata: Metadata = { title: "Invoices · Platform" };

export default async function PlatformInvoices({ searchParams }: { searchParams: Promise<{ q?: string; tenant?: string; status?: string; page?: string }> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const [list, companies] = await Promise.all([listAllInvoices({ q: sp.q, tenantId: sp.tenant, status: sp.status, page }), revenueByCompany()]);
  const qs = (p: number) => { const u = new URLSearchParams({ page: String(p) }); for (const k of ["q", "tenant", "status"] as const) if (sp[k]) u.set(k, sp[k]!); return `/platform/invoices?${u}`; };
  const totals = companies.reduce((a, c) => ({ inv: a.inv + c.invoicedCents, col: a.col + c.collectedCents, out: a.out + c.outstandingCents }), { inv: 0, col: 0, out: 0 });
  return (
    <>
      <PageHeader title="Invoices & revenue" subtitle="Every company's billing in one place. Read-only — open a company as support to act inside it." />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card><div className="text-xs text-fg-3">Invoiced (all companies)</div><Money cents={totals.inv} className="text-xl font-semibold" /></Card>
        <Card><div className="text-xs text-fg-3">Collected</div><Money cents={totals.col} className="text-xl font-semibold text-success" /></Card>
        <Card><div className="text-xs text-fg-3">Outstanding</div><Money cents={totals.out} className="text-xl font-semibold" /></Card>
      </div>
      <Card title="By company" padded={false} className="mb-6">
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-[13px]"><thead><tr className="border-b border-line bg-surface-2/60 text-left text-xs font-semibold text-fg-3"><th className="px-4 py-2">Company</th><th className="px-3 py-2 text-right">Invoices</th><th className="px-3 py-2 text-right">Invoiced</th><th className="px-3 py-2 text-right">Collected</th><th className="px-3 py-2 text-right">Outstanding</th></tr></thead>
          <tbody className="divide-y divide-line">{companies.map((c) => <tr key={c.id}><td className="px-4 py-2"><Link href={`/platform/invoices?tenant=${c.id}`} className="font-medium hover:text-primary hover:underline">{c.name}</Link> {c.status === "SUSPENDED" && <Badge tone="red">Suspended</Badge>}</td><td className="tabular px-3 text-right">{c.invoiceCount}</td><td className="px-3 text-right"><Money cents={c.invoicedCents} /></td><td className="px-3 text-right"><Money cents={c.collectedCents} /></td><td className="px-3 text-right"><Money cents={c.outstandingCents} /></td></tr>)}</tbody></table></div>
      </Card>
      <form action="/platform/invoices" className="mb-4 flex flex-wrap gap-3">
        <Input name="q" defaultValue={sp.q ?? ""} placeholder="Search invoice #, customer, company…" className="w-72" />
        <Select name="tenant" defaultValue={sp.tenant ?? ""} className="w-52"><option value="">All companies</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Select name="status" defaultValue={sp.status ?? ""} className="w-40"><option value="">All statuses</option>{["DRAFT", "OPEN", "SENT", "VIEWED", "PARTIALLY_PAID", "PAID", "VOID"].map((s) => <option key={s} value={s}>{s.replace("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}</option>)}</Select>
        <Button type="submit">Filter</Button>
      </form>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        {list.rows.length === 0 ? <EmptyState title="No invoices" description="Nothing matches these filters." /> : (
          <table className="w-full min-w-[820px] text-[13px]"><thead><tr className="border-b border-line bg-surface-2/60 text-left text-xs font-semibold text-fg-3"><th className="px-3 py-2">Invoice</th><th className="px-3 py-2">Company</th><th className="px-3 py-2">Customer</th><th className="px-3 py-2">Issued</th><th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2 text-right">Balance</th><th className="px-3 py-2">Status</th></tr></thead>
            <tbody className="divide-y divide-line">{list.rows.map((r) => <tr key={r.id}><td className="px-3 py-2 font-mono text-xs">{r.number}</td><td className="px-3"><Link href={`/platform/companies/${r.tenant.id}`} className="hover:text-primary hover:underline">{r.tenant.name}</Link></td><td className="px-3 text-fg-2">{r.customer.displayName}</td><td className="px-3">{formatDateOnly(r.issueDate)}</td><td className="px-3 text-right"><Money cents={r.totalCents} /></td><td className="px-3 text-right"><Money cents={r.balanceCents} muted={r.balanceCents === 0} /></td><td className="px-3"><StatusBadge status={r.status} /></td></tr>)}</tbody></table>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-fg-3"><span>{list.total.toLocaleString()} invoices · matching total <Money cents={list.totalCents} /> · balance <Money cents={list.balanceCents} /></span><span className="flex gap-3">{page > 1 && <Link className="text-primary" href={qs(page - 1)}>← Newer</Link>}{page * list.pageSize < list.total && <Link className="text-primary" href={qs(page + 1)}>Older →</Link>}</span></div>
    </>
  );
}
