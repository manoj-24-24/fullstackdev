// S3-compatible object storage: Backblaze B2 (10 GB free, no card) or
// Cloudflare R2 (10 GB free, card on file). Whichever provider's env vars are
// configured, uploads are stored there instead of the MySQL files_blob table
// and downloads use short-lived presigned URLs so buckets stay private. When
// neither is configured (e.g. local dev), the caller falls back to
// database-backed storage.
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** @type {S3Client | null} */
let client = null;

export function r2Enabled() {
  return Boolean(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET);
}

// Backblaze B2: endpoint + keys from the app key you create in the B2 console.
function b2Enabled() {
  return Boolean(process.env.B2_ENDPOINT && process.env.B2_ACCESS_KEY_ID && process.env.B2_SECRET_ACCESS_KEY && process.env.B2_BUCKET);
}

export function objectStoreEnabled() {
  return r2Enabled() || b2Enabled();
}

function getClient() {
  if (!client) {
    if (r2Enabled()) {
      client = new S3Client({
        region: 'auto',
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
      });
    } else {
      client = new S3Client({
        region: process.env.B2_REGION || 'us-east-005',
        endpoint: process.env.B2_ENDPOINT,
        credentials: {
          accessKeyId: process.env.B2_ACCESS_KEY_ID,
          secretAccessKey: process.env.B2_SECRET_ACCESS_KEY,
        },
      });
    }
  }
  return client;
}

function bucketName() {
  return r2Enabled() ? process.env.R2_BUCKET : process.env.B2_BUCKET;
}

/** Uploads bytes to the configured object store under the given key. Throws on failure. */
export async function r2Put(key, body, contentType) {
  await getClient().send(new PutObjectCommand({ Bucket: bucketName(), Key: key, Body: body, ContentType: contentType }));
}

/** Returns a presigned GET URL valid for the given seconds. */
export async function r2SignedUrl(key, expiresIn = 3600) {
  return getSignedUrl(getClient(), new GetObjectCommand({ Bucket: bucketName(), Key: key }), { expiresIn });
}

/** Deletes an object. Missing objects are treated as success. */
export async function r2Delete(key) {
  try {
    await getClient().send(new DeleteObjectCommand({ Bucket: bucketName(), Key: key }));
  } catch (err) {
    // S3 deletes are idempotent; only network failures surface here.
    console.error('[objectstore] delete failed (continuing)', err);
  }
}
