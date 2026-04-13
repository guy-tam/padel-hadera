import Link from 'next/link';
import { requireProfile } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { setupClubAction } from './actions';

export default async function ClubSetupPage({
  searchParams
}: { searchParams: Promise<{ error?: string }> }) {
  const profile = await requireProfile();
  if (profile.club_id) {
    return (
      <div className="card p-8">
        החשבון כבר משויך למגרש.{' '}
        <Link href="/app/club" className="text-brand-700 font-semibold">חזרה לדשבורד</Link>
      </div>
    );
  }
  const params = await searchParams;
  const db = adminClient();
  const { data: existing } = profile.email
    ? await db.from('clubs').select('id, name, city').eq('contact_email', profile.email).maybeSingle()
    : { data: null as any };

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">השלמת פרטי מגרש</h1>
      {params.error && <div className="card p-3 bg-rose-50 text-rose-700 text-sm">{params.error}</div>}

      {existing && (
        <div className="card p-6 space-y-3">
          <h2 className="font-bold">🏟️ מצאנו מגרש לפי האימייל שלך</h2>
          <p className="text-sm">
            <b>{existing.name}</b>{existing.city ? ` · ${existing.city}` : ''}
          </p>
          <form action={setupClubAction}>
            <input type="hidden" name="link_to" value={existing.id} />
            <button className="btn-primary">קשר את החשבון שלי</button>
          </form>
        </div>
      )}

      <div className="card p-6">
        <h2 className="font-bold mb-3">יצירת מגרש חדש</h2>
        <form action={setupClubAction} className="space-y-3">
          <Field label="שם המגרש" name="name" required />
          <Field label="עיר" name="city" />
          <Field label="טלפון" name="contact_phone" type="tel" defaultValue={profile.phone || ''} />
          <label className="block">
            <span className="text-sm font-medium text-slate-700 block mb-1">תיאור קצר</span>
            <textarea name="short_description" rows={2} className="w-full rounded-lg border border-slate-300 px-3 py-2.5" />
          </label>
          <button className="btn-primary">יצירת מגרש</button>
        </form>
      </div>
    </div>
  );
}

function Field({ label, name, type = 'text', required, defaultValue }: any) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700 block mb-1">{label}{required && ' *'}</span>
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        className="w-full rounded-lg border border-slate-300 px-3 py-2.5"
      />
    </label>
  );
}
