// Cloudinary object storage. When the CLOUDINARY_* env vars are configured,
// uploads are stored in Cloudinary's free tier (credit-based, ~25 GB) instead
// of the MySQL files_blob table. Objects are private ("authenticated" type);
// every read goes through a short-lived signed URL minted on demand. When not
// configured (local dev), the caller falls back to R2 or database storage.
import { v2 as cloudinary } from 'cloudinary';

let configured = false;

export function cloudinaryEnabled() {
  return configured;
}

export function initCloudinary() {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    configured = false;
    return;
  }
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
  configured = true;
  console.log('[cloudinary] storage enabled for cloud', CLOUDINARY_CLOUD_NAME);
}

// Images go in as "image" resources (inline rendering + transformations);
// everything else (PDFs, docs) as "raw".
function resourceTypeFor(contentType, key) {
  if ((contentType || '').startsWith('image/')) return 'image';
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(key)) return 'image';
  return 'raw';
}

/**
 * Uploads bytes to Cloudinary under "bucket/path" (extension stripped —
 * Cloudinary manages formats itself). Returns { publicId, resourceType }.
 */
export async function cloudinaryPut(key, buffer, contentType) {
  const publicId = key.replace(/\.[^.]+$/, '');
  const resourceType = resourceTypeFor(contentType, key);
  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { public_id: publicId, resource_type: resourceType, type: 'authenticated', overwrite: true },
      (err, res) => (err ? reject(err) : resolve(res))
    );
    stream.end(buffer);
  });
  return { publicId: result.public_id, resourceType };
}

/**
 * Signed inline-viewing URL for an authenticated asset, valid ~1 hour.
 * `inline` adds fl_inline so browsers render the file instead of downloading
 * it — needed for images and for PDFs shown inside the in-app viewer.
 */
export function cloudinarySignedUrl(publicId, resourceType = 'raw', expiresIn = 3600, inline = false) {
  return cloudinary.url(publicId, {
    type: 'authenticated',
    resource_type: resourceType,
    sign_url: true,
    secure: true,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    ...(inline ? { transformation: [{ flags: 'inline' }] } : {}),
  });
}

/** Deletes an object. Missing objects are treated as success. */
export async function cloudinaryDelete(publicId, resourceType = 'raw') {
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType, type: 'authenticated' });
  } catch (err) {
    console.error('[cloudinary] delete failed (continuing)', err);
  }
}
