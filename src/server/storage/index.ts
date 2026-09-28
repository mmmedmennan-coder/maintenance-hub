import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getEnv } from "@/server/env";

export interface PrivateStorage {
  readonly driver: "local" | "s3";
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** Short-lived direct URL (S3 only); local storage streams through the app instead. */
  signedUrl?(key: string, fileName: string, inline: boolean, seconds: number): Promise<string>;
}

const KEY_PATTERN = /^[a-z0-9]+(\/[a-z0-9-]+)+$/;

export function assertSafeKey(key: string) {
  if (!KEY_PATTERN.test(key) || key.includes("..")) throw new Error("Invalid storage key");
}

class LocalStorage implements PrivateStorage {
  readonly driver = "local" as const;
  private readonly root: string;
  constructor(dir: string) {
    // Runtime-configured directory: excluded from build tracing (it is data, not code).
    this.root = path.resolve(/*turbopackIgnore: true*/ process.cwd(), dir);
    const publicDir = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "public");
    if (this.root === publicDir || this.root.startsWith(publicDir + path.sep)) {
      throw new Error("Private storage must not be inside /public");
    }
  }
  private resolve(key: string) {
    assertSafeKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("Path traversal rejected");
    return full;
  }
  async put(key: string, data: Buffer) {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
    await fs.writeFile(full, data, { mode: 0o600 });
  }
  async get(key: string) {
    return fs.readFile(this.resolve(key));
  }
  async delete(key: string) {
    await fs.rm(this.resolve(key), { force: true });
  }
}

class S3Storage implements PrivateStorage {
  readonly driver = "s3" as const;
  private readonly client: S3Client;
  constructor(private readonly bucket: string) {
    const env = getEnv();
    this.client = new S3Client({
      region: env.S3_REGION || "auto",
      endpoint: env.S3_ENDPOINT || undefined,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID ?? "", secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "" },
    });
  }
  async put(key: string, data: Buffer, contentType: string) {
    assertSafeKey(key);
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType, ServerSideEncryption: "AES256" }));
  }
  async get(key: string) {
    assertSafeKey(key);
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }
  async delete(key: string) {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
  async signedUrl(key: string, fileName: string, inline: boolean, seconds: number) {
    assertSafeKey(key);
    const disposition = `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(fileName)}`;
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key, ResponseContentDisposition: disposition }), {
      expiresIn: seconds,
    });
  }
}

let instance: PrivateStorage | undefined;

export function getStorage(): PrivateStorage {
  if (instance) return instance;
  const env = getEnv();
  instance = env.STORAGE_DRIVER === "s3" ? new S3Storage(env.S3_BUCKET!) : new LocalStorage(env.STORAGE_LOCAL_DIR);
  return instance;
}

/** For tests: override the storage backend. */
export function setStorageForTests(storage: PrivateStorage | undefined) {
  instance = storage;
}
