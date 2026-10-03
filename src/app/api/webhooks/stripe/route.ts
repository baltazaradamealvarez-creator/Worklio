import { NextResponse } from "next/server";
import { recordProviderPayment } from "@/server/domain/payments";
import { getPaymentProvider } from "@/server/payments/provider";

export const dynamic = "force-dynamic";

/** Stripe webhook: signature-verified, idempotent, tenant resolved from the signed event metadata. */
export async function POST(req: Request) {
  const raw = await req.text();
  let event;
  try {
    event = getPaymentProvider().parseWebhook(raw, req.headers.get("stripe-signature"));
  } catch {
    return new NextResponse("Invalid webhook", { status: 400 });
  }
  if (!event) return NextResponse.json({ received: true });
  try {
    await recordProviderPayment({ tenantId: event.tenantId, invoiceId: event.invoiceId, provider: "stripe", providerPaymentId: event.providerPaymentId, amountCents: event.amountCents, method: event.method });
  } catch (e) {
    console.error("[stripe webhook] failed to record payment", e instanceof Error ? e.message : e);
    return new NextResponse("Processing error", { status: 500 }); // Stripe will retry
  }
  return NextResponse.json({ received: true });
}
