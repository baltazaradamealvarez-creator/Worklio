import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** 256-bit URL-safe random token. Only its SHA-256 is ever persisted. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hmac(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function randomId(): string {
  return randomBytes(16).toString("hex");
}
