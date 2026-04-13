import Link from 'next/link';

export default function ForOrganizers() {
  return (
    <section className="mx-auto max-w-4xl px-4 py-16">
      <h1 className="text-4xl font-bold mb-4">🏆 ליוזמי טורנירים</h1>
      <p className="text-lg text-slate-600 mb-8">
        כל הכלים שצריך לנהל טורניר מקצועי — יצירה, הרשמה, תשלומים ותקשורת עם המגרש.
      </p>
      <div className="grid md:grid-cols-2 gap-4 mb-10">
        <Feature t="יצירת טורנירים" d="בחר מגרש מארח, תאריך, קטגוריה ופורמט — תוך דקות." />
        <Feature t="ניהול הרשמות" d="ראה את כל הזוגות, סטטוסי תשלום ואישורים במקום אחד." />
        <Feature t="אישור מגרש" d="תיאום אוטומטי מול המגרש המארח לזמינות ותפוסה." />
        <Feature t="דשבורד אופרטיבי" d="תמונת מצב חיה — כמה נרשמו, כמה שולמו, מה חסר." />
      </div>
      <div className="flex gap-3">
        <Link href="/signup?role=organizer" className="btn-primary">הרשמה כיוזם</Link>
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
