import { createClient } from '@supabase/supabase-js';
import type { RuntimeConfig } from '../config/env.js';

export function createSupabaseClient(config: RuntimeConfig) {
  return createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type DatabaseClient = ReturnType<typeof createSupabaseClient>;
