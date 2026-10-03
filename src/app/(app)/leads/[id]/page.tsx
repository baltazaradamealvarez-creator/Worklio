import type { Metadata } from "next";
import Link from "next/link";
import { archiveLeadAction, convertLeadAction, saveLeadAction } from "@/app/actions/ops";
import { LeadFields } from "@/components/leads/forms";
import { LeadStatusMenu } from "@/components/leads/client";
import { NoteBody } from "@/components/records/note-body";
import { NotesPanel } from "@/components/records/notes-panel";
import { ActionForm, ConfirmAction, Dialog, SubmitButton } from "@/components/ui/client";
import { Badge, Button, Card, Checkbox, DefList, Money, Notice, PageHeader, Select, StatusBadge } from "@/components/ui/primitives";
import { can } from "@/server/auth/context";
import { listAssignableEmployees } from "@/server/domain/employees";
import { getLead } from "@/server/domain/leads";
import { listMentionable, listNotes } from "@/server/domain/notes";
import { formatAddress, formatDate, formatPhone } from "@/lib/format";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Lead" };

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, tz, currency } = await pageCtx();
  const lead = await getLead(ctx, id);
  const [people, notes, mentionable] = await Promise.all([listAssignableEmployees(ctx), can(ctx, "notes.view") ? listNotes(ctx, "LEAD", id) : [], listMentionable(ctx)]);
  const canManage = can(ctx, "leads.manage") && !lead.convertedAt;
  const hasAddress = !!(lead.addressLine1 && lead.city && lead.state && lead.postalCode);
  return (
    <>
      <PageHeader title={lead.displayName} breadcrumbs={[{ label: "Leads", href: "/leads" }, { label: lead.displayName }]} badges={<StatusBadge status={lead.status} />}
        subtitle={lead.requestedService ?? undefined}
        actions={<>
          {can(ctx, "leads.manage") && <LeadStatusMenu id={id} status={lead.status} converted={!!lead.convertedAt} />}
          {canManage && (
            <Dialog title="Convert lead" description="Creates the customer and service location from this lead — nothing to retype." trigger={<Button variant="primary">Convert to customer</Button>}>
              <ActionForm action={convertLeadAction.bind(null, id)} className="space-y-4">
                {!hasAddress && <Notice tone="warn">Add the service address (street, city, state, ZIP) before converting.</Notice>}
                <div className="space-y-1"><label className="block text-[12.5px] font-medium text-fg-2">Customer type</label><Select name="customerType" defaultValue={lead.companyName ? "COMMERCIAL" : "RESIDENTIAL"}><option value="RESIDENTIAL">Residential</option><option value="COMMERCIAL">Commercial</option></Select></div>
                <Checkbox name="createJob" defaultChecked label="Also create a job for the requested service" />
                <Checkbox name="createQuote" label="Also start a draft quote" />
                <Checkbox name="allowDuplicate" label="Create a new customer even if one with the same phone/email exists" />
                <div className="flex justify-end"><SubmitButton disabled={!hasAddress}>Convert</SubmitButton></div>
              </ActionForm>
            </Dialog>
          )}
          {can(ctx, "leads.manage") && <ConfirmAction label="Archive" title="Archive this lead?" confirmLabel="Archive" action={archiveLeadAction.bind(null, id)} />}
        </>} />
      {lead.convertedAt && lead.customer && <div className="mb-4"><Notice tone="success">Converted on {formatDate(lead.convertedAt, tz)} — <Link className="font-medium text-primary underline" href={`/customers/${lead.customer.id}`}>{lead.customer.displayName}</Link></Notice></div>}
      {lead.status === "LOST" && lead.lostReason && <div className="mb-4"><Notice tone="warn" title="Lost">{lead.lostReason}</Notice></div>}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {canManage ? (
            <Card title="Lead details">
              <ActionForm action={saveLeadAction.bind(null, id)} className="space-y-4">
                <LeadFields l={lead} salespeople={people.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}` }))} />
                <div className="flex justify-end"><SubmitButton>Save changes</SubmitButton></div>
              </ActionForm>
            </Card>
          ) : (
            <Card title="Lead details"><DefList items={[{ label: "Phone", value: formatPhone(lead.phone) }, { label: "Email", value: lead.email }, { label: "Address", value: formatAddress(lead) }, { label: "Source", value: lead.source }, { label: "Salesperson", value: lead.assignee ? `${lead.assignee.firstName} ${lead.assignee.lastName}` : null }, { label: "Estimated value", value: <Money cents={lead.estimatedValueCents} currency={currency} /> }, { label: "Notes", value: lead.notes && <NoteBody body={lead.notes} />, wide: true }]} /></Card>
          )}
        </div>
        <div className="space-y-6">
          <Card title="Summary"><DefList cols={1} items={[{ label: "Status", value: <StatusBadge status={lead.status} /> }, { label: "Estimated value", value: <Money cents={lead.estimatedValueCents} currency={currency} /> }, { label: "Source", value: lead.source && <Badge>{lead.source}</Badge> }, { label: "Created", value: formatDate(lead.createdAt, tz) }]} /></Card>
          {can(ctx, "notes.view") && <Card title="Notes"><NotesPanel entityType="LEAD" entityId={id} mentionable={mentionable} currentUserId={ctx.userId} canCreate={can(ctx, "notes.create")} canManage={can(ctx, "notes.manage")} notes={notes.map((n) => ({ id: n.id, type: n.type, body: n.body, isPinned: n.isPinned, isPrivate: n.isPrivate, authorId: n.authorId, authorName: n.authorName, createdAt: n.createdAt.toISOString(), editedAt: n.editedAt?.toISOString() ?? null, revisions: n._count.revisions }))} /></Card>}
        </div>
      </div>
    </>
  );
}
