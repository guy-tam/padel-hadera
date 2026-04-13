import { requireProfile } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';

export default async function OrganizerRegistrations() {
  const profile = await requireProfile();
  if (!profile.organizer_id) {
    return <div className="card p-8">השלמת פרטי ארגון נדרשת.</div>;
  }
  const db = adminClient();
  const { data: tournaments } = await db
    .from('tournaments')
    .select('id, title, slug')
    .eq('organizer_id', profile.organizer_id);
  const tmap = new Map((tournaments || []).map((t: any) => [t.id, t]));
  const ids = Array.from(tmap.keys());

  const { data: regs } = ids.length
    ? await db
        .from('registrations')
        .select('id, full_name, partner_name, email, phone, tournament_id, status, created_at')
        .in('tournament_id', ids)
        .order('created_at', { ascending: false })
    : { data: [] as any[] };

  const list = (regs || []) as any[];
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">הרשמות לטורנירים שלי</h1>
      {list.length === 0 ? (
        <div className="card p-10 text-center text-slate-500">אין הרשמות עדיין.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <Th>שחקן</Th>
                <Th>בן/בת זוג</Th>
                <Th>טורניר</Th>
                <Th>טלפון</Th>
                <Th>תאריך הרשמה</Th>
                <Th>סטטוס</Th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <Td>{r.full_name}</Td>
                  <Td>{r.partner_name || '—'}</Td>
                  <Td>{(tmap.get(r.tournament_id) as any)?.title || r.tournament_id}</Td>
                  <Td>{r.phone || '—'}</Td>
                  <Td>{new Date(r.created_at).toLocaleDateString('he-IL')}</Td>
                  <Td><b>{r.status}</b></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
const Th = ({ children }: any) => <th className="text-right px-4 py-2 font-semibold whitespace-nowrap">{children}</th>;
const Td = ({ children }: any) => <td className="px-4 py-2 whitespace-nowrap">{children}</td>;
