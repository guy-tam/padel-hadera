'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'crypto';
import { requireProfile } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';

// העלאת הוכחת תשלום לרישום קיים של השחקן
export async function uploadPaymentProofAction(formData: FormData) {
  const profile = await requireProfile();
  const regId = String(formData.get('registration_id') || '');
  const file = formData.get('file') as File | null;
  if (!regId || !file || file.size === 0) redirect(`/app/player/tournaments/${regId}?error=file-missing`);
  if (file.size > 10 * 1024 * 1024) redirect(`/app/player/tournaments/${regId}?error=file-too-big`);

  const db = adminClient();
  const { data: reg } = await db.from('registrations').select('id, email').eq('id', regId).single();
  const r = reg as any;
  if (!r) redirect('/app/player');
  if (r.email !== profile.email) redirect('/app/player');

  const ext = file.name.split('.').pop() || 'bin';
  const path = `payment/${regId}/${randomUUID()}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: upErr } = await db.storage.from('uploads').upload(path, bytes, {
    contentType: file.type || 'application/octet-stream',
    upsert: false
  });
  if (upErr) redirect(`/app/player/tournaments/${regId}?error=${encodeURIComponent(upErr.message)}`);

  const payment_proof = { bucket: 'uploads', path, original_name: file.name, size: file.size, uploaded_at: new Date().toISOString() };
  await db.from('registrations').update({ payment_proof }).eq('id', regId);
  await db.from('uploads').insert({
    id: randomUUID(),
    registration_id: regId,
    kind: 'payment',
    bucket: 'uploads',
    path,
    original_name: file.name,
    size_bytes: file.size,
    mime_type: file.type || null
  });

  revalidatePath('/app/player');
  revalidatePath(`/app/player/tournaments/${regId}`);
  redirect(`/app/player/tournaments/${regId}?uploaded=1`);
}
