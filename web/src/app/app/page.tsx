import { redirect } from 'next/navigation';
import { requireProfile } from '@/lib/auth';

// /app — מפנה לדשבורד הנכון לפי role
export default async function AppRootPage() {
  const profile = await requireProfile();
  if (profile.role === 'admin') redirect('/app/admin');
  redirect(`/app/${profile.role}`);
}
