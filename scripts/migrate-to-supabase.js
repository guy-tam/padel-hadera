#!/usr/bin/env node
// מיגרציה חד-פעמית: data/db.json -> טבלאות יחסיות ב-Supabase
// שימוש:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate-to-supabase.js
// אידמפוטנטי: משתמש ב-upsert על primary key.

'use strict';
const fs   = require('fs');
const path = require('path');
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('❌ חסרים משתני סביבה: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');
if (!fs.existsSync(DB_PATH)) {
  console.error('❌ לא נמצא data/db.json'); process.exit(1);
}
const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));

// ------- מיפויים מ-JSON לעמודות snake_case -------
const mapClub = c => ({
  id: c.id, slug: c.slug, name: c.name, city: c.city,
  description: c.description, short_description: c.shortDescription,
  image: c.image, contact_email: c.contactEmail, contact_phone: c.contactPhone,
  status: c.status || 'active',
  created_at: c.createdAt || new Date().toISOString(),
  meta: {}
});

const mapOrganizer = o => ({
  id: o.id, slug: o.slug, name: o.name,
  contact_person: o.contactPerson, email: o.email,
  phone: o.phone, whatsapp: o.whatsapp,
  business: o.business || {},
  status: o.status || 'active',
  created_at: o.createdAt || new Date().toISOString(),
  meta: {}
});

const mapTournament = t => ({
  id: t.id, slug: t.slug, title: t.title, subtitle: t.subtitle,
  club_id: t.clubId || null, organizer_id: t.organizerId || null,
  description: t.description, date: t.date, location: t.location,
  format: t.format || {}, pricing: t.pricing || {}, payment: t.payment || {},
  refund_policy: t.refundPolicy,
  require_health_declaration: !!t.requireHealthDeclaration,
  health_form_url: t.healthFormUrl,
  status: t.status || 'draft',
  visibility: t.visibility || 'public',
  created_at: t.createdAt || new Date().toISOString(),
  meta: {}
});

const mapRegistration = r => ({
  id: r.id,
  tournament_id: r.tournamentId || r.tournament_id || null,
  status: r.status || 'awaiting_payment',
  full_name: r.fullName, phone: r.phone, email: r.email,
  level: r.level, partner_name: r.partnerName, partner_phone: r.partnerPhone,
  notes: r.notes,
  health_file: r.healthFile || null,
  payment_proof: r.paymentProof || null,
  history: r.history || [],
  created_at: r.createdAt || new Date().toISOString(),
  meta: {}
});

// ------- batch upsert עם דיווח -------
async function upsert(table, rows, onConflict = 'id') {
  if (!rows.length) { console.log(`  ${table}: ריק, מדלג`); return; }
  const { error, count } = await sb.from(table).upsert(rows, { onConflict, count: 'exact' });
  if (error) { console.error(`  ${table}: ❌ ${error.message}`); throw error; }
  console.log(`  ${table}: ✅ ${count ?? rows.length} רשומות`);
}

async function migrateApplications() {
  const apps = db.applications || {};
  const rows = [];
  // המפתחות ב-db.json הם ברבים (organizers/clubs/players), אבל ה-check constraint
  // דורש יחיד (organizer/club/player).
  const toSingular = { organizers: 'organizer', clubs: 'club', players: 'player' };
  for (const pluralKey of Object.keys(apps)) {
    const kind = toSingular[pluralKey] || pluralKey.replace(/s$/, '');
    const list = Array.isArray(apps[pluralKey]) ? apps[pluralKey] : [];
    for (const a of list) {
      rows.push({
        id: a.id || `${kind}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
        kind, status: a.status || 'pending',
        data: a,
        created_at: a.createdAt || new Date().toISOString()
      });
    }
  }
  await upsert('applications', rows);
}

(async () => {
  console.log('🚀 מתחיל מיגרציה ל-Supabase...');
  console.log(`   יעד: ${URL}`);

  // גם שומר את ה-JSONB כגיבוי (platform_state) — כך השרת ממשיך לעבוד מיד
  console.log('📦 שומר גיבוי platform_state (JSONB)...');
  {
    const { error } = await sb.from('platform_state').upsert({
      id: 'singleton', state: db, updated_at: new Date().toISOString()
    }, { onConflict: 'id' });
    if (error) throw error;
    console.log('   ✅ platform_state נשמר');
  }

  console.log('📥 מעביר טבלאות יחסיות...');
  await upsert('clubs',         (db.clubs        || []).map(mapClub));
  await upsert('organizers',    (db.organizers   || []).map(mapOrganizer));
  await upsert('tournaments',   (db.tournaments  || []).map(mapTournament));
  await upsert('registrations', (db.registrations|| []).map(mapRegistration));
  await migrateApplications();

  console.log('✨ הסתיים בהצלחה.');
})().catch(err => { console.error('💥 כשל:', err.message || err); process.exit(1); });
