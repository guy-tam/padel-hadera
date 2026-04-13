import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Profile } from '@/lib/supabase/types';

// Helper שמחזיר את הפרופיל — מפנה ל-/login אם לא מחובר
export async function requireProfile(): Promise<Profile> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (!profile) {
    // אם אין profile עדיין (trigger לא רץ), ננסה ליצור מינימלי
    redirect('/login?error=missing-profile');
  }
  return profile as Profile;
}
