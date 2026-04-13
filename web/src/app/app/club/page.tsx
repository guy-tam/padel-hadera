import Link from 'next/link';
import StatCard from '@/components/StatCard';
import { requireProfile } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';

// דשבורד מגרש — טורנירים מתארחים, משתתפים, יוזמים פעילים
export default async function ClubDashboard() {
  const profile = await requireProfile();

  if (!profile.club_id) {
    return (
      <div className="space-y-5">
        <h1 className="text-2xl font-bold">ברוך הבא לדשבורד המגרש 🏟️</h1>
        <div className="card p-8 bg-amber-50 border-amber-200">
          <h2 className="font-bold mb-2">השלמת הרשמת מגרש</h2>
          <p className="text-sm text-slate-700 mb-4">
            החשבון שלך עדיין לא משויך למגרש. צור מגרש חדש או חבר לחשבון קיים.
          </p>
          <Link href="/app/club/setup" className="btn-primary">השלמת פרטי מגרש</Link>
        </div>
      </div>
    );
  }

  const db = adminClient();
  const { data: club } = await db.from('clubs').select('*').eq('id', profile.club_id).single();
  const { data: tournaments } = await db
    .from('tournaments')
    .select('id, slug, title, date, status, format, organizer_id')
    .eq('club_id', profile.club_id)
    .order('created_at', { ascending: false });

  const hosted = (tournaments || []) as any[];
  const now = Date.now();
  const upcoming = hosted.filter((t) => {
    if (!t.date) return true;
    const d = Date.parse(t.date);
    return isNaN(d) || d >= now;
  });
  const past = hosted.filter((t) => {
    if (!t.date) return false;
    const d = Date.parse(t.date);
    return !isNaN(d) && d < now;
  });
  const organizerIds = Array.from(new Set(hosted.map((t) => t.organizer_id).filter(Boolean)));

  const ids = hosted.map((t) => t.id);
  const { data: regs } = ids.length
    ? await db.from('registrations').select('id, tournament_id').in('tournament_id', ids)
    : { data: [] as any[] };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-1">🏟️ {(club as any)?.name || 'המגרש שלי'}</h1>
        <p className="text-slate-600 text-sm">תמונת מצב של הפעילות במגרש</p>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        <StatCard label="טורנירים מתוכננים" value={upcoming.length} accent="brand" />
        <StatCard label="טורנירים שהתארחו" value={past.length} accent="blue" />
        <StatCard label="סה״כ משתתפים" value={(regs || []).length} accent="amber" />
        <StatCard label="יוזמים פעילים" value={organizerIds.length} accent="rose" />
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">טורנירים קרובים אצלך</h2>
          <Link href="/app/club/tournaments" className="text-sm text-brand-700 font-semibold">הכל ←</Link>
        </div>
        {upcoming.length === 0 ? (
          <div className="text-center py-10 text-slate-500">אין כרגע טורנירים מתוכננים.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {upcoming.slice(0, 6).map((t) => {
              const n = (regs || []).filter((r: any) => r.tournament_id === t.id).length;
              const cap = t.format?.capacity || t.format?.max_teams || '—';
              return (
                <div key={t.id} className="flex items-center justify-between py-3">
                  <div>
                    <div className="font-semibold">{t.title}</div>
                    <div className="text-xs text-slate-500">
                      {t.date || 'ללא תאריך'} · משתתפים {n}/{cap}
                    </div>
                  </div>
                  <span className="text-xs bg-brand-50 text-brand-700 px-2 py-1 rounded-md font-medium">{t.status}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
