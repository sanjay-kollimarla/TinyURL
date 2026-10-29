import { z } from "zod";

export const createLinkSchema = z.object({
  url: z.string().min(1),
  alias: z.string().optional(),
  ttlSeconds: z.number().int().positive().optional(),
  expiresAt: z.coerce.date().optional(),
});

export const statsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});
