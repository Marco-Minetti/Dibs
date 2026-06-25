import { verifyAccess } from '../services/tokens.js';
import { ApiError } from './error.js';

// Requires a valid access token. Attaches { id, schoolId, role } to req.user.
export function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new ApiError(401, 'missing_token', 'Authorization header required');

  const payload = verifyAccess(token); // throws -> handled by errorHandler
  req.user = { id: payload.sub, schoolId: payload.sid, role: payload.role };
  next();
}

// Gate admin-only routes (moderation dashboard, etc).
export function requireAdmin(req, _res, next) {
  if (req.user?.role !== 'admin') throw new ApiError(403, 'forbidden');
  next();
}
