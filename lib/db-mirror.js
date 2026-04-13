// Mirror: אחרי כל saveDB ל-platform_state, נכתוב גם לטבלאות יחסיות
// כך שהטבלאות tournaments/clubs/organizers/registrations/applications
// יישארו מסונכרנות עם האמת (ה-JSONB). שיקוף חד-כיווני בלבד.
// ה-UI של האתר המקורי לא משתנה.

const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ENABLED = !!(URL && KEY);
let client = null;
if (ENABLED) client = createClient(URL, KEY, { auth: { persistSession: false } });

async function mirrorDb(db) {
  if (!ENABLED || !db) return;
  try {
    await Promise.all([
      mirrorClubs(db.clubs || []),
      mirrorOrganizers(db.organizers || []),
      mirrorTournaments(db.tournaments || []),
      mirrorRegistrations(db.registrations || []),
      mirrorApplications(db.applications || {})
    ]);
  } catch (e) {
    // לא מפילים את השמירה המרכזית — ה-mirror הוא best-effort
    console.warn('[db-mirror] ' + e.message);
  }
}

async function mirrorClubs(clubs) {
  if (!clubs.length) return;
  const rows = clubs.map(cl => ({
    id: cl.id,
    slug: cl.slug || cl.id,
    name: cl.name,
    city: cl.city || null,
    description: cl.description || null,
    short_description: cl.shortDescription || cl.short_description || null,
    image: cl.image || null,
    contact_email: cl.contactEmail || cl.contact_email || null,
    contact_phone: cl.contactPhone || cl.contact_phone || null,
    status: cl.status || 'active',
    meta: stripCore(cl, ['id', 'slug', 'name'])
  }));
  const { error } = await client.from('clubs').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error('clubs: ' + error.message);
}

async function mirrorOrganizers(list) {
  if (!list.length) return;
  const rows = list.map(o => ({
    id: o.id,
    slug: o.slug || o.id,
    name: o.name,
    contact_person: o.contactPerson || o.contact_person || null,
    email: o.email || null,
    phone: o.phone || null,
    whatsapp: o.whatsapp || null,
    business: o.business || {},
    status: o.status || 'active',
    meta: stripCore(o, ['id', 'slug', 'name'])
  }));
  const { error } = await client.from('organizers').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error('organizers: ' + error.message);
}

async function mirrorTournaments(list) {
  if (!list.length) return;
  const rows = list.map(t => ({
    id: t.id,
    slug: t.slug || t.id,
    title: t.title,
    subtitle: t.subtitle || null,
    club_id: t.clubId || t.club_id || null,
    organizer_id: t.organizerId || t.organizer_id || null,
    description: t.description || null,
    date: t.date || null,
    location: t.location || null,
    format: t.format || {},
    pricing: t.pricing || {},
    payment: t.payment || {},
    refund_policy: t.refundPolicy || t.refund_policy || null,
    require_health_declaration: !!(t.requireHealthDeclaration || t.require_health_declaration),
    health_form_url: t.healthFormUrl || t.health_form_url || null,
    status: t.status || 'draft',
    visibility: t.visibility || 'public',
    meta: stripCore(t, ['id', 'slug', 'title', 'format', 'pricing', 'payment'])
  }));
  const { error } = await client.from('tournaments').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error('tournaments: ' + error.message);
}

async function mirrorRegistrations(list) {
  if (!list.length) return;
  const rows = list.map(r => ({
    id: r.id,
    tournament_id: r.tournamentId || r.tournament_id || null,
    status: r.status || 'awaiting_payment',
    full_name: r.fullName || r.full_name || r.name || '—',
    phone: r.phone || null,
    email: r.email || null,
    level: r.level || null,
    partner_name: r.partnerName || r.partner_name || null,
    partner_phone: r.partnerPhone || r.partner_phone || null,
    notes: r.notes || null,
    health_file: r.healthFile || null,
    payment_proof: r.paymentProof || null,
    history: r.history || [],
    meta: stripCore(r, ['id', 'tournamentId', 'status', 'fullName'])
  }));
  const { error } = await client.from('registrations').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error('registrations: ' + error.message);
}

async function mirrorApplications(apps) {
  const all = [];
  for (const kind of ['organizers', 'clubs', 'players']) {
    for (const a of (apps[kind] || [])) {
      if (!a.id) continue;
      all.push({
        id: a.id,
        kind: kind === 'organizers' ? 'organizer' : kind === 'clubs' ? 'club' : 'player',
        status: a.status || 'pending',
        data: a
      });
    }
  }
  if (!all.length) return;
  const { error } = await client.from('applications').upsert(all, { onConflict: 'id' });
  if (error) throw new Error('applications: ' + error.message);
}

function stripCore(obj, keys) {
  const out = { ...obj };
  for (const k of keys) delete out[k];
  return out;
}

module.exports = { mirrorDb, ENABLED };
