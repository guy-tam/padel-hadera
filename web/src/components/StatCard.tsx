// כרטיס סטטיסטיקה משותף לכל הדשבורדים
export default function StatCard({
  label, value, hint, accent
}: { label: string; value: string | number; hint?: string; accent?: 'brand' | 'blue' | 'amber' | 'rose' }) {
  const accents = {
    brand: 'text-brand-700 bg-brand-50',
    blue: 'text-blue-700 bg-blue-50',
    amber: 'text-amber-700 bg-amber-50',
    rose: 'text-rose-700 bg-rose-50'
  };
  return (
    <div className="card p-5">
      <div className="text-xs font-medium text-slate-500 mb-2">{label}</div>
      <div className={`inline-flex items-center rounded-lg px-3 py-1.5 font-bold text-2xl ${accents[accent || 'brand']}`}>
        {value}
      </div>
      {hint && <div className="mt-2 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}
