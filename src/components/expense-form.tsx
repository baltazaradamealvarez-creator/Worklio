import { FField } from "@/components/ui/client";
import { Input, Select } from "@/components/ui/primitives";
import { centsToInput } from "@/lib/money";
import { humanize } from "@/lib/format";
import { EXPENSE_CATEGORIES } from "@/server/domain/expenses";
import { PAYMENT_METHODS } from "@/lib/payment-methods";

type E = Partial<{ vendorId: string | null; category: string; amountCents: number; expenseDate: Date; description: string; paymentMethod: string; reference: string | null; jobId: string | null }>;

export function ExpenseFields({ e = {}, vendors, jobs }: { e?: E; vendors: { id: string; name: string }[]; jobs: { id: string; number: string; title: string }[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FField label="Description" name="description" required className="sm:col-span-2"><Input name="description" defaultValue={e.description ?? ""} required /></FField>
      <FField label="Amount ($)" name="amount" required><Input name="amount" inputMode="decimal" defaultValue={e.amountCents != null ? centsToInput(e.amountCents) : ""} required /></FField>
      <FField label="Date" name="expenseDate" required><Input name="expenseDate" type="date" defaultValue={(e.expenseDate ?? new Date()).toISOString().slice(0, 10)} required /></FField>
      <FField label="Category" name="category" required><Select name="category" defaultValue={e.category ?? "PARTS"}>{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</Select></FField>
      <FField label="Vendor" name="vendorId"><Select name="vendorId" defaultValue={e.vendorId ?? ""}><option value="">None</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select></FField>
      <FField label="Paid by" name="paymentMethod"><Select name="paymentMethod" defaultValue={e.paymentMethod ?? "CREDIT_CARD"}>{PAYMENT_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></FField>
      <FField label="Reference" name="reference"><Input name="reference" defaultValue={e.reference ?? ""} /></FField>
      <FField label="Job (optional)" name="jobId" hint="Tracks job costs"><Select name="jobId" defaultValue={e.jobId ?? ""}><option value="">None</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.number} · {j.title}</option>)}</Select></FField>
    </div>
  );
}
