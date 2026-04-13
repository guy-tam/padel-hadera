import Link from 'next/link';

export default function ForPlayers() {
  return (
    <section className="mx-auto max-w-4xl px-4 py-16">
      <h1 className="text-4xl font-bold mb-4">🎾 לשחקנים</h1>
      <p className="text-lg text-slate-600 mb-8">
        הדרך הפשוטה ביותר להירשם לטורנירים, לעקוב אחרי הביצועים שלך ולראות את ההיסטוריה.
      </p>
      <div className="grid md:grid-cols-2 gap-4 mb-10">
        <Feature t="הרשמה בלחיצה" d="מצא טורניר שמתאים לך ורשום בן־זוג תוך שניות." />
        <Feature t="סטטוסי הרשמה" d="עקוב אחרי אישור, תשלום ומיקום ברשימה." />
        <Feature t="היסטוריית משחקים" d="ניצחונות, הפסדים, דירוג וכל הטורנירים שהשתתפת בהם." />
        <Feature t="פרופיל אישי" d="עדכון פרטים, רמה, מועדף ונקודות." />
      </div>
      <div className="flex gap-3">
        <Link href="/signup?role=player" className="btn-primary">הרשמה כשחקן</Link>
        <Link href="/tournaments" className="btn-outline">צפייה בטורנירים</Link>
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
