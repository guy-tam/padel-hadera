import { requireProfile } from '@/lib/auth';

export default async function PlayerProfile() {
  const profile = await requireProfile();
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">הפרופיל שלי</h1>
      <div className="card p-6 space-y-3">
        <Row k="שם מלא" v={profile.full_name || '—'} />
        <Row k="אימייל" v={profile.email} />
        <Row k="טלפון" v={profile.phone || '—'} />
        <Row k="תפקיד" v="שחקן" />
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
