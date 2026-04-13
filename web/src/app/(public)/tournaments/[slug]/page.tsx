import Link from 'next/link';
import { notFound } from 'next/navigation';
import { adminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import RegisterForm from './RegisterForm';

// דף טורניר — נטען חי, כולל קיבולת בזמן אמת וטופס הרשמה
export default async function TournamentDetail({
  params
}: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = adminClient();
  const { data: tournament } = await db
    .from('tournaments')
    .select('*, clubs(id, name, city, contact_phone)')
    .eq('slug', slug)
    .single();

  if (!tournament) notFound();

  const t = tournament as any;
  const capacity = t.format?.capacity || t.format?.max_teams || 0;
  const { count } = await db
    .from('registrations')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', t.id);

  const registered = count || 0;
  const pct = capacity ? Math.min(100, Math.round((registered / capacity) * 100)) : 0;
  const price = t.pricing?.price_per_pair || t.pricing?.price || null;

  // בדיקת משתמש מחובר — לטופס הרשמה מוזן מראש
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  let defaults: { name: string; email: string; phone: string } = { name: '', email: '', phone: '' };
  if (user) {
    const { data: profile } = await sb.from('profiles').select('full_name, email, phone').eq('id', user.id).single();
    if (profile) defaults = {
      name: (profile as any).full_name || '',
      email: (profile as any).email || '',
      phone: (profile as any).phone || ''
    };
  }

  const isOpen = t.status === 'published' && (!capacity || registered < capacity);

  return (
    <section className="mx-auto max-w-4xl px-4 py-10">
      <div className="card p-8">
        <div className="text-xs text-brand-700 font-semibold mb-2">
          {t.date || 'תאריך יפורסם'}
        </div>
        <h1 className="text-3xl font-bold mb-2">{t.title}</h1>
        {t.subtitle && <p className="text-slate-600 mb-6">{t.subtitle}</p>}

        <div className="grid md:grid-cols-3 gap-4 my-6">
          <Info label="מגרש מארח" value={t.clubs?.name || '—'} />
          <Info label="תפוסה" value={capacity ? `${registered}/${capacity}` : `${registered} נרשמו`} />
          <Info label="מחיר לזוג" value={price ? `₪${price}` : 'יפורסם'} />
        </div>

        {capacity > 0 && (
          <div className="my-6">
            <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
              <span>תפוסה</span>
              <span>{pct}%</span>
            </div>
            <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        {t.description && (
          <div className="my-6 text-slate-700 whitespace-pre-line">{t.description}</div>
        )}

        <div className="my-8 border-t border-slate-200 pt-8">
          {isOpen ? (
            user ? (
              <RegisterForm tournamentId={t.id} slug={t.slug} defaults={defaults} />
            ) : (
              <div className="rounded-xl bg-slate-50 p-6 text-center">
                <div className="mb-3 text-slate-700">כדי להירשם — התחבר לחשבון שלך</div>
                <div className="flex gap-2 justify-center">
                  <Link href={`/login?next=/tournaments/${t.slug}`} className="btn-primary">התחברות</Link>
                  <Link href={`/signup?role=player`} className="btn-outline">הרשמה חדשה</Link>
                </div>
              </div>
            )
          ) : (
            <div className="rounded-xl bg-amber-50 p-6 text-center text-amber-800 font-medium">
              {capacity && registered >= capacity ? '⛔ הטורניר מלא' : 'ההרשמה סגורה כרגע'}
            </div>
          )}
        </div>

        <Link href="/tournaments" className="text-sm text-brand-700 font-semibold">← חזרה לרשימת הטורנירים</Link>
      </div>
    </section>
  );
}

function Info({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}
