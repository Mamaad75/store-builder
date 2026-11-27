import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { isStorableMediaKey } from "@store-builder/shared/lib/storage/variants";
import type { StorageConfig } from "./config.js";
import type { ListPage, MediaStorage } from "./types.js";

/**
 * S3-compatible implementation (AWS S3, MinIO, ...). This is the ONLY file that imports the AWS SDK.
 * The credentials in `config` have write access and stay on the server; the browser only ever sees public,
 * read-only object URLs built by `mediaPublicUrl`.
 */
export class S3MediaStorage implements MediaStorage {
  private readonly client: S3Client;
  constructor(private readonly config: StorageConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      maxAttempts: 3,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }

  async put(key: string, body: Buffer, opts: { contentType: string }): Promise<void> {
    if (!isStorableMediaKey(key)) throw new Error("refusing to write an invalid media key");
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: opts.contentType,
        // Keys are random and content never changes under a key, so objects are immutable.
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
  }

  async delete(key: string): Promise<void> {
    if (!isStorableMediaKey(key)) throw new Error("refusing to delete an invalid media key");
    // S3 DeleteObject succeeds for a missing key, which makes this idempotent.
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }

  async list(prefix: string, opts: { limit?: number; after?: string } = {}): Promise<ListPage> {
    const out = await this.client.send(
      new ListObjectsV2Command({ Bucket: this.config.bucket, Prefix: prefix, MaxKeys: opts.limit ?? 500, ContinuationToken: opts.after }),
    );
    return {
      objects: (out.Contents ?? []).flatMap((o) => (o.Key && o.LastModified ? [{ key: o.Key, size: o.Size ?? 0, lastModified: o.LastModified }] : [])),
      next: out.IsTruncated ? out.NextContinuationToken : undefined,
    };
  }

  async get(key: string): Promise<Buffer | null> {
    if (!isStorableMediaKey(key)) throw new Error("refusing to read an invalid media key");
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return out.Body ? Buffer.from(await out.Body.transformToByteArray()) : null;
    } catch (e) {
      if (e instanceof S3ServiceException && (e.$metadata.httpStatusCode === 404 || e.name === "NoSuchKey")) return null;
      throw e;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }));
      return true;
    } catch (e) {
      if (e instanceof S3ServiceException && (e.$metadata.httpStatusCode === 404 || e.name === "NotFound")) return false;
      throw e;
    }
  }
}
