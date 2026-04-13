import Link from 'next/link';
import { requireProfile } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';

export default async function ClubCalendar() {
  const profile = await requireProfile();
  if (!profile.club_id) return <div className="card p-6">לא משויך עדיין למגרש. <Link href="/app/club/setup" className="text-brand-700 font-semibold">השלם פרטים</Link>.</div>;
  const db = adminClient();
  const { data } = await db
    .from('tournaments')
    .select('id, title, date, format, status')
    .eq('club_id', profile.club_id)
    .not('date', 'is', null)
    .order('date', { ascending: true });

  const items = (data || []) as any[];
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">יומן וזמינות</h1>
      {items.length === 0 ? (
        <div className="card p-10 text-center text-slate-500">לא מצאנו תאריכי טורנירים.</div>
      ) : (
        <div className="card divide-y divide-slate-100">
          {items.map((t) => (
            <div key={t.id} className="p-4 flex items-center justify-between">
              <div>
                <div className="font-medium">{t.title}</div>
                <div className="text-xs text-slate-500">
                  {t.date} · קיבולת {t.format?.capacity || '—'}
                </div>
              </div>
              <span className="text-xs text-slate-600">{t.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
