import AppShell from '@/components/AppShell';
import { requireProfile } from '@/lib/auth';

// layout לכל האזור המאומת — מטעין profile ועוטף ב-AppShell
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  return <AppShell profile={profile}>{children}</AppShell>;
}
