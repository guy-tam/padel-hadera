'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'crypto';
import { requireProfile } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';

function toSlug(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^\w\u0590-\u05ff\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

// יצירת טורניר חדש — כפוף לתפקיד organizer
export async function createTournamentAction(formData: FormData) {
  const profile = await requireProfile();
  if (profile.role !== 'organizer' && profile.role !== 'admin') {
    redirect('/app');
  }
  if (!profile.organizer_id) {
    redirect('/app/organizer/setup');
  }

  const title = String(formData.get('title') || '').trim();
  const subtitle = String(formData.get('subtitle') || '').trim();
  const description = String(formData.get('description') || '').trim();
  const date = String(formData.get('date') || '').trim();
  const location = String(formData.get('location') || '').trim();
  const club_id = String(formData.get('club_id') || '').trim() || null;
  const capacity = Number(formData.get('capacity')) || 0;
  const price = Number(formData.get('price')) || 0;
  const publish = formData.get('publish') === 'on';

  if (!title) {
    redirect(`/app/organizer/tournaments/new?error=${encodeURIComponent('כותרת הכרחית')}`);
  }

  const db = adminClient();
  const id = randomUUID();
  // slug ייחודי
  let slug = toSlug(title) || id.slice(0, 8);
  const { data: dup } = await db.from('tournaments').select('id').eq('slug', slug).maybeSingle();
  if (dup) slug = `${slug}-${id.slice(0, 6)}`;

  const { error } = await db.from('tournaments').insert({
    id,
    slug,
    title,
    subtitle: subtitle || null,
    description: description || null,
    date: date || null,
    location: location || null,
    club_id,
    organizer_id: profile.organizer_id,
    format: capacity ? { capacity } : {},
    pricing: price ? { price_per_pair: price } : {},
    status: publish ? 'published' : 'draft',
    visibility: 'public'
  });

  if (error) {
    redirect(`/app/organizer/tournaments/new?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath('/app/organizer');
  revalidatePath('/tournaments');
  redirect(`/app/organizer/tournaments`);
}
