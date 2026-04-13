import Link from 'next/link';
import { loginAction } from '@/app/(auth)/actions';

export default async function LoginPage({
  searchParams
}: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const params = await searchParams;
  return (
    <section className="mx-auto max-w-md px-4 py-16">
      <div className="card p-8">
        <h1 className="text-2xl font-bold mb-2">התחברות</h1>
        <p className="text-slate-600 text-sm mb-6">הכנס לחשבון שלך כדי להמשיך</p>
        <form action={loginAction} className="space-y-4">
          <input type="hidden" name="next" value={params.next || '/app'} />
          <Field label="אימייל" name="email" type="email" required />
          <Field label="סיסמה" name="password" type="password" required />
          <button type="submit" className="btn-primary w-full">התחברות</button>
        </form>
        {params.error && <div className="mt-4 text-sm text-red-600">{params.error}</div>}
        <div className="mt-6 text-sm text-slate-600">
          אין לך חשבון? <Link href="/signup" className="text-brand-700 font-semibold">הרשמה</Link>
        </div>
      </div>
    </section>
  );
}

function Field({ label, name, type, required }: { label: string; name: string; type: string; required?: boolean }) {
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
