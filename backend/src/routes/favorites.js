import { Router } from 'express';
import { query } from '../db.js';
import { ah } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// GET /api/favorites  → the listings this user has hearted
router.get('/', ah(async (req, res) => {
  const me = req.user.id;
  const { rows } = await query(
    `select l.*, u.first_name as seller_name, u.avatar_emoji as seller_emoji,
            u.rating as seller_rating
     from favorites f
     join listings l on l.id = f.listing_id
     join users u on u.id = l.seller_id
     where f.user_id = $1 and l.status <> 'removed'
     order by f.created_at desc`,
    [me]
  );
  const ids = rows.map(r => r.id);
  const photos = ids.length
    ? (await query(
        `select id, listing_id, url, position from listing_photos
         where listing_id = any($1) order by position`, [ids])).rows
    : [];
  const byListing = {};
  for (const p of photos) (byListing[p.listing_id] ||= []).push(p);

  const items = rows.map(r => ({
    id: r.id, title: r.title, priceCents: r.price_cents, isFree: r.is_free,
    category: r.category, status: r.status,
    seller: { firstName: r.seller_name, avatarEmoji: r.seller_emoji },
    photos: (byListing[r.id] || []).map(p => ({ id: p.id, url: p.url, position: p.position })),
    favored: true,
  }));
  res.json({ items });
}));

export default router;
