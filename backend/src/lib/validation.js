import { z } from 'zod';

export const CATEGORIES = ['furniture','appliances','tech','books','kitchen','decor','rides','other'];
export const CONDITIONS = ['like new','good','used','loved'];
export const PICKUP_SPOTS = ['my_room','my_house','around_campus'];

export const emailSchema = z.string().trim().toLowerCase().email().max(120);

export const requestCodeSchema = z.object({
  email: emailSchema,
  schoolId: z.string().uuid().optional(),
  firstName: z.string().trim().min(1).max(24).optional(),
});

export const verifyCodeSchema = z.object({
  email: emailSchema,
  code: z.string().trim().regex(/^\d{4,8}$/),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(20),
});

export const createListingSchema = z.object({
  title: z.string().trim().min(2).max(80),
  description: z.string().trim().max(1000).default(''),
  priceCents: z.number().int().min(0).max(1_000_000).default(0),
  isFree: z.boolean().default(false),
  category: z.enum(CATEGORIES),
  condition: z.enum(CONDITIONS),
  pickupSpot: z.enum(PICKUP_SPOTS),
  photoIds: z.array(z.string().uuid()).min(2).max(3),
});

export const feedQuerySchema = z.object({
  category: z.string().optional(),
  q: z.string().trim().max(80).optional(),
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const messageSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

export const signUploadSchema = z.object({
  contentType: z.string().regex(/^image\/(jpeg|png|webp|heic)$/),
});

export const reportSchema = z.object({
  targetType: z.enum(['listing','user','message']),
  targetId: z.string().uuid(),
  reason: z.string().trim().min(2).max(60),
  detail: z.string().trim().max(500).optional(),
});
