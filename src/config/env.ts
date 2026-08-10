import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash-lite'),
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  TELEGRAM_CHAT_ID: z.string().min(1).optional(),
  HEADLESS: z
    .string()
    .default('true')
    .transform((value) => value !== 'false'),
  MAX_LISTINGS_PER_SOURCE: z.coerce.number().int().positive().default(100),
  MAX_SEARCH_PAGES: z.coerce.number().int().positive().max(50).default(10),
  DETAIL_CONCURRENCY: z.coerce.number().int().positive().max(5).default(3),
  AI_SCORE_THRESHOLD: z.coerce.number().int().min(0).max(100).default(55),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type RuntimeConfig = z.infer<typeof envSchema>;

export function getRuntimeConfig(): RuntimeConfig {
  return envSchema.parse(process.env);
}
