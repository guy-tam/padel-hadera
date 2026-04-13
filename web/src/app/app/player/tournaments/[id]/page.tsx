import Link from 'next/link';
import { requireProfile } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { uploadPaymentProofAction } from './actions';

// עמוד הרשמה בודד של שחקן — מציג סטטוס ומאפשר העלאת הוכחת תשלום
export default async function PlayerRegistrationPage({
  params, searchParams
}: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; uploaded?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const profile = await requireProfile();
  const db = adminClient();
  const { data: reg } = await db
    .from('registrations')
    .select('*, tournaments(slug, title, date, pricing, payment)')
    .eq('id', id)
    .single();
  const r = reg as any;
  if (!r || r.email !== profile.email) {
    return <div className="card p-8">הרשמה לא נמצאה.</div>;
  }
  const t = r.tournaments || {};

  return (
    <div className="space-y-5">
      <Link href="/app/player/tournaments" className="text-sm text-brand-700">← לכל ההרשמות</Link>
      <h1 className="text-2xl font-bold">{t.title || 'הרשמה'}</h1>
      <div className="card p-6 space-y-3">
        <Row k="תאריך" v={t.date || 'יפורסם'} />
        <Row k="שם" v={r.full_name} />
        <Row k="בן/בת זוג" v={r.partner_name || '—'} />
        <Row k="סטטוס" v={r.status} />
        {t.pricing?.price_per_pair && <Row k="מחיר לזוג" v={`₪${t.pricing.price_per_pair}`} />}
      </div>

      <div className="card p-6">
        <h2 className="font-bold mb-3">הוכחת תשלום</h2>
        {r.payment_proof ? (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-sm text-emerald-800">
            ✓ הועלה: {r.payment_proof.original_name} — ממתין לאישור היוזם
          </div>
        ) : (
          <>
            {sp.error && <div className="mb-3 text-sm text-rose-700">{sp.error}</div>}
            {sp.uploaded && <div className="mb-3 text-sm text-emerald-700">✓ הועלה בהצלחה</div>}
            <form action={uploadPaymentProofAction} className="space-y-3">
              <input type="hidden" name="registration_id" value={r.id} />
              <input
                type="file"
                name="file"
                accept="image/*,application/pdf"
                required
                className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-brand-600 file:text-white"
              />
              <button className="btn-primary">העלאה</button>
              <p className="text-xs text-slate-500">תמונה או PDF, עד 10MB</p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between py-2 border-b border-slate-100 last:border-0">
      <span className="text-slate-500 text-sm">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}
