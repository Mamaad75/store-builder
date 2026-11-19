import { CreateBucketCommand, HeadBucketCommand, PutBucketPolicyCommand, S3Client } from "@aws-sdk/client-s3";
import { getStorageConfig, type StorageConfig } from "../lib/storage/config";

/**
 * Storage used by integration/E2E tests. Hard safety rules (mirroring the database ones): the endpoint must be a
 * local/loopback host, the bucket name must end in "-test" or "-e2e", and the credentials come only from TEST_S3_*
 * variables (CI: throw-away MinIO container; local: any S3-compatible server). Production settings (S3_*) are
 * never read here, so these tests cannot reach production storage.
 */
export function getTestStorageEnv(bucketSuffix: "test" | "e2e", source: Record<string, string | undefined> = process.env): Record<string, string> {
  const endpoint = source.TEST_S3_ENDPOINT ?? "http://127.0.0.1:9000";
  const bucket = source.TEST_S3_BUCKET ?? `store-builder-media-${bucketSuffix}`;
  const host = new URL(endpoint).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) throw new Error(`Refusing to run storage tests against a non-local endpoint: ${host}`);
  if (!/-(test|e2e)$/.test(bucket)) throw new Error(`Refusing to use bucket "${bucket}": test buckets must end in -test or -e2e`);
  return {
    S3_ENDPOINT: endpoint,
    S3_REGION: "us-east-1",
    S3_BUCKET: bucket,
    S3_ACCESS_KEY_ID: source.TEST_S3_ACCESS_KEY_ID ?? "minioadmin",
    S3_SECRET_ACCESS_KEY: source.TEST_S3_SECRET_ACCESS_KEY ?? "minioadmin",
    S3_FORCE_PATH_STYLE: "true",
    S3_PUBLIC_BASE_URL: `${endpoint.replace(/\/+$/, "")}/${bucket}`,
  };
}

/** Idempotent, deterministic bucket setup: create the isolated bucket and allow anonymous READ of objects only. */
export async function ensureTestBucket(env: Record<string, string | undefined>): Promise<StorageConfig> {
  const config = getStorageConfig(env);
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
  }
  // Public access is READ-ONLY: GetObject on objects. No ListBucket, no Put/Delete for anonymous users.
  await client.send(
    new PutBucketPolicyCommand({
      Bucket: config.bucket,
      Policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{ Sid: "PublicReadObjects", Effect: "Allow", Principal: "*", Action: ["s3:GetObject"], Resource: [`arn:aws:s3:::${config.bucket}/*`] }],
      }),
    }),
  );
  return config;
}
