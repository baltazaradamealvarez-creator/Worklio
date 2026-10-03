import type { Metadata } from "next";
import { addDays } from "date-fns";
import { DocumentEditor } from "@/components/documents/editor";
import { emptyOption } from "@/components/documents/helpers";
import { PageHeader } from "@/components/ui/primitives";
import { requirePermission } from "@/server/auth/context";
import { getCustomer } from "@/server/domain/customers";
import { listAssignableEmployees } from "@/server/domain/employees";
import { todayDateOnly } from "@/server/domain/shared";
import { bpToPercentInput } from "@/lib/money";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "New quote" };

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ customer?: string; job?: string }> }) {
  const sp = await searchParams;
  const { ctx, settings, currency, tz } = await pageCtx();
  requirePermission(ctx, "quotes.create");
  const [c, people] = await Promise.all([sp.customer ? getCustomer(ctx, sp.customer).catch(() => null) : null, listAssignableEmployees(ctx)]);
  const job = sp.job && c ? await ctx.db.job.findFirst({ where: { id: sp.job, customerId: c.id, deletedAt: null }, select: { id: true, title: true, locationId: true } }) : null;
  const today = todayDateOnly(tz);
  return (
    <>
      <PageHeader title="New quote" breadcrumbs={[{ label: "Quotes", href: "/quotes" }, { label: "New" }]} />
      <DocumentEditor mode="quote" currency={currency} settingsTaxRate={bpToPercentInput(settings.defaultTaxRateBp)} taxExemptDefault={c?.taxExempt}
        salespeople={people.map((p) => ({ id: p.id, name: `${p.firstName} ${p.lastName}` }))}
        initial={{ id: null, customer: c ? { id: c.id, name: c.displayName } : null, locationId: job?.locationId ?? null, jobId: job?.id ?? null, salespersonId: ctx.employeeId, title: job?.title ?? "", issueDate: today.toISOString().slice(0, 10), expiresAt: addDays(today, settings.quoteExpirationDays).toISOString().slice(0, 10), paymentTermsDays: "30", taxRate: c?.taxExempt ? "0" : bpToPercentInput(settings.defaultTaxRateBp), discountType: "NONE", discountValue: "", depositType: settings.defaultDepositBp > 0 ? "PERCENT" : "NONE", depositValue: settings.defaultDepositBp > 0 ? String(settings.defaultDepositBp / 100) : "", terms: settings.quoteTerms ?? "", customerNotes: "", internalNotes: "", options: [emptyOption("Option 1")] }} />
    </>
  );
}
