-- Profiles + role-based auth לפלטפורמה החדשה ב-/web
-- הרצה ידנית ב-Supabase SQL Editor (או דרך CLI). אידמפוטנטי.

-- 1. enum לתפקיד
do $$ begin
  create type public.user_role as enum ('player', 'organizer', 'club', 'admin');
exception when duplicate_object then null; end $$;

-- 2. טבלת פרופילים — id אחד-לאחד מול auth.users, קישורים TEXT לישויות הקיימות
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  phone text,
  role public.user_role not null default 'player',
  -- קישורים לטבלאות הקיימות — הערה: clubs/organizers.id הם TEXT בסכמה
  club_id text references public.clubs(id) on delete set null,
  organizer_id text references public.organizers(id) on delete set null,
  player_id text, -- קישור רך ל-registrations.id האחרון
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists profiles_role_idx on public.profiles(role);
create index if not exists profiles_club_idx on public.profiles(club_id);
create index if not exists profiles_organizer_idx on public.profiles(organizer_id);

-- 3. RLS — משתמש רואה/מעדכן רק את הפרופיל שלו; service_role כבר שולט
alter table public.profiles enable row level security;
drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles for select using (auth.uid() = id);
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update using (auth.uid() = id);
drop policy if exists profiles_self_insert on public.profiles;
create policy profiles_self_insert on public.profiles for insert with check (auth.uid() = id);

-- 4. טריגר signup אוטומטי — יוצר profile עם role מ-metadata
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role public.user_role;
begin
  v_role := coalesce((new.raw_user_meta_data->>'role')::public.user_role, 'player');
  insert into public.profiles (id, email, full_name, phone, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'phone',
    v_role
  ) on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- 5. מדיניות קריאה ציבורית לטורנירים ומועדונים (לצד service_role הקיים)
drop policy if exists tournaments_public_read on public.tournaments;
create policy tournaments_public_read on public.tournaments
  for select to anon, authenticated using (status = 'published' and visibility = 'public');

drop policy if exists clubs_public_read on public.clubs;
create policy clubs_public_read on public.clubs
  for select to anon, authenticated using (status = 'active');

drop policy if exists organizers_public_read on public.organizers;
create policy organizers_public_read on public.organizers
  for select to anon, authenticated using (status = 'active');
