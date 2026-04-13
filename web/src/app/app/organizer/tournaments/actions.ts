'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireProfile } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';

// שינוי סטטוס טורניר — רק היוזם שלו או admin
export async function setTournamentStatusAction(formData: FormData) {
  const profile = await requireProfile();
  if (profile.role !== 'organizer' && profile.role !== 'admin') redirect('/app');
  const tId = String(formData.get('tournament_id') || '');
  const status = String(formData.get('status') || '');
  const allowed = ['draft', 'published', 'closed', 'cancelled'];
  if (!tId || !allowed.includes(status)) redirect('/app/organizer/tournaments');

  const db = adminClient();
  const { data: t } = await db.from('tournaments').select('organizer_id, slug').eq('id', tId).single();
  const tr = t as any;
  if (!tr) redirect('/app/organizer/tournaments');
  if (profile.role !== 'admin' && tr.organizer_id !== profile.organizer_id) {
    redirect('/app/organizer/tournaments');
  }
  await db.from('tournaments').update({ status }).eq('id', tId);
  revalidatePath('/app/organizer');
  revalidatePath('/app/organizer/tournaments');
  revalidatePath('/tournaments');
  revalidatePath(`/tournaments/${tr.slug}`);
  redirect('/app/organizer/tournaments');
}
