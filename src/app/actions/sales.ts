"use server";

import { run, type ActionResult } from "@/server/actions";
import { requireCtx } from "@/server/auth/server";
import { archivePricebookItem, deleteCategory, saveCategory, savePricebookItem } from "@/server/domain/pricebook";
import { convertQuote, createQuote, deleteQuote, markQuoteReady, recordQuoteDecision, reviseQuote, sendQuote, updateQuote } from "@/server/domain/quotes";
import { createInvoice, markInvoiceOpen, sendInvoice, updateInvoice, voidInvoice } from "@/server/domain/invoices";
import { recordPayment, sendReceipt, voidPayment } from "@/server/domain/payments";
import { formToObject } from "@/lib/validation";

// ── Pricebook ──
export async function savePricebookItemAction(id: string | null, fd: FormData): Promise<ActionResult> {
  return run(async () => { await savePricebookItem(await requireCtx(), id, formToObject(fd)); return { message: id ? "Item updated" : "Item added", redirectTo: "/pricebook" }; });
}
export async function archivePricebookItemAction(id: string): Promise<ActionResult> {
  return run(async () => { await archivePricebookItem(await requireCtx(), id); return { message: "Item archived", redirectTo: "/pricebook" }; });
}
export async function saveCategoryAction(id: string | null, fd: FormData): Promise<ActionResult> {
  return run(async () => { await saveCategory(await requireCtx(), id, formToObject(fd)); return { message: "Category saved" }; });
}
export async function deleteCategoryAction(id: string): Promise<ActionResult> {
  return run(async () => { await deleteCategory(await requireCtx(), id); return { message: "Category deleted" }; });
}

// ── Quotes (the editor submits typed JSON, not FormData) ──
export async function saveQuoteAction(id: string | null, payload: unknown): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const ctx = await requireCtx();
    const q = id ? await updateQuote(ctx, id, payload) : await createQuote(ctx, payload);
    return { message: id ? "Quote saved" : `Quote ${q.number} created`, redirectTo: `/quotes/${q.id}` };
  });
}
export async function quoteReadyAction(id: string): Promise<ActionResult> {
  return run(async () => { await markQuoteReady(await requireCtx(), id); return { message: "Marked ready" }; });
}
export async function reviseQuoteAction(id: string): Promise<ActionResult> {
  return run(async () => { await reviseQuote(await requireCtx(), id); return { message: "Quote reopened for editing", redirectTo: `/quotes/${id}/edit` }; });
}
export async function sendQuoteAction(id: string, fd: FormData): Promise<ActionResult> {
  return run(async () => { await sendQuote(await requireCtx(), id, formToObject(fd)); return { message: "Quote emailed to the customer" }; });
}
export async function quoteDecisionAction(id: string, decision: "APPROVED" | "DECLINED", fd: FormData): Promise<ActionResult> {
  return run(async () => { await recordQuoteDecision(await requireCtx(), id, decision, formToObject(fd)); return { message: decision === "APPROVED" ? "Quote marked approved" : "Quote marked declined" }; });
}
export async function convertQuoteAction(id: string, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const r = await convertQuote(await requireCtx(), id, formToObject(fd));
    return { message: "Quote converted", redirectTo: r.invoiceId ? `/invoices/${r.invoiceId}` : `/jobs/${r.jobId}` };
  });
}
export async function deleteQuoteAction(id: string): Promise<ActionResult> {
  return run(async () => { await deleteQuote(await requireCtx(), id); return { message: "Quote deleted", redirectTo: "/quotes" }; });
}

// ── Invoices & payments ──
export async function saveInvoiceAction(id: string | null, payload: unknown): Promise<ActionResult> {
  return run(async () => {
    const ctx = await requireCtx();
    const inv = id ? await updateInvoice(ctx, id, payload) : await createInvoice(ctx, payload);
    return { message: id ? "Invoice saved" : `Invoice ${inv.number} created`, redirectTo: `/invoices/${inv.id}` };
  });
}
export async function invoiceOpenAction(id: string): Promise<ActionResult> {
  return run(async () => { await markInvoiceOpen(await requireCtx(), id); return { message: "Invoice finalised" }; });
}
export async function sendInvoiceAction(id: string, fd: FormData): Promise<ActionResult> {
  return run(async () => { await sendInvoice(await requireCtx(), id, formToObject(fd)); return { message: "Invoice emailed to the customer" }; });
}
export async function voidInvoiceAction(id: string, reason: string): Promise<ActionResult> {
  return run(async () => { await voidInvoice(await requireCtx(), id, reason); return { message: "Invoice voided" }; });
}
export async function recordPaymentAction(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const r = await recordPayment(await requireCtx(), formToObject(fd));
    return { message: r.invoice.status === "PAID" ? "Payment recorded — invoice paid in full" : "Payment recorded", redirectTo: `/invoices/${r.invoice.id}` };
  });
}
export async function voidPaymentAction(id: string, reason: string): Promise<ActionResult> {
  return run(async () => { await voidPayment(await requireCtx(), id, reason); return { message: "Payment voided" }; });
}
export async function sendReceiptAction(id: string): Promise<ActionResult> {
  return run(async () => { await sendReceipt(await requireCtx(), id); return { message: "Receipt emailed" }; });
}
