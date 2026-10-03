import type { Metadata } from "next";
import Link from "next/link";
import { archiveCustomerAction, addLocationAction, archiveLocationAction, restoreCustomerAction, removeContactAction, saveContactAction, updateLocationAction } from "@/app/actions/customers";
import { LocationFields } from "@/components/customers/forms";
import { ActionForm, ConfirmAction, Dialog, FField, SubmitButton, QuickAction, Menu } from "@/components/ui/client";
import { Badge, Button, Card, Checkbox, DefList, EmptyState, Input, LinkButton, Money, PageHeader, Select, Stat, StatusBadge, Tabs } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
import { MiniTable } from "@/components/ui/mini-table";
import { FilesPanel } from "@/components/records/files-panel";
import { NotesPanel } from "@/components/records/notes-panel";
import { NoteBody } from "@/components/records/note-body";
import { Timeline } from "@/components/records/timeline";
import { can } from "@/server/auth/context";
import { getCustomer, customerSummary, customerTimeline, listCustomerEmails } from "@/server/domain/customers";
import { listCustomerAttachments } from "@/server/domain/attachments";
import { listCustomerEquipment } from "@/server/domain/equipment";
import { listJobs } from "@/server/domain/jobs";
import { listAgreements } from "@/server/domain/maintenance";
import { listCustomerNotes, listMentionable } from "@/server/domain/notes";
import { listPayments } from "@/server/domain/payments";
import { listInvoices } from "@/server/domain/invoices";
import { listQuotes } from "@/server/domain/quotes";
import { listCustomerTasks } from "@/server/domain/tasks";
import { parseListParams } from "@/server/domain/list";
import { effectiveInvoiceStatus } from "@/lib/state";
import { formatAddress, formatDate, formatDateOnly, formatDateTime, formatPhone, humanize, mapsUrl } from "@/lib/format";
import { pageCtx } from "@/server/page-context";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const { ctx } = await pageCtx();
  const c = await getCustomer(ctx, id).catch(() => null);
  return { title: c?.displayName ?? "Customer" };
}

const filt = (customer: string) => parseListParams({ customer, pageSize: "50" }, { sortable: ["createdAt", "issueDate", "scheduledStart", "receivedAt"], defaultSort: "createdAt", filters: ["customer"] });

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; noteType?: string; before?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx, tz, currency } = await pageCtx();
  const [c, summary] = await Promise.all([getCustomer(ctx, id), customerSummary(ctx, id)]);
  const showFin = can(ctx, "invoices.view");
  const tabs = [
    { key: "overview", label: "Overview" }, { key: "locations", label: "Locations", count: c.locations.length }, ...(can(ctx, "equipment.view") ? [{ key: "equipment", label: "Equipment" }] : []),
    ...(can(ctx, "jobs.view") || can(ctx, "jobs.view_assigned") ? [{ key: "jobs", label: "Jobs" }] : []), ...(can(ctx, "quotes.view") ? [{ key: "quotes", label: "Quotes" }] : []),
    ...(showFin ? [{ key: "invoices", label: "Invoices" }] : []), ...(can(ctx, "payments.view") ? [{ key: "payments", label: "Payments" }] : []),
    ...(can(ctx, "maintenance.view") ? [{ key: "maintenance", label: "Maintenance" }] : []), ...(can(ctx, "notes.view") ? [{ key: "notes", label: "Notes" }] : []),
    ...(can(ctx, "files.view") ? [{ key: "files", label: "Files" }] : []), { key: "emails", label: "Emails" }, { key: "activity", label: "Activity" },
  ];
  const tab = tabs.some((t) => t.key === sp.tab) ? sp.tab! : "overview";
  const primary = c.locations.find((l) => l.isPrimary) ?? c.locations[0];

  return (
    <>
      <PageHeader
        title={c.displayName}
        breadcrumbs={[{ label: "Customers", href: "/customers" }, { label: c.displayName }]}
        badges={<><StatusBadge status={c.status} />{c.deletedAt && <Badge tone="red">Archived</Badge>}<Badge>{humanize(c.type)}</Badge>{c.taxExempt && <Badge tone="blue">Tax exempt</Badge>}</>}
        subtitle={<span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {c.phone && <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1.5 hover:text-primary"><Icon name="phone" size={13} />{formatPhone(c.phone)}</a>}
          {c.email && <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1.5 hover:text-primary"><Icon name="mail" size={13} />{c.email}</a>}
          {primary && <a href={mapsUrl(formatAddress(primary))} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-primary"><Icon name="map-pin" size={13} />{formatAddress(primary)}</a>}
        </span>}
        actions={<>
          {showFin && <div className="mr-2 text-right"><div className="text-[11px] font-medium uppercase tracking-wide text-fg-3">Balance</div><Money cents={summary.balanceCents} currency={currency} className={`text-lg font-semibold ${summary.balanceCents > 0 ? "text-danger" : ""}`} /></div>}
          {can(ctx, "jobs.create") && <LinkButton href={`/jobs/new?customer=${id}`}>New job</LinkButton>}
          {can(ctx, "quotes.create") && <LinkButton href={`/quotes/new?customer=${id}`}>New quote</LinkButton>}
          {can(ctx, "invoices.create") && <LinkButton href={`/invoices/new?customer=${id}`}>New invoice</LinkButton>}
          <Menu trigger={<span className="inline-flex h-8 items-center rounded-md border border-line-strong bg-surface px-2 shadow-sm hover:bg-surface-2"><Icon name="more-horizontal" size={16} /></span>}>
            {can(ctx, "customers.edit") && <Link href={`/customers/${id}/edit`} role="menuitem" className="block px-3 py-1.5 text-[13px] hover:bg-surface-2">Edit customer</Link>}
            {can(ctx, "tasks.manage") && <Link href={`/tasks?new=1&customer=${id}`} role="menuitem" className="block px-3 py-1.5 text-[13px] hover:bg-surface-2">Add task</Link>}
          </Menu>
          {can(ctx, "customers.delete") && (c.deletedAt
            ? <QuickAction label="Restore" action={restoreCustomerAction.bind(null, id)} />
            : <ConfirmAction label="Archive" title={`Archive ${c.displayName}?`} description="Archived customers are hidden from lists and search but keep all history. Customers with open balances or jobs can't be archived." confirmLabel="Archive" action={archiveCustomerAction.bind(null, id)} />)}
        </>}
      />
      <Tabs tabs={tabs} active={tab} basePath={`/customers/${id}`} />

      {tab === "overview" && <Overview />}
      {tab === "locations" && <Locations />}
      {tab === "equipment" && <EquipmentTab />}
      {tab === "jobs" && <JobsTab />}
      {tab === "quotes" && <QuotesTab />}
      {tab === "invoices" && <InvoicesTab />}
      {tab === "payments" && <PaymentsTab />}
      {tab === "maintenance" && <MaintenanceTab />}
      {tab === "notes" && <NotesTab />}
      {tab === "files" && <FilesTab />}
      {tab === "emails" && <EmailsTab />}
      {tab === "activity" && <ActivityTab />}
    </>
  );

  // ───────── Tabs (each loads only its own data) ─────────

  async function Overview() {
    const [tl, notes, tasks, equipment, agreements] = await Promise.all([
      customerTimeline(ctx, id, { take: 8 }),
      can(ctx, "notes.view") ? listCustomerNotes(ctx, id) : [],
      can(ctx, "tasks.view") ? listCustomerTasks(ctx, id) : [],
      can(ctx, "equipment.view") ? listCustomerEquipment(ctx, id) : [],
      can(ctx, "maintenance.view") ? listAgreements(ctx, filt(id)) : null,
    ]);
    const pinned = notes.filter((n) => n.isPinned);
    return (
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {showFin && <Stat label="Balance due" value={<Money cents={summary.balanceCents} currency={currency} />} tone={summary.balanceCents > 0 ? "danger" : undefined} sub={`${summary.openInvoices} open invoice${summary.openInvoices === 1 ? "" : "s"}`} href={`/customers/${id}?tab=invoices`} />}
            {showFin && <Stat label="Lifetime paid" value={<Money cents={summary.lifetimePaidCents} currency={currency} />} />}
            <Stat label="Open jobs" value={summary.openJobs} href={`/customers/${id}?tab=jobs`} sub={summary.nextAppointment ? `Next: ${formatDate(summary.nextAppointment.startsAt, tz)}` : "None scheduled"} />
            {can(ctx, "quotes.view") && <Stat label="Open quotes" value={summary.openQuotes} href={`/customers/${id}?tab=quotes`} />}
          </div>
          {pinned.length > 0 && (
            <Card title="Pinned notes" padded={false}>
              <ul className="divide-y divide-line">{pinned.map((n) => <li key={n.id} className={`flex gap-3 px-4 py-3 ${n.type === "WARNING" ? "bg-danger-soft/50" : ""}`}><Icon name={n.type === "WARNING" ? "alert-triangle" : "pin"} size={15} className={n.type === "WARNING" ? "mt-0.5 shrink-0 text-danger" : "mt-0.5 shrink-0 text-warn"} /><div><div className="mb-0.5 text-xs font-semibold text-fg-2">{humanize(n.type)}</div><NoteBody body={n.body} /></div></li>)}</ul>
            </Card>
          )}
          <Card title="Recent activity" padded actions={<LinkButton size="sm" variant="ghost" href={`/customers/${id}?tab=activity`}>View all</LinkButton>}>
            {tl.rows.length ? <Timeline items={tl.rows} tz={tz} /> : <EmptyState title="No activity yet" description="Quotes, jobs, invoices, payments and notes will build a timeline here." />}
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Details">
            <DefList cols={1} items={[
              { label: "Preferred contact", value: humanize(c.preferredContact) }, { label: "Language", value: c.preferredLanguage.toUpperCase() }, { label: "Referral source", value: c.referralSource },
              { label: "Billing address", value: c.billingLine1 ? formatAddress({ addressLine1: c.billingLine1, addressLine2: c.billingLine2, city: c.billingCity, state: c.billingState, postalCode: c.billingPostalCode }) : "Same as service address" },
              { label: "Tags", value: c.tags.length ? <span className="flex flex-wrap gap-1">{c.tags.map((t) => <Badge key={t}>{t}</Badge>)}</span> : null }, { label: "Last service", value: summary.lastServiceAt ? formatDate(summary.lastServiceAt, tz) : null },
              ...(c.accountNotes ? [{ label: "Account notes", value: c.accountNotes }] : []), ...(c.internalNotes ? [{ label: "Internal notes", value: c.internalNotes }] : []),
            ]} />
          </Card>
          <Card title="Contacts" padded={false} actions={can(ctx, "customers.edit") && <ContactDialog />}>
            {c.contacts.length === 0 ? <p className="px-4 py-5 text-center text-[13px] text-fg-3">No additional contacts.</p> : (
              <ul className="divide-y divide-line">{c.contacts.map((ct) => (
                <li key={ct.id} className="px-4 py-2.5"><div className="flex items-center justify-between gap-2"><span className="text-[13px] font-medium">{ct.name} {ct.isPrimary && <Badge tone="blue">Primary</Badge>} {ct.isBilling && <Badge tone="purple">Billing</Badge>}</span>{can(ctx, "customers.edit") && <span className="flex"><ContactDialog contact={ct} /><ConfirmAction size="sm" variant="ghost" label={<Icon name="trash-2" size={13} />} title="Remove contact?" confirmLabel="Remove" action={removeContactAction.bind(null, id, ct.id)} /></span>}</div>
                  <div className="text-xs text-fg-3">{ct.role}{ct.role && (ct.phone || ct.email) ? " · " : ""}{ct.phone && formatPhone(ct.phone)}{ct.phone && ct.email ? " · " : ""}{ct.email}</div></li>
              ))}</ul>
            )}
          </Card>
          {tasks.length > 0 && <Card title="Open tasks" padded={false}><ul className="divide-y divide-line">{tasks.map((t) => <li key={t.id} className="px-4 py-2.5 text-[13px]"><div className="font-medium">{t.title}</div><div className="text-xs text-fg-3">{t.dueAt ? `Due ${formatDate(t.dueAt, tz)}` : "No due date"}</div></li>)}</ul></Card>}
          {agreements && agreements.rows.length > 0 && <Card title="Maintenance plans" padded={false}><ul className="divide-y divide-line">{agreements.rows.map((a) => <li key={a.id}><Link href={`/maintenance/${a.id}`} className="flex items-center justify-between px-4 py-2.5 text-[13px] hover:bg-surface-2/60"><span><span className="font-medium">{a.name}</span><span className="block text-xs text-fg-3">Renews {formatDateOnly(a.renewalDate)} · {a.completedVisits}/{a.includedVisits} visits</span></span><StatusBadge status={a.effectiveStatus} /></Link></li>)}</ul></Card>}
          {equipment.length > 0 && <Card title="Equipment" padded={false} actions={<LinkButton size="sm" variant="ghost" href={`/customers/${id}?tab=equipment`}>All</LinkButton>}><ul className="divide-y divide-line">{equipment.slice(0, 5).map((e) => <li key={e.id}><Link href={`/equipment/${e.id}`} className="block px-4 py-2.5 text-[13px] hover:bg-surface-2/60"><span className="font-medium">{[e.manufacturer, e.model].filter(Boolean).join(" ") || humanize(e.type)}</span><span className="block text-xs text-fg-3">{humanize(e.type)} · {e.location.name}{e.installDate ? ` · installed ${formatDateOnly(e.installDate)}` : ""}</span></Link></li>)}</ul></Card>}
        </div>
      </div>
    );
  }

  function ContactDialog({ contact }: { contact?: (typeof c.contacts)[number] }) {
    return (
      <Dialog title={contact ? "Edit contact" : "Add contact"} trigger={contact ? <Button variant="ghost" size="sm"><Icon name="pencil" size={13} /></Button> : <Button size="sm" variant="secondary"><Icon name="plus" size={13} /> Add</Button>}>
        {(
          <ActionForm action={saveContactAction.bind(null, id, contact?.id ?? null)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FField label="Name" name="name" required><Input name="name" defaultValue={contact?.name ?? ""} required /></FField>
              <FField label="Role" name="role"><Input name="role" defaultValue={contact?.role ?? ""} placeholder="Property manager, spouse…" /></FField>
              <FField label="Phone" name="phone"><Input name="phone" type="tel" defaultValue={contact?.phone ?? ""} /></FField>
              <FField label="Email" name="email"><Input name="email" type="email" defaultValue={contact?.email ?? ""} /></FField>
            </div>
            <FField label="Associated location" name="locationId"><Select name="locationId" defaultValue={contact?.locationId ?? ""}><option value="">All locations</option>{c.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></FField>
            <div className="flex gap-6"><Checkbox name="isPrimary" defaultChecked={contact?.isPrimary} label="Primary contact" /><Checkbox name="isBilling" defaultChecked={contact?.isBilling} label="Billing contact" /></div>
            <div className="flex justify-end"><SubmitButton>Save contact</SubmitButton></div>
          </ActionForm>
        )}
      </Dialog>
    );
  }

  async function Locations() {
    const equipment = can(ctx, "equipment.view") ? await listCustomerEquipment(ctx, id) : [];
    const jobs = can(ctx, "jobs.view") || can(ctx, "jobs.view_assigned") ? await listJobs(ctx, filt(id)) : null;
    return (
      <div className="space-y-4">
        {can(ctx, "customers.edit") && (
          <div className="flex justify-end">
            <Dialog title="Add location" description="A property or site this customer owns or manages." width="max-w-2xl" trigger={<Button variant="primary"><Icon name="plus" size={14} /> Add location</Button>}>
              {<ActionForm action={addLocationAction.bind(null, id)}><LocationFields canSeeCodes={can(ctx, "access_codes.view")} /><div className="mt-4 flex justify-end"><SubmitButton>Add location</SubmitButton></div></ActionForm>}
            </Dialog>
          </div>
        )}
        {c.locations.map((l) => {
          const eq = equipment.filter((e) => e.locationId === l.id);
          const jobCount = jobs?.rows.filter((j) => j.location.addressLine1 === l.addressLine1).length ?? 0;
          return (
            <Card key={l.id} title={<span className="flex items-center gap-2">{l.name}{l.isPrimary && <Badge tone="blue">Primary</Badge>}</span>} actions={<>{can(ctx, "customers.edit") && <EditLocation l={l} />}</>}>
              <div className="grid gap-6 md:grid-cols-3">
                <DefList cols={1} items={[{ label: "Service address", value: <a href={mapsUrl(formatAddress(l))} target="_blank" rel="noreferrer" className="hover:text-primary hover:underline">{formatAddress(l)}</a> }, { label: "On-site contact", value: l.onSiteContactName ? `${l.onSiteContactName}${l.onSiteContactPhone ? ` · ${formatPhone(l.onSiteContactPhone)}` : ""}` : null }, { label: "Billing", value: l.billToCustomer ? "Billed to customer" : "Separate billing" }]} />
                <DefList cols={1} items={[{ label: "Gate / access", value: l.gateInstructions }, { label: "Parking", value: l.parkingInstructions }, ...(can(ctx, "access_codes.view") ? [{ label: "Access codes", value: l.accessCodes ? <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">{l.accessCodes}</code> : null }] : [])]} />
                <div>
                  <div className="text-xs font-medium text-fg-3">Equipment ({eq.length})</div>
                  <ul className="mt-1 space-y-1 text-[13px]">{eq.slice(0, 4).map((e) => <li key={e.id}><Link href={`/equipment/${e.id}`} className="hover:text-primary hover:underline">{[e.manufacturer, e.model].filter(Boolean).join(" ") || humanize(e.type)}</Link></li>)}{eq.length === 0 && <li className="text-fg-3">None recorded</li>}</ul>
                  {jobCount > 0 && <div className="mt-2 text-xs text-fg-3">{jobCount} job{jobCount === 1 ? "" : "s"} at this location</div>}
                </div>
              </div>
              {l.notes && <p className="mt-3 border-t border-line pt-3 text-[13px] text-fg-2">{l.notes}</p>}
            </Card>
          );
        })}
      </div>
    );
  }

  function EditLocation({ l }: { l: (typeof c.locations)[number] }) {
    return (
      <Dialog title={`Edit ${l.name}`} width="max-w-2xl" trigger={<Button size="sm" variant="ghost"><Icon name="pencil" size={13} /> Edit</Button>}>
        {(
          <div className="space-y-4">
            <ActionForm action={updateLocationAction.bind(null, l.id)}><LocationFields l={l} canSeeCodes={can(ctx, "access_codes.view")} /><div className="mt-4 flex justify-end"><SubmitButton>Save location</SubmitButton></div></ActionForm>
            {!l.isPrimary && <div className="border-t border-line pt-3"><ConfirmAction label="Remove location" title="Remove this location?" description="Locations with open jobs or equipment can't be removed." confirmLabel="Remove" action={archiveLocationAction.bind(null, l.id)} /></div>}
          </div>
        )}
      </Dialog>
    );
  }

  async function EquipmentTab() {
    const equipment = await listCustomerEquipment(ctx, id);
    return (
      <div className="space-y-3">
        {can(ctx, "equipment.manage") && <div className="flex justify-end"><LinkButton href={`/equipment/new?customer=${id}`} variant="primary"><Icon name="plus" size={14} /> Add equipment</LinkButton></div>}
        <MiniTable rows={equipment} href={(e) => `/equipment/${e.id}`} empty={{ title: "No equipment recorded", description: "Track furnaces, condensers, heat pumps and more — with serial numbers, warranties and full service history.", action: can(ctx, "equipment.manage") && <LinkButton href={`/equipment/new?customer=${id}`} variant="primary">Add equipment</LinkButton> }}
          columns={[{ header: "Equipment", cell: (e) => [e.manufacturer, e.model].filter(Boolean).join(" ") || humanize(e.type) }, { header: "Type", cell: (e) => humanize(e.type) }, { header: "Serial #", cell: (e) => e.serialNumber ?? "—" }, { header: "Location", cell: (e) => e.location.name }, { header: "Installed", cell: (e) => formatDateOnly(e.installDate) }, { header: "Condition", cell: (e) => <StatusBadge status={e.condition} /> }]} />
      </div>
    );
  }

  async function JobsTab() {
    const jobs = await listJobs(ctx, filt(id));
    return <MiniTable rows={jobs.rows} href={(j) => `/jobs/${j.id}`} empty={{ title: "No jobs yet", description: "Jobs are the work you perform for this customer, from first call to completion.", action: can(ctx, "jobs.create") && <LinkButton href={`/jobs/new?customer=${id}`} variant="primary">Create a job</LinkButton> }}
      columns={[{ header: "Job", cell: (j) => j.number }, { header: "Title", cell: (j) => j.title }, { header: "Type", cell: (j) => j.jobType?.name ?? "—" }, { header: "Scheduled", cell: (j) => j.scheduledStart ? formatDateTime(j.scheduledStart, tz) : "—" }, { header: "Status", cell: (j) => <StatusBadge status={j.status} /> }]} />;
  }

  async function QuotesTab() {
    const q = await listQuotes(ctx, filt(id));
    return <MiniTable rows={q.rows} href={(x) => `/quotes/${x.id}`} empty={{ title: "No quotes yet", description: "Quotes let the customer review options and approve online.", action: can(ctx, "quotes.create") && <LinkButton href={`/quotes/new?customer=${id}`} variant="primary">Create quote</LinkButton> }}
      columns={[{ header: "Quote", cell: (x) => x.number }, { header: "Title", cell: (x) => x.title }, { header: "Issued", cell: (x) => formatDateOnly(x.issueDate) }, { header: "Total", align: "right", cell: (x) => <Money cents={x.totalCents} currency={currency} /> }, { header: "Status", cell: (x) => <StatusBadge status={x.status} /> }]} />;
  }

  async function InvoicesTab() {
    const inv = await listInvoices(ctx, filt(id));
    return <MiniTable rows={inv.rows} href={(x) => `/invoices/${x.id}`} empty={{ title: "No invoices yet", description: "Invoices are created from completed jobs or approved quotes.", action: can(ctx, "invoices.create") && <LinkButton href={`/invoices/new?customer=${id}`} variant="primary">Create invoice</LinkButton> }}
      columns={[{ header: "Invoice", cell: (x) => x.number }, { header: "Issued", cell: (x) => formatDateOnly(x.issueDate) }, { header: "Due", cell: (x) => formatDateOnly(x.dueDate) }, { header: "Total", align: "right", cell: (x) => <Money cents={x.totalCents} currency={currency} /> }, { header: "Balance", align: "right", cell: (x) => <Money cents={x.balanceCents} currency={currency} muted /> }, { header: "Status", cell: (x) => <StatusBadge status={effectiveInvoiceStatus(x)} /> }]} />;
  }

  async function PaymentsTab() {
    const pay = await listPayments(ctx, filt(id));
    return <MiniTable rows={pay.rows} empty={{ title: "No payments yet", description: "Payments recorded against this customer's invoices appear here." }}
      columns={[{ header: "Received", cell: (p) => formatDateTime(p.receivedAt, tz) }, { header: "Invoice", cell: (p) => <Link href={`/invoices/${p.invoice.id}`} className="hover:text-primary hover:underline">{p.invoice.number}</Link> }, { header: "Method", cell: (p) => humanize(p.method) }, { header: "Reference", cell: (p) => p.reference ?? "—" }, { header: "Amount", align: "right", cell: (p) => <Money cents={p.amountCents} currency={currency} /> }]} />;
  }

  async function MaintenanceTab() {
    const a = await listAgreements(ctx, filt(id));
    return <MiniTable rows={a.rows} href={(x) => `/maintenance/${x.id}`} empty={{ title: "No maintenance plans", description: "Recurring maintenance agreements bring predictable revenue and loyal customers.", action: can(ctx, "maintenance.manage") && <LinkButton href={`/maintenance/new?customer=${id}`} variant="primary">New agreement</LinkButton> }}
      columns={[{ header: "Plan", cell: (x) => `${x.number} · ${x.name}` }, { header: "Location", cell: (x) => x.location.name }, { header: "Renews", cell: (x) => formatDateOnly(x.renewalDate) }, { header: "Visits", cell: (x) => `${x.completedVisits} of ${x.includedVisits}` }, { header: "Price", align: "right", cell: (x) => <Money cents={x.priceCents} currency={currency} /> }, { header: "Status", cell: (x) => <StatusBadge status={x.effectiveStatus} /> }]} />;
  }

  async function NotesTab() {
    const [notes, mentionable] = await Promise.all([listCustomerNotes(ctx, id), listMentionable(ctx)]);
    return <NotesPanel entityType="CUSTOMER" entityId={id} mentionable={mentionable} currentUserId={ctx.userId} canCreate={can(ctx, "notes.create")} canManage={can(ctx, "notes.manage")} notes={notes.map((n) => ({ id: n.id, type: n.type, body: n.body, isPinned: n.isPinned, isPrivate: n.isPrivate, authorId: n.authorId, authorName: n.authorName, createdAt: n.createdAt.toISOString(), editedAt: n.editedAt?.toISOString() ?? null, revisions: n._count.revisions }))} />;
  }

  async function FilesTab() {
    const files = await listCustomerAttachments(ctx, id);
    return <FilesPanel entityType="CUSTOMER" entityId={id} tz={tz} canUpload={can(ctx, "files.upload")} canDelete={can(ctx, "files.delete")} files={files.map((f) => ({ id: f.id, filename: f.filename, mimeType: f.mimeType, sizeBytes: f.sizeBytes, kind: f.kind, caption: f.caption, createdAt: f.createdAt.toISOString() }))} />;
  }

  async function EmailsTab() {
    const mails = await listCustomerEmails(ctx, id);
    return <MiniTable rows={mails} empty={{ title: "No emails sent", description: "Quotes, invoices, receipts and reminders sent from Worklio are recorded here." }}
      columns={[{ header: "Sent", cell: (m) => formatDateTime(m.sentAt ?? m.createdAt, tz) }, { header: "Subject", cell: (m) => m.subject }, { header: "To", cell: (m) => m.toEmail }, { header: "Type", cell: (m) => humanize(m.template) }, { header: "Status", cell: (m) => <StatusBadge status={m.status === "SENT" ? "ACTIVE" : m.status === "FAILED" ? "FAILED" : "PENDING"} label={humanize(m.status)} /> }]} />;
  }

  async function ActivityTab() {
    const before = sp.before ? new Date(sp.before) : undefined;
    const tl = await customerTimeline(ctx, id, { take: 40, before: before && !Number.isNaN(before.getTime()) ? before : undefined });
    return (
      <Card>
        {tl.rows.length === 0 ? <EmptyState title="No activity" description="Nothing has happened on this customer yet." /> : <Timeline items={tl.rows} tz={tz} />}
        {tl.hasMore && <div className="mt-4 text-center"><LinkButton href={`/customers/${id}?tab=activity&before=${tl.rows.at(-1)!.createdAt.toISOString()}`} variant="secondary">Load older activity</LinkButton></div>}
      </Card>
    );
  }
}
