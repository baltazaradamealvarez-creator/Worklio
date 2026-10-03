import { NextResponse } from "next/server";
import { readPublicLogo } from "@/server/domain/settings";

/** Company logos are intentionally public: they appear in customer emails and quote pages. */
export async function GET(_req: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  if (!/^[a-z0-9]{20,30}$/.test(tenantId)) return new NextResponse("Not found", { status: 404 });
  const logo = await readPublicLogo(tenantId);
  if (!logo) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(logo.bytes), { headers: { "Content-Type": logo.mime, "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}
