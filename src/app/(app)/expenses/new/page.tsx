import type { Metadata } from "next";
import { saveExpenseAction } from "@/app/actions/admin";
import { ExpenseFields } from "@/components/expense-form";
import { ActionForm, SubmitButton } from "@/components/ui/client";
import { Card, LinkButton, PageHeader } from "@/components/ui/primitives";
import { requirePermission } from "@/server/auth/context";
import { listVendors } from "@/server/domain/inventory";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Add expense" };

export default async function NewExpense({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const sp = await searchParams;
  const { ctx } = await pageCtx();
  requirePermission(ctx, "expenses.manage");
  const [vendors, jobs] = await Promise.all([listVendors(ctx).catch(() => []), ctx.db.job.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, number: true, title: true } })]);
  return (
    <>
      <PageHeader title="Add expense" breadcrumbs={[{ label: "Expenses", href: "/expenses" }, { label: "New" }]} />
      <ActionForm action={saveExpenseAction.bind(null, null)} className="max-w-3xl space-y-5">
        <Card><ExpenseFields vendors={vendors} jobs={jobs} e={{ jobId: sp.job }} /></Card>
        <div className="flex justify-end gap-2"><LinkButton href="/expenses" variant="ghost">Cancel</LinkButton><SubmitButton>Save expense</SubmitButton></div>
      </ActionForm>
    </>
  );
}
