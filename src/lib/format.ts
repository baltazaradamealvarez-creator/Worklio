const dateFmt = new Map<string, Intl.DateTimeFormat>();

function fmt(key: string, tz: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const k = `${key}|${tz}`;
  let f = dateFmt.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts });
    dateFmt.set(k, f);
  }
  return f;
}

export const DEFAULT_TZ = "America/Chicago";

export function formatDate(d: Date | string | null | undefined, tz = DEFAULT_TZ): string {
  if (!d) return "—";
  return fmt("d", tz, { month: "short", day: "numeric", year: "numeric" }).format(new Date(d));
}

/** DATE columns come back as UTC midnight; format them in UTC so they never shift a day. */
export function formatDateOnly(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return fmt("do", "UTC", { month: "short", day: "numeric", year: "numeric" }).format(new Date(d));
}

export function formatTime(d: Date | string | null | undefined, tz = DEFAULT_TZ): string {
  if (!d) return "—";
  return fmt("t", tz, { hour: "numeric", minute: "2-digit" }).format(new Date(d));
}

export function formatDateTime(d: Date | string | null | undefined, tz = DEFAULT_TZ): string {
  if (!d) return "—";
  return fmt("dt", tz, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(d));
}

export function formatWeekday(d: Date | string, tz = DEFAULT_TZ): string {
  return fmt("w", tz, { weekday: "short", month: "short", day: "numeric" }).format(new Date(d));
}

/** Local calendar date (yyyy-mm-dd) of an instant in a timezone. */
export function localDateKey(d: Date | string, tz = DEFAULT_TZ): string {
  const parts = fmt("k", tz, { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(d));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Offset (ms) of `tz` from UTC at the given instant. */
function tzOffsetMs(at: Date, tz: string): number {
  const parts = fmt("o", tz, {
    hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Convert a wall-clock time in `tz` (yyyy-mm-dd + minutes from midnight) to a UTC instant. */
export function zonedToUtc(dateKey: string, minutes: number, tz = DEFAULT_TZ): Date {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  const guess = new Date(Date.UTC(y, m - 1, d, 0, minutes));
  const offset = tzOffsetMs(guess, tz);
  const first = new Date(guess.getTime() - offset);
  const offset2 = tzOffsetMs(first, tz);
  return new Date(guess.getTime() - offset2);
}

/** `<input type="datetime-local">` value (wall clock in tz) for an instant. */
export function toLocalInput(d: Date | string | null | undefined, tz = DEFAULT_TZ): string {
  if (!d) return "";
  const date = new Date(d);
  return `${localDateKey(date, tz)}T${fmt("hm", tz, { hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).format(date)}`;
}

export function fromLocalInput(value: string, tz = DEFAULT_TZ): Date {
  const [date, time = "00:00"] = value.split("T") as [string, string];
  const [h, m] = time.split(":").map(Number) as [number, number];
  return zonedToUtc(date, h * 60 + m, tz);
}

export function addDays(dateKey: string, n: number): string {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function relativeTime(d: Date | string, now = new Date()): string {
  const diff = new Date(d).getTime() - now.getTime();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];
  if (abs < 60_000) return "just now";
  for (const [unit, ms] of units) {
    if (abs >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return "just now";
}

export function formatPhone(p: string | null | undefined): string {
  if (!p) return "—";
  const digits = p.replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === "1") return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return p;
}

/** IN_PROGRESS → "In progress" */
export function humanize(v: string | null | undefined): string {
  if (!v) return "—";
  const s = v.toLowerCase().replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatAddress(a: {
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}): string {
  const line2 = a.addressLine2 ? `, ${a.addressLine2}` : "";
  const cityLine = [a.city, [a.state, a.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [`${a.addressLine1 ?? ""}${line2}`.trim(), cityLine].filter(Boolean).join(", ");
}

export function mapsUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "");
}

/** Store US-style numbers as bare digits so search and tel: links work; keep anything else as typed. */
export function normalizePhone(p: string | null | undefined): string | null {
  if (!p) return null;
  const trimmed = p.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length === 10) return digits;
  return trimmed;
}
