export interface Branding {
  companyName: string;
  brandColor: string;
  logoUrl: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  signature: string | null;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export const esc = (s: string | null | undefined): string =>
  (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Only allow http(s) URLs into href attributes. */
const safeUrl = (u: string) => (/^https?:\/\//i.test(u) ? esc(u) : "#");

const safeColor = (c: string) => (/^#[0-9a-fA-F]{6}$/.test(c) ? c : "#1d4ed8");

export interface EmailBlocks {
  preheader?: string;
  heading: string;
  /** Pre-escaped HTML paragraphs */
  paragraphs: string[];
  summary?: { label: string; value: string }[];
  button?: { label: string; url: string };
  footnote?: string;
}

export function renderLayout(brand: Branding, b: EmailBlocks, subject: string): RenderedEmail {
  const color = safeColor(brand.brandColor);
  const logo = brand.logoUrl
    ? `<img src="${safeUrl(brand.logoUrl)}" alt="${esc(brand.companyName)}" height="40" style="display:block;height:40px;max-width:200px;">`
    : `<span style="font-size:18px;font-weight:700;color:#111827;">${esc(brand.companyName)}</span>`;
  const summary = b.summary?.length
    ? `<table role="presentation" width="100%" style="border:1px solid #e5e7eb;border-radius:8px;margin:20px 0;border-collapse:separate;">${b.summary
        .map(
          (r) =>
            `<tr><td style="padding:10px 14px;color:#6b7280;font-size:13px;border-bottom:1px solid #f3f4f6;">${esc(r.label)}</td><td style="padding:10px 14px;text-align:right;font-size:14px;font-weight:600;color:#111827;border-bottom:1px solid #f3f4f6;">${esc(r.value)}</td></tr>`,
        )
        .join("")}</table>`
    : "";
  const button = b.button
    ? `<p style="margin:24px 0;"><a href="${safeUrl(b.button.url)}" style="background:${color};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:6px;display:inline-block;">${esc(b.button.label)}</a></p>
       <p style="font-size:12px;color:#6b7280;margin:0 0 8px;">If the button doesn't work, copy this link into your browser:<br><a href="${safeUrl(b.button.url)}" style="color:${color};word-break:break-all;">${esc(b.button.url)}</a></p>`
    : "";
  const contact = [brand.phone, brand.email, brand.website].filter(Boolean).map((v) => esc(v)).join(" &middot; ");
  const sig = brand.signature ? `<p style="margin:24px 0 0;white-space:pre-line;color:#374151;">${esc(brand.signature)}</p>` : "";

  const html = `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<span style="display:none;max-height:0;overflow:hidden;">${esc(b.preheader ?? "")}</span>
<table role="presentation" width="100%" style="padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:10px;border:1px solid #e5e7eb;">
<tr><td style="padding:24px 28px 0;">${logo}</td></tr>
<tr><td style="padding:8px 28px 28px;color:#374151;font-size:15px;line-height:1.6;">
<h1 style="font-size:20px;line-height:1.3;color:#111827;margin:20px 0 12px;">${esc(b.heading)}</h1>
${b.paragraphs.map((p) => `<p style="margin:0 0 12px;">${p}</p>`).join("")}
${summary}${button}${sig}
${b.footnote ? `<p style="font-size:12px;color:#6b7280;margin:20px 0 0;">${esc(b.footnote)}</p>` : ""}
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #f3f4f6;color:#9ca3af;font-size:12px;">${esc(brand.companyName)}${brand.address ? ` &middot; ${esc(brand.address)}` : ""}${contact ? `<br>${contact}` : ""}</td></tr>
</table></td></tr></table></body></html>`;

  const stripTags = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const text = [
    b.heading,
    "",
    ...b.paragraphs.map(stripTags),
    ...(b.summary ?? []).map((r) => `${r.label}: ${r.value}`),
    ...(b.button ? ["", `${b.button.label}: ${b.button.url}`] : []),
    ...(brand.signature ? ["", brand.signature] : []),
    "",
    brand.companyName,
  ].join("\n");

  return { subject, html, text };
}
