import Link from 'next/link';
import StatCard from '@/components/StatCard';
import { requireProfile } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';

// דשבורד יוזם — טורנירים של הארגון + הרשמות אליהם
export default async function OrganizerDashboard() {
  const profile = await requireProfile();
  const db = adminClient();

  // אם הפרופיל עדיין לא מקושר ל-organizer, נציג onboarding
  if (!profile.organizer_id) {
    return (
      <div className="space-y-5">
        <h1 className="text-2xl font-bold">ברוך הבא לדשבורד היוזם 🏆</h1>
        <div className="card p-8 bg-amber-50 border-amber-200">
          <h2 className="font-bold mb-2">השלמת הרשמה</h2>
          <p className="text-sm text-slate-700 mb-4">
            החשבון שלך עדיין לא משויך לארגון מפיק. לחץ על הקישור והאדמין ישייך אותך לארגון הקיים,
            או שתיצור ארגון חדש.
          </p>
          <Link href="/app/organizer/setup" className="btn-primary">השלמת פרטי ארגון</Link>
        </div>
      </div>
    );
  }

  const { data: tournaments } = await db
    .from('tournaments')
    .select('id, slug, title, date, status, format, club_id')
    .eq('organizer_id', profile.organizer_id)
    .order('created_at', { ascending: false });

  const my = (tournaments || []) as any[];
  const ids = my.map((t) => t.id);
  const { data: regs } = ids.length
    ? await db.from('registrations').select('id, tournament_id, status').in('tournament_id', ids)
    : { data: [] as any[] };

  const registrations = (regs || []) as any[];
  const pending = registrations.filter((r) => r.status === 'awaiting_payment' || r.status === 'pending').length;
  const approved = registrations.filter((r) => r.status === 'approved' || r.status === 'confirmed' || r.status === 'paid').length;
  const published = my.filter((t) => t.status === 'published').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold mb-1">דשבורד יוזם 🏆</h1>
          <p className="text-slate-600 text-sm">כל הטורנירים שלך במקום אחד</p>
        </div>
        <Link href="/app/organizer/tournaments/new" className="btn-primary">➕ טורניר חדש</Link>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        <StatCard label="טורנירים פעילים" value={published} accent="brand" />
        <StatCard label="סה״כ הרשמות" value={registrations.length} accent="blue" />
        <StatCard label="ממתינים לתשלום" value={pending} accent="amber" />
        <StatCard label="אושרו/שולמו" value={approved} accent="rose" />
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">הטורנירים שלי</h2>
          <Link href="/app/organizer/tournaments" className="text-sm text-brand-700 font-semibold">הכל ←</Link>
        </div>
        {my.length === 0 ? (
          <div className="text-center py-10 text-slate-500">
            עוד לא יצרת טורניר.{' '}
            <Link href="/app/organizer/tournaments/new" className="text-brand-700 font-semibold">צור טורניר →</Link>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {my.slice(0, 6).map((t) => {
              const tregs = registrations.filter((r) => r.tournament_id === t.id);
              const cap = t.format?.capacity || t.format?.max_teams || '—';
              return (
                <div key={t.id} className="flex items-center justify-between py-3">
                  <div>
                    <div className="font-semibold">{t.title}</div>
                    <div className="text-xs text-slate-500">
                      {t.date || 'ללא תאריך'} · קיבולת {cap} · נרשמו {tregs.length}
                    </div>
                  </div>
                  <StatusPill status={t.status} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const m: Record<string, { label: string; cls: string }> = {
    draft: { label: 'טיוטה', cls: 'bg-slate-100 text-slate-600' },
    published: { label: 'פורסם', cls: 'bg-green-100 text-green-700' },
    closed: { label: 'סגור', cls: 'bg-amber-100 text-amber-700' },
    cancelled: { label: 'בוטל', cls: 'bg-rose-100 text-rose-700' }
  };
  const x = m[status] || { label: status, cls: 'bg-slate-100 text-slate-600' };
  return <span className={`text-xs px-2 py-1 rounded-md font-medium ${x.cls}`}>{x.label}</span>;
}
