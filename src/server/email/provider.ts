import { env } from "@/server/env";

export interface OutboundEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(email: OutboundEmail): Promise<{ id?: string }>;
}

/** Development provider: prints the message instead of sending it. */
class ConsoleProvider implements EmailProvider {
  readonly name = "console";
  async send(email: OutboundEmail) {
    console.log(`\n[email:console] to=${email.to} subject="${email.subject}"\n${email.text}\n`);
    return { id: `console-${Date.now()}` };
  }
}

/** Resend (https://resend.com) over plain HTTPS — no SDK required. Needs RESEND_API_KEY. */
class ResendProvider implements EmailProvider {
  readonly name = "resend";
  constructor(private apiKey: string) {}
  async send(email: OutboundEmail) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: email.from,
        to: [email.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
        reply_to: email.replyTo,
      }),
    });
    if (!res.ok) throw new Error(`Resend responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as { id?: string };
    return { id: body.id };
  }
}

let override: EmailProvider | undefined;
/** Tests / alternative integrations inject a provider here. */
export function setEmailProvider(p: EmailProvider | undefined) {
  override = p;
}

export function getEmailProvider(): EmailProvider {
  if (override) return override;
  const e = env();
  if (e.EMAIL_PROVIDER === "resend") {
    if (!e.RESEND_API_KEY) throw new Error("EMAIL_PROVIDER=resend requires RESEND_API_KEY");
    return new ResendProvider(e.RESEND_API_KEY);
  }
  return new ConsoleProvider();
}
