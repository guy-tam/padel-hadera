import Link from 'next/link';

export default function PublicFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white mt-16">
      <div className="mx-auto max-w-6xl px-4 py-10 grid md:grid-cols-4 gap-6 text-sm">
        <div>
          <div className="font-bold text-brand-700 mb-2">🎾 פאדל ישראל</div>
          <p className="text-slate-500">פלטפורמה אחת לכל עולם הפאדל — שחקנים, יוזמים ומגרשים.</p>
        </div>
        <div>
          <div className="font-semibold mb-2">חקירה</div>
          <ul className="space-y-1 text-slate-600">
            <li><Link href="/tournaments">טורנירים פעילים</Link></li>
            <li><Link href="/for-players">לשחקנים</Link></li>
          </ul>
        </div>
        <div>
          <div className="font-semibold mb-2">עסקים</div>
          <ul className="space-y-1 text-slate-600">
            <li><Link href="/for-organizers">ליוזמי טורנירים</Link></li>
            <li><Link href="/for-clubs">למגרשי פאדל</Link></li>
          </ul>
        </div>
        <div>
          <div className="font-semibold mb-2">חשבון</div>
          <ul className="space-y-1 text-slate-600">
            <li><Link href="/login">התחברות</Link></li>
            <li><Link href="/signup">הרשמה</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-slate-100 py-4 text-center text-xs text-slate-400">
        © {new Date().getFullYear()} פאדל ישראל
      </div>
    </footer>
  );
}
