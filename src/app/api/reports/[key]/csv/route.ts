import { NextResponse, type NextRequest } from "next/server";
import { requireCtx } from "@/server/auth/server";
import { AppError } from "@/server/errors";
import { REPORTS, parseReportFilters, reportToCsv, runReport, type ReportKey } from "@/server/domain/reports";
import { tenantTimezone } from "@/server/domain/scheduling";
import { audit } from "@/server/domain/shared";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  try {
    const ctx = await requireCtx();
    if (!REPORTS.some((r) => r.key === key)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const tz = await tenantTimezone(ctx.db);
    const f = parseReportFilters(Object.fromEntries(req.nextUrl.searchParams), tz);
    const result = await runReport(ctx, key as ReportKey, f);
    await audit(ctx, "report.exported", "Report", key, { from: f.from, to: f.to });
    return new NextResponse(reportToCsv(result), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${key}-${f.from}-${f.to}.csv"`, "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: e.code === "FORBIDDEN" ? 403 : e.code === "UNAUTHENTICATED" ? 401 : 400 });
    throw e;
  }
}
