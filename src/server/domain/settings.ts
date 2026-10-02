import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requirePermission, type Ctx } from "@/server/auth/context";
import { platformDb } from "@/server/db";
import { AppError, notFound } from "@/server/errors";
import { storage } from "@/server/storage/provider";
import { MAX_UPLOAD_BYTES, validateUpload } from "@/server/storage/validate";
import { bool, intField, optEmail, optPhone, optStr, parseInput, percentBp, str } from "@/lib/validation";
import { audit } from "./shared";

export const ONBOARDING_STEPS = ["company", "branding", "operations", "financial", "team"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

const PAYMENT_METHODS = ["CASH", "CHECK", "CREDIT_CARD", "ACH", "EXTERNAL", "MANUAL", "FINANCING", "OTHER"] as const;

export async function getSettings(ctx: Pick<Ctx, "db">) {
  const s = await ctx.db.tenantSettings.findFirst({ where: {} });
  if (!s) throw notFound("Company settings");
  return s;
}

const timezones = new Set<string>((Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone"));
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #1d4ed8");

const companySchema = z.object({
  name: str(120),
  legalName: optStr(160),
  addressLine1: optStr(160),
  addressLine2: optStr(160),
  city: optStr(80),
  state: optStr(40),
  postalCode: optStr(20),
  country: str(2).default("US"),
  phone: optPhone,
  email: optEmail,
  website: optStr(200),
  taxId: optStr(40),
  registrationNumber: optStr(60),
  licenseNumber: optStr(60),
  timezone: z.string().refine((t) => timezones.has(t), "Choose a valid timezone"),
  currency: z.string().length(3).transform((s) => s.toUpperCase()),
  defaultTaxRate: percentBp,
});

const brandingSchema = z.object({
  brandColor: hex,
  quoteIntro: optStr(2000),
  quoteFooter: optStr(2000),
  invoiceFooter: optStr(2000),
  emailSignature: optStr(1000),
});

const dayHours = z.object({ closed: bool, open: z.string().regex(/^\d{2}:\d{2}$/), close: z.string().regex(/^\d{2}:\d{2}$/) });
export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

const operationsSchema = z.object({
  businessHours: z.record(z.string(), dayHours).optional(),
  serviceAreaNotes: optStr(2000),
  defaultAppointmentMinutes: intField.pipe(z.number().min(15).max(960)),
  jobPrefix: z.string().trim().max(10),
  jobStartNumber: intField.pipe(z.number().min(1).max(99_999_999)),
  quotePrefix: z.string().trim().max(10),
  quoteStartNumber: intField.pipe(z.number().min(1).max(99_999_999)),
  invoicePrefix: z.string().trim().max(10),
  invoiceStartNumber: intField.pipe(z.number().min(1).max(99_999_999)),
  agreementPrefix: z.string().trim().max(10),
  agreementStartNumber: intField.pipe(z.number().min(1).max(99_999_999)),
});

const financialSchema = z.object({
  paymentTermsDays: intField.pipe(z.number().min(0).max(365)),
  acceptedPaymentMethods: z.preprocess((v) => (typeof v === "string" ? [v] : v), z.array(z.enum(PAYMENT_METHODS))).default([]),
  defaultDeposit: percentBp,
  quoteExpirationDays: intField.pipe(z.number().min(1).max(365)),
  quoteTerms: optStr(8000),
  invoiceTerms: optStr(8000),
  requireQuoteSignature: bool.optional(),
});

async function save(ctx: Ctx, step: OnboardingStep, action: string, data: Record<string, unknown>, tenantName?: string) {
  await ctx.db.tx(async (tx) => {
    const current = await tx.tenantSettings.findFirst({ where: {} });
    const progress = { ...((current?.onboardingProgress as Record<string, unknown> | null) ?? {}), [step]: true };
    await tx.tenantSettings.updateMany({ where: {}, data: { ...data, onboardingProgress: progress } });
    if (tenantName) await tx.tenant.update({ where: { id: ctx.tenantId }, data: { name: tenantName } });
    await audit(ctx, action, "TenantSettings", ctx.tenantId, { fields: Object.keys(data) }, tx);
  });
}

export async function updateCompany(ctx: Ctx, raw: unknown) {
  requirePermission(ctx, "settings.manage");
  const { name, defaultTaxRate, ...rest } = parseInput(companySchema, raw);
  await save(ctx, "company", "settings.company_updated", { ...rest, defaultTaxRateBp: defaultTaxRate }, name);
}

export async function updateBranding(ctx: Ctx, raw: unknown) {
  requirePermission(ctx, "settings.manage");
  await save(ctx, "branding", "settings.branding_updated", parseInput(brandingSchema, raw));
}

export async function updateOperations(ctx: Ctx, raw: unknown) {
  requirePermission(ctx, "settings.manage");
  const input = parseInput(operationsSchema, raw);
  await save(ctx, "operations", "settings.operations_updated", { ...input, businessHours: input.businessHours ?? {} });
}

export async function updateFinancial(ctx: Ctx, raw: unknown) {
  requirePermission(ctx, "settings.manage");
  const { defaultDeposit, ...rest } = parseInput(financialSchema, raw);
  await save(ctx, "financial", "settings.financial_updated", { ...rest, requireQuoteSignature: rest.requireQuoteSignature ?? false, defaultDepositBp: defaultDeposit });
}

export async function skipOnboardingStep(ctx: Ctx, step: OnboardingStep) {
  requirePermission(ctx, "settings.manage");
  if (!ONBOARDING_STEPS.includes(step)) throw new AppError("VALIDATION", "Unknown step");
  const current = await ctx.db.tenantSettings.findFirst({ where: {} });
  const progress = { ...((current?.onboardingProgress as Record<string, unknown> | null) ?? {}) };
  if (!progress[step]) progress[step] = "skipped";
  await ctx.db.tenantSettings.updateMany({ where: {}, data: { onboardingProgress: progress } });
}

export async function completeOnboarding(ctx: Ctx) {
  requirePermission(ctx, "settings.manage");
  await ctx.db.tx(async (tx) => {
    await tx.tenant.update({ where: { id: ctx.tenantId }, data: { onboardingCompletedAt: new Date() } });
    await audit(ctx, "settings.onboarding_completed", "Tenant", ctx.tenantId, undefined, tx);
  });
}

export async function onboardingState(ctx: Ctx) {
  const [tenant, settings] = await Promise.all([ctx.db.tenant.findFirst({ where: {} }), getSettings(ctx)]);
  const progress = (settings.onboardingProgress as Record<string, boolean | "skipped">) ?? {};
  return { completed: !!tenant?.onboardingCompletedAt, progress };
}

// ─── Logo ───────────────────────────────────────────────────────────────────────

const LOGO_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function setLogo(ctx: Ctx, file: { name: string; size: number; content: Buffer }) {
  requirePermission(ctx, "settings.manage");
  const checked = validateUpload(file.name, file.size, file.content);
  if (!LOGO_MIME.has(checked.mimeType)) throw new AppError("VALIDATION", "Logo must be a PNG, JPG or WebP image.");
  if (file.size > Math.min(MAX_UPLOAD_BYTES, 2 * 1024 * 1024)) throw new AppError("VALIDATION", "Logo must be under 2 MB.");
  const key = `${ctx.tenantId}/branding/${randomUUID()}`;
  await storage().put(key, file.content, checked.mimeType);
  const old = (await getSettings(ctx)).logoKey;
  await ctx.db.tx(async (tx) => {
    await tx.tenantSettings.updateMany({ where: {}, data: { logoKey: key } });
    await audit(ctx, "settings.logo_updated", "TenantSettings", ctx.tenantId, undefined, tx);
  });
  if (old) await storage().delete(old).catch(() => undefined);
}

/** Public branding lookup (used by emails/quote pages). Logos are intentionally public. */
export async function readPublicLogo(tenantId: string): Promise<{ bytes: Buffer; mime: string } | null> {
  const s = await platformDb().tenantSettings.findFirst({ where: { tenantId }, select: { logoKey: true } });
  if (!s?.logoKey) return null;
  try {
    const bytes = await storage().get(s.logoKey);
    const mime = bytes[0] === 0x89 ? "image/png" : bytes[0] === 0xff ? "image/jpeg" : "image/webp";
    return { bytes, mime };
  } catch {
    return null;
  }
}

// ─── Service territories ────────────────────────────────────────────────────────

const territorySchema = z.object({ name: str(80), description: optStr(300), postalCodes: z.preprocess((v) => (typeof v === "string" ? v.split(/[\s,]+/).filter(Boolean) : v), z.array(z.string().max(12)).max(500)) });

export async function saveTerritory(ctx: Ctx, id: string | null, raw: unknown) {
  requirePermission(ctx, "settings.manage");
  const input = parseInput(territorySchema, raw);
  const data = { name: input.name, description: input.description ?? null, postalCodes: input.postalCodes };
  if (id) {
    if (!(await ctx.db.serviceTerritory.findFirst({ where: { id } }))) throw notFound("Territory");
    await ctx.db.serviceTerritory.update({ where: { id }, data });
  } else {
    await ctx.db.serviceTerritory.create({ data: { tenantId: ctx.tenantId, ...data } });
  }
}

export async function deleteTerritory(ctx: Ctx, id: string) {
  requirePermission(ctx, "settings.manage");
  await ctx.db.employee.updateMany({ where: { territoryId: id }, data: { territoryId: null } });
  await ctx.db.serviceTerritory.deleteMany({ where: { id } });
}

export async function listTerritories(ctx: Pick<Ctx, "db">) {
  return ctx.db.serviceTerritory.findMany({ orderBy: { name: "asc" } });
}
