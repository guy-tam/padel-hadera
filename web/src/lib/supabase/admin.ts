import { createClient as createSb, type SupabaseClient } from '@supabase/supabase-js';

// Supabase client עם service_role — עוקף RLS.
// generic רופף כדי לאפשר inserts ללא Database schema types
let cached: SupabaseClient<any, any, any> | null = null;

export function adminClient(): SupabaseClient<any, any, any> {
  if (cached) return cached;
  cached = createSb<any, any, any>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  return cached;
}
