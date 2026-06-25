import { Router } from 'express';
import { query } from '../db.js';
import { ah, ApiError } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { writeLimiter } from '../middleware/rateLimit.js';
import { messageSchema } from '../lib/validation.js';
import { notifyMessage } from '../realtime.js';

const router = Router();
router.use(requireAuth);

// Confirm the user is a participant of the conversation.
async function loadConversation(convId, userId) {
  const { rows } = await query('select * from conversations where id=$1', [convId]);
  if (!rows.length) throw new ApiError(404, 'not_found');
  const c = rows[0];
  if (c.buyer_id !== userId && c.seller_id !== userId) throw new ApiError(403, 'forbidden');
  return c;
}

// ---- GET /api/conversations  (inbox) ----
router.get('/', ah(async (req, res) => {
  const me = req.user.id;
  const { rows } = await query(
    `select c.id, c.listing_id, c.created_at,
            other.id as other_id, other.first_name as other_name, other.avatar_emoji as other_emoji,
            l.title as listing_title,
            (c.seller_id = $1) as i_am_seller,
            lp.url as listing_photo,
            m.body as last_body, m.created_at as last_at,
            (select count(*) from messages mm
              where mm.conversation_id=c.id and mm.sender_id<>$1 and mm.read_at is null)::int as unread
     from conversations c
     join users other
       on other.id = case when c.buyer_id=$1 then c.seller_id else c.buyer_id end
     left join listings l on l.id = c.listing_id
     left join lateral (
       select url from listing_photos where listing_id=c.listing_id order by position limit 1
     ) lp on true
     left join lateral (
       select body, created_at from messages where conversation_id=c.id
       order by created_at desc limit 1
     ) m on true
     where c.buyer_id=$1 or c.seller_id=$1
     order by coalesce(m.created_at, c.created_at) desc`,
    [me]
  );
  res.json({ conversations: rows.map(r => ({
    id: r.id,
    listingId: r.listing_id,
    listingTitle: r.listing_title,
    listingPhoto: r.listing_photo,
    role: r.i_am_seller ? 'selling' : 'buying',
    other: { id: r.other_id, firstName: r.other_name, avatarEmoji: r.other_emoji },
    lastMessage: r.last_body,
    lastAt: r.last_at,
    unread: r.unread,
  })) });
}));

// ---- GET /api/conversations/:id/messages ----
router.get('/:id/messages', ah(async (req, res) => {
  await loadConversation(req.params.id, req.user.id);
  const { rows } = await query(
    `select id, sender_id, body, created_at, read_at
     from messages where conversation_id=$1 order by created_at asc limit 200`,
    [req.params.id]
  );
  // Mark the other side's messages as read.
  await query(
    `update messages set read_at=now()
     where conversation_id=$1 and sender_id<>$2 and read_at is null`,
    [req.params.id, req.user.id]
  );
  res.json({ messages: rows.map(m => ({
    id: m.id,
    mine: m.sender_id === req.user.id,
    body: m.body,
    createdAt: m.created_at,
  })) });
}));

// ---- POST /api/conversations/:id/messages ----
router.post('/:id/messages', writeLimiter, validate(messageSchema), ah(async (req, res) => {
  const conv = await loadConversation(req.params.id, req.user.id);
  const { rows } = await query(
    `insert into messages (conversation_id, sender_id, body)
     values ($1,$2,$3) returning id, created_at`,
    [conv.id, req.user.id, req.body.body]
  );
  const message = {
    id: rows[0].id,
    conversationId: conv.id,
    senderId: req.user.id,
    body: req.body.body,
    createdAt: rows[0].created_at,
  };
  // Push to the other participant in real time if they're connected.
  const recipient = conv.buyer_id === req.user.id ? conv.seller_id : conv.buyer_id;
  notifyMessage(recipient, message);

  res.status(201).json({ message: { id: message.id, mine: true, body: message.body, createdAt: message.createdAt } });
}));

export default router;
