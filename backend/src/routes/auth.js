import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { config } from '../config.js';
import { ah, ApiError } from '../middleware/error.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';
import {
  requestCodeSchema, verifyCodeSchema, refreshSchema,
} from '../lib/validation.js';
import {
  genNumericCode, hmacCode, safeEqualHex,
  signAccess, genRefreshToken, hashRefresh,
} from '../services/tokens.js';
import { sendLoginCode } from '../services/email.js';

const router = Router();
const EMOJIS = ['🦊','🐸','🦉','🐱','🐻','🦄','🐨','🐺','🦋','🐢','🐰','🦎','🦁','🐹','🐯','🦦'];
const pickEmoji = () => EMOJIS[Math.floor(Math.random() * EMOJIS.length)];

function domainOf(email) {
  return email.split('@')[1] || '';
}

// ---- helper: issue access + refresh for a user ----
async function issueSession(user, userAgent) {
  const accessToken = signAccess(user);
  const { raw, hash } = genRefreshToken();
  const expires = new Date(Date.now() + config.refreshTtlDays * 86_400_000);
  await query(
    `insert into refresh_tokens (user_id, token_hash, user_agent, expires_at)
     values ($1,$2,$3,$4)`,
    [user.id, hash, (userAgent || '').slice(0, 200), expires]
  );
  return { accessToken, refreshToken: raw };
}

function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    firstName: u.first_name,
    avatarEmoji: u.avatar_emoji,
    schoolId: u.school_id,
    rating: Number(u.rating),
    role: u.role,
    verified: !!u.verified_at,
  };
}

// ============================================================
//  POST /api/auth/request-code
// ============================================================
router.post('/request-code', authLimiter, validate(requestCodeSchema), ah(async (req, res) => {
  const { email, schoolId, firstName } = req.body;
  const domain = domainOf(email);

  if (config.requireEdu && !domain.endsWith('.edu')) {
    throw new ApiError(400, 'not_edu', 'Please use your school .edu email address');
  }

  // If a school was chosen and it declares domains, the email must match one.
  if (schoolId) {
    const { rows } = await query('select email_domains from schools where id=$1', [schoolId]);
    if (!rows.length) throw new ApiError(400, 'unknown_school');
    const domains = rows[0].email_domains || [];
    if (domains.length && !domains.some(d => domain === d || domain.endsWith('.' + d))) {
      throw new ApiError(400, 'email_school_mismatch',
        'That email does not match the school you selected');
    }
  }

  // Throttle: max N codes per email per 15 min (on top of IP rate limit).
  const recent = await query(
    `select count(*)::int as n from login_codes
     where email=$1 and created_at > now() - interval '15 minutes'`,
    [email]
  );
  if (recent.rows[0].n >= config.maxCodesPerWindow) {
    throw new ApiError(429, 'too_many_codes', 'Too many codes requested. Try again soon.');
  }

  const code = genNumericCode();
  const expires = new Date(Date.now() + config.codeTtlMinutes * 60_000);
  await query(
    `insert into login_codes (email, code_hmac, first_name, school_id, expires_at)
     values ($1,$2,$3,$4,$5)`,
    [email, hmacCode(code), firstName || null, schoolId || null, expires]
  );

  await sendLoginCode(email, code);
  res.json({ ok: true, expiresInSeconds: config.codeTtlMinutes * 60 });
}));

// ============================================================
//  POST /api/auth/verify-code
// ============================================================
router.post('/verify-code', authLimiter, validate(verifyCodeSchema), ah(async (req, res) => {
  const { email, code } = req.body;

  const result = await withTransaction(async (client) => {
    // Latest unconsumed, unexpired code for this email, locked for update.
    const { rows } = await client.query(
      `select * from login_codes
       where email=$1 and consumed_at is null and expires_at > now()
       order by created_at desc limit 1 for update`,
      [email]
    );
    if (!rows.length) throw new ApiError(400, 'code_invalid', 'No active code — request a new one');
    const row = rows[0];

    if (row.attempts >= config.maxCodeAttempts) {
      await client.query('update login_codes set consumed_at=now() where id=$1', [row.id]);
      throw new ApiError(429, 'too_many_attempts', 'Too many tries — request a new code');
    }

    const ok = safeEqualHex(row.code_hmac, hmacCode(code));
    if (!ok) {
      await client.query('update login_codes set attempts=attempts+1 where id=$1', [row.id]);
      throw new ApiError(400, 'code_invalid', 'That code is not correct');
    }

    await client.query('update login_codes set consumed_at=now() where id=$1', [row.id]);

    // Upsert the user. New users are created verified (the code proved ownership).
    const domain = domainOf(email);
    const upsert = await client.query(
      `insert into users (email, email_domain, school_id, first_name, avatar_emoji, verified_at)
       values ($1,$2,$3,$4,$5, now())
       on conflict (email) do update
         set verified_at = coalesce(users.verified_at, now()),
             school_id   = coalesce(users.school_id, excluded.school_id)
       returning *`,
      [email, domain, row.school_id, row.first_name || 'Student', pickEmoji()]
    );
    const user = upsert.rows[0];
    if (user.banned_at) throw new ApiError(403, 'account_suspended');
    return user;
  });

  const session = await issueSession(result, req.headers['user-agent']);
  res.json({ ...session, user: publicUser(result) });
}));

// ============================================================
//  POST /api/auth/refresh  (rotates the refresh token)
// ============================================================
router.post('/refresh', validate(refreshSchema), ah(async (req, res) => {
  const { refreshToken } = req.body;
  const hash = hashRefresh(refreshToken);

  const out = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `select rt.*, u.id as uid, u.school_id, u.role, u.banned_at
       from refresh_tokens rt join users u on u.id = rt.user_id
       where rt.token_hash=$1 for update`,
      [hash]
    );
    const t = rows[0];
    if (!t || t.revoked_at || new Date(t.expires_at) < new Date()) {
      throw new ApiError(401, 'invalid_refresh');
    }
    if (t.banned_at) throw new ApiError(403, 'account_suspended');

    // Rotate: revoke the old token, mint a new one.
    await client.query('update refresh_tokens set revoked_at=now() where id=$1', [t.id]);
    const { raw, hash: newHash } = genRefreshToken();
    const expires = new Date(Date.now() + config.refreshTtlDays * 86_400_000);
    await client.query(
      `insert into refresh_tokens (user_id, token_hash, user_agent, expires_at)
       values ($1,$2,$3,$4)`,
      [t.user_id, newHash, t.user_agent, expires]
    );
    const accessToken = signAccess({ id: t.uid, school_id: t.school_id, role: t.role });
    return { accessToken, refreshToken: raw };
  });

  res.json(out);
}));

// ============================================================
//  POST /api/auth/logout
// ============================================================
router.post('/logout', validate(refreshSchema), ah(async (req, res) => {
  await query('update refresh_tokens set revoked_at=now() where token_hash=$1',
    [hashRefresh(req.body.refreshToken)]);
  res.json({ ok: true });
}));

// ============================================================
//  GET /api/me
// ============================================================
router.get('/me', requireAuth, ah(async (req, res) => {
  const { rows } = await query('select * from users where id=$1', [req.user.id]);
  if (!rows.length) throw new ApiError(404, 'not_found');
  res.json({ user: publicUser(rows[0]) });
}));

export default router;
