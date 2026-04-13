import Link from 'next/link';

export default function ForClubs() {
  return (
    <section className="mx-auto max-w-4xl px-4 py-16">
      <h1 className="text-4xl font-bold mb-4">🏟️ למגרשי פאדל</h1>
      <p className="text-lg text-slate-600 mb-8">
        הפכו את המגרש לבית לטורנירים. שליטה מלאה על זמינות, תפוסה ואירועים מתארחים.
      </p>
      <div className="grid md:grid-cols-2 gap-4 mb-10">
        <Feature t="טורנירים מתארחים" d="רשימה חיה של כל הטורנירים אצלכם, כולל תאריכים ותפוסה." />
        <Feature t="ניהול זמינות" d="הגדרת ימים ושעות שאתם מציעים לטורנירים חיצוניים." />
        <Feature t="אירועים ונפחים" d="כמה משתתפים, באילו קטגוריות, אילו יוזמים." />
        <Feature t="פרופיל מגרש" d="הציגו את המגרש לקהל יוזמי הטורנירים בארץ." />
      </div>
      <div className="flex gap-3">
        <Link href="/signup?role=club" className="btn-primary">הרשמה כמגרש</Link>
        <Link href="/login" className="btn-outline">התחברות</Link>
      </div>
    </section>
  );
}
function Feature({ t, d }: { t: string; d: string }) {
  return (
    <div className="card p-5">
      <div className="font-bold mb-1">{t}</div>
      <div className="text-sm text-slate-600">{d}</div>
    </div>
  );
}
