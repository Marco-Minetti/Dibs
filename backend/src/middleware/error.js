// Throw this anywhere in a handler to return a clean JSON error.
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

// Wrap async route handlers so thrown/rejected errors reach the error handler.
export const ah = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Central error handler (must be registered last).
export function errorHandler(err, req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  if (err?.name === 'ZodError') {
    return res.status(400).json({ error: 'validation_failed', issues: err.issues });
  }
  if (err?.name === 'TokenExpiredError' || err?.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'invalid_token' });
  }
  // Unique-violation from Postgres
  if (err?.code === '23505') {
    return res.status(409).json({ error: 'already_exists' });
  }
  console.error('[error]', err);
  return res.status(500).json({ error: 'server_error' });
}
