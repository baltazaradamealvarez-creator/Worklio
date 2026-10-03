/**
 * Create (or reset) the first platform administrator.
 *
 *   ADMIN_EMAIL=you@company.com ADMIN_PASSWORD='a long passphrase' ADMIN_NAME='Your Name' \
 *     npx tsx scripts/create-platform-admin.ts
 *
 * Run it once from a Render shell after the first deploy, then sign in and open /platform.
 */
import "dotenv/config";
import { hashPassword, validatePasswordStrength } from "@/server/auth/password";
import { platformDb } from "@/server/db";
import { ensureDefaultPlans } from "@/server/domain/tenants";

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || "Platform Admin";
  if (!email || !password) throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD are required");
  const weak = validatePasswordStrength(password);
  if (weak) throw new Error(weak);
  await ensureDefaultPlans();
  const passwordHash = await hashPassword(password);
  const user = await platformDb().user.upsert({
    where: { email },
    update: { passwordHash, isPlatformAdmin: true, isActive: true },
    create: { email, name, passwordHash, isPlatformAdmin: true, emailVerifiedAt: new Date() },
  });
  console.log(`✓ Platform admin ready: ${user.email}`);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); }).finally(() => process.exit(0));
