import type { Metadata } from "next";
import { DocumentEditor } from "@/components/documents/editor";
import { dateInput, discountToInput, toEditorLine } from "@/components/documents/helpers";
import { newKey } from "@/components/documents/helpers";
import { PageHeader } from "@/components/ui/primitives";
import { requirePermission } from "@/server/auth/context";
import { listAssignableEmployees } from "@/server/domain/employees";
import { getQuote } from "@/server/domain/quotes";
import { bpToPercentInput } from "@/lib/money";
import { redirect } from "next/navigation";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Edit quote" };

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, settings, currency } = await pageCtx();
  requirePermission(ctx, "quotes.edit");
  const [q, people] = await Promise.all([getQuote(ctx, id), listAssignableEmployees(ctx)]);
  if (q.status !== "DRAFT" && q.status !== "READY") redirect(`/quotes/${id}`);
  return (
    <>
      <PageHeader title={`Edit ${q.number}`} breadcrumbs={[{ label: "Quotes", href: "/quotes" }, { label: q.number, href: `/quotes/${id}` }, { label: "Edit" }]} />
      <DocumentEditor mode="quote" currency={currency} settingsTaxRate={bpToPercentInput(settings.defaultTaxRateBp)} taxExemptDefault={q.customer.taxExempt} salespeople={people.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}` }))}
        initial={{ id, customer: { id: q.customer.id, name: q.customer.displayName }, locationId: q.locationId, jobId: q.jobId, salespersonId: q.salespersonId, title: q.title, issueDate: dateInput(q.issueDate), expiresAt: dateInput(q.expiresAt), paymentTermsDays: "30", taxRate: bpToPercentInput(q.taxRateBp), discountType: q.discountType, discountValue: discountToInput(q.discountType, q.discountValue), depositType: q.depositType, depositValue: discountToInput(q.depositType, q.depositValue), terms: q.terms ?? "", customerNotes: q.customerNotes ?? "", internalNotes: q.internalNotes ?? "",
          options: q.options.map((o) => ({ key: newKey(), id: o.id, name: o.name, description: o.description ?? "", isRecommended: o.isRecommended, lines: o.lineItems.length ? o.lineItems.map(toEditorLine) : [] })) }} />
    </>
  );
}
