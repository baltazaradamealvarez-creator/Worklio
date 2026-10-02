import { ZodError } from "zod";
import type { Ctx } from "@/server/auth/context";
import { AppError } from "@/server/errors";
import { RateLimitError } from "@/server/security/rate-limit";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string; redirectTo?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Run a server-action body and convert thrown domain errors into a serialisable result.
 * Unexpected errors are logged server-side and returned as a generic message.
 */
export async function run<T>(fn: () => Promise<{ data?: T; message?: string; redirectTo?: string } | void>): Promise<ActionResult<T>> {
  try {
    const out = await fn();
    return { ok: true, ...(out ?? {}) } as ActionResult<T>;
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: err.message, fieldErrors: err.fieldErrors };
    if (err instanceof RateLimitError) return { ok: false, error: err.message };
    if ((err as { code?: string } | null)?.code === "P2025") return { ok: false, error: "That record could not be found." };
    if (err instanceof ZodError) return { ok: false, error: err.issues[0]?.message ?? "Invalid input." };
    if (isNextControlFlow(err)) throw err;
    console.error("[action] unexpected error", err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

function isNextControlFlow(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND"));
}

export type WithCtx = (ctx: Ctx) => Promise<{ data?: unknown; message?: string; redirectTo?: string } | void>;
