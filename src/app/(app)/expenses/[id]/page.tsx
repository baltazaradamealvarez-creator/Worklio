import type { Metadata } from "next";
import { deleteExpenseAction, saveExpenseAction } from "@/app/actions/admin";
import { ExpenseFields } from "@/components/expense-form";
import { ActionForm, ConfirmAction, SubmitButton } from "@/components/ui/client";
import { Card, LinkButton, PageHeader } from "@/components/ui/primitives";
import { can } from "@/server/auth/context";
import { getExpense } from "@/server/domain/expenses";
import { listVendors } from "@/server/domain/inventory";
import { pageCtx } from "@/server/page-context";

export const metadata: Metadata = { title: "Expense" };

export default async function ExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await pageCtx();
  const e = await getExpense(ctx, id);
  const manage = can(ctx, "expenses.manage");
  const [vendors, jobs] = await Promise.all([listVendors(ctx).catch(() => []), ctx.db.job.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, number: true, title: true } })]);
  return (
    <>
      <PageHeader title="Expense" subtitle={`Recorded by ${e.recordedByName ?? "—"}`} breadcrumbs={[{ label: "Expenses", href: "/expenses" }, { label: e.description }]} actions={manage && <ConfirmAction label="Delete" title="Delete this expense?" description="It will no longer count toward reports." confirmLabel="Delete" action={deleteExpenseAction.bind(null, id)} />} />
      {manage ? (
        <ActionForm action={saveExpenseAction.bind(null, id)} className="max-w-3xl space-y-5">
          <Card><ExpenseFields e={e} vendors={vendors} jobs={jobs} /></Card>
          <div className="flex justify-end gap-2"><LinkButton href="/expenses" variant="ghost">Back</LinkButton><SubmitButton>Save changes</SubmitButton></div>
        </ActionForm>
      ) : <Card><p className="text-[13px]">{e.description}</p></Card>}
    </>
  );
}
