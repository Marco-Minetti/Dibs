import http from 'node:http';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config.js';
import { errorHandler } from './middleware/error.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { initRealtime } from './realtime.js';

import authRoutes from './routes/auth.js';
import schoolRoutes from './routes/schools.js';
import listingRoutes from './routes/listings.js';
import favoriteRoutes from './routes/favorites.js';
import chatRoutes from './routes/chats.js';
import uploadRoutes from './routes/uploads.js';
import safetyRoutes from './routes/safety.js';

const app = express();
app.set('trust proxy', 1); // correct client IPs behind a load balancer

// --- security headers ---
app.use(helmet());

// --- CORS allowlist ---
app.use(cors({
  origin(origin, cb) {
    // allow same-origin / native (no Origin header) and listed web origins
    if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
    cb(new Error('not_allowed_by_cors'));
  },
  credentials: true,
}));

// --- body parsing (small limit; images go straight to S3, not through here) ---
app.use(express.json({ limit: '64kb' }));

// --- lightweight request log ---
app.use((req, _res, next) => {
  if (config.env !== 'test') {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  }
  next();
});

// --- health check (for load balancers / uptime monitors) ---
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// --- routes ---
app.use('/api/auth', authRoutes);
app.use('/api', authRoutes);              // exposes /api/me
app.use('/api/schools', schoolRoutes);
app.use('/api/listings', apiLimiter, listingRoutes);
app.use('/api/favorites', apiLimiter, favoriteRoutes);
app.use('/api/conversations', apiLimiter, chatRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/safety', safetyRoutes);

// --- 404 + error handler ---
app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
app.use(errorHandler);

// --- start (http server so WebSocket can share the port) ---
const server = http.createServer(app);
initRealtime(server);

server.listen(config.port, () => {
  console.log(`\n  dibs api ✶  listening on :${config.port}  (${config.env})`);
  if (!config.isProd) console.log('  health → http://localhost:' + config.port + '/health\n');
});

export { app, server };
