import Link from 'next/link';
import { requireProfile } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';

export default async function ClubProfile() {
  const profile = await requireProfile();
  if (!profile.club_id) return <div className="card p-6">לא משויך למגרש. <Link href="/app/club/setup" className="text-brand-700 font-semibold">השלם פרטים</Link>.</div>;
  const db = adminClient();
  const { data: club } = await db.from('clubs').select('*').eq('id', profile.club_id).single();
  const c = club as any;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">פרופיל המגרש</h1>
      <div className="card p-6 space-y-3">
        <Row k="שם המגרש" v={c?.name || '—'} />
        <Row k="עיר" v={c?.city || '—'} />
        <Row k="טלפון" v={c?.contact_phone || '—'} />
        <Row k="אימייל" v={c?.contact_email || '—'} />
        <Row k="תיאור" v={c?.short_description || c?.description || '—'} />
        <Row k="סטטוס" v={c?.status || '—'} />
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
