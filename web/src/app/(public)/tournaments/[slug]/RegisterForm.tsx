import { registerAction } from './actions';

// טופס הרשמה לטורניר — Server Action, ללא JS מותאם
export default function RegisterForm({
  tournamentId, slug, defaults
}: {
  tournamentId: string;
  slug: string;
  defaults: { name: string; email: string; phone: string };
}) {
  return (
    <form action={registerAction} className="space-y-3">
      <input type="hidden" name="tournament_id" value={tournamentId} />
      <input type="hidden" name="slug" value={slug} />
      <h2 className="text-xl font-bold mb-2">הרשמה לטורניר</h2>
      <div className="grid md:grid-cols-2 gap-3">
        <Field label="שם מלא" name="full_name" required defaultValue={defaults.name} />
        <Field label="טלפון" name="phone" type="tel" required defaultValue={defaults.phone} />
        <Field label="אימייל" name="email" type="email" defaultValue={defaults.email} />
        <Field label="רמה" name="level" placeholder="מתחיל / בינוני / מתקדם" />
        <Field label="בן/בת זוג — שם" name="partner_name" />
        <Field label="בן/בת זוג — טלפון" name="partner_phone" type="tel" />
      </div>
      <label className="block">
        <span className="text-sm font-medium text-slate-700 block mb-1">הערות</span>
        <textarea
          name="notes"
          rows={3}
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none"
        />
      </label>
      <button type="submit" className="btn-primary w-full">שליחת הרשמה</button>
      <p className="text-xs text-slate-500 text-center">לאחר שליחת ההרשמה תועבר לדשבורד האישי שלך</p>
    </form>
  );
}

function Field({
  label, name, type = 'text', required, defaultValue, placeholder
}: { label: string; name: string; type?: string; required?: boolean; defaultValue?: string; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700 block mb-1">{label}{required && ' *'}</span>
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 outline-none"
      />
    </label>
  );
}
