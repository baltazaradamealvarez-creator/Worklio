import type { Metadata } from "next";
import Link from "next/link";
import { FilterBar } from "@/components/data/client";
import { DataTable, withParams, type Column, type SP } from "@/components/data/data-table";
import { LeadStatusMenu } from "@/components/leads/client";
import { Icon } from "@/components/ui/icon";
import { Badge, EmptyState, LinkButton, Money, PageHeader, StatusBadge } from "@/components/ui/primitives";
import { can } from "@/server/auth/context";
import { LEAD_STATUSES, leadBoard, listLeads } from "@/server/domain/leads";
import { parseListParams } from "@/server/domain/list";
import { formatPhone, humanize, relativeTime } from "@/lib/format";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Leads" };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { ctx, currency } = await pageCtx();
  const view = sp.view === "list" ? "list" : "board";
  const canManage = can(ctx, "leads.manage");
  const toggle = (
    <div className="inline-flex rounded-md border border-line-strong bg-surface p-0.5 text-xs font-medium shadow-sm" role="group" aria-label="View">
      {(["board", "list"] as const).map((v) => <Link key={v} href={withParams("/leads", sp, { view: v === "board" ? undefined : v })} aria-current={view === v} className={`rounded px-2.5 py-1 capitalize ${view === v ? "bg-fg text-white" : "text-fg-2 hover:bg-surface-2"}`}>{v}</Link>)}
    </div>
  );
  const actions = <>{toggle}{canManage && <LinkButton href="/leads/new" variant="primary"><Icon name="plus" size={14} /> New lead</LinkButton>}</>;

  if (view === "board") {
    const columns = await leadBoard(ctx);
    const open = columns.filter((c) => !["WON", "LOST"].includes(c.status)).flatMap((c) => c.leads);
    const pipeline = open.reduce((s, l) => s + l.estimatedValueCents, 0);
    if (columns.every((c) => c.leads.length === 0)) {
      return <><PageHeader title="Leads" subtitle="Track every inquiry from first contact to won job." actions={actions} /><div className="rounded-lg border border-line bg-surface"><EmptyState icon={<Icon name="funnel" size={18} />} title="No leads yet" description="Capture calls, web requests and referrals here. When a lead is won, convert it into a customer, location, job and quote without retyping anything." action={canManage && <LinkButton href="/leads/new" variant="primary">Add your first lead</LinkButton>} /></div></>;
    }
    return (
      <>
        <PageHeader title="Leads" subtitle={`${open.length} open · pipeline value `} actions={actions} />
        <p className="-mt-4 mb-4 text-[13px] text-fg-3"><span className="font-medium text-fg-2"><Money cents={pipeline} currency={currency} /></span> estimated</p>
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 lg:-mx-8 lg:px-8">
          {columns.map((col) => (
            <section key={col.status} aria-label={humanize(col.status)} className="w-64 shrink-0">
              <header className="mb-2 px-1">
                <h2 className="truncate text-xs font-semibold uppercase tracking-wide text-fg-3">{humanize(col.status)}</h2>
                <div className="text-xs text-fg-3 tabular">{col.leads.length} lead{col.leads.length === 1 ? "" : "s"} · <Money cents={col.leads.reduce((s, l) => s + l.estimatedValueCents, 0)} currency={currency} /></div>
              </header>
              <div className="space-y-2 rounded-lg bg-surface-2/70 p-2">
                {col.leads.length === 0 && <p className="px-2 py-6 text-center text-xs text-fg-3">No leads</p>}
                {col.leads.map((l) => (
                  <article key={l.id} className="rounded-md border border-line bg-surface p-3 shadow-sm">
                    <Link href={`/leads/${l.id}`} className="block text-[13px] font-semibold hover:text-primary">{l.displayName}</Link>
                    <p className="mt-0.5 line-clamp-2 text-xs text-fg-2">{l.requestedService ?? "No service noted"}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">{l.source && <Badge>{l.source}</Badge>}{l.estimatedValueCents > 0 && <Badge tone="green"><Money cents={l.estimatedValueCents} currency={currency} /></Badge>}</div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-fg-3"><span>{l.assignedToName ?? "Unassigned"} · {relativeTime(l.createdAt)}</span>{canManage && <LeadStatusMenu id={l.id} status={l.status} converted={!!l.convertedAt} />}</div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </>
    );
  }

  const p = parseListParams(sp, { sortable: ["createdAt", "value", "status", "name"], defaultSort: "createdAt", filters: ["status", "source"] });
  const page = await listLeads(ctx, p);
  type Row = (typeof page.rows)[number];
  const cols: Column<Row>[] = [
    { key: "name", header: "Lead", sortKey: "name", fixed: true, cell: (r) => r.displayName },
    { key: "service", header: "Requested service", from: "md", cell: (r) => r.requestedService ?? "—" },
    { key: "contact", header: "Contact", from: "lg", cell: (r) => <div className="leading-tight"><div>{formatPhone(r.phone)}</div><div className="text-xs text-fg-3">{r.email}</div></div> },
    { key: "source", header: "Source", from: "lg", cell: (r) => r.source ?? "—" },
    { key: "owner", header: "Salesperson", from: "xl", cell: (r) => r.assignedToName ?? "—" },
    { key: "value", header: "Est. value", sortKey: "value", align: "right", cell: (r) => <Money cents={r.estimatedValueCents} currency={currency} muted /> },
    { key: "status", header: "Status", sortKey: "status", cell: (r) => <StatusBadge status={r.status} /> },
    { key: "created", header: "Created", sortKey: "createdAt", from: "xl", cell: (r) => <span className="text-fg-3">{relativeTime(r.createdAt)}</span> },
  ];
  return (
    <>
      <PageHeader title="Leads" subtitle="Track every inquiry from first contact to won job." actions={actions} />
      <FilterBar searchPlaceholder="Search name, phone, email, service…" filters={[{ name: "status", label: "Status", options: LEAD_STATUSES.map((s) => ({ value: s, label: humanize(s) })) }, { name: "source", label: "Source", type: "text" }]} />
      <DataTable id="leads-table" columns={cols} page={page} sp={sp} basePath="/leads" sort={p.sort} dir={p.dir} rowHref={(r) => `/leads/${r.id}`} empty={<EmptyState title="No leads" description="Add a lead to start tracking it through your pipeline." />} />
    </>
  );
}
