import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Supabase client לשימוש ב-Server Components / Actions / Route Handlers
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // קריאה מ-Server Component — בלתי ניתן לעדכן cookies; זה תקין
          }
        }
      }
    }
  );
}
