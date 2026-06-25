import { Router } from 'express';
import { query } from '../db.js';
import { ah } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { writeLimiter } from '../middleware/rateLimit.js';
import { reportSchema } from '../lib/validation.js';
import { z } from 'zod';

const router = Router();
router.use(requireAuth);

// POST /api/safety/report
router.post('/report', writeLimiter, validate(reportSchema), ah(async (req, res) => {
  const { targetType, targetId, reason, detail } = req.body;
  await query(
    `insert into reports (reporter_id, target_type, target_id, reason, detail)
     values ($1,$2,$3,$4,$5)`,
    [req.user.id, targetType, targetId, reason, detail || null]
  );
  res.status(201).json({ ok: true });
}));

// POST /api/safety/block  { userId }
const blockSchema = z.object({ userId: z.string().uuid() });
router.post('/block', validate(blockSchema), ah(async (req, res) => {
  await query(
    `insert into blocks (blocker_id, blocked_id) values ($1,$2) on conflict do nothing`,
    [req.user.id, req.body.userId]
  );
  res.json({ ok: true });
}));

export default router;
