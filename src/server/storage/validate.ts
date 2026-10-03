import path from "node:path";
import { AppError } from "@/server/errors";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

interface Allowed {
  mime: string;
  ext: string[];
  /** Verify real content, not the client-claimed type. */
  sniff: (b: Buffer) => boolean;
  inline: boolean;
}

const startsWith = (b: Buffer, ...bytes: number[]) => bytes.every((v, i) => b[i] === v);
const ascii = (b: Buffer, offset: number, s: string) => b.subarray(offset, offset + s.length).toString("latin1") === s;
const looksLikeText = (b: Buffer) => !b.subarray(0, 4096).includes(0);

const ALLOWED: Allowed[] = [
  { mime: "image/jpeg", ext: [".jpg", ".jpeg"], sniff: (b) => startsWith(b, 0xff, 0xd8, 0xff), inline: true },
  { mime: "image/png", ext: [".png"], sniff: (b) => startsWith(b, 0x89, 0x50, 0x4e, 0x47), inline: true },
  { mime: "image/gif", ext: [".gif"], sniff: (b) => ascii(b, 0, "GIF8"), inline: true },
  { mime: "image/webp", ext: [".webp"], sniff: (b) => ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP"), inline: true },
  { mime: "application/pdf", ext: [".pdf"], sniff: (b) => ascii(b, 0, "%PDF"), inline: true },
  { mime: "text/plain", ext: [".txt", ".log"], sniff: looksLikeText, inline: false },
  { mime: "text/csv", ext: [".csv"], sniff: looksLikeText, inline: false },
  { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: [".docx"], sniff: (b) => startsWith(b, 0x50, 0x4b), inline: false },
  { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: [".xlsx"], sniff: (b) => startsWith(b, 0x50, 0x4b), inline: false },
  { mime: "application/msword", ext: [".doc"], sniff: (b) => startsWith(b, 0xd0, 0xcf, 0x11, 0xe0), inline: false },
  { mime: "application/vnd.ms-excel", ext: [".xls"], sniff: (b) => startsWith(b, 0xd0, 0xcf, 0x11, 0xe0), inline: false },
];

export interface ValidatedFile {
  filename: string;
  mimeType: string;
  inline: boolean;
}

/** Strip path components and control characters from a user-supplied filename. */
export function sanitizeFilename(name: string): string {
  const base = path.basename(name.replace(/\\/g, "/")).replace(/[\u0000-\u001f\u007f"<>:|?*]/g, "_").trim();
  const trimmed = base.slice(-120);
  return trimmed || "file";
}

/**
 * Validate an uploaded file by extension AND real content signature. SVG/HTML/scripts are
 * rejected outright (stored-XSS vectors). The stored MIME type is derived from the content
 * match, never from the client header.
 */
export function validateUpload(filename: string, size: number, content: Buffer): ValidatedFile {
  if (size <= 0) throw new AppError("VALIDATION", "The file is empty.");
  if (size > MAX_UPLOAD_BYTES) throw new AppError("VALIDATION", "Files can be up to 25 MB.");
  const safeName = sanitizeFilename(filename);
  const ext = path.extname(safeName).toLowerCase();
  const match = ALLOWED.find((a) => a.ext.includes(ext));
  if (!match) throw new AppError("VALIDATION", "That file type isn't supported. Upload images, PDFs, or Office/text documents.");
  if (!match.sniff(content)) throw new AppError("VALIDATION", "The file contents don't match its type.");
  return { filename: safeName, mimeType: match.mime, inline: match.inline };
}

export function isInlineMime(mime: string): boolean {
  return ALLOWED.some((a) => a.mime === mime && a.inline);
}
