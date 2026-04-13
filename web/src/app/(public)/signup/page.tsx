import Link from 'next/link';
import { signupAction } from '@/app/(auth)/actions';

const ROLE_LABELS: Record<string, string> = {
  player: 'שחקן',
  organizer: 'יוזם טורנירים',
  club: 'מגרש פאדל'
};

export default async function SignupPage({
  searchParams
}: { searchParams: Promise<{ role?: string; error?: string }> }) {
  const params = await searchParams;
  const role = ['player', 'organizer', 'club'].includes(params.role || '') ? params.role! : 'player';

  return (
    <section className="mx-auto max-w-md px-4 py-16">
      <div className="card p-8">
        <h1 className="text-2xl font-bold mb-2">הרשמה</h1>
        <p className="text-slate-600 text-sm mb-6">פתיחת חשבון כ{ROLE_LABELS[role]}</p>

        <div className="flex gap-2 mb-6">
          {(['player', 'organizer', 'club'] as const).map((r) => (
            <Link
              key={r}
              href={`/signup?role=${r}`}
              className={`flex-1 text-center text-sm rounded-lg px-3 py-2 border transition ${
                r === role
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {ROLE_LABELS[r]}
            </Link>
          ))}
        </div>

        <form action={signupAction} className="space-y-4">
          <input type="hidden" name="role" value={role} />
          <Field label="שם מלא" name="full_name" required />
          <Field label="אימייל" name="email" type="email" required />
          <Field label="טלפון" name="phone" type="tel" />
          <Field label="סיסמה (מינימום 8 תווים)" name="password" type="password" required />
          <button type="submit" className="btn-primary w-full">צור חשבון</button>
        </form>
        {params.error && <div className="mt-4 text-sm text-red-600">{params.error}</div>}
        <div className="mt-6 text-sm text-slate-600">
          כבר יש לך חשבון? <Link href="/login" className="text-brand-700 font-semibold">התחברות</Link>
        </div>
      </div>
    </section>
  );
}

function Field({ label, name, type = 'text', required }: { label: string; name: string; type?: string; required?: boolean }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700 block mb-1">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none"
      />
    </label>
  );
}
