import Link from 'next/link';
import { logoutAction } from '@/app/(auth)/actions';
import type { Profile, UserRole } from '@/lib/supabase/types';

const NAV: Record<UserRole, { href: string; label: string; icon: string }[]> = {
  player: [
    { href: '/app/player', label: 'סקירה', icon: '📊' },
    { href: '/app/player/tournaments', label: 'הטורנירים שלי', icon: '🎾' },
    { href: '/app/player/history', label: 'היסטוריה', icon: '📜' },
    { href: '/app/player/profile', label: 'פרופיל', icon: '👤' }
  ],
  organizer: [
    { href: '/app/organizer', label: 'סקירה', icon: '📊' },
    { href: '/app/organizer/tournaments', label: 'הטורנירים שלי', icon: '🏆' },
    { href: '/app/organizer/tournaments/new', label: 'יצירת טורניר', icon: '➕' },
    { href: '/app/organizer/registrations', label: 'הרשמות', icon: '📋' }
  ],
  club: [
    { href: '/app/club', label: 'סקירה', icon: '📊' },
    { href: '/app/club/tournaments', label: 'טורנירים במגרש', icon: '🏟️' },
    { href: '/app/club/calendar', label: 'יומן וזמינות', icon: '📅' },
    { href: '/app/club/profile', label: 'פרופיל מגרש', icon: '⚙️' }
  ],
  admin: [
    { href: '/app', label: 'סקירה', icon: '📊' }
  ]
};

const ROLE_LABEL: Record<UserRole, string> = {
  player: 'אזור השחקן',
  organizer: 'אזור היוזם',
  club: 'אזור המגרש',
  admin: 'אזור הניהול'
};

// Shell אחיד לכל הדשבורדים — sidebar + topbar עם ניווט פנימי בלבד
export default function AppShell({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  const nav = NAV[profile.role] || [];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="mx-auto max-w-7xl px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="font-bold text-brand-700">🎾 פאדל ישראל</Link>
            <span className="hidden md:inline-block text-xs text-white bg-brand-600 px-2 py-1 rounded-md">
              {ROLE_LABEL[profile.role]}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden md:block text-sm text-slate-600">
              שלום, <b>{profile.full_name || profile.email}</b>
            </div>
            <form action={logoutAction}>
              <button type="submit" className="btn-outline text-sm">התנתקות</button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6 grid md:grid-cols-[220px_1fr] gap-6">
        <aside className="md:sticky md:top-20 md:self-start">
          <nav className="card p-2">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-brand-50 text-slate-700 hover:text-brand-700 text-sm"
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>
        </aside>
        <main>{children}</main>
      </div>
    </div>
  );
}
