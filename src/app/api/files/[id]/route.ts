import { NextResponse, type NextRequest } from "next/server";
import { AppError } from "@/server/errors";
import { getAuth } from "@/server/auth/server";
import { readAttachmentBytes } from "@/server/domain/attachments";
import { isInlineMime } from "@/server/storage/validate";

export const dynamic = "force-dynamic";

/** Authenticated, permission-checked file download. Objects are never publicly addressable. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth?.ctx) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  try {
    const { attachment, bytes } = await readAttachmentBytes(auth.ctx, id);
    const wantsDownload = req.nextUrl.searchParams.get("download") === "1";
    const inline = !wantsDownload && isInlineMime(attachment.mimeType);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": attachment.mimeType,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return new NextResponse(e.code === "FORBIDDEN" ? "Forbidden" : "Not found", { status: e.code === "FORBIDDEN" ? 403 : 404 });
    throw e;
  }
}
