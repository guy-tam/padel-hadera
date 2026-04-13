import Link from 'next/link';
import { adminClient } from '@/lib/supabase/admin';

// רשימת טורנירים פעילים — נתונים חיים מ-Supabase (service role, עמוד ציבורי)
export default async function TournamentsPage() {
  const db = adminClient();
  const { data: tournaments } = await db
    .from('tournaments')
    .select('id, slug, title, subtitle, date, location, format, status, club_id')
    .eq('status', 'published')
    .eq('visibility', 'public')
    .order('date', { ascending: true });

  const list = (tournaments || []) as any[];

  return (
    <section className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="text-3xl font-bold mb-2">טורנירים פעילים</h1>
      <p className="text-slate-600 mb-8">בחר טורניר והירשם בלחיצה. הנתונים מתעדכנים בזמן אמת.</p>

      {list.length === 0 ? (
        <div className="card p-10 text-center text-slate-500">
          אין כרגע טורנירים פעילים. חזור בקרוב 🎾
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map((t) => {
            const capacity = t.format?.capacity || t.format?.max_teams || null;
            return (
              <Link key={t.id} href={`/tournaments/${t.slug}`} className="card p-5 hover:shadow-md transition">
                <div className="text-xs text-brand-700 font-semibold mb-1">
                  {t.date || 'תאריך יפורסם'}
                </div>
                <div className="font-bold text-lg mb-1">{t.title}</div>
                {t.subtitle && <div className="text-sm text-slate-500 mb-2">{t.subtitle}</div>}
                {t.location && <div className="text-xs text-slate-400 mt-1">📍 {t.location}</div>}
                {capacity && <div className="text-xs text-slate-400 mt-1">קיבולת: {capacity}</div>}
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
