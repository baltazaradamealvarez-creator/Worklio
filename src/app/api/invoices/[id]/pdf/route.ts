import { NextResponse } from "next/server";
import { AppError } from "@/server/errors";
import { getAuth } from "@/server/auth/server";
import { invoicePdf } from "@/server/domain/pdf-data";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth?.ctx) return new NextResponse("Unauthorized", { status: 401 });
  try {
    const { bytes, filename } = await invoicePdf(auth.ctx, (await params).id);
    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${filename}"`, "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError) return new NextResponse(e.message, { status: e.code === "FORBIDDEN" ? 403 : 404 });
    throw e;
  }
}
