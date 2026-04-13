'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { UserRole } from '@/lib/supabase/types';

// Server Actions לאימות — login, signup, logout
// בעת שגיאה: redirect חזרה לדף עם ?error=... כדי שטיפוס הפונקציה יתאים ל-<form action>
export async function loginAction(formData: FormData) {
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');
  const next = String(formData.get('next') || '/app');

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    redirect(`/login?error=${encodeURIComponent('פרטי התחברות שגויים')}&next=${encodeURIComponent(next)}`);
  }
  revalidatePath('/', 'layout');
  redirect(next);
}

export async function signupAction(formData: FormData) {
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');
  const full_name = String(formData.get('full_name') || '').trim();
  const phone = String(formData.get('phone') || '').trim();
  const role = String(formData.get('role') || 'player') as UserRole;

  if (!['player', 'organizer', 'club'].includes(role)) {
    redirect(`/signup?error=${encodeURIComponent('תפקיד לא חוקי')}`);
  }
  if (password.length < 8) {
    redirect(`/signup?role=${role}&error=${encodeURIComponent('הסיסמה חייבת להיות לפחות 8 תווים')}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name, phone, role } }
  });
  if (error) {
    redirect(`/signup?role=${role}&error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath('/', 'layout');
  redirect('/app');
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/');
}
