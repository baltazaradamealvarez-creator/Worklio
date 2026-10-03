import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "@/server/env";

/** AES-256-GCM with a key derived from APP_SECRET. Format: base64(iv ‖ tag ‖ ciphertext). */
const key = () => createHash("sha256").update(`worklio-settings:${env().APP_SECRET}`).digest();

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
}

export function decryptSecret(blob: string): string | null {
  try {
    const raw = Buffer.from(blob, "base64");
    const d = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return null; // wrong APP_SECRET or corrupted value
  }
}
