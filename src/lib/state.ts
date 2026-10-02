/**
 * Explicit state machines for business objects. Services call `assertTransition`; the UI
 * reads `nextStates` to decide which actions to offer. No status is ever set directly from
 * client input without passing through here.
 */
import { AppError } from "@/server/errors";
import type { AgreementStatus, AppointmentStatus, InvoiceStatus, JobStatus, LeadStatus, QuoteStatus } from "@prisma/client";

type Machine<S extends string> = Record<S, readonly S[]>;

export const JOB_TRANSITIONS: Machine<JobStatus> = {
  NEW: ["UNSCHEDULED", "SCHEDULED", "CANCELLED"],
  UNSCHEDULED: ["SCHEDULED", "ON_HOLD", "CANCELLED"],
  SCHEDULED: ["UNSCHEDULED", "DISPATCHED", "EN_ROUTE", "IN_PROGRESS", "ON_HOLD", "CANCELLED"],
  DISPATCHED: ["SCHEDULED", "UNSCHEDULED", "EN_ROUTE", "IN_PROGRESS", "ON_HOLD", "CANCELLED"],
  EN_ROUTE: ["DISPATCHED", "IN_PROGRESS", "ON_HOLD", "CANCELLED"],
  IN_PROGRESS: ["ON_HOLD", "COMPLETED", "NEEDS_FOLLOW_UP"],
  ON_HOLD: ["UNSCHEDULED", "SCHEDULED", "IN_PROGRESS", "CANCELLED"],
  COMPLETED: ["NEEDS_FOLLOW_UP"],
  NEEDS_FOLLOW_UP: ["UNSCHEDULED", "SCHEDULED", "COMPLETED", "CANCELLED"],
  CANCELLED: ["UNSCHEDULED"],
};

export const APPOINTMENT_TRANSITIONS: Machine<AppointmentStatus> = {
  SCHEDULED: ["DISPATCHED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "CANCELLED", "NO_SHOW"],
  DISPATCHED: ["SCHEDULED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "CANCELLED", "NO_SHOW"],
  EN_ROUTE: ["ARRIVED", "IN_PROGRESS", "DISPATCHED", "CANCELLED", "NO_SHOW"],
  ARRIVED: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "ARRIVED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export const QUOTE_TRANSITIONS: Machine<QuoteStatus> = {
  DRAFT: ["READY", "SENT", "APPROVED", "DECLINED"],
  READY: ["DRAFT", "SENT", "APPROVED", "DECLINED"],
  SENT: ["VIEWED", "APPROVED", "DECLINED", "EXPIRED", "DRAFT"],
  VIEWED: ["SENT", "APPROVED", "DECLINED", "EXPIRED", "DRAFT"],
  APPROVED: ["CONVERTED"],
  DECLINED: ["DRAFT"],
  EXPIRED: ["DRAFT", "SENT"],
  CONVERTED: [],
};

/** Payment-driven transitions (PARTIALLY_PAID / PAID) are computed by the invoice service. */
export const INVOICE_TRANSITIONS: Machine<InvoiceStatus> = {
  DRAFT: ["OPEN", "SENT", "VOID"],
  OPEN: ["SENT", "VIEWED", "PARTIALLY_PAID", "PAID", "VOID"],
  SENT: ["OPEN", "VIEWED", "PARTIALLY_PAID", "PAID", "VOID"],
  VIEWED: ["SENT", "OPEN", "PARTIALLY_PAID", "PAID", "VOID"],
  PARTIALLY_PAID: ["OPEN", "SENT", "VIEWED", "PAID"],
  PAID: ["PARTIALLY_PAID", "OPEN", "SENT", "VIEWED"],
  VOID: [],
};

export const LEAD_TRANSITIONS: Machine<LeadStatus> = {
  NEW: ["CONTACTED", "APPOINTMENT_SCHEDULED", "ESTIMATE_NEEDED", "QUOTE_SENT", "WON", "LOST"],
  CONTACTED: ["NEW", "APPOINTMENT_SCHEDULED", "ESTIMATE_NEEDED", "QUOTE_SENT", "WON", "LOST"],
  APPOINTMENT_SCHEDULED: ["CONTACTED", "ESTIMATE_NEEDED", "QUOTE_SENT", "WON", "LOST"],
  ESTIMATE_NEEDED: ["CONTACTED", "APPOINTMENT_SCHEDULED", "QUOTE_SENT", "WON", "LOST"],
  QUOTE_SENT: ["ESTIMATE_NEEDED", "CONTACTED", "WON", "LOST"],
  WON: [],
  LOST: ["NEW"],
};

export const AGREEMENT_MANUAL_TRANSITIONS: Machine<AgreementStatus> = {
  PENDING_RENEWAL: ["ACTIVE", "CANCELLED", "EXPIRED"],
  ACTIVE: ["EXPIRING", "PENDING_RENEWAL", "CANCELLED"],
  EXPIRING: ["ACTIVE", "PENDING_RENEWAL", "EXPIRED", "CANCELLED"],
  EXPIRED: ["ACTIVE", "PENDING_RENEWAL"],
  CANCELLED: [],
};

const machines = {
  job: JOB_TRANSITIONS,
  appointment: APPOINTMENT_TRANSITIONS,
  quote: QUOTE_TRANSITIONS,
  invoice: INVOICE_TRANSITIONS,
  lead: LEAD_TRANSITIONS,
  agreement: AGREEMENT_MANUAL_TRANSITIONS,
} as const;

export type MachineName = keyof typeof machines;

export function nextStates<M extends MachineName>(machine: M, from: string): readonly string[] {
  return ((machines[machine] as Record<string, readonly string[]>)[from] ?? []) as readonly string[];
}

export function canTransition(machine: MachineName, from: string, to: string): boolean {
  return from === to || nextStates(machine, from).includes(to);
}

export class InvalidTransitionError extends AppError {
  constructor(public machine: MachineName, public from: string, public to: string) {
    super("INVALID_STATE", `A ${machine} can't move from ${from.toLowerCase().replace(/_/g, " ")} to ${to.toLowerCase().replace(/_/g, " ")}.`);
  }
}

export function assertTransition(machine: MachineName, from: string, to: string): void {
  if (from === to) return;
  if (!nextStates(machine, from).includes(to)) throw new InvalidTransitionError(machine, from, to);
}

// ─── Derived statuses ────────────────────────────────────────────────────────────

/** Invoices are "past due" when unpaid past their due date; derived, never stored. */
export function effectiveInvoiceStatus(inv: { status: InvoiceStatus; dueDate: Date; balanceCents: number }, now = new Date()): InvoiceStatus | "PAST_DUE" {
  const unpaid = inv.status === "OPEN" || inv.status === "SENT" || inv.status === "VIEWED" || inv.status === "PARTIALLY_PAID";
  if (unpaid && inv.balanceCents > 0 && inv.dueDate.getTime() + 24 * 3600_000 <= now.getTime()) return "PAST_DUE";
  return inv.status;
}

export const OPEN_INVOICE_STATUSES: readonly InvoiceStatus[] = ["OPEN", "SENT", "VIEWED", "PARTIALLY_PAID"];

/** Agreement status from dates (unless cancelled). Expiring = renewal within 45 days. */
export function effectiveAgreementStatus(a: { status: AgreementStatus; renewalDate: Date; startDate: Date }, now = new Date()): AgreementStatus {
  if (a.status === "CANCELLED") return "CANCELLED";
  if (a.startDate > now) return "PENDING_RENEWAL";
  if (a.renewalDate < now) return "EXPIRED";
  if (a.renewalDate.getTime() - now.getTime() <= 45 * 86_400_000) return "EXPIRING";
  return "ACTIVE";
}
