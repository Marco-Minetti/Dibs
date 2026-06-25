import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

// --- one-time login codes -------------------------------------------------
// Cryptographically strong numeric code.
export function genNumericCode(len = config.codeLength) {
  let s = '';
  while (s.length < len) s += crypto.randomInt(0, 10);
  return s;
}

// HMAC-SHA256 with a server-side pepper. If the DB leaks, codes still can't be
// reversed or brute-forced offline without the pepper.
export function hmacCode(code) {
  return crypto.createHmac('sha256', config.codePepper).update(code).digest('hex');
}

// Constant-time compare of two hex digests.
export function safeEqualHex(a, b) {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// --- access tokens (JWT) --------------------------------------------------
export function signAccess(user) {
  return jwt.sign(
    { sub: user.id, sid: user.school_id, role: user.role },
    config.jwtSecret,
    { expiresIn: config.accessTtl }
  );
}

export function verifyAccess(token) {
  return jwt.verify(token, config.jwtSecret);
}

// --- refresh tokens (opaque, rotating) ------------------------------------
export function genRefreshToken() {
  const raw = crypto.randomBytes(32).toString('base64url');
  return { raw, hash: hashRefresh(raw) };
}

export function hashRefresh(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}
