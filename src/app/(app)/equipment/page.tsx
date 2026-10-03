import type { Metadata } from "next";
import Link from "next/link";
import { FilterBar } from "@/components/data/client";
import { DataTable, type Column, type SP } from "@/components/data/data-table";
import { Icon } from "@/components/ui/icon";
import { EmptyState, LinkButton, PageHeader, StatusBadge } from "@/components/ui/primitives";
import { can } from "@/server/auth/context";
import { CONDITIONS, EQUIPMENT_TYPES, listEquipment } from "@/server/domain/equipment";
import { parseListParams } from "@/server/domain/list";
import { formatDateOnly, humanize } from "@/lib/format";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Equipment" };

export default async function EquipmentPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { ctx } = await pageCtx();
  const p = parseListParams(sp, { sortable: ["createdAt", "installDate", "type", "customer"], defaultSort: "createdAt", filters: ["type", "condition", "warranty", "customer"] });
  const page = await listEquipment(ctx, p);
  type Row = (typeof page.rows)[number];
  const soon = Date.now() + 90 * 86_400_000;
  const warranty = (r: Row) => {
    const d = [r.warrantyExpiresAt, r.equipmentWarrantyExpiresAt, r.laborWarrantyExpiresAt].filter((x): x is Date => !!x).sort((a, b) => a.getTime() - b.getTime()).find((x) => x.getTime() > Date.now());
    if (!d) return <span className="text-fg-3">Expired / none</span>;
    return <span className={d.getTime() < soon ? "font-medium text-warn" : ""}>{formatDateOnly(d)}</span>;
  };
  const cols: Column<Row>[] = [
    { key: "unit", header: "Equipment", fixed: true, cell: (r) => [r.manufacturer, r.model].filter(Boolean).join(" ") || humanize(r.type) },
    { key: "type", header: "Type", sortKey: "type", from: "md", cell: (r) => humanize(r.type) },
    { key: "serial", header: "Serial #", from: "md", cell: (r) => <span className="font-mono text-xs">{r.serialNumber ?? "—"}</span> },
    { key: "customer", header: "Customer", sortKey: "customer", cell: (r) => <Link href={`/customers/${r.customer.id}`} className="hover:text-primary hover:underline">{r.customer.displayName}</Link> },
    { key: "location", header: "Location", from: "lg", cell: (r) => <span className="text-fg-2">{r.location.addressLine1}, {r.location.city}</span> },
    { key: "installed", header: "Installed", sortKey: "installDate", from: "lg", cell: (r) => formatDateOnly(r.installDate) },
    { key: "warranty", header: "Next warranty end", from: "xl", cell: warranty },
    { key: "condition", header: "Condition", cell: (r) => <StatusBadge status={r.condition} /> },
  ];
  return (
    <>
      <PageHeader title="Equipment" subtitle="Every unit installed at your customers' properties, with serials, warranties and service history." actions={can(ctx, "equipment.manage") && <LinkButton href="/equipment/new" variant="primary"><Icon name="plus" size={14} /> Add equipment</LinkButton>} />
      <FilterBar searchPlaceholder="Search serial #, model, customer, address…" filters={[
        { name: "type", label: "Type", options: EQUIPMENT_TYPES.map((t) => ({ value: t, label: humanize(t) })) },
        { name: "condition", label: "Condition", options: CONDITIONS.map((t) => ({ value: t, label: humanize(t) })) },
        { name: "warranty", label: "Warranty", options: [{ value: "expiring", label: "Expiring in 90 days" }] },
      ]} />
      <DataTable id="equipment-table" columns={cols} page={page} sp={sp} basePath="/equipment" sort={p.sort} dir={p.dir} rowHref={(r) => `/equipment/${r.id}`}
        empty={<EmptyState icon={<Icon name="fan" size={18} />} title="No equipment yet" description="Record the furnaces, air conditioners and heat pumps you service. Technicians see the full history of each unit on every visit." action={can(ctx, "equipment.manage") && <LinkButton href="/equipment/new" variant="primary">Add equipment</LinkButton>} />} />
    </>
  );
}
