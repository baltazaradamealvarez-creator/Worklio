import { NextResponse } from "next/server";
import { AppError } from "@/server/errors";
import { publicInvoicePdf, publicQuotePdf } from "@/server/domain/pdf-data";
import { resolveDocumentLink } from "@/server/domain/public-links";

export const dynamic = "force-dynamic";

/** Portal PDF download: portal token + the document must belong to that customer. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string; kind: string; id: string }> }) {
  const { token, kind, id } = await params;
  if (kind !== "quotes" && kind !== "invoices") return new NextResponse("Not found", { status: 404 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  try {
    const link = await resolveDocumentLink(token, kind === "quotes" ? "QUOTE" : "INVOICE", id, { ip });
    if (!link) return new NextResponse("Not found", { status: 404 });
    const { bytes, filename } = kind === "quotes" ? await publicQuotePdf(link) : await publicInvoicePdf(link);
    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError) return new NextResponse("Not available", { status: e.code === "RATE_LIMITED" ? 429 : 404 });
    throw e;
  }
}
