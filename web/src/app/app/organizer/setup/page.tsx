import Link from 'next/link';
import { requireProfile } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { setupOrganizerAction } from './actions';

// onboarding של יוזם — יוצר ארגון חדש או מתחבר לארגון קיים לפי אימייל
export default async function OrganizerSetupPage({
  searchParams
}: { searchParams: Promise<{ error?: string }> }) {
  const profile = await requireProfile();
  if (profile.organizer_id) {
    return (
      <div className="card p-8">
        החשבון כבר משויך לארגון.{' '}
        <Link href="/app/organizer" className="text-brand-700 font-semibold">חזרה לדשבורד</Link>
      </div>
    );
  }
  const params = await searchParams;
  const db = adminClient();
  const { data: existing } = profile.email
    ? await db.from('organizers').select('id, name').eq('email', profile.email).maybeSingle()
    : { data: null as any };

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">השלמת פרטי ארגון</h1>
      {params.error && <div className="card p-3 bg-rose-50 text-rose-700 text-sm">{params.error}</div>}

      {existing ? (
        <div className="card p-6 space-y-4">
          <h2 className="font-bold">🎯 מצאנו ארגון קיים לפי האימייל שלך</h2>
          <p className="text-sm text-slate-700">
            <b>{existing.name}</b> — האם זה שלך? לחצי/ץ להשלמת הקישור.
          </p>
          <form action={setupOrganizerAction}>
            <input type="hidden" name="link_to" value={existing.id} />
            <button className="btn-primary">כן, קשר את החשבון שלי</button>
          </form>
        </div>
      ) : null}

      <div className="card p-6 space-y-4">
        <h2 className="font-bold">יצירת ארגון חדש</h2>
        <form action={setupOrganizerAction} className="space-y-3">
          <Field label="שם הארגון" name="name" required />
          <Field label="איש קשר" name="contact_person" defaultValue={profile.full_name || ''} />
          <Field label="טלפון" name="phone" type="tel" defaultValue={profile.phone || ''} />
          <button className="btn-primary">יצירת ארגון</button>
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
