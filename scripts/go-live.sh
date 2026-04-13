#!/usr/bin/env bash
# ==================================================================
# go-live.sh — הפיכת הפרויקט לפלטפורמה חיה בפקודה אחת
# ==================================================================
# לפני הרצה: הגדר ב-.env.live (או בסביבה) את המשתנים הבאים:
#   SUPABASE_URL=https://xxxxx.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY=eyJ...
#   SUPABASE_DB_URL=postgres://postgres:PWD@db.xxxxx.supabase.co:5432/postgres
#   SMTP_USER=...
#   SMTP_PASS=...
#   ADMIN_EMAIL=...
#   ADMIN_TOKEN=...                    # סיסמת אדמין חזקה
#   CALLMEBOT_API_KEY=...              # אופציונלי
#   ORGANIZER_WA_NUMBER=...            # אופציונלי
#
# ומוודאים שהותקנו: vercel CLI, psql, node
# ==================================================================

set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env.live ]; then
  echo "📄 טוען .env.live"
  set -a; . ./.env.live; set +a
fi

require() {
  local var="$1"
  if [ -z "${!var:-}" ]; then echo "❌ חסר משתנה $var"; exit 1; fi
}
require SUPABASE_URL
require SUPABASE_SERVICE_ROLE_KEY

echo "=================================================="
echo "🚀 GO LIVE — פאדל חדרה"
echo "   Supabase: $SUPABASE_URL"
echo "=================================================="

# ---------- 1. הרצת הסכמה ----------
if [ -n "${SUPABASE_DB_URL:-}" ]; then
  if command -v psql >/dev/null 2>&1; then
    echo "📐 מריץ schema.sql דרך psql..."
    psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/schema.sql
    echo "   ✅ schema הותקנה"
  else
    echo "⚠️  psql לא מותקן — דלג. הרץ ידנית: קובץ supabase/schema.sql ב-SQL Editor."
  fi
else
  echo "ℹ️  SUPABASE_DB_URL לא הוגדר — הרץ ידנית את supabase/schema.sql ב-SQL Editor"
fi

# ---------- 2. מיגרציית נתונים ----------
echo "📦 מעביר נתונים מ-data/db.json ל-Supabase..."
node scripts/migrate-to-supabase.js

# ---------- 3. דחיפת ENV ל-Vercel ----------
echo "🔐 מזין משתני סביבה ל-Vercel (production + preview + development)..."
push_env() {
  local key="$1" val="$2"
  if [ -z "$val" ]; then return 0; fi
  for env in production preview development; do
    # הסר קיים כדי למנוע כפילויות
    echo "y" | vercel env rm "$key" "$env" >/dev/null 2>&1 || true
    printf '%s' "$val" | vercel env add "$key" "$env" >/dev/null
  done
  echo "   ✅ $key"
}

push_env SUPABASE_URL               "${SUPABASE_URL:-}"
push_env SUPABASE_SERVICE_ROLE_KEY  "${SUPABASE_SERVICE_ROLE_KEY:-}"
push_env SUPABASE_STORAGE_BUCKET    "${SUPABASE_STORAGE_BUCKET:-uploads}"
push_env ADMIN_TOKEN                "${ADMIN_TOKEN:-}"
push_env ADMIN_EMAIL                "${ADMIN_EMAIL:-}"
push_env SMTP_USER                  "${SMTP_USER:-}"
push_env SMTP_PASS                  "${SMTP_PASS:-}"
push_env CALLMEBOT_API_KEY          "${CALLMEBOT_API_KEY:-}"
push_env ORGANIZER_WA_NUMBER        "${ORGANIZER_WA_NUMBER:-}"

# ---------- 4. דפלוי פרודקשן ----------
echo "🚢 מריץ vercel --prod ..."
vercel --prod --yes

echo ""
echo "=================================================="
echo "🎉 הפלטפורמה חיה."
echo "=================================================="
