import { NextResponse } from "next/server";
import { AppError } from "@/server/errors";
import { publicInvoicePdf } from "@/server/domain/pdf-data";
import { resolvePublicLink } from "@/server/domain/public-links";

export const dynamic = "force-dynamic";

/** Customer PDF download authorised solely by the secure link token. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  try {
    const link = await resolvePublicLink((await params).token, "INVOICE", { ip });
    if (!link) return new NextResponse("Not found", { status: 404 });
    const { bytes, filename } = await publicInvoicePdf(link);
    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError) return new NextResponse("Not available", { status: e.code === "RATE_LIMITED" ? 429 : 404 });
    throw e;
  }
}
