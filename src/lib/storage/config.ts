import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_BUCKET: z.string().min(3).max(63),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: bool.default(true),
  /** Public, read-only base URL under which objects are served: `<base>/<key>`. Not stored in the database. */
  S3_PUBLIC_BASE_URL: z.url(),
});

export type StorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  publicBaseUrl: string;
};

export class StorageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageConfigError";
  }
}

/** Validated server-side configuration. Secrets are only ever read here, on the server. */
export function getStorageConfig(source: Record<string, string | undefined> = process.env): StorageConfig {
  const r = schema.safeParse({
    S3_ENDPOINT: source.S3_ENDPOINT,
    S3_REGION: source.S3_REGION || undefined,
    S3_BUCKET: source.S3_BUCKET,
    S3_ACCESS_KEY_ID: source.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: source.S3_SECRET_ACCESS_KEY,
    S3_FORCE_PATH_STYLE: source.S3_FORCE_PATH_STYLE || undefined,
    S3_PUBLIC_BASE_URL: source.S3_PUBLIC_BASE_URL,
  });
  if (!r.success) {
    // Names only, never values (they may contain secrets).
    const names = [...new Set(r.error.issues.map((i) => String(i.path[0])))];
    throw new StorageConfigError(`Invalid or missing storage configuration: ${names.join(", ")}`);
  }
  const d = r.data;
  return {
    endpoint: d.S3_ENDPOINT,
    region: d.S3_REGION,
    bucket: d.S3_BUCKET,
    accessKeyId: d.S3_ACCESS_KEY_ID,
    secretAccessKey: d.S3_SECRET_ACCESS_KEY,
    forcePathStyle: d.S3_FORCE_PATH_STYLE,
    publicBaseUrl: d.S3_PUBLIC_BASE_URL.replace(/\/+$/, ""),
  };
}

/** Only the public base URL (no secrets): safe to use from rendering code. */
export function getPublicBaseUrl(source: Record<string, string | undefined> = process.env): string {
  const r = z.url().safeParse(source.S3_PUBLIC_BASE_URL);
  if (!r.success) throw new StorageConfigError("Invalid or missing storage configuration: S3_PUBLIC_BASE_URL");
  return r.data.replace(/\/+$/, "");
}
