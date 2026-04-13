import Link from 'next/link';

// עמוד בית — מסביר את הפלטפורמה ומציע כניסות ברורות לכל התפקידים
export default function HomePage() {
  return (
    <>
      <section className="bg-gradient-to-b from-brand-50 to-white">
        <div className="mx-auto max-w-6xl px-4 py-20 text-center">
          <h1 className="text-4xl md:text-6xl font-bold text-slate-900 leading-tight">
            פלטפורמה אחת.<br />
            <span className="text-brand-600">כל עולם הפאדל.</span>
          </h1>
          <p className="mt-6 text-lg text-slate-600 max-w-2xl mx-auto">
            שחקנים, יוזמי טורנירים ומגרשי פאדל — כולם בבית אחד.
            גלה טורנירים, הירשם בלחיצה, ונהל את כל הפעילות שלך ממקום אחד.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link href="/tournaments" className="btn-primary">🎯 צפייה בטורנירים</Link>
            <Link href="/signup?role=player" className="btn-outline">הרשמה כשחקן</Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-2xl md:text-3xl font-bold text-center mb-10">בחר את המסלול שלך</h2>
        <div className="grid md:grid-cols-3 gap-5">
          <RoleCard
            emoji="🎾"
            title="שחקנים"
            text="הירשם לטורנירים, עקוב אחרי הניצחונות וההפסדים, צפה בהיסטוריה."
            href="/for-players"
            cta="כניסה לשחקנים"
          />
          <RoleCard
            emoji="🏆"
            title="יוזמי טורנירים"
            text="צור טורנירים, בחר מגרשים מארחים, נהל הרשמות ותשלומים."
            href="/for-organizers"
            cta="כניסה ליוזמים"
          />
          <RoleCard
            emoji="🏟️"
            title="מגרשי פאדל"
            text="ראה את הטורנירים המתארחים אצלך, זמינות, תפוסה ומנהלי אירועים."
            href="/for-clubs"
            cta="כניסה למגרשים"
          />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 bg-slate-50 rounded-3xl">
        <h2 className="text-2xl font-bold text-center mb-10">איך זה עובד?</h2>
        <div className="grid md:grid-cols-3 gap-6 text-center">
          <Step n={1} t="הרשמה חינם" d="פותחים חשבון לפי התפקיד שלך — שחקן, יוזם או מגרש." />
          <Step n={2} t="מתחברים לאקוסיסטם" d="רואים טורנירים, הרשמות, תשלומים — הכל במקום אחד." />
          <Step n={3} t="מנהלים מהדשבורד" d="נתונים חיים מתעדכנים בזמן אמת בכל הדשבורדים." />
        </div>
      </section>
    </>
  );
}

function RoleCard({
  emoji, title, text, href, cta
}: { emoji: string; title: string; text: string; href: string; cta: string }) {
  return (
    <Link href={href} className="card p-6 hover:shadow-md transition group">
      <div className="text-4xl mb-3">{emoji}</div>
      <h3 className="text-xl font-bold mb-2">{title}</h3>
      <p className="text-slate-600 mb-4 text-sm">{text}</p>
      <span className="text-brand-700 font-semibold text-sm group-hover:underline">{cta} ←</span>
    </Link>
  );
}

function Step({ n, t, d }: { n: number; t: string; d: string }) {
  return (
    <div>
      <div className="w-12 h-12 rounded-full bg-brand-600 text-white font-bold text-lg flex items-center justify-center mx-auto mb-3">{n}</div>
      <div className="font-bold mb-1">{t}</div>
      <div className="text-slate-600 text-sm">{d}</div>
    </div>
  );
}
