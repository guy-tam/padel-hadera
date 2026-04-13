'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'crypto';
import { requireProfile } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';

export async function setupClubAction(formData: FormData) {
  const profile = await requireProfile();
  const db = adminClient();
  const linkTo = String(formData.get('link_to') || '').trim();

  let clubId = '';
  if (linkTo) {
    clubId = linkTo;
  } else {
    const name = String(formData.get('name') || '').trim();
    if (!name) redirect('/app/club/setup?error=' + encodeURIComponent('שם מגרש הכרחי'));

    const city = String(formData.get('city') || '').trim();
    const phone = String(formData.get('contact_phone') || '').trim();
    const short = String(formData.get('short_description') || '').trim();

    clubId = randomUUID();
    const slug = name.toLowerCase().replace(/\s+/g, '-').slice(0, 60) + '-' + clubId.slice(0, 6);
    const { error } = await db.from('clubs').insert({
      id: clubId,
      slug,
      name,
      city: city || null,
      short_description: short || null,
      contact_email: profile.email,
      contact_phone: phone || null,
      status: 'active'
    });
    if (error) redirect('/app/club/setup?error=' + encodeURIComponent(error.message));
  }

  await db.from('profiles').update({ club_id: clubId, role: 'club' }).eq('id', profile.id);
  revalidatePath('/app/club');
  redirect('/app/club');
}
