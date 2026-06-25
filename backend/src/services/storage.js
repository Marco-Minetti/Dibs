import crypto from 'node:crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.js';

const s3 = new S3Client({
  region: config.s3Region,
  endpoint: config.s3Endpoint || undefined,   // set for Cloudflare R2 / MinIO
  forcePathStyle: !!config.s3Endpoint,
  credentials: config.s3Key
    ? { accessKeyId: config.s3Key, secretAccessKey: config.s3Secret }
    : undefined,
});

// Only allow real image types.
const ALLOWED = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

// Returns a short-lived PUT url the phone uploads directly to, plus the public
// url the photo will live at. Keeps large image bytes off our API server.
export async function presignUpload(userId, contentType) {
  const ext = ALLOWED[contentType];
  if (!ext) {
    const err = new Error('unsupported_image_type');
    err.status = 400;
    throw err;
  }

  const key = `uploads/${userId}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  const cmd = new PutObjectCommand({
    Bucket: config.s3Bucket,
    Key: key,
    ContentType: contentType,
  });
  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 300 });

  const fileUrl = config.cdnBase
    ? `${config.cdnBase}/${key}`
    : `https://${config.s3Bucket}.s3.${config.s3Region}.amazonaws.com/${key}`;

  return { uploadUrl, fileUrl, key };
}
