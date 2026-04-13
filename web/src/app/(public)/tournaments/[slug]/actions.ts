'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';

// רישום לטורניר — Server Action. דורש משתמש מחובר.
export async function registerAction(formData: FormData) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    redirect('/login');
  }

  const tournamentId = String(formData.get('tournament_id') || '');
  const slug = String(formData.get('slug') || '');
  const full_name = String(formData.get('full_name') || '').trim();
  const phone = String(formData.get('phone') || '').trim();
  const email = String(formData.get('email') || '').trim() || user!.email || '';
  const level = String(formData.get('level') || '').trim();
  const partner_name = String(formData.get('partner_name') || '').trim();
  const partner_phone = String(formData.get('partner_phone') || '').trim();
  const notes = String(formData.get('notes') || '').trim();

  if (!full_name || !phone || !tournamentId) {
    redirect(`/tournaments/${slug}?error=${encodeURIComponent('שם וטלפון הכרחיים')}`);
  }

  const db = adminClient();

  // מניעת כפילות על אותו טורניר לאותו email
  const { data: existing } = await db
    .from('registrations')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('email', email)
    .maybeSingle();

  if (existing) {
    redirect(`/tournaments/${slug}?registered=1`);
  }

  const id = randomUUID();
  const { error } = await db.from('registrations').insert({
    id,
    tournament_id: tournamentId,
    status: 'awaiting_payment',
    full_name,
    phone,
    email,
    level: level || null,
    partner_name: partner_name || null,
    partner_phone: partner_phone || null,
    notes: notes || null
  });

  if (error) {
    redirect(`/tournaments/${slug}?error=${encodeURIComponent(error.message)}`);
  }

  // עדכון profile.player_id אם רלוונטי
  await db.from('profiles').update({ player_id: id }).eq('id', user!.id);

  revalidatePath(`/tournaments/${slug}`);
  revalidatePath('/app/player');
  redirect(`/app/player/tournaments?new=${id}`);
}
