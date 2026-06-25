import 'dotenv/config';

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';

function required(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined && isProd) {
    throw new Error(`Missing required env var in production: ${name}`);
  }
  return v;
}

export const config = {
  env,
  isProd,
  port: parseInt(process.env.PORT || '4000', 10),

  // Database
  databaseUrl: required('DATABASE_URL', 'postgres://localhost:5432/dibs'),
  pgSsl: process.env.PG_SSL === 'true',

  // Secrets — generate with: openssl rand -base64 48
  jwtSecret:  required('JWT_SECRET', 'dev-insecure-jwt-secret-change-me'),
  codePepper: required('CODE_PEPPER', 'dev-insecure-pepper-change-me'),

  // Token lifetimes
  accessTtl:  process.env.ACCESS_TTL  || '15m',
  refreshTtlDays: parseInt(process.env.REFRESH_TTL_DAYS || '30', 10),

  // Login codes
  codeLength: 6,
  codeTtlMinutes: 10,
  maxCodeAttempts: 5,
  maxCodesPerWindow: 3,        // per email per 15 min

  // CORS — comma-separated list of allowed origins
  corsOrigins: (process.env.CORS_ORIGINS ||
    'http://localhost:5173,http://localhost:3000,capacitor://localhost,http://localhost')
    .split(',').map(s => s.trim()).filter(Boolean),

  // Email (Resend by default; dev logs to console)
  resendApiKey: process.env.RESEND_API_KEY || '',
  emailFrom: process.env.EMAIL_FROM || 'dibs <login@dibs.app>',

  // Object storage (S3 / Cloudflare R2 / any S3-compatible)
  s3Region:   process.env.S3_REGION   || 'us-east-1',
  s3Bucket:   process.env.S3_BUCKET   || 'dibs-uploads',
  s3Endpoint: process.env.S3_ENDPOINT || '',     // set for R2/MinIO
  s3Key:      process.env.S3_ACCESS_KEY_ID || '',
  s3Secret:   process.env.S3_SECRET_ACCESS_KEY || '',
  cdnBase:    process.env.CDN_BASE_URL || '',     // e.g. https://cdn.dibs.app

  // Restrict signups to .edu (set false only for testing)
  requireEdu: process.env.REQUIRE_EDU !== 'false',
};
