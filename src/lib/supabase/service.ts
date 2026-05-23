import 'server-only'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * Supabase client dengan service role key.
 * HANYA dipakai di server-side untuk operasi yang tidak butuh sesi user
 * (misalnya: cron job auto-sync).
 *
 * Service role key membypass RLS — jangan expose ke client!
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL tidak dikonfigurasi.')
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY tidak dikonfigurasi.')

  return createSupabaseClient<Database>(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
