import Link from 'next/link';
import { requireProfile } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { setTournamentStatusAction } from './actions';

export default async function OrganizerTournaments() {
  const profile = await requireProfile();
  if (!profile.organizer_id) {
    return <div className="card p-8">השלמת פרטי ארגון נדרשת — <Link href="/app/organizer" className="text-brand-700 font-semibold">הסקירה</Link>.</div>;
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
            <div key={t.id} className="p-4 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <Link href={`/tournaments/${t.slug}`} className="font-semibold hover:text-brand-700">
                  {t.title}
                </Link>
                <div className="text-xs text-slate-500">
                  {t.date || 'ללא תאריך'} · קיבולת {t.format?.capacity || t.format?.max_teams || '—'} · <b>{t.status}</b>
                </div>
              </div>
              <div className="flex gap-1 flex-wrap">
                {t.status !== 'published' && <ActionBtn id={t.id} status="published" label="פרסם" cls="bg-brand-600 text-white" />}
                {t.status !== 'draft' && <ActionBtn id={t.id} status="draft" label="טיוטה" cls="bg-slate-200 text-slate-700" />}
                {t.status !== 'closed' && <ActionBtn id={t.id} status="closed" label="סגור" cls="bg-amber-100 text-amber-800" />}
                {t.status !== 'cancelled' && <ActionBtn id={t.id} status="cancelled" label="בטל" cls="bg-rose-50 text-rose-700 border border-rose-200" />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActionBtn({ id, status, label, cls }: { id: string; status: string; label: string; cls: string }) {
  return (
    <form action={setTournamentStatusAction}>
      <input type="hidden" name="tournament_id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button className={`text-xs px-2 py-1 rounded-md font-medium ${cls}`}>{label}</button>
    </form>
  );
}
