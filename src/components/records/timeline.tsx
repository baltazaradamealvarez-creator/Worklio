import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { formatDate, formatTime } from "@/lib/format";

const ICON: Record<string, string> = { quote: "file-text", invoice: "receipt", payment: "banknote", job: "clipboard-list", appointment: "calendar-days", note: "pin", customer: "user", location: "map-pin", equipment: "fan", file: "paperclip", contact: "users", agreement: "shield-check", lead: "funnel", email: "mail" };
const TONE: Record<string, string> = { "quote.approved": "bg-success-soft text-success", "invoice.paid": "bg-success-soft text-success", "job.completed": "bg-success-soft text-success", "payment.recorded": "bg-success-soft text-success", "quote.declined": "bg-danger-soft text-danger", "invoice.voided": "bg-danger-soft text-danger", "payment.voided": "bg-danger-soft text-danger", "appointment.cancelled": "bg-danger-soft text-danger" };

export interface TimelineItem {
  id: string;
  type: string;
  summary: string;
  actorName: string | null;
  actorType: string;
  createdAt: Date | string;
  entityType: string;
  entityId: string;
}

function href(i: TimelineItem): string | null {
  switch (i.entityType) {
    case "QUOTE": return `/quotes/${i.entityId}`;
    case "INVOICE": return `/invoices/${i.entityId}`;
    case "JOB": return `/jobs/${i.entityId}`;
    case "EQUIPMENT": return `/equipment/${i.entityId}`;
    case "AGREEMENT": return `/maintenance/${i.entityId}`;
    case "LEAD": return `/leads/${i.entityId}`;
    default: return null;
  }
}

/** Chronological activity feed grouped by day, newest first. */
export function Timeline({ items, tz }: { items: TimelineItem[]; tz: string }) {
  const groups = new Map<string, TimelineItem[]>();
  for (const it of items) {
    const k = formatDate(it.createdAt, tz);
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  return (
    <div className="space-y-5">
      {[...groups.entries()].map(([day, list]) => (
        <section key={day} aria-label={day}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-3">{day}</h3>
          <ol className="relative space-y-3 border-l border-line pl-5">
            {list.map((it) => {
              const link = href(it);
              const kind = it.type.split(".")[0]!;
              return (
                <li key={it.id} className="relative">
                  <span className={`absolute -left-[31px] top-0 flex size-[22px] items-center justify-center rounded-full ring-4 ring-bg ${TONE[it.type] ?? "bg-surface-2 text-fg-2"}`}><Icon name={ICON[kind] ?? "clock"} size={12} /></span>
                  <div className="text-[13px] text-fg">{link ? <Link href={link} className="hover:text-primary hover:underline">{it.summary}</Link> : it.summary}</div>
                  <div className="text-xs text-fg-3">{formatTime(it.createdAt, tz)} · {it.actorType === "CUSTOMER" ? `${it.actorName ?? "Customer"} (customer)` : (it.actorName ?? "System")}</div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
