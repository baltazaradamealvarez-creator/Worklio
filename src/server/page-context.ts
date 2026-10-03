import "server-only";
import { cache } from "react";
import { requireCtx } from "@/server/auth/server";
import { getSettings } from "@/server/domain/settings";

/** Per-request: the authenticated context plus company-wide display settings. */
export const pageCtx = cache(async () => {
  const ctx = await requireCtx();
  const settings = await getSettings(ctx);
  return { ctx, tz: settings.timezone, currency: settings.currency, settings };
});
