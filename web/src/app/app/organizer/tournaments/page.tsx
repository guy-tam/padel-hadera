import Link from 'next/link';
import { requireProfile } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';

export default async function OrganizerTournaments() {
  const profile = await requireProfile();
  if (!profile.organizer_id) {
    return <div className="card p-8">השלמת פרטי ארגון נדרשת — פנה לעמוד <Link href="/app/organizer" className="text-brand-700 font-semibold">הסקירה</Link>.</div>;
  }
  const db = adminClient();
  const { data } = await db
    .from('tournaments')
    .select('id, slug, title, date, status, format')
    .eq('organizer_id', profile.organizer_id)
    .order('created_at', { ascending: false });

  const list = (data || []) as any[];
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">כל הטורנירים שלי</h1>
        <Link href="/app/organizer/tournaments/new" className="btn-primary">➕ חדש</Link>
      </div>
      {list.length === 0 ? (
        <div className="card p-10 text-center text-slate-500">אין טורנירים עדיין.</div>
      ) : (
        <div className="card divide-y divide-slate-100">
          {list.map((t) => (
            <Link href={`/tournaments/${t.slug}`} key={t.id} className="flex items-center justify-between p-4 hover:bg-slate-50">
              <div>
                <div className="font-semibold">{t.title}</div>
                <div className="text-xs text-slate-500">
                  {t.date || 'ללא תאריך'} · קיבולת {t.format?.capacity || t.format?.max_teams || '—'}
                </div>
              </div>
              <span className="text-xs text-brand-700 font-semibold">{t.status}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
