import type { Metadata } from 'next';
import { Heebo } from 'next/font/google';
import './globals.css';

const heebo = Heebo({ subsets: ['hebrew', 'latin'], variable: '--font-heebo' });

export const metadata: Metadata = {
  title: 'פאדל ישראל — פלטפורמת טורנירים',
  description: 'פלטפורמה אחת לשחקנים, יוזמי טורנירים ומגרשי פאדל'
};

// layout ראשי — מגדיר שפה עברית + RTL לכל האפליקציה
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={heebo.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
