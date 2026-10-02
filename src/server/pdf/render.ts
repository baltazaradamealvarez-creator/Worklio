import PDFDocument from "pdfkit";
import { formatMoney } from "@/lib/money";

export interface PdfLine {
  name: string;
  description?: string | null;
  quantity: string;
  unitPriceCents: number;
  discountLabel?: string | null;
  totalCents: number;
}

export interface PdfSection {
  heading?: string;
  subheading?: string | null;
  recommended?: boolean;
  lines: PdfLine[];
  totals: { label: string; cents: number; bold?: boolean }[];
}

export interface PdfInput {
  kind: "QUOTE" | "INVOICE" | "RECEIPT";
  number: string;
  title?: string | null;
  currency: string;
  brand: { name: string; address: string | null; phone: string | null; email: string | null; website: string | null; taxId: string | null; color: string; logo: Buffer | null };
  customer: { name: string; lines: string[]; email?: string | null; phone?: string | null };
  serviceLocation?: string | null;
  meta: { label: string; value: string }[];
  intro?: string | null;
  sections: PdfSection[];
  customerNotes?: string | null;
  terms?: string | null;
  footer?: string | null;
  /** big diagonal stamp, e.g. PAID or VOID */
  stamp?: { text: string; color: string } | null;
  signature?: { name: string; signedAt: string; image: Buffer | null } | null;
  payments?: { date: string; method: string; reference: string | null; cents: number }[];
}

const hexToRgb = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [29, 78, 216];
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const INK = "#111827";
const MUTED = "#6b7280";
const RULE = "#e5e7eb";

export function renderPdf(input: PdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 48, bufferPages: true, info: { Title: `${input.kind} ${input.number}`, Author: input.brand.name } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const color = hexToRgb(input.brand.color);
    const money = (c: number) => formatMoney(c, input.currency);
    const L = doc.page.margins.left;
    const R = doc.page.width - doc.page.margins.right;
    const W = R - L;
    const bottom = () => doc.page.height - doc.page.margins.bottom - 28;

    const ensure = (h: number) => {
      if (doc.y + h > bottom()) doc.addPage();
    };

    // ── Header ────────────────────────────────────────────────────────────────
    let leftY = doc.y;
    if (input.brand.logo) {
      try {
        doc.image(input.brand.logo, L, leftY, { fit: [150, 48] });
        leftY += 54;
      } catch {
        /* unsupported logo format: fall back to name */
      }
    }
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(input.brand.logo ? 10 : 16).text(input.brand.name, L, leftY, { width: W * 0.55 });
    doc.font("Helvetica").fontSize(9).fillColor(MUTED);
    for (const line of [input.brand.address, input.brand.phone, input.brand.email, input.brand.website, input.brand.taxId ? `Tax ID ${input.brand.taxId}` : null].filter(Boolean) as string[]) {
      doc.text(line, L, doc.y, { width: W * 0.55 });
    }
    const leftEnd = doc.y;

    doc.fillColor(color).font("Helvetica-Bold").fontSize(22).text(input.kind === "RECEIPT" ? "RECEIPT" : input.kind, L + W * 0.55, 48, { width: W * 0.45, align: "right" });
    doc.fillColor(INK).fontSize(11).text(input.number, L + W * 0.55, doc.y, { width: W * 0.45, align: "right" });
    doc.font("Helvetica").fontSize(9).fillColor(MUTED);
    for (const m of input.meta) doc.text(`${m.label}: ${m.value}`, L + W * 0.55, doc.y + 1, { width: W * 0.45, align: "right" });
    doc.y = Math.max(leftEnd, doc.y) + 18;

    doc.moveTo(L, doc.y).lineTo(R, doc.y).lineWidth(2).strokeColor(color).stroke();
    doc.y += 14;

    // ── Parties ──────────────────────────────────────────────────────────────────
    const partiesTop = doc.y;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED).text(input.kind === "QUOTE" ? "PREPARED FOR" : "BILL TO", L, partiesTop);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(input.customer.name, L, doc.y + 2, { width: W / 2 - 10 });
    doc.font("Helvetica").fontSize(9).fillColor(INK);
    for (const l of input.customer.lines) doc.text(l, L, doc.y, { width: W / 2 - 10 });
    if (input.customer.email) doc.fillColor(MUTED).text(input.customer.email, L, doc.y, { width: W / 2 - 10 });
    if (input.customer.phone) doc.fillColor(MUTED).text(input.customer.phone, L, doc.y, { width: W / 2 - 10 });
    const leftBottom = doc.y;
    if (input.serviceLocation) {
      doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED).text("SERVICE LOCATION", L + W / 2, partiesTop, { width: W / 2 });
      doc.font("Helvetica").fontSize(9).fillColor(INK).text(input.serviceLocation, L + W / 2, doc.y + 2, { width: W / 2 });
    }
    doc.y = Math.max(leftBottom, doc.y) + 16;

    if (input.title) {
      doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text(input.title, L, doc.y, { width: W });
      doc.y += 4;
    }
    if (input.intro) {
      doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(input.intro, L, doc.y, { width: W });
      doc.y += 6;
    }

    // ── Line-item sections ────────────────────────────────────────────────────────
    const cols = { desc: L, qty: L + W * 0.56, price: L + W * 0.68, total: L + W * 0.84 };
    const drawHeaderRow = () => {
      doc.rect(L, doc.y, W, 18).fill("#f3f4f6");
      doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(8);
      const y = doc.y + 5;
      doc.text("DESCRIPTION", cols.desc + 6, y, { width: W * 0.5 });
      doc.text("QTY", cols.qty, y, { width: W * 0.1, align: "right" });
      doc.text("UNIT PRICE", cols.price, y, { width: W * 0.14, align: "right" });
      doc.text("AMOUNT", cols.total, y, { width: W * 0.16 - 6, align: "right" });
      doc.y += 22;
    };

    for (const section of input.sections) {
      ensure(80);
      if (section.heading) {
        doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(section.heading, L, doc.y, { continued: !!section.recommended });
        if (section.recommended) doc.fillColor(color).fontSize(8).text("   RECOMMENDED");
        if (section.subheading) doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(section.subheading, L, doc.y, { width: W });
        doc.y += 4;
      }
      drawHeaderRow();
      for (const line of section.lines) {
        const descHeight = doc.font("Helvetica-Bold").fontSize(9.5).heightOfString(line.name, { width: W * 0.52 }) + (line.description ? doc.font("Helvetica").fontSize(8.5).heightOfString(line.description, { width: W * 0.52 }) : 0);
        ensure(descHeight + 14);
        if (doc.y + descHeight + 14 > bottom() - 10) drawHeaderRow();
        const y = doc.y;
        doc.font("Helvetica-Bold").fontSize(9.5).fillColor(INK).text(line.name, cols.desc + 6, y, { width: W * 0.52 });
        if (line.description) doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(line.description, cols.desc + 6, doc.y, { width: W * 0.52 });
        const endY = doc.y;
        doc.font("Helvetica").fontSize(9.5).fillColor(INK);
        doc.text(line.quantity, cols.qty, y, { width: W * 0.1, align: "right" });
        doc.text(money(line.unitPriceCents), cols.price, y, { width: W * 0.14, align: "right" });
        doc.text(money(line.totalCents), cols.total, y, { width: W * 0.16 - 6, align: "right" });
        if (line.discountLabel) doc.fontSize(8).fillColor(MUTED).text(line.discountLabel, cols.price, y + 11, { width: W * 0.3 - 6, align: "right" });
        doc.y = Math.max(endY, y + (line.discountLabel ? 22 : 13)) + 6;
        doc.moveTo(L, doc.y - 3).lineTo(R, doc.y - 3).lineWidth(0.5).strokeColor(RULE).stroke();
      }
      // Totals block, right-aligned
      doc.y += 4;
      ensure(section.totals.length * 16 + 10);
      for (const t of section.totals) {
        const y = doc.y;
        doc.font(t.bold ? "Helvetica-Bold" : "Helvetica").fontSize(t.bold ? 11 : 9.5).fillColor(t.bold ? INK : MUTED);
        doc.text(t.label, L + W * 0.55, y, { width: W * 0.29, align: "right" });
        doc.fillColor(INK).text(money(t.cents), cols.total, y, { width: W * 0.16 - 6, align: "right" });
        doc.y = y + (t.bold ? 18 : 14);
      }
      doc.y += 8;
    }

    if (input.payments?.length) {
      ensure(40 + input.payments.length * 14);
      doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text("Payments received", L, doc.y);
      doc.y += 3;
      for (const p of input.payments) {
        doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(`${p.date} · ${p.method}${p.reference ? ` · ${p.reference}` : ""}`, L, doc.y, { continued: false, width: W * 0.7 });
        doc.fillColor(INK).text(money(p.cents), L, doc.y - 11, { width: W - 6, align: "right" });
        doc.y += 3;
      }
      doc.y += 6;
    }

    const block = (label: string, text: string) => {
      const h = doc.font("Helvetica").fontSize(8.5).heightOfString(text, { width: W });
      ensure(h + 24);
      doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED).text(label, L, doc.y);
      doc.font("Helvetica").fontSize(8.5).fillColor(INK).text(text, L, doc.y + 2, { width: W });
      doc.y += 10;
    };
    if (input.customerNotes) block("NOTES", input.customerNotes);
    if (input.terms) block("TERMS & CONDITIONS", input.terms);

    if (input.signature) {
      ensure(90);
      doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED).text("ACCEPTED BY", L, doc.y);
      if (input.signature.image) {
        try { doc.image(input.signature.image, L, doc.y + 2, { fit: [180, 50] }); doc.y += 54; } catch { doc.y += 4; }
      }
      doc.font("Helvetica").fontSize(9).fillColor(INK).text(`${input.signature.name} — ${input.signature.signedAt}`, L, doc.y + 2);
      doc.y += 14;
    }

    if (input.footer) {
      ensure(30);
      doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(input.footer, L, doc.y + 6, { width: W, align: "center" });
    }

    // Stamp (first page) + page numbers on every page
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      if (input.stamp && i === 0) {
        doc.save();
        doc.rotate(-24, { origin: [doc.page.width / 2, 300] });
        doc.fillColor(input.stamp.color).fillOpacity(0.14).font("Helvetica-Bold").fontSize(110);
        doc.text(input.stamp.text, 0, 250, { width: doc.page.width, align: "center", lineBreak: false });
        doc.restore();
      }
      doc.fillOpacity(1).font("Helvetica").fontSize(8).fillColor(MUTED);
      const label = `${input.brand.name}  ·  ${input.kind === "RECEIPT" ? "Receipt" : input.kind === "QUOTE" ? "Quote" : "Invoice"} ${input.number}  ·  Page ${i + 1} of ${range.count}`;
      doc.text(label, L, doc.page.height - 36, { width: W, align: "center", lineBreak: false });
    }
    doc.flushPages();
    doc.end();
  });
}
