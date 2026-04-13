# הפיכת הפלטפורמה לחיה — מדריך 10 דקות

עד היום הפרויקט היה deploy חצי-חי: הקוד ב-Vercel אבל **אין persistence אמיתי** (אין Supabase env, הנתונים נשמרים ב-`/tmp` של serverless ונמחקים כל הפעלה מחדש).

המדריך הזה הופך אותו לפלטפורמה חיה אמיתית בפקודה אחת.

---

## שלב 1 — Supabase (חינם, 3 דק')

1. היכנס ל-https://supabase.com והתחבר עם GitHub.
2. **New project** → שם: `padel-hadera`, region: Frankfurt, צור סיסמה חזקה ל-DB ושמור אותה.
3. חכה ~2 דק' שהפרויקט ייווצר.
4. ב-Settings → API:
   - העתק את `Project URL` → `SUPABASE_URL`
   - העתק את `service_role key` (לא anon!) → `SUPABASE_SERVICE_ROLE_KEY`
5. ב-Settings → Database → Connection string → URI:
   - העתק את ה-connection string (כולל הסיסמה) → `SUPABASE_DB_URL`

## שלב 2 — מלא `.env.live`

```bash
cp .env.live.example .env.live
# ערוך את .env.live ומלא את כל הערכים
```

## שלב 3 — הפעל

```bash
./scripts/go-live.sh
```

הסקריפט:
1. מריץ את `supabase/schema.sql` על ה-DB (טבלאות: clubs, organizers, tournaments, registrations, applications, uploads + RLS + triggers + storage bucket).
2. מעביר את כל הנתונים מ-`data/db.json` לטבלאות האמיתיות.
3. מזין את כל משתני הסביבה ל-Vercel (production + preview + development).
4. מריץ `vercel --prod`.

## שלב 4 — אימות

```bash
curl https://YOUR-DEPLOYMENT.vercel.app/api/health
```

תקבל:
```json
{
  "ok": true,
  "persistence": "supabase",
  "serverless": true,
  "supabase": true,
  "smtp": true,
  "admin_token_set": true
}
```

אם `persistence` הוא `ephemeral-tmp-DANGER` — משתני הסביבה לא הגיעו ל-Vercel. בדוק עם `vercel env ls production`.

---

## מה השתנה בקוד

- **`supabase/schema.sql`** — עכשיו סכמה יחסית מלאה: `clubs`, `organizers`, `tournaments` (FK ל-club/organizer), `registrations` (FK ל-tournament), `applications`, `uploads` (FK ל-registration). כל הטבלאות עם RLS שמאפשר רק ל-`service_role`. bucket `uploads` נוצר אוטומטית.
- **`scripts/migrate-to-supabase.js`** — מיגרציה אידמפוטנטית מ-`data/db.json` לטבלאות (upsert לפי PK).
- **`scripts/go-live.sh`** — פקודה אחת מ-0 ל-100.
- **`server.js`** — אזהרה רועשת כש-serverless בלי Supabase + endpoint חדש `/api/health` שחושף את מצב ה-persistence בשקיפות מלאה.

## מה נשאר לעתיד (אחרי go-live)

האדפטר הנוכחי (`lib/db-supabase.js`) עדיין שומר את כל המצב כ-JSONB ב-`platform_state`. זה עובד מצוין כ-persistence אמיתי, אבל השלב הבא הוא לשכתב את ה-API ב-`server.js` כך שיקרא/יכתוב ישירות לטבלאות היחסיות. הסכמה כבר ערוכה — אין חסם. זה שיפור ביצועים/scale שלא דחוף לשלב הראשון.
