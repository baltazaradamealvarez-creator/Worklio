import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

// ─── Buttons ───────────────────────────────────────────────────────────────────

const variants = {
  primary: "bg-primary text-white hover:bg-primary-hover shadow-sm",
  secondary: "bg-surface text-fg border border-line-strong hover:bg-surface-2 shadow-sm",
  ghost: "text-fg-2 hover:bg-surface-2 hover:text-fg",
  danger: "bg-danger text-white hover:bg-red-700 shadow-sm",
  "danger-outline": "bg-surface text-danger border border-line-strong hover:bg-danger-soft",
} as const;
const sizes = { sm: "h-7 px-2.5 text-[12.5px] gap-1.5", md: "h-8 px-3 text-[13px] gap-2", lg: "h-10 px-4 text-sm gap-2" } as const;

export type ButtonVariant = keyof typeof variants;

export const buttonClass = (variant: ButtonVariant = "secondary", size: keyof typeof sizes = "md", className?: string) =>
  cn("inline-flex items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 select-none", variants[variant], sizes[size], className);

export function Button({ variant = "secondary", size = "md", className, type = "button", ...props }: ComponentProps<"button"> & { variant?: ButtonVariant; size?: keyof typeof sizes }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

export function LinkButton({ variant = "secondary", size = "md", className, ...props }: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: keyof typeof sizes }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

// ─── Form controls ─────────────────────────────────────────────────────────────

const control = "w-full rounded-md border border-line-strong bg-surface px-2.5 text-[13px] text-fg shadow-sm placeholder:text-fg-3 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-surface-2 disabled:text-fg-3 aria-[invalid=true]:border-danger";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, "h-8", className)} {...props} />;
}
export function Textarea({ className, rows = 3, ...props }: ComponentProps<"textarea">) {
  return <textarea rows={rows} className={cn(control, "py-1.5 leading-relaxed", className)} {...props} />;
}
export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select className={cn(control, "h-8 pr-7", className)} {...props}>
      {children}
    </select>
  );
}
export function Checkbox({ label, className, ...props }: ComponentProps<"input"> & { label: ReactNode }) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-2 text-[13px] text-fg", className)}>
      <input type="checkbox" className="size-4 rounded border-line-strong accent-primary" {...props} />
      {label}
    </label>
  );
}

export function Field({ label, hint, error, required, children, className }: { label: ReactNode; hint?: ReactNode; error?: string; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1", className)}>
      <label className="block text-[12.5px] font-medium text-fg-2">
        {label}
        {required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
      </label>
      {children}
      {error ? <p className="text-xs text-danger" role="alert">{error}</p> : hint ? <p className="text-xs text-fg-3">{hint}</p> : null}
    </div>
  );
}

// ─── Badges ──────────────────────────────────────────────────────────────────────

const tones = {
  gray: "bg-surface-2 text-fg-2 ring-line-strong/60",
  blue: "bg-info-soft text-info ring-blue-200",
  green: "bg-success-soft text-success ring-green-200",
  amber: "bg-warn-soft text-warn ring-amber-200",
  red: "bg-danger-soft text-danger ring-red-200",
  purple: "bg-purple-50 text-purple-700 ring-purple-200",
  teal: "bg-teal-50 text-teal-700 ring-teal-200",
} as const;
export type Tone = keyof typeof tones;

export function Badge({ tone = "gray", children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium ring-1 ring-inset", tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current opacity-70" />}
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  // jobs
  NEW: "blue", UNSCHEDULED: "amber", SCHEDULED: "blue", DISPATCHED: "purple", EN_ROUTE: "purple", IN_PROGRESS: "teal", ON_HOLD: "gray", COMPLETED: "green", NEEDS_FOLLOW_UP: "amber", CANCELLED: "gray",
  // appointments
  ARRIVED: "teal", NO_SHOW: "red",
  // quotes
  DRAFT: "gray", READY: "blue", SENT: "blue", VIEWED: "purple", APPROVED: "green", DECLINED: "red", EXPIRED: "amber", CONVERTED: "teal",
  // invoices
  OPEN: "blue", PARTIALLY_PAID: "amber", PAID: "green", VOID: "gray", PAST_DUE: "red",
  // customers / leads / agreements / generic
  ACTIVE: "green", INACTIVE: "gray", PROSPECT: "blue", DO_NOT_SERVICE: "red", CONTACTED: "blue", APPOINTMENT_SCHEDULED: "purple", ESTIMATE_NEEDED: "amber", QUOTE_SENT: "purple", WON: "green", LOST: "gray",
  EXPIRING: "amber", PENDING_RENEWAL: "blue", ON_LEAVE: "amber", TERMINATED: "gray", INVITED: "blue", SUSPENDED: "red", TRIALING: "blue", PAST_DUE_SUB: "red",
  // priority
  LOW: "gray", NORMAL: "gray", HIGH: "amber", EMERGENCY: "red",
  // payments / misc
  SUCCEEDED: "green", PENDING: "amber", FAILED: "red", VOIDED: "gray", REFUNDED: "gray", PLANNED: "gray", SKIPPED: "gray", DONE: "green",
  FAIR: "amber", POOR: "red", NEEDS_REPLACEMENT: "red", GOOD: "green", EXCELLENT: "green", DECOMMISSIONED: "gray",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const text = label ?? (status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " "));
  return <Badge tone={STATUS_TONE[status] ?? "gray"} dot>{text}</Badge>;
}

// ─── Layout bits ─────────────────────────────────────────────────────────────────

export function Card({ title, actions, children, className, padded = true, description }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cn("rounded-lg border border-line bg-surface", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <div>
            <h2 className="text-[13px] font-semibold text-fg">{title}</h2>
            {description && <p className="text-xs text-fg-3">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn(padded && "p-4")}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, breadcrumbs, badges }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; breadcrumbs?: { label: string; href?: string }[]; badges?: ReactNode }) {
  return (
    <div className="mb-5">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-1.5 flex items-center gap-1.5 text-xs text-fg-3">
          {breadcrumbs.map((b, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {b.href ? <Link href={b.href} className="hover:text-fg hover:underline">{b.label}</Link> : <span className="text-fg-2">{b.label}</span>}
              {i < breadcrumbs.length - 1 && <span aria-hidden>/</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="truncate text-xl font-semibold tracking-tight text-fg">{title}</h1>
            {badges}
          </div>
          {subtitle && <p className="mt-0.5 text-[13px] text-fg-3">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-surface-2 text-fg-3">{icon}</div>}
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      <p className="mt-1 max-w-sm text-[13px] text-fg-3">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, href, tone }: { label: string; value: ReactNode; sub?: ReactNode; href?: string; tone?: "danger" | "warn" | "success" }) {
  const inner = (
    <div className={cn("rounded-lg border border-line bg-surface px-4 py-3 transition-colors", href && "hover:border-line-strong hover:bg-surface-2/50")}>
      <div className="text-xs font-medium text-fg-3">{label}</div>
      <div className={cn("tabular mt-1 text-2xl font-semibold tracking-tight", tone === "danger" && "text-danger", tone === "warn" && "text-warn", tone === "success" && "text-success")}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-fg-3">{sub}</div>}
    </div>
  );
  return href ? <Link href={href} className="block">{inner}</Link> : inner;
}

export function DefList({ items, cols = 2 }: { items: { label: string; value: ReactNode; wide?: boolean }[]; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3", cols === 1 ? "grid-cols-1" : cols === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3")}>
      {items.map((it) => (
        <div key={it.label} className={cn(it.wide && "sm:col-span-full", "min-w-0")}>
          <dt className="text-xs font-medium text-fg-3">{it.label}</dt>
          <dd className="mt-0.5 break-words text-[13px] text-fg">{it.value || <span className="text-fg-3">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Avatar({ name, color, size = 28 }: { name: string; color?: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white" style={{ width: size, height: size, fontSize: size * 0.38, background: color ?? "#667085" }} aria-hidden>
      {initials}
    </span>
  );
}

export function Tabs({ tabs, active, basePath, param = "tab", hrefFor }: { tabs: { key: string; label: string; count?: number }[]; active: string; basePath: string; param?: string; hrefFor?: (key: string) => string }) {
  return (
    <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-line" aria-label="Sections">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={hrefFor ? hrefFor(t.key) : t.key === tabs[0]!.key ? basePath : `${basePath}?${param}=${t.key}`}
          scroll={false}
          aria-current={active === t.key ? "page" : undefined}
          className={cn("-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors", active === t.key ? "border-primary text-primary" : "border-transparent text-fg-3 hover:text-fg")}
        >
          {t.label}
          {t.count != null && t.count > 0 && <span className="rounded-full bg-surface-2 px-1.5 text-[11px] font-semibold text-fg-2">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4 w-full", className)} aria-hidden />;
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warn" | "danger" | "success"; title?: string; children: ReactNode }) {
  const t = { info: "bg-info-soft border-blue-200 text-info", warn: "bg-warn-soft border-amber-200 text-warn", danger: "bg-danger-soft border-red-200 text-danger", success: "bg-success-soft border-green-200 text-success" }[tone];
  return (
    <div className={cn("rounded-md border px-3 py-2 text-[13px]", t)} role={tone === "danger" ? "alert" : "status"}>
      {title && <div className="font-semibold">{title}</div>}
      <div className="text-fg-2">{children}</div>
    </div>
  );
}

export function Money({ cents, currency = "USD", className, muted }: { cents: number; currency?: string; className?: string; muted?: boolean }) {
  const s = new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  return <span className={cn("tabular", muted && cents === 0 && "text-fg-3", cents < 0 && "text-danger", className)}>{s}</span>;
}
