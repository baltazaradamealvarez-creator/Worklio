import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEYLEN = 64;

function derive(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEYLEN, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

const scryptOpts = (n: number, r: number, p: number): ScryptOptions => ({ N: n, r, p, maxmem: 256 * n * r });

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, scryptOpts(N, R, P));
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  // Always do comparable work so unknown users / missing hashes are not distinguishable by timing.
  const dummy = "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(KEYLEN).toString("base64");
  const [scheme, n, r, p, saltB64, keyB64] = (stored ?? dummy).split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const actual = await derive(password, Buffer.from(saltB64, "base64"), scryptOpts(Number(n), Number(r), Number(p)));
  const ok = actual.length === expected.length && timingSafeEqual(actual, expected);
  return stored !== null && ok;
}

export const PASSWORD_MIN_LENGTH = 10;

/** Returns an error message or null. Length-first policy (NIST 800-63B style). */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > 200) return "Password is too long.";
  if (/^(.)\1+$/.test(password)) return "Password is too simple.";
  if (/^(password|123456|qwerty|letmein)/i.test(password)) return "Password is too common.";
  return null;
}
