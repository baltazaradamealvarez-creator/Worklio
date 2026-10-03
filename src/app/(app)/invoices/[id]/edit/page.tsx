import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DocumentEditor, newKey } from "@/components/documents/editor";
import { dateInput, discountToInput, toEditorLine } from "@/components/documents/helpers";
import { PageHeader } from "@/components/ui/primitives";
import { requirePermission } from "@/server/auth/context";
import { getInvoice } from "@/server/domain/invoices";
import { bpToPercentInput, centsToInput } from "@/lib/money";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Edit invoice" };

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, settings, currency } = await pageCtx();
  requirePermission(ctx, "invoices.edit");
  const inv = await getInvoice(ctx, id);
  if (inv.status !== "DRAFT") redirect(`/invoices/${id}`);
  return (
    <>
      <PageHeader title={`Edit ${inv.number}`} breadcrumbs={[{ label: "Invoices", href: "/invoices" }, { label: inv.number, href: `/invoices/${id}` }, { label: "Edit" }]} />
      <DocumentEditor mode="invoice" currency={currency} settingsTaxRate={bpToPercentInput(settings.defaultTaxRateBp)} taxExemptDefault={inv.customer.taxExempt} salespeople={[]}
        initial={{ id, customer: { id: inv.customer.id, name: inv.customer.displayName }, locationId: inv.locationId, jobId: inv.jobId, salespersonId: null, title: inv.title ?? "", issueDate: dateInput(inv.issueDate), expiresAt: "", paymentTermsDays: String(inv.paymentTermsDays), taxRate: bpToPercentInput(inv.taxRateBp), discountType: inv.discountType, discountValue: discountToInput(inv.discountType, inv.discountValue), depositType: "NONE", depositValue: inv.depositRequiredCents ? centsToInput(inv.depositRequiredCents) : "", terms: inv.terms ?? "", customerNotes: inv.customerNotes ?? "", internalNotes: inv.internalNotes ?? "", options: [{ key: newKey(), name: "Lines", description: "", isRecommended: false, lines: inv.lineItems.map(toEditorLine) }] }} />
    </>
  );
}
