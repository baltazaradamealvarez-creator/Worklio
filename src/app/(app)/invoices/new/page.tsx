import type { Metadata } from "next";
import { DocumentEditor } from "@/components/documents/editor";
import { emptyOption } from "@/components/documents/helpers";
import { PageHeader } from "@/components/ui/primitives";
import { requirePermission } from "@/server/auth/context";
import { getCustomer } from "@/server/domain/customers";
import { todayDateOnly } from "@/server/domain/shared";
import { bpToPercentInput } from "@/lib/money";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "New invoice" };

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ customer?: string; job?: string }> }) {
  const sp = await searchParams;
  const { ctx, settings, currency, tz } = await pageCtx();
  requirePermission(ctx, "invoices.create");
  const c = sp.customer ? await getCustomer(ctx, sp.customer).catch(() => null) : null;
  const job = sp.job && c ? await ctx.db.job.findFirst({ where: { id: sp.job, customerId: c.id, deletedAt: null }, select: { id: true, title: true, locationId: true } }) : null;
  return (
    <>
      <PageHeader title="New invoice" subtitle="Tip: invoices created from a job's “Create invoice” button include its services and materials automatically." breadcrumbs={[{ label: "Invoices", href: "/invoices" }, { label: "New" }]} />
      <DocumentEditor mode="invoice" currency={currency} settingsTaxRate={bpToPercentInput(settings.defaultTaxRateBp)} taxExemptDefault={c?.taxExempt} salespeople={[]}
        initial={{ id: null, customer: c ? { id: c.id, name: c.displayName } : null, locationId: job?.locationId ?? null, jobId: job?.id ?? null, salespersonId: null, title: job?.title ?? "", issueDate: todayDateOnly(tz).toISOString().slice(0, 10), expiresAt: "", paymentTermsDays: String(settings.paymentTermsDays), taxRate: c?.taxExempt ? "0" : bpToPercentInput(settings.defaultTaxRateBp), discountType: "NONE", discountValue: "", depositType: "NONE", depositValue: "", terms: settings.invoiceTerms ?? "", customerNotes: "", internalNotes: "", options: [emptyOption("Lines")] }} />
    </>
  );
}
