'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireProfile } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';

// אישור/דחיית/ביטול הרשמה — מבוצע על ידי יוזם, כפוף לבעלות על הטורניר
export async function setRegistrationStatusAction(formData: FormData) {
  const profile = await requireProfile();
  if (profile.role !== 'organizer' && profile.role !== 'admin') redirect('/app');
  const regId = String(formData.get('registration_id') || '');
  const newStatus = String(formData.get('status') || '');
  const allowed = ['approved', 'confirmed', 'cancelled', 'awaiting_payment'];
  if (!regId || !allowed.includes(newStatus)) redirect('/app/organizer/registrations');

  const db = adminClient();
  // ודא שההרשמה אכן שייכת לטורניר של היוזם
  const { data: reg } = await db
    .from('registrations')
    .select('id, tournament_id, tournaments(organizer_id)')
    .eq('id', regId)
    .single();
  const r = reg as any;
  if (!r) redirect('/app/organizer/registrations');
  if (profile.role !== 'admin' && r.tournaments?.organizer_id !== profile.organizer_id) {
    redirect('/app/organizer/registrations');
  }

  await db.from('registrations').update({ status: newStatus }).eq('id', regId);
  revalidatePath('/app/organizer/registrations');
  revalidatePath('/app/organizer');
  redirect('/app/organizer/registrations');
}
