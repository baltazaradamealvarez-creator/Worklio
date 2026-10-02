/**
 * Money & document calculations — the single source of truth.
 *
 * - All money is integer minor units (cents). Rates are integer basis points (825 = 8.25%).
 * - Quantities have at most 2 decimal places and are handled as integer hundredths, so no
 *   floating-point arithmetic touches a monetary value.
 * - Rounding is "half away from zero", applied once per line and once per document-level
 *   percentage, in a fixed order (documented in `computeDocument`).
 *
 * The server recomputes every document total from its line items using this module; client
 * code may import it for live previews but totals from the browser are never trusted.
 */

export type DiscountType = "NONE" | "PERCENT" | "FIXED";

export type QuantityLike = number | string | { toString(): string };

export interface LineInput {
  quantity: QuantityLike;
  unitPriceCents: number;
  unitCostCents?: number;
  discountType?: DiscountType;
  /** basis points when PERCENT, cents when FIXED */
  discountValue?: number;
  taxable?: boolean;
}

export interface LineTotals {
  grossCents: number;
  discountCents: number;
  netCents: number;
  costCents: number;
}

export interface DocumentInput {
  lines: LineInput[];
  taxRateBp: number;
  discountType?: DiscountType;
  discountValue?: number;
  depositType?: DiscountType;
  depositValue?: number;
  amountPaidCents?: number;
}

export interface DocumentTotals {
  lines: LineTotals[];
  subtotalCents: number;
  discountCents: number;
  taxableCents: number;
  taxCents: number;
  totalCents: number;
  depositCents: number;
  amountPaidCents: number;
  balanceCents: number;
  costCents: number;
  marginCents: number;
}

/** Integer division rounded half away from zero. */
export function divRound(numerator: number, denominator: number): number {
  if (denominator === 0) throw new RangeError("Division by zero");
  const sign = numerator < 0 !== denominator < 0 ? -1 : 1;
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  return sign * Math.floor((2 * n + d) / (2 * d));
}

/** Parse a quantity into integer hundredths without floating-point error. Max 2 dp. */
export function toHundredths(q: QuantityLike): number {
  const raw = typeof q === "number" ? q.toFixed(4) : q.toString().trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!m) throw new RangeError(`Invalid quantity: ${String(raw)}`);
  const [, sign, whole, frac = ""] = m;
  // Round the (possibly longer) fraction to 2 places.
  const padded = (frac + "000").slice(0, 3);
  let hundredths = Number(whole) * 100 + Number(padded.slice(0, 2));
  if (Number(padded[2]) >= 5) hundredths += 1;
  return sign === "-" ? -hundredths : hundredths;
}

function assertInt(n: number, label: string) {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${label} must be an integer, got ${n}`);
}

export function computeLine(line: LineInput): LineTotals {
  assertInt(line.unitPriceCents, "unitPriceCents");
  const qty = toHundredths(line.quantity);
  const grossCents = divRound(qty * line.unitPriceCents, 100);
  let discountCents = 0;
  const type = line.discountType ?? "NONE";
  const value = line.discountValue ?? 0;
  if (grossCents > 0 && type !== "NONE" && value > 0) {
    assertInt(value, "discountValue");
    discountCents =
      type === "PERCENT" ? divRound(grossCents * Math.min(value, 10000), 10000) : Math.min(value, grossCents);
  }
  const unitCost = line.unitCostCents ?? 0;
  return {
    grossCents,
    discountCents,
    netCents: grossCents - discountCents,
    costCents: divRound(qty * unitCost, 100),
  };
}

/**
 * Order of operations:
 *  1. each line: gross = qty × unit price; line discount; net
 *  2. subtotal = Σ line nets
 *  3. document discount (percent of subtotal, or fixed capped at subtotal)
 *  4. tax = rate × (taxable line nets − their proportional share of the document discount)
 *  5. total = subtotal − discount + tax
 *  6. deposit (percent of total, or fixed capped at total)
 *  7. balance = total − amount paid
 */
export function computeDocument(input: DocumentInput): DocumentTotals {
  if (input.taxRateBp < 0 || input.taxRateBp > 10000) throw new RangeError("taxRateBp out of range");
  const lines = input.lines.map(computeLine);
  const subtotalCents = lines.reduce((s, l) => s + l.netCents, 0);
  const costCents = lines.reduce((s, l) => s + l.costCents, 0);

  let discountCents = 0;
  const dType = input.discountType ?? "NONE";
  const dValue = input.discountValue ?? 0;
  if (subtotalCents > 0 && dType !== "NONE" && dValue > 0) {
    discountCents =
      dType === "PERCENT"
        ? divRound(subtotalCents * Math.min(dValue, 10000), 10000)
        : Math.min(dValue, subtotalCents);
  }

  const taxableLinesCents = input.lines.reduce((s, l, i) => s + (l.taxable === false ? 0 : lines[i]!.netCents), 0);
  const taxableDiscount = subtotalCents > 0 ? divRound(discountCents * taxableLinesCents, subtotalCents) : 0;
  const taxableCents = Math.max(0, taxableLinesCents - taxableDiscount);
  const taxCents = divRound(taxableCents * input.taxRateBp, 10000);
  const totalCents = subtotalCents - discountCents + taxCents;

  let depositCents = 0;
  const depType = input.depositType ?? "NONE";
  const depValue = input.depositValue ?? 0;
  if (totalCents > 0 && depType !== "NONE" && depValue > 0) {
    depositCents =
      depType === "PERCENT" ? divRound(totalCents * Math.min(depValue, 10000), 10000) : Math.min(depValue, totalCents);
  }

  const amountPaidCents = input.amountPaidCents ?? 0;
  return {
    lines,
    subtotalCents,
    discountCents,
    taxableCents,
    taxCents,
    totalCents,
    depositCents,
    amountPaidCents,
    balanceCents: totalCents - amountPaidCents,
    costCents,
    marginCents: subtotalCents - discountCents - costCents,
  };
}

// ─── Formatting & parsing (display only) ───────────────────────────────────────

const formatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(cents: number, currency = "USD", opts: { compact?: boolean } = {}): string {
  const key = `${currency}:${opts.compact ? "c" : "f"}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      ...(opts.compact ? { notation: "compact", maximumFractionDigits: 1 } : {}),
    });
    formatters.set(key, f);
  }
  // Format from integer parts to avoid float drift for large values.
  return f.format(cents / 100);
}

/** "1,234.5" → 123450. Returns null when the input is not a valid amount. */
export function parseMoney(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  const m = /^(-?)(\d*)(?:\.(\d{0,2})\d*)?$/.exec(cleaned);
  if (!m || (m[2] === "" && (m[3] === undefined || m[3] === ""))) return null;
  const cents = Number(m[2] || "0") * 100 + Number(((m[3] ?? "") + "00").slice(0, 2));
  return m[1] === "-" ? -cents : cents;
}

/** Integer cents → plain decimal string for form inputs ("1234.50"). */
export function centsToInput(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** basis points → "8.25" for form inputs */
export function bpToPercentInput(bp: number): string {
  return (bp / 100).toFixed(2).replace(/\.?0+$/, "") || "0";
}

export function percentInputToBp(input: string): number | null {
  const n = input.trim().replace("%", "");
  if (!/^\d*(\.\d{0,2})?\d*$/.test(n) || n === "") return null;
  return Math.round(Number(n) * 100);
}
