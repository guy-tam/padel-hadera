'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'crypto';
import { requireProfile } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';

// קישור או יצירה של organizer לפרופיל
export async function setupOrganizerAction(formData: FormData) {
  const profile = await requireProfile();
  const db = adminClient();
  const linkTo = String(formData.get('link_to') || '').trim();

  let organizerId = '';
  if (linkTo) {
    organizerId = linkTo;
  } else {
    const name = String(formData.get('name') || '').trim();
    const contact_person = String(formData.get('contact_person') || '').trim();
    const phone = String(formData.get('phone') || '').trim();
    if (!name) redirect('/app/organizer/setup?error=' + encodeURIComponent('שם ארגון הכרחי'));

    organizerId = randomUUID();
    const { error } = await db.from('organizers').insert({
      id: organizerId,
      slug: name.toLowerCase().replace(/\s+/g, '-').slice(0, 60) + '-' + organizerId.slice(0, 6),
      name,
      contact_person: contact_person || null,
      email: profile.email,
      phone: phone || null,
      status: 'active'
    });
    if (error) redirect('/app/organizer/setup?error=' + encodeURIComponent(error.message));
  }

  await db.from('profiles').update({ organizer_id: organizerId, role: 'organizer' }).eq('id', profile.id);

  revalidatePath('/app/organizer');
  redirect('/app/organizer');
}
