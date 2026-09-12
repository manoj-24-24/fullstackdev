// Cloudflare R2 object storage (S3-compatible). When the R2_* env vars are
// configured, uploads are stored in R2's free tier instead of the MySQL
// files_blob table — 10 GB free vs 1 GB total DB — and downloads use
// short-lived presigned URLs so buckets stay private. When not configured
// (e.g. local dev), the caller falls back to database-backed storage.
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** @type {S3Client | null} */
let client = null;

export function r2Enabled() {
  return Boolean(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET);
}

function getClient() {
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return client;
}

/** Uploads bytes to R2 under the given key. Throws on failure. */
export async function r2Put(key, body, contentType) {
  await getClient().send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, Body: body, ContentType: contentType }));
}

/** Returns a presigned GET URL valid for the given seconds. */
export async function r2SignedUrl(key, expiresIn = 3600) {
  return getSignedUrl(getClient(), new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }), { expiresIn });
}

/** Deletes an object. Missing objects are treated as success. */
export async function r2Delete(key) {
  try {
    await getClient().send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
  } catch (err) {
    // S3 deletes are idempotent; only network failures surface here.
    console.error('[r2] delete failed (continuing)', err);
  }
}
