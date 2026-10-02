import { beforeAll, describe, expect, it } from "vitest";
import * as files from "@/server/domain/attachments";
import { storage } from "@/server/storage/provider";
import { sanitizeFilename, validateUpload } from "@/server/storage/validate";
import { buildGraph, createTestTenant, installProviders, memoryStorage, type TestTenant } from "../helpers/fixtures";

let t: TestTenant;
let g: Awaited<ReturnType<typeof buildGraph>>;
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const up = (name: string, content: Buffer, entity = { entityType: "CUSTOMER", entityId: "" }) => files.uploadAttachment(t.owner, { name, size: content.length, content }, { ...entity, entityId: entity.entityId || g.customer.id });

beforeAll(async () => {
  installProviders();
  t = await createTestTenant("Files");
  g = await buildGraph(t);
}, 60_000);

describe("upload validation", () => {
  it("accepts real images and PDFs and derives the MIME type from content", async () => {
    expect((await up("photo.png", PNG)).mimeType).toBe("image/png");
    expect((await up("manual.pdf", PDF)).mimeType).toBe("application/pdf");
  });

  it.each([
    ["script disguised as image", "evil.png", Buffer.from("<script>alert(1)</script>")],
    ["SVG (stored-XSS vector)", "logo.svg", Buffer.from("<svg onload=alert(1)/>")],
    ["HTML", "page.html", Buffer.from("<html></html>")],
    ["executable", "setup.exe", Buffer.from("MZ\x90\x00")],
    ["PDF extension, wrong content", "fake.pdf", Buffer.from("not a pdf")],
    ["empty file", "empty.pdf", Buffer.alloc(0)],
  ])("rejects %s", async (_n, name, content) => {
    await expect(up(name, content)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects files over 25 MB without reading them", () => {
    expect(() => validateUpload("big.pdf", 26 * 1024 * 1024, PDF)).toThrow(/25 MB/);
  });

  it("sanitises hostile filenames", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("a\u0000b<c>.pdf")).not.toMatch(/[\u0000<>]/);
    expect(sanitizeFilename("C:\\Users\\x\\report.pdf")).toBe("report.pdf");
  });
});

describe("storage is private and tenant-namespaced", () => {
  it("uses opaque, tenant-prefixed keys and never exposes a path or URL", async () => {
    const a = await up("photo.png", PNG);
    expect(a.storageKey.startsWith(`${t.tenantId}/`)).toBe(true);
    expect(a.storageKey).not.toContain("photo");
    expect(JSON.stringify(a)).not.toMatch(/https?:\/\//);
    expect(memoryStorage.objects.has(a.storageKey)).toBe(true);
  });

  it("rejects path-traversal style keys at the storage layer", async () => {
    // The local driver (used in dev) must not be escapable.
    const { setStorageProvider } = await import("@/server/storage/provider");
    setStorageProvider(undefined);
    await expect(storage().get("../../etc/passwd")).rejects.toThrow(/Invalid storage key/);
    await expect(storage().put("a/../../b", Buffer.from("x"), "text/plain")).rejects.toThrow(/Invalid storage key/);
    installProviders();
  });

  it("downloads require files.view and access to the parent record", async () => {
    const a = await up("manual.pdf", PDF, { entityType: "EQUIPMENT", entityId: g.equipment.id });
    const { bytes } = await files.readAttachmentBytes(t.owner, a.id);
    expect(bytes.equals(PDF)).toBe(true);
    const ro = await t.as("READ_ONLY");
    expect((await files.readAttachmentBytes(ro, a.id)).bytes.length).toBe(PDF.length);
    const unrelatedTech = await t.as("TECHNICIAN"); // no assigned jobs → no access to this customer's records
    await expect(files.readAttachmentBytes(unrelatedTech, a.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const noFiles = await t.as("DISPATCHER");
    await t.owner.db.role.update({ where: { id: (await t.owner.db.role.findFirstOrThrow({ where: { key: "DISPATCHER" } })).id }, data: { permissions: ["customers.view"] } });
    const { loadTenantContext } = await import("@/server/auth/context");
    const stripped = (await loadTenantContext(noFiles.userId, t.tenantId))!;
    await expect(files.readAttachmentBytes(stripped, a.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("employee documents are restricted to HR-privileged users and the employee", async () => {
    const emp = g.employee;
    const doc = await files.uploadAttachment(t.owner, { name: "i9.pdf", size: PDF.length, content: PDF }, { entityType: "EMPLOYEE", entityId: emp.id, kind: "DOCUMENT" });
    const sales = await t.as("SALES");
    await expect(files.readAttachmentBytes(sales, doc.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const manager = await t.as("OFFICE_MANAGER");
    await expect(files.readAttachmentBytes(manager, doc.id)).resolves.toBeTruthy();
  });

  it("deletes are soft: the file becomes unreachable and the action is audited", async () => {
    const a = await up("old.pdf", PDF);
    await files.deleteAttachment(t.owner, a.id);
    await expect(files.readAttachmentBytes(t.owner, a.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await t.owner.db.auditLog.count({ where: { action: "file.deleted", entityId: a.id } })).toBe(1);
  });

  it("enforces the plan's storage limit", async () => {
    await t.owner.db.$executeRaw`SELECT 1`;
    const { platformDb } = await import("@/server/db");
    await platformDb().subscription.update({ where: { tenantId: t.tenantId }, data: { maxStorageMbOverride: 1 } });
    const big = Buffer.concat([PDF, Buffer.alloc(2 * 1024 * 1024)]);
    await expect(files.uploadAttachment(t.owner, { name: "big.pdf", size: big.length, content: big }, { entityType: "CUSTOMER", entityId: g.customer.id })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    await platformDb().subscription.update({ where: { tenantId: t.tenantId }, data: { maxStorageMbOverride: null } });
  });
});
