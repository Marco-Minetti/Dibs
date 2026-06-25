import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { ah, ApiError } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { writeLimiter } from '../middleware/rateLimit.js';
import {
  createListingSchema, feedQuerySchema, CATEGORIES,
} from '../lib/validation.js';

const router = Router();
router.use(requireAuth); // everything here requires a logged-in student

// ---- shape a DB row + photos into the API response ----
function serialize(row, photos, favored, claimedByMe) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    priceCents: row.price_cents,
    isFree: row.is_free,
    category: row.category,
    condition: row.condition,
    pickupSpot: row.pickup_spot,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    seller: {
      id: row.seller_id,
      firstName: row.seller_name,
      avatarEmoji: row.seller_emoji,
      rating: Number(row.seller_rating),
    },
    photos: photos.map(p => ({ id: p.id, url: p.url, position: p.position })),
    favored: !!favored,
    claimedByMe: !!claimedByMe,
    mine: row.seller_id === row._me,
  };
}

// ============================================================
//  GET /api/listings        feed (scoped to your campus)
// ============================================================
router.get('/', validate(feedQuerySchema, 'query'), ah(async (req, res) => {
  const { category, q, cursor, limit } = req.query;
  const me = req.user.id;
  const params = [req.user.schoolId, me];
  let where = `l.school_id = $1 and l.status in ('active','on_hold')`;

  if (category && category !== 'all' && CATEGORIES.includes(category)) {
    params.push(category);
    where += ` and l.category = $${params.length}`;
  }
  if (category === 'free') where += ` and l.is_free = true`;
  if (q) {
    params.push(q);
    where += ` and l.search @@ plainto_tsquery('english', $${params.length})`;
  }
  if (cursor) {
    params.push(cursor);
    where += ` and l.created_at < $${params.length}`;
  }
  params.push(limit);

  const { rows } = await query(
    `select l.*, u.first_name as seller_name, u.avatar_emoji as seller_emoji,
            u.rating as seller_rating,
            exists(select 1 from favorites f where f.listing_id=l.id and f.user_id=$2) as favored,
            exists(select 1 from claims c where c.listing_id=l.id and c.buyer_id=$2) as claimed
     from listings l join users u on u.id = l.seller_id
     where ${where}
     order by l.created_at desc
     limit $${params.length}`,
    params
  );

  const ids = rows.map(r => r.id);
  const photos = ids.length
    ? (await query(
        `select id, listing_id, url, position from listing_photos
         where listing_id = any($1) order by position`, [ids]
      )).rows
    : [];
  const byListing = {};
  for (const p of photos) (byListing[p.listing_id] ||= []).push(p);

  const items = rows.map(r => serialize({ ...r, _me: me }, byListing[r.id] || [], r.favored, r.claimed));
  const nextCursor = rows.length === limit ? rows[rows.length - 1].created_at : null;
  res.json({ items, nextCursor });
}));

// ============================================================
//  POST /api/listings       create
// ============================================================
router.post('/', writeLimiter, validate(createListingSchema), ah(async (req, res) => {
  const b = req.body;
  const me = req.user.id;
  const price = b.isFree ? 0 : b.priceCents;

  const listing = await withTransaction(async (client) => {
    const ins = await client.query(
      `insert into listings
        (seller_id, school_id, title, description, price_cents, is_free,
         category, condition, pickup_spot, expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() + interval '21 days')
       returning *`,
      [me, req.user.schoolId, b.title, b.description, price, b.isFree,
       b.category, b.condition, b.pickupSpot]
    );
    const row = ins.rows[0];

    // Attach the user's already-uploaded photos (verifying ownership).
    const updated = await client.query(
      `update listing_photos
         set listing_id = $1,
             position = array_position($2::uuid[], id)
       where id = any($2) and owner_id = $3 and listing_id is null
       returning id`,
      [row.id, b.photoIds, me]
    );
    if (updated.rows.length < 2) {
      throw new ApiError(400, 'photos_invalid', 'Upload 2–3 photos before posting');
    }
    return row;
  });

  const photos = (await query(
    `select id, url, position from listing_photos where listing_id=$1 order by position`,
    [listing.id]
  )).rows;

  const { rows: [seller] } = await query(
    'select first_name, avatar_emoji, rating from users where id=$1', [me]
  );
  res.status(201).json(serialize(
    { ...listing, seller_name: seller.first_name, seller_emoji: seller.avatar_emoji,
      seller_rating: seller.rating, _me: me },
    photos, false, false
  ));
}));

// ============================================================
//  GET /api/listings/:id     detail
// ============================================================
router.get('/:id', ah(async (req, res) => {
  const me = req.user.id;
  const { rows } = await query(
    `select l.*, u.first_name as seller_name, u.avatar_emoji as seller_emoji,
            u.rating as seller_rating,
            exists(select 1 from favorites f where f.listing_id=l.id and f.user_id=$2) as favored,
            exists(select 1 from claims c where c.listing_id=l.id and c.buyer_id=$2) as claimed
     from listings l join users u on u.id=l.seller_id
     where l.id=$1`,
    [req.params.id, me]
  );
  if (!rows.length) throw new ApiError(404, 'not_found');
  const row = rows[0];
  if (row.school_id !== req.user.schoolId) throw new ApiError(403, 'other_campus');

  const photos = (await query(
    'select id, url, position from listing_photos where listing_id=$1 order by position',
    [row.id]
  )).rows;
  res.json(serialize({ ...row, _me: me }, photos, row.favored, row.claimed));
}));

// ============================================================
//  DELETE /api/listings/:id   (seller removes own listing)
// ============================================================
router.delete('/:id', ah(async (req, res) => {
  const { rowCount } = await query(
    `update listings set status='removed' where id=$1 and seller_id=$2 and status<>'removed'`,
    [req.params.id, req.user.id]
  );
  if (!rowCount) throw new ApiError(404, 'not_found');
  res.json({ ok: true });
}));

// ============================================================
//  Favorites
// ============================================================
router.put('/:id/favorite', ah(async (req, res) => {
  await query(
    `insert into favorites (user_id, listing_id) values ($1,$2)
     on conflict do nothing`,
    [req.user.id, req.params.id]
  );
  res.json({ ok: true, favored: true });
}));

router.delete('/:id/favorite', ah(async (req, res) => {
  await query('delete from favorites where user_id=$1 and listing_id=$2',
    [req.user.id, req.params.id]);
  res.json({ ok: true, favored: false });
}));

// ============================================================
//  POST /api/listings/:id/dibs   call dibs = 24h hold + opens chat
// ============================================================
router.post('/:id/dibs', writeLimiter, ah(async (req, res) => {
  const me = req.user.id;

  const out = await withTransaction(async (client) => {
    // Lock the listing row so two people can't grab it at once.
    const { rows } = await client.query(
      'select * from listings where id=$1 for update', [req.params.id]
    );
    if (!rows.length) throw new ApiError(404, 'not_found');
    const listing = rows[0];

    if (listing.school_id !== req.user.schoolId) throw new ApiError(403, 'other_campus');
    if (listing.seller_id === me) throw new ApiError(400, 'own_listing', "That's your own listing");
    if (listing.status !== 'active') throw new ApiError(409, 'already_claimed', 'Someone got there first');

    await client.query(`update listings set status='on_hold' where id=$1`, [listing.id]);

    await client.query(
      `insert into claims (listing_id, buyer_id, expires_at)
       values ($1,$2, now() + interval '24 hours')
       on conflict (listing_id, buyer_id) do nothing`,
      [listing.id, me]
    );

    // Create (or reuse) the buyer↔seller conversation for this listing.
    const conv = await client.query(
      `insert into conversations (listing_id, buyer_id, seller_id)
       values ($1,$2,$3)
       on conflict (listing_id, buyer_id) do update set listing_id = excluded.listing_id
       returning id`,
      [listing.id, me, listing.seller_id]
    );
    const conversationId = conv.rows[0].id;

    await client.query(
      `insert into messages (conversation_id, sender_id, body)
       values ($1,$2,$3)`,
      [conversationId, me, 'dibs! 🤙 still available?']
    );
    return { conversationId };
  });

  res.json({ ok: true, ...out });
}));

export default router;
