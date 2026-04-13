import Link from 'next/link';
import StatCard from '@/components/StatCard';
import { requireProfile } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';

// סקירת אדמין — רק למשתמשים עם role=admin
export default async function AdminPage() {
  const profile = await requireProfile();
  if (profile.role !== 'admin') {
    return <div className="card p-8">אין לך הרשאת אדמין.</div>;
  }
  const db = adminClient();
  const [users, tournaments, registrations, clubs, organizers] = await Promise.all([
    db.from('profiles').select('id', { count: 'exact', head: true }),
    db.from('tournaments').select('id', { count: 'exact', head: true }),
    db.from('registrations').select('id', { count: 'exact', head: true }),
    db.from('clubs').select('id', { count: 'exact', head: true }),
    db.from('organizers').select('id', { count: 'exact', head: true })
  ]);

  const { data: latest } = await db
    .from('registrations')
    .select('id, full_name, status, created_at, tournaments(title)')
    .order('created_at', { ascending: false })
    .limit(10);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">ניהול פלטפורמה 🛡️</h1>
      <div className="grid md:grid-cols-5 gap-4">
        <StatCard label="משתמשים" value={users.count || 0} accent="brand" />
        <StatCard label="טורנירים" value={tournaments.count || 0} accent="blue" />
        <StatCard label="הרשמות" value={registrations.count || 0} accent="amber" />
        <StatCard label="מגרשים" value={clubs.count || 0} accent="rose" />
        <StatCard label="יוזמים" value={organizers.count || 0} accent="blue" />
      </div>

      <div className="card p-6">
        <h2 className="text-lg font-bold mb-4">הרשמות אחרונות</h2>
        <div className="divide-y divide-slate-100">
          {(latest || []).map((r: any) => (
            <div key={r.id} className="flex items-center justify-between py-2">
              <div>
                <div className="font-medium">{r.full_name}</div>
                <div className="text-xs text-slate-500">{r.tournaments?.title || '—'}</div>
              </div>
              <div className="text-xs text-slate-500">
                {new Date(r.created_at).toLocaleString('he-IL')} · {r.status}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-6">
        <h2 className="font-bold mb-2">קישורים מהירים</h2>
        <div className="flex gap-2 flex-wrap">
          <Link href="/tournaments" className="btn-outline text-sm">עמוד טורנירים ציבורי</Link>
          <Link href="/app/organizer" className="btn-outline text-sm">דשבורד יוזם</Link>
          <Link href="/app/club" className="btn-outline text-sm">דשבורד מגרש</Link>
          <Link href="/app/player" className="btn-outline text-sm">דשבורד שחקן</Link>
        </div>
      </div>
    </div>
  );
}
