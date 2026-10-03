"use client";

import { recordPaymentAction, sendInvoiceAction } from "@/app/actions/sales";
import { ActionForm, Dialog, FField, SubmitButton } from "@/components/ui/client";
import { Button, Checkbox, Input, Select, Textarea } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
import { centsToInput } from "@/lib/money";

export const PAYMENT_METHODS = [["CASH", "Cash"], ["CHECK", "Check"], ["CREDIT_CARD", "Credit card"], ["ACH", "ACH / bank transfer"], ["EXTERNAL", "External processor"], ["FINANCING", "Financing"], ["MANUAL", "Manual adjustment"], ["OTHER", "Other"]] as const;

export function PaymentForm({ invoiceId, balanceCents, depositCents }: { invoiceId: string; balanceCents: number; depositCents?: number }) {
  return (
    <ActionForm action={recordPaymentAction} className="space-y-4">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FField label="Amount ($)" name="amount" required hint={`Balance due ${centsToInput(balanceCents)}`}><Input name="amount" inputMode="decimal" defaultValue={centsToInput(balanceCents)} required /></FField>
        <FField label="Method" name="method" required><Select name="method" defaultValue="CHECK">{PAYMENT_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></FField>
        <FField label="Reference / check #" name="reference"><Input name="reference" /></FField>
        <FField label="Received" name="receivedAt"><Input name="receivedAt" type="datetime-local" /></FField>
      </div>
      <FField label="Notes" name="notes"><Textarea name="notes" rows={2} /></FField>
      <div className="flex flex-wrap gap-6"><Checkbox name="isDeposit" defaultChecked={!!depositCents && depositCents > 0 && balanceCents > 0 && false} label="This is a deposit" /><Checkbox name="sendReceipt" label="Email a receipt to the customer" /></div>
      <div className="flex justify-end"><SubmitButton>Record payment</SubmitButton></div>
    </ActionForm>
  );
}

export function RecordPaymentDialog({ invoiceId, balanceCents, depositCents }: { invoiceId: string; balanceCents: number; depositCents?: number }) {
  return (
    <Dialog title="Record a payment" description="Partial payments and deposits are supported. Card details are never stored." trigger={<Button variant="primary"><Icon name="banknote" size={14} /> Record payment</Button>}>
      <PaymentForm invoiceId={invoiceId} balanceCents={balanceCents} depositCents={depositCents} />
    </Dialog>
  );
}

export function SendInvoiceDialog({ invoiceId, number, defaultTo }: { invoiceId: string; number: string; defaultTo: string }) {
  return (
    <Dialog title={`Email ${number}`} description="The customer receives a secure link to view, download and pay the invoice." trigger={<Button variant="secondary"><Icon name="send" size={14} /> Email invoice</Button>}>
      <ActionForm action={sendInvoiceAction.bind(null, invoiceId)} className="space-y-4">
        <FField label="To" name="to" required><Input name="to" type="email" defaultValue={defaultTo} required /></FField>
        <FField label="Message (optional)" name="message"><Textarea name="message" rows={3} /></FField>
        <div className="flex justify-end"><SubmitButton pendingLabel="Sending…">Send invoice</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}
