# פאדל — Web (Next.js)

פלטפורמת Next.js 15 App Router חדשה לצד ה-Express הקיים.

## התקנה והפעלה

```bash
cd web
cp .env.local.example .env.local
# מלא:
# NEXT_PUBLIC_SUPABASE_URL
# NEXT_PUBLIC_SUPABASE_ANON_KEY
# SUPABASE_SERVICE_ROLE_KEY
npm install
npm run dev   # http://localhost:3001
```

## הרצת מיגרציית ה-DB

פעם אחת ב-Supabase SQL Editor:

```
supabase/migrations/20260413_profiles_auth.sql
```

יוצר: טבלת `profiles`, enum `user_role`, טריגר signup אוטומטי, RLS.

## מבנה כללי

- **Public** (`src/app/(public)`): `/`, `/tournaments`, `/tournaments/[slug]`, `/for-players`, `/for-organizers`, `/for-clubs`, `/login`, `/signup`
- **App** (`src/app/app`): `/app/player`, `/app/organizer`, `/app/club` — role guard ב-middleware
- **Server Actions**: login, signup, logout, רישום לטורניר, יצירת טורניר, setup ארגון/מגרש
- **Shell אחיד**: header/footer ציבוריים, sidebar לאזור המאומת
- **ניווט פנימי בלבד** — אין `target="_blank"` לקישורים פנימיים

## Data

הסכמה הקיימת ב-`supabase/schema.sql` נשמרת. ה-Next.js מוסיף:
- `profiles` — קישור auth.users → role + organizer_id/club_id
- שימוש ב-service_role client לקריאות/כתיבות מהשרת (אחרי אימות session)

## Phase הבא (לא כלול)

- העלאות קבצים (payment_proof, health_file) — נשאר ב-Express לעת עתה
- אישור/דחיית הרשמות על ידי יוזם (UI)
- הגדרת slots זמינות של מגרש
- admin panel
- emails/PDF
