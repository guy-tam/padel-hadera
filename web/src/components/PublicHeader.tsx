import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

// Header של החלק הציבורי — מציג זהות משתמש אם מחובר
export default async function PublicHeader() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  return (
    <header className="border-b border-slate-200 bg-white/80 backdrop-blur sticky top-0 z-30">
      <div className="mx-auto max-w-6xl px-4 h-16 flex items-center justify-between">
        <Link href="/" className="font-bold text-lg text-brand-700">
          🎾 פאדל ישראל
        </Link>
        <nav className="hidden md:flex items-center gap-6 text-sm">
          <Link href="/tournaments" className="hover:text-brand-700">טורנירים</Link>
          <Link href="/for-players" className="hover:text-brand-700">לשחקנים</Link>
          <Link href="/for-organizers" className="hover:text-brand-700">ליוזמים</Link>
          <Link href="/for-clubs" className="hover:text-brand-700">למגרשים</Link>
        </nav>
        <div className="flex items-center gap-2">
          {user ? (
            <Link href="/app" className="btn-primary text-sm">האזור האישי</Link>
          ) : (
            <>
              <Link href="/login" className="btn-outline text-sm">התחברות</Link>
              <Link href="/signup" className="btn-primary text-sm">הרשמה</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
