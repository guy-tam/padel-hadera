import { requireProfile } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { setRegistrationStatusAction } from './actions';

// רשימת הרשמות + כפתורי אישור/דחייה פר שורה
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
        .select('id, full_name, partner_name, email, phone, tournament_id, status, payment_proof, created_at')
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
                <Th>הוכחת תשלום</Th>
                <Th>סטטוס</Th>
                <Th>פעולות</Th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 align-middle">
                  <Td>
                    <div className="font-medium">{r.full_name}</div>
                    <div className="text-xs text-slate-500">{r.email}</div>
                  </Td>
                  <Td>{r.partner_name || '—'}</Td>
                  <Td>{(tmap.get(r.tournament_id) as any)?.title || '—'}</Td>
                  <Td>{r.phone || '—'}</Td>
                  <Td>{r.payment_proof ? '✓' : '—'}</Td>
                  <Td><StatusBadge status={r.status} /></Td>
                  <Td>
                    <div className="flex gap-1 flex-wrap">
                      {r.status !== 'approved' && (
                        <ActionButton regId={r.id} status="approved" label="אשר" cls="bg-green-600 text-white" />
                      )}
                      {r.status !== 'confirmed' && (
                        <ActionButton regId={r.id} status="confirmed" label="שולם" cls="bg-emerald-600 text-white" />
                      )}
                      {r.status !== 'cancelled' && (
                        <ActionButton regId={r.id} status="cancelled" label="ביטול" cls="bg-rose-50 text-rose-700 border border-rose-200" />
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ActionButton({ regId, status, label, cls }: { regId: string; status: string; label: string; cls: string }) {
  return (
    <form action={setRegistrationStatusAction}>
      <input type="hidden" name="registration_id" value={regId} />
      <input type="hidden" name="status" value={status} />
      <button className={`text-xs px-2 py-1 rounded-md font-medium ${cls}`}>{label}</button>
    </form>
  );
}

function StatusBadge({ status }: { status: string }) {
  const m: Record<string, { label: string; cls: string }> = {
    awaiting_payment: { label: 'ממתין לתשלום', cls: 'bg-amber-100 text-amber-700' },
    pending: { label: 'ממתין', cls: 'bg-amber-100 text-amber-700' },
    approved: { label: 'אושר', cls: 'bg-green-100 text-green-700' },
    confirmed: { label: 'שולם', cls: 'bg-emerald-100 text-emerald-700' },
    cancelled: { label: 'בוטל', cls: 'bg-slate-100 text-slate-500' }
  };
  const x = m[status] || { label: status, cls: 'bg-slate-100 text-slate-600' };
  return <span className={`text-xs px-2 py-1 rounded-md font-medium whitespace-nowrap ${x.cls}`}>{x.label}</span>;
}

const Th = ({ children }: any) => <th className="text-right px-3 py-2 font-semibold whitespace-nowrap">{children}</th>;
const Td = ({ children }: any) => <td className="px-3 py-2 whitespace-nowrap">{children}</td>;
