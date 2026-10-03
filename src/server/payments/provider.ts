import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";

/**
 * Payment-processor abstraction. The app never touches card numbers: customers pay on the
 * processor's hosted page and the processor calls our webhook, which records the payment
 * idempotently (see `recordProviderPayment`). Swap/add providers by implementing this interface.
 */
export interface CheckoutRequest {
  tenantId: string;
  invoiceId: string;
  invoiceNumber: string;
  amountCents: number;
  currency: string;
  customerEmail?: string | null;
  successUrl: string;
  cancelUrl: string;
}

export interface WebhookPayment {
  eventId: string;
  tenantId: string;
  invoiceId: string;
  providerPaymentId: string;
  amountCents: number;
  method: "CREDIT_CARD" | "ACH";
}

export interface PaymentProvider {
  readonly name: string;
  readonly supportsOnlinePayments: boolean;
  createCheckout(req: CheckoutRequest): Promise<{ url: string }>;
  /** Verify + parse a webhook; returns null for events we don't act on. Throws on bad signature. */
  parseWebhook(rawBody: string, signatureHeader: string | null): WebhookPayment | null;
}

class ManualProvider implements PaymentProvider {
  readonly name = "manual";
  readonly supportsOnlinePayments = false;
  async createCheckout(): Promise<{ url: string }> {
    throw new Error("Online payments are not enabled. Set PAYMENT_PROVIDER=stripe and STRIPE_SECRET_KEY.");
  }
  parseWebhook(): WebhookPayment | null {
    throw new Error("No payment provider configured");
  }
}

class StripeProvider implements PaymentProvider {
  readonly name = "stripe";
  readonly supportsOnlinePayments = true;
  constructor(private secret: string, private webhookSecret: string | undefined) {}

  async createCheckout(r: CheckoutRequest) {
    const body = new URLSearchParams({
      mode: "payment",
      success_url: r.successUrl,
      cancel_url: r.cancelUrl,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": r.currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": String(r.amountCents),
      "line_items[0][price_data][product_data][name]": `Invoice ${r.invoiceNumber}`,
      "payment_intent_data[metadata][tenantId]": r.tenantId,
      "payment_intent_data[metadata][invoiceId]": r.invoiceId,
      "metadata[tenantId]": r.tenantId,
      "metadata[invoiceId]": r.invoiceId,
    });
    if (r.customerEmail) body.set("customer_email", r.customerEmail);
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { Authorization: `Bearer ${this.secret}`, "Content-Type": "application/x-www-form-urlencoded" }, body });
    if (!res.ok) throw new Error(`Stripe error ${res.status}`);
    const json = (await res.json()) as { url?: string };
    if (!json.url) throw new Error("Stripe did not return a checkout URL");
    return { url: json.url };
  }

  parseWebhook(raw: string, header: string | null): WebhookPayment | null {
    if (!this.webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
    verifyStripeSignature(raw, header, this.webhookSecret);
    const evt = JSON.parse(raw) as { id: string; type: string; data: { object: { id: string; amount_total?: number; payment_intent?: string; payment_status?: string; payment_method_types?: string[]; metadata?: Record<string, string> } } };
    if (evt.type !== "checkout.session.completed") return null;
    const o = evt.data.object;
    if (o.payment_status !== "paid") return null;
    const tenantId = o.metadata?.tenantId;
    const invoiceId = o.metadata?.invoiceId;
    if (!tenantId || !invoiceId || !o.amount_total) return null;
    return { eventId: evt.id, tenantId, invoiceId, providerPaymentId: o.payment_intent ?? o.id, amountCents: o.amount_total, method: o.payment_method_types?.includes("us_bank_account") ? "ACH" : "CREDIT_CARD" };
  }
}

/** Stripe-Signature: t=timestamp,v1=hex(hmac_sha256(secret, `${t}.${payload}`)); 5-minute tolerance. */
export function verifyStripeSignature(payload: string, header: string | null, secret: string, toleranceSec = 300, now = Date.now()) {
  if (!header) throw new Error("Missing signature");
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(now / 1000 - t) > toleranceSec) throw new Error("Signature timestamp outside tolerance");
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  const given = header.split(",").filter((kv) => kv.startsWith("v1=")).map((kv) => kv.slice(3));
  const ok = given.some((g) => g.length === expected.length && timingSafeEqual(Buffer.from(g), Buffer.from(expected)));
  if (!ok) throw new Error("Invalid signature");
}

let override: PaymentProvider | undefined;
export function setPaymentProvider(p: PaymentProvider | undefined) {
  override = p;
}
export function getPaymentProvider(): PaymentProvider {
  if (override) return override;
  const e = env();
  if (e.PAYMENT_PROVIDER === "stripe") {
    if (!e.STRIPE_SECRET_KEY) throw new Error("PAYMENT_PROVIDER=stripe requires STRIPE_SECRET_KEY");
    return new StripeProvider(e.STRIPE_SECRET_KEY, e.STRIPE_WEBHOOK_SECRET);
  }
  return new ManualProvider();
}
