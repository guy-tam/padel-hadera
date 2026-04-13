import PublicHeader from '@/components/PublicHeader';
import PublicFooter from '@/components/PublicFooter';

// layout ציבורי — כל הדפים הציבוריים חולקים header/footer, כך שמעבר ביניהם הוא ניווט פנימי בלבד
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <PublicHeader />
      <main className="flex-1">{children}</main>
      <PublicFooter />
    </div>
  );
}
