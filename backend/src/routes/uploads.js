import { Router } from 'express';
import { query } from '../db.js';
import { ah } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { writeLimiter } from '../middleware/rateLimit.js';
import { signUploadSchema } from '../lib/validation.js';
import { presignUpload } from '../services/storage.js';

const router = Router();

// POST /api/uploads/sign  { contentType }
// → { photoId, uploadUrl, fileUrl }
// The phone PUTs the image bytes straight to uploadUrl, then references
// photoId when creating the listing.
router.post('/sign', requireAuth, writeLimiter, validate(signUploadSchema), ah(async (req, res) => {
  const { uploadUrl, fileUrl } = await presignUpload(req.user.id, req.body.contentType);
  const { rows } = await query(
    `insert into listing_photos (owner_id, url, position) values ($1,$2,0) returning id`,
    [req.user.id, fileUrl]
  );
  res.json({ photoId: rows[0].id, uploadUrl, fileUrl });
}));

export default router;
