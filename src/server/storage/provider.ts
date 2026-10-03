import { promises as fs } from "node:fs";
import path from "node:path";
import { env } from "@/server/env";

/**
 * Object storage abstraction. Objects are private: they are only ever served through an
 * authenticated, permission-checked route handler — never by a public/predictable URL.
 * Keys are opaque (`<tenantId>/<yyyy-mm>/<random>`), which also gives a per-tenant prefix
 * for bucket policies and usage accounting.
 */
export interface StorageProvider {
  readonly name: string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

const KEY_RE = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+){1,3}$/;

function assertSafeKey(key: string) {
  if (!KEY_RE.test(key) || key.includes("..")) throw new Error("Invalid storage key");
}

class LocalStorage implements StorageProvider {
  readonly name = "local";
  private root: string;
  constructor(dir: string) {
    this.root = path.resolve(dir);
  }
  private resolve(key: string) {
    assertSafeKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("Invalid storage key");
    return full;
  }
  async put(key: string, body: Buffer) {
    const file = this.resolve(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body, { mode: 0o600 });
  }
  async get(key: string) {
    return fs.readFile(this.resolve(key));
  }
  async delete(key: string) {
    await fs.rm(this.resolve(key), { force: true });
  }
}

/** S3 / S3-compatible (R2, MinIO). Needs S3_BUCKET, S3_REGION and credentials. */
class S3Storage implements StorageProvider {
  readonly name = "s3";
  private clientPromise: Promise<{ client: import("@aws-sdk/client-s3").S3Client; sdk: typeof import("@aws-sdk/client-s3") }> | undefined;

  private async sdk() {
    this.clientPromise ??= (async () => {
      const sdk = await import("@aws-sdk/client-s3");
      const { S3_REGION, S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
      const client = new sdk.S3Client({
        region: S3_REGION || "us-east-1",
        endpoint: S3_ENDPOINT || undefined,
        forcePathStyle: !!S3_ENDPOINT,
        credentials: S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY ? { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY } : undefined,
      });
      return { client, sdk };
    })();
    return this.clientPromise;
  }
  private get bucket() {
    const b = process.env.S3_BUCKET;
    if (!b) throw new Error("STORAGE_DRIVER=s3 requires S3_BUCKET");
    return b;
  }
  async put(key: string, body: Buffer, contentType: string) {
    assertSafeKey(key);
    const { client, sdk } = await this.sdk();
    await client.send(new sdk.PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: process.env.S3_ENDPOINT ? undefined : "AES256" }));
  }
  async get(key: string) {
    assertSafeKey(key);
    const { client, sdk } = await this.sdk();
    const res = await client.send(new sdk.GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) throw new Error("Object not found");
    return Buffer.from(bytes);
  }
  async delete(key: string) {
    assertSafeKey(key);
    const { client, sdk } = await this.sdk();
    await client.send(new sdk.DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

let override: StorageProvider | undefined;
let cached: StorageProvider | undefined;
export function setStorageProvider(p: StorageProvider | undefined) {
  override = p;
}
export function storage(): StorageProvider {
  if (override) return override;
  if (!cached) cached = env().STORAGE_DRIVER === "s3" ? new S3Storage() : new LocalStorage(env().STORAGE_LOCAL_DIR);
  return cached;
}
