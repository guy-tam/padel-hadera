import Link from 'next/link';
import StatCard from '@/components/StatCard';
import { requireProfile } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';

// דשבורד שחקן — הרשמות השחקן דרך email שזהה לפרופיל
export default async function PlayerDashboard() {
  const profile = await requireProfile();
  const db = adminClient();

  const { data: regs } = await db
    .from('registrations')
    .select('id, tournament_id, status, created_at, tournaments(slug, title, date, status)')
    .eq('email', profile.email)
    .order('created_at', { ascending: false });

  const list = (regs || []) as any[];
  const upcoming = list.filter((r) => r.status !== 'cancelled' && r.tournaments?.status === 'published');
  const past = list.filter((r) => r.tournaments?.status === 'closed' || r.status === 'past');
  const confirmed = list.filter((r) => r.status === 'confirmed' || r.status === 'approved');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-1">שלום {profile.full_name || 'שחקן'} 👋</h1>
        <p className="text-slate-600 text-sm">הפעילות האישית שלך במבט אחד</p>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        <StatCard label="הרשמות פעילות" value={upcoming.length} accent="brand" />
        <StatCard label="טורנירים שהסתיימו" value={past.length} accent="blue" />
        <StatCard label="אישורי השתתפות" value={confirmed.length} accent="amber" />
        <StatCard label="סך הרשמות" value={list.length} accent="rose" />
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">הטורנירים הקרובים שלך</h2>
          <Link href="/app/player/tournaments" className="text-sm text-brand-700 font-semibold">הכל ←</Link>
        </div>
        {upcoming.length === 0 ? (
          <div className="text-slate-500 text-sm py-6 text-center">
            עוד לא נרשמת לטורניר פעיל.{' '}
            <Link href="/tournaments" className="text-brand-700 font-semibold">גלה טורנירים →</Link>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {upcoming.slice(0, 5).map((r) => (
              <Link
                key={r.id}
                href={`/tournaments/${r.tournaments?.slug}`}
                className="flex items-center justify-between py-3 hover:bg-slate-50 px-2 rounded-lg"
              >
                <div>
                  <div className="font-medium">{r.tournaments?.title || r.tournament_id}</div>
                  <div className="text-xs text-slate-500">
                    {r.tournaments?.date || 'תאריך יפורסם'} · נרשמת ב-{new Date(r.created_at).toLocaleDateString('he-IL')}
                  </div>
                </div>
                <StatusBadge status={r.status} />
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="card p-6 bg-gradient-to-l from-brand-50 to-white">
        <h3 className="font-bold mb-1">💡 טיפ</h3>
        <p className="text-sm text-slate-700">
          גלה טורנירים חדשים ב
          <Link href="/tournaments" className="text-brand-700 font-semibold underline mx-1">עמוד הטורנירים</Link>
          ורשום בן/בת זוג בלחיצה.
        </p>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    awaiting_payment: { label: 'ממתין לתשלום', cls: 'bg-amber-100 text-amber-700' },
    pending: { label: 'ממתין', cls: 'bg-amber-100 text-amber-700' },
    approved: { label: 'אושר', cls: 'bg-green-100 text-green-700' },
    confirmed: { label: 'שולם', cls: 'bg-emerald-100 text-emerald-700' },
    paid: { label: 'שולם', cls: 'bg-emerald-100 text-emerald-700' },
    cancelled: { label: 'בוטל', cls: 'bg-slate-100 text-slate-500' },
    past: { label: 'הסתיים', cls: 'bg-slate-100 text-slate-500' }
  };
  const m = map[status] || { label: status, cls: 'bg-slate-100 text-slate-600' };
  return <span className={`text-xs px-2 py-1 rounded-md font-medium whitespace-nowrap ${m.cls}`}>{m.label}</span>;
}
