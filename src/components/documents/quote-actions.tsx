"use client";

import { useState } from "react";
import { convertQuoteAction, quoteDecisionAction, sendQuoteAction } from "@/app/actions/sales";
import { ActionForm, Dialog, FField, SubmitButton } from "@/components/ui/client";
import { Button, Input, Select, Textarea } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";

export function SendQuoteDialog({ quoteId, defaultTo, number, resend }: { quoteId: string; defaultTo: string; number: string; resend: boolean }) {
  return (
    <Dialog title={resend ? `Re-send ${number}` : `Send ${number}`} description="The customer gets a branded email with a secure link — no account needed." trigger={<Button variant="primary"><Icon name="send" size={14} /> {resend ? "Re-send" : "Send to customer"}</Button>}>
      <ActionForm action={sendQuoteAction.bind(null, quoteId)} className="space-y-4">
        <FField label="To" name="to" required><Input name="to" type="email" defaultValue={defaultTo} required /></FField>
        <FField label="Personal message (optional)" name="message"><Textarea name="message" rows={4} placeholder="Thanks for having us out today. Here's the quote we discussed…" /></FField>
        <p className="text-xs text-fg-3">The email includes the quote summary, expiry date and a “View quote” button. Opens and approvals are tracked on the quote and the customer's timeline.</p>
        <div className="flex justify-end"><SubmitButton pendingLabel="Sending…">Send quote</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function DecisionDialog({ quoteId, options, decision }: { quoteId: string; options: { id: string; name: string }[]; decision: "APPROVED" | "DECLINED" }) {
  const approve = decision === "APPROVED";
  return (
    <Dialog title={approve ? "Record customer approval" : "Record customer decline"} description="Use this when the customer answered by phone or in person." trigger={<Button variant={approve ? "secondary" : "danger-outline"}>{approve ? "Mark approved" : "Mark declined"}</Button>}>
      <ActionForm action={quoteDecisionAction.bind(null, quoteId, decision)} className="space-y-4">
        {approve && options.length > 1 && <FField label="Approved option" name="optionId" required><Select name="optionId" required>{options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select></FField>}
        {approve && options.length === 1 && <input type="hidden" name="optionId" value={options[0]!.id} />}
        <FField label={approve ? "Note (how did they approve?)" : "Reason"} name="note"><Textarea name="note" rows={3} /></FField>
        <div className="flex justify-end"><SubmitButton>{approve ? "Mark approved" : "Mark declined"}</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

export function ConvertDialog({ quoteId, needsLocation, locations, canJob, canInvoice }: { quoteId: string; needsLocation: boolean; locations: { id: string; name: string }[]; canJob: boolean; canInvoice: boolean }) {
  const [to, setTo] = useState(canJob ? "job_and_invoice" : "invoice");
  return (
    <Dialog title="Convert approved quote" description="Everything carries over — customer, location, line items, pricing and notes." trigger={<Button variant="primary">Convert…</Button>}>
      <ActionForm action={convertQuoteAction.bind(null, quoteId)} className="space-y-4">
        <div className="space-y-2" role="radiogroup">
          {[["job_and_invoice", "Job and invoice", "Create the work order and bill it now (deposit included).", canJob && canInvoice], ["job", "Job only", "Schedule the work first; invoice from the job when it's done.", canJob], ["invoice", "Invoice only", "Bill without creating a job.", canInvoice]].filter((o) => o[3]).map(([v, label, hint]) => (
            <label key={v as string} className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${to === v ? "border-primary bg-primary-soft" : "border-line-strong"}`}>
              <input type="radio" name="to" value={v as string} checked={to === v} onChange={() => setTo(v as string)} className="mt-1 accent-primary" /><span><span className="block text-[13px] font-medium">{label}</span><span className="text-xs text-fg-3">{hint}</span></span>
            </label>
          ))}
        </div>
        {needsLocation && to !== "invoice" && <FField label="Service location for the job" name="locationId" required><Select name="locationId" required>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></FField>}
        <div className="flex justify-end"><SubmitButton>Convert quote</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}
