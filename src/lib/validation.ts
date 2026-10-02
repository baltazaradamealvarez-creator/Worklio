import { z } from "zod";
import { AppError } from "@/server/errors";

/** Treat empty form strings as "not provided". */
const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

export const str = (max = 200) => z.string().trim().min(1, "Required").max(max);
export const optStr = (max = 500) => z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional());
export const optEmail = z.preprocess(
  blankToNull,
  z.string().trim().toLowerCase().max(254).email("Enter a valid email address").nullable().optional(),
);
export const email = z.string().trim().toLowerCase().max(254).email("Enter a valid email address");
export const optPhone = z.preprocess(
  blankToNull,
  z
    .string()
    .trim()
    .max(40)
    .regex(/^[+()\-.\sx\d]{7,40}$/, "Enter a valid phone number")
    .nullable()
    .optional(),
);

/** yyyy-mm-dd → Date at UTC midnight (Postgres DATE columns). */
export const optDate = z.preprocess(
  blankToNull,
  z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}/, "Enter a valid date"), z.date()])
    .transform((v) => (v instanceof Date ? v : new Date(`${v.slice(0, 10)}T00:00:00.000Z`)))
    .nullable()
    .optional(),
);
export const dateReq = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}/, "Enter a valid date"), z.date()])
  .transform((v) => (v instanceof Date ? v : new Date(`${v.slice(0, 10)}T00:00:00.000Z`)));

export const optDateTime = z.preprocess(
  blankToNull,
  z
    .union([z.string(), z.date()])
    .transform((v, ctx) => {
      const d = v instanceof Date ? v : new Date(v);
      if (Number.isNaN(d.getTime())) {
        ctx.addIssue({ code: "custom", message: "Enter a valid date and time" });
        return z.NEVER;
      }
      return d;
    })
    .nullable()
    .optional(),
);

export const bool = z.preprocess((v) => v === true || v === "true" || v === "on" || v === "1", z.boolean());

/** Money from a form: "1,234.50" → 123450 cents. */
export const cents = z.preprocess(
  (v) => {
    if (typeof v === "number") return v;
    if (typeof v !== "string") return v;
    const cleaned = v.replace(/[$,\s]/g, "");
    if (cleaned === "") return 0;
    if (!/^-?\d*(\.\d{0,2})?$/.test(cleaned)) return Number.NaN;
    return Math.round(Number(cleaned) * 100);
  },
  z.number().int("Enter a valid amount").min(-100_000_000_00).max(100_000_000_00),
);
export const optCents = z.preprocess(blankToNull, cents.nullable().optional());

/** Percent from a form ("8.25") → basis points (825). */
export const percentBp = z.preprocess(
  (v) => {
    if (v === undefined || v === null) return 0;
    if (typeof v === "number") return v;
    if (typeof v !== "string") return v;
    const c = v.replace(/[%\s]/g, "");
    if (c === "") return 0;
    if (!/^\d*(\.\d{0,2})?$/.test(c)) return Number.NaN;
    return Math.round(Number(c) * 100);
  },
  z.number().int("Enter a valid percentage").min(0).max(10000),
);

export const qty = z.preprocess(
  (v) => (typeof v === "number" ? String(v) : v),
  z.string().regex(/^-?\d+(\.\d{1,2})?$/, "Enter a valid quantity").refine((v) => Number(v) < 1_000_000, "Too large"),
);

export const intField = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : Number(v)) : v),
  z.number().int(),
);

export const id = z.string().min(1).max(40);
export const optId = z.preprocess(blankToNull, z.string().min(1).max(40).nullable().optional());
export const strList = z.preprocess(
  (v) =>
    typeof v === "string"
      ? v
          .split(/[,\n]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : v,
  z.array(z.string().trim().min(1).max(60)).max(50),
);

/** Parse + throw an `AppError` with per-field messages the UI can render. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_";
    fieldErrors[key] ??= issue.message;
  }
  const first = Object.entries(fieldErrors)[0];
  throw new AppError(
    "VALIDATION",
    first && first[0] !== "_" ? `${humanizeKey(first[0])}: ${first[1]}` : (first?.[1] ?? "Invalid input."),
    fieldErrors,
  );
}

function humanizeKey(key: string): string {
  const last = key.split(".").pop() ?? key;
  const spaced = last.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** FormData → plain object; repeated keys become arrays. */
export function formToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(fd.keys())) {
    if (key.startsWith("$ACTION")) continue;
    const all = fd.getAll(key).filter((v) => typeof v === "string");
    out[key] = all.length > 1 ? all : all[0];
  }
  return out;
}
