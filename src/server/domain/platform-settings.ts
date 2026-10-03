import { platformDb } from "@/server/db";
import { AppError } from "@/server/errors";
import { env } from "@/server/env";
import { decryptSecret, encryptSecret } from "@/server/security/secrets";
import { email as emailSchema } from "@/lib/validation";

/**
 * Platform-wide settings (platform admins only — callers must have verified `isPlatformAdmin`).
 * Email settings saved here take precedence over the EMAIL_* / RESEND_API_KEY environment variables.
 */
const EMAIL_KEY = "email";

export interface EmailSettings {
  provider: "resend" | "console";
  apiKey: string | null;
  from: string | null;
  source: "database" | "environment";
}

let cache: { at: number; value: EmailSettings } | undefined;

export async function loadEmailSettings(): Promise<EmailSettings> {
  if (cache && Date.now() - cache.at < 15_000) return cache.value;
  const e = env();
  let value: EmailSettings = { provider: e.EMAIL_PROVIDER, apiKey: e.RESEND_API_KEY ?? null, from: e.EMAIL_FROM, source: "environment" };
  try {
    const row = await platformDb().platformSetting.findUnique({ where: { key: EMAIL_KEY } });
    const parsed = row ? (JSON.parse(decryptSecret(row.valueEnc) ?? "null") as { apiKey?: string; from?: string } | null) : null;
    if (parsed?.apiKey) value = { provider: "resend", apiKey: parsed.apiKey, from: parsed.from ?? e.EMAIL_FROM, source: "database" };
  } catch {
    /* fall back to environment */
  }
  cache = { at: Date.now(), value };
  return value;
}

/** Safe-to-display view: never returns the key itself. */
export async function emailSettingsSummary() {
  const s = await loadEmailSettings();
  return { provider: s.provider, from: s.from, source: s.source, keyHint: s.apiKey ? `••••${s.apiKey.slice(-4)}` : null };
}

export async function saveEmailSettings(actor: { userId: string; name: string }, input: { apiKey?: string; from: string }) {
  const from = input.from.trim();
  const addr = /<([^>]+)>/.exec(from)?.[1] ?? from;
  if (!emailSchema.safeParse(addr).success) throw new AppError("VALIDATION", "Enter a valid from address, e.g. Worklio <no-reply@yourdomain.com>.", { from: "Invalid address" });
  const current = await loadEmailSettings();
  const apiKey = input.apiKey?.trim() || current.apiKey;
  if (!apiKey) throw new AppError("VALIDATION", "Paste your Resend API key.", { apiKey: "Required" });
  if (!/^re_[A-Za-z0-9_\-]{10,}$/.test(apiKey)) throw new AppError("VALIDATION", "That doesn't look like a Resend API key (it starts with re_).", { apiKey: "Invalid key" });
  const db = platformDb();
  await db.platformSetting.upsert({
    where: { key: EMAIL_KEY },
    create: { key: EMAIL_KEY, valueEnc: encryptSecret(JSON.stringify({ apiKey, from })), updatedById: actor.userId },
    update: { valueEnc: encryptSecret(JSON.stringify({ apiKey, from })), updatedById: actor.userId },
  });
  await db.auditLog.create({ data: { tenantId: null, actorUserId: actor.userId, actorName: actor.name, action: "platform.email_settings_updated", entityType: "PlatformSetting", entityId: EMAIL_KEY, metadata: { from } } });
  cache = undefined;
}

export async function clearEmailSettings(actor: { userId: string; name: string }) {
  const db = platformDb();
  await db.platformSetting.deleteMany({ where: { key: EMAIL_KEY } });
  await db.auditLog.create({ data: { tenantId: null, actorUserId: actor.userId, actorName: actor.name, action: "platform.email_settings_cleared", entityType: "PlatformSetting", entityId: EMAIL_KEY } });
  cache = undefined;
}
