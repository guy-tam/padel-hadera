-- ==================================================================
-- פאדל חדרה — Supabase Schema (מודל יחסי אמיתי)
-- ==================================================================
-- הרצה ראשונה: העתק/י את כל הקובץ והדבק/י ב-SQL Editor של Supabase.
-- אידמפוטנטי — אפשר להריץ שוב ושוב בלי נזק.
-- ==================================================================

create extension if not exists pgcrypto;

-- ==================================================================
-- גיבוי JSONB (legacy) — נשאר לתאימות אחורה ולמצבי חירום.
-- ==================================================================
create table if not exists public.platform_state (
  id         text primary key,
  state      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.platform_state enable row level security;
drop policy if exists "service only read"  on public.platform_state;
drop policy if exists "service only write" on public.platform_state;
create policy "service only read"  on public.platform_state for select to service_role using (true);
create policy "service only write" on public.platform_state for all    to service_role using (true) with check (true);

-- ==================================================================
-- Clubs — מועדוני פאדל
-- ==================================================================
create table if not exists public.clubs (
  id                text primary key,
  slug              text unique not null,
  name              text not null,
  city              text,
  description       text,
  short_description text,
  image             text,
  contact_email     text,
  contact_phone     text,
  status            text not null default 'active',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  meta              jsonb not null default '{}'::jsonb
);
create index if not exists idx_clubs_status on public.clubs(status);
create index if not exists idx_clubs_slug   on public.clubs(slug);

-- ==================================================================
-- Organizers — מארגני טורנירים
-- ==================================================================
create table if not exists public.organizers (
  id             text primary key,
  slug           text unique,
  name           text not null,
  contact_person text,
  email          text,
  phone          text,
  whatsapp       text,
  business       jsonb not null default '{}'::jsonb,
  status         text not null default 'active',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  meta           jsonb not null default '{}'::jsonb
);
create index if not exists idx_organizers_status on public.organizers(status);
create index if not exists idx_organizers_email  on public.organizers(email);

-- ==================================================================
-- Tournaments — טורנירים
-- ==================================================================
create table if not exists public.tournaments (
  id                         text primary key,
  slug                       text unique not null,
  title                      text not null,
  subtitle                   text,
  club_id                    text references public.clubs(id)      on delete set null,
  organizer_id               text references public.organizers(id) on delete set null,
  description                text,
  date                       text,
  location                   text,
  format                     jsonb not null default '{}'::jsonb,
  pricing                    jsonb not null default '{}'::jsonb,
  payment                    jsonb not null default '{}'::jsonb,
  refund_policy              text,
  require_health_declaration boolean not null default false,
  health_form_url            text,
  status                     text not null default 'draft',
  visibility                 text not null default 'public',
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  meta                       jsonb not null default '{}'::jsonb
);
create index if not exists idx_tournaments_club      on public.tournaments(club_id);
create index if not exists idx_tournaments_organizer on public.tournaments(organizer_id);
create index if not exists idx_tournaments_status    on public.tournaments(status);
create index if not exists idx_tournaments_visible   on public.tournaments(visibility);

-- ==================================================================
-- Registrations — הרשמות לטורניר
-- ==================================================================
create table if not exists public.registrations (
  id             text primary key,
  tournament_id  text references public.tournaments(id) on delete cascade,
  status         text not null default 'awaiting_payment',
  full_name      text not null,
  phone          text,
  email          text,
  level          text,
  partner_name   text,
  partner_phone  text,
  notes          text,
  health_file    jsonb,
  payment_proof  jsonb,
  history        jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  meta           jsonb not null default '{}'::jsonb
);
create index if not exists idx_reg_tournament on public.registrations(tournament_id);
create index if not exists idx_reg_status     on public.registrations(status);
create index if not exists idx_reg_email      on public.registrations(email);
create index if not exists idx_reg_phone      on public.registrations(phone);

-- ==================================================================
-- Applications — בקשות הצטרפות (מארגנים/מועדונים/שחקנים)
-- ==================================================================
create table if not exists public.applications (
  id         text primary key default gen_random_uuid()::text,
  kind       text not null check (kind in ('organizer','club','player')),
  status     text not null default 'pending',
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_apps_kind   on public.applications(kind);
create index if not exists idx_apps_status on public.applications(status);

-- ==================================================================
-- Uploads — רשומות של קבצים ב-Storage
-- ==================================================================
create table if not exists public.uploads (
  id              text primary key default gen_random_uuid()::text,
  registration_id text references public.registrations(id) on delete cascade,
  kind            text not null,                 -- 'health' | 'payment' | ...
  bucket          text not null default 'uploads',
  path            text not null,                 -- הנתיב ב-bucket
  original_name   text,
  size_bytes      integer,
  mime_type       text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_uploads_reg on public.uploads(registration_id);

-- ==================================================================
-- עדכון אוטומטי של updated_at
-- ==================================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['clubs','organizers','tournaments','registrations','applications']
  loop
    execute format('drop trigger if exists trg_%1$I_touch on public.%1$I;', t);
    execute format('create trigger trg_%1$I_touch before update on public.%1$I
                    for each row execute function public.touch_updated_at();', t);
  end loop;
end $$;

-- ==================================================================
-- RLS — service_role בלבד (השרת שלנו). ללקוח לעולם אין גישה ישירה.
-- ==================================================================
do $$
declare t text;
begin
  foreach t in array array['clubs','organizers','tournaments','registrations','applications','uploads']
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "service all" on public.%I;', t);
    execute format('create policy "service all" on public.%I for all to service_role using (true) with check (true);', t);
  end loop;
end $$;

-- ==================================================================
-- Storage bucket 'uploads' (private) — יצירה אידמפוטנטית
-- ==================================================================
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', false)
on conflict (id) do nothing;
