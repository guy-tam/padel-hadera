import Link from 'next/link';
import { createTournamentAction } from './actions';
import { requireProfile } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';

// עמוד יצירת טורניר — חי, עם בחירת מגרש מארח מתוך DB
export default async function NewTournamentPage({
  searchParams
}: { searchParams: Promise<{ error?: string }> }) {
  const profile = await requireProfile();
  if (profile.role !== 'organizer' && profile.role !== 'admin') {
    return <div className="card p-6">רק יוזמי טורנירים יכולים ליצור טורנירים.</div>;
  }
  const params = await searchParams;
  const db = adminClient();
  const { data: clubs } = await db.from('clubs').select('id, name, city').eq('status', 'active').order('name');

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">יצירת טורניר חדש</h1>

      <form action={createTournamentAction} className="card p-6 space-y-4">
        {params.error && (
          <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">
            {params.error}
          </div>
        )}
        <Field label="כותרת הטורניר" name="title" required />
        <Field label="כותרת משנה" name="subtitle" />
        <label className="block">
          <span className="text-sm font-medium text-slate-700 block mb-1">תיאור</span>
          <textarea name="description" rows={4} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none" />
        </label>
        <div className="grid md:grid-cols-2 gap-3">
          <Field label="תאריך" name="date" placeholder="למשל: 15/05/2026" />
          <Field label="מיקום / כתובת" name="location" />
        </div>
        <label className="block">
          <span className="text-sm font-medium text-slate-700 block mb-1">מגרש מארח</span>
          <select name="club_id" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 bg-white">
            <option value="">— ללא קישור למגרש —</option>
            {(clubs || []).map((c: any) => (
              <option key={c.id} value={c.id}>{c.name}{c.city ? ` · ${c.city}` : ''}</option>
            ))}
          </select>
        </label>
        <div className="grid md:grid-cols-2 gap-3">
          <Field label="קיבולת (מס׳ זוגות)" name="capacity" type="number" />
          <Field label="מחיר לזוג (₪)" name="price" type="number" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="publish" className="h-4 w-4" />
          פרסם מיד (אחרת יישמר כטיוטה)
        </label>
        <div className="flex gap-3 pt-2">
          <button type="submit" className="btn-primary">יצירת טורניר</button>
          <Link href="/app/organizer/tournaments" className="btn-outline">ביטול</Link>
        </div>
      </form>
    </div>
  );
}

function Field({ label, name, type = 'text', required, placeholder }: { label: string; name: string; type?: string; required?: boolean; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700 block mb-1">{label}{required && ' *'}</span>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none"
      />
    </label>
  );
}
