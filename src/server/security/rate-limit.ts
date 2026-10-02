/**
 * Fixed-window in-memory rate limiter. Sufficient for a single instance; swap the
 * `RateLimitStore` for Redis (or similar) when running multiple instances.
 */
export interface RateLimitStore {
  hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> | { count: number; resetAt: number };
}

class MemoryStore implements RateLimitStore {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  hit(key: string, windowMs: number) {
    const now = Date.now();
    const b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      this.buckets.set(key, fresh);
      if (this.buckets.size > 10_000) this.sweep(now);
      return fresh;
    }
    b.count += 1;
    return b;
  }

  private sweep(now: number) {
    for (const [k, v] of this.buckets) if (v.resetAt <= now) this.buckets.delete(k);
  }
}

let store: RateLimitStore = new MemoryStore();
export function setRateLimitStore(s: RateLimitStore) {
  store = s;
}

export class RateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super("Too many requests. Please try again shortly.");
  }
}

export async function rateLimit(key: string, limit: number, windowMs: number): Promise<void> {
  const { count, resetAt } = await store.hit(key, windowMs);
  if (count > limit) throw new RateLimitError(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)));
}
