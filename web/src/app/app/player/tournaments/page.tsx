import Link from 'next/link';
import { requireProfile } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';

export default async function PlayerTournaments() {
  const profile = await requireProfile();
  const db = adminClient();
  const { data: regs } = await db
    .from('registrations')
    .select('id, status, partner_name, created_at, tournaments(slug, title, date, status)')
    .eq('email', profile.email)
    .order('created_at', { ascending: false });

  const list = (regs || []) as any[];
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">הטורנירים שלי</h1>
      {list.length === 0 ? (
        <div className="card p-10 text-center text-slate-500">
          עוד אין הרשמות. <Link href="/tournaments" className="text-brand-700 font-semibold">לצפייה בטורנירים →</Link>
        </div>
      ) : (
        <div className="card divide-y divide-slate-100">
          {list.map((r) => (
            <Link href={`/tournaments/${r.tournaments?.slug}`} key={r.id} className="p-4 flex items-center justify-between hover:bg-slate-50">
              <div>
                <div className="font-semibold">{r.tournaments?.title}</div>
                <div className="text-xs text-slate-500">
                  {r.tournaments?.date || 'תאריך יפורסם'}
                  {r.partner_name ? ` · בן/בת זוג: ${r.partner_name}` : ''}
                  {' · '}נרשם ב-{new Date(r.created_at).toLocaleDateString('he-IL')}
                </div>
              </div>
              <span className="text-xs font-semibold text-brand-700">{r.status}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
