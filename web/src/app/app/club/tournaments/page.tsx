import Link from 'next/link';
import { requireProfile } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';

export default async function ClubTournaments() {
  const profile = await requireProfile();
  if (!profile.club_id) return <div className="card p-6">לא משויך עדיין למגרש. <Link href="/app/club/setup" className="text-brand-700 font-semibold">השלם פרטים</Link>.</div>;
  const db = adminClient();
  const { data } = await db
    .from('tournaments')
    .select('id, slug, title, date, status, format')
    .eq('club_id', profile.club_id)
    .order('created_at', { ascending: false });
  const list = (data || []) as any[];
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">טורנירים במגרש</h1>
      {list.length === 0 ? (
        <div className="card p-10 text-center text-slate-500">אין טורנירים משויכים למגרש.</div>
      ) : (
        <div className="card divide-y divide-slate-100">
          {list.map((t) => (
            <Link href={`/tournaments/${t.slug}`} key={t.id} className="p-4 hover:bg-slate-50 block">
              <div className="font-semibold">{t.title}</div>
              <div className="text-xs text-slate-500">
                {t.date || 'ללא תאריך'} · {t.status} · קיבולת {t.format?.capacity || '—'}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
