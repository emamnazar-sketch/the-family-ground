-- ============================================================
-- The Family Ground — Supabase schema
-- Run this in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to run more than once (uses IF NOT EXISTS / OR REPLACE).
-- ============================================================

-- ---------- profiles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now()
);

-- ---------- chores ----------
create table if not exists public.chores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kid_label text not null,          -- e.g. "Age 9" or a nickname (never a real name)
  title text not null,              -- e.g. "Make the bed"
  frequency text not null default 'daily',  -- 'daily' | 'weekly'
  created_at timestamptz not null default now()
);

-- ---------- chore_completions ----------
create table if not exists public.chore_completions (
  id uuid primary key default gen_random_uuid(),
  chore_id uuid not null references public.chores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  completed_on date not null,
  created_at timestamptz not null default now(),
  unique (chore_id, completed_on)
);

-- ---------- agreements ----------
create table if not exists public.agreements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Our Family Agreement',
  -- body shape: {"rules": [...], "rewards": [...], "consequences": [...],
  --              "disagree": "...", "signatures": [{"name": "...", "date": "..."}]}
  body jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------- course_progress ----------
create table if not exists public.course_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_slug text not null,
  lesson_slug text not null,
  completed_at timestamptz not null default now(),
  unique (user_id, course_slug, lesson_slug)
);

-- ============================================================
-- Row Level Security: members can only touch their own rows.
-- ============================================================

alter table public.profiles enable row level security;
alter table public.chores enable row level security;
alter table public.chore_completions enable row level security;
alter table public.agreements enable row level security;
alter table public.course_progress enable row level security;

-- profiles: a member can read/update only their own profile.
drop policy if exists "Members manage own profile" on public.profiles;
create policy "Members manage own profile"
  on public.profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- chores
drop policy if exists "Members manage own chores" on public.chores;
create policy "Members manage own chores"
  on public.chores for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- chore_completions
drop policy if exists "Members manage own completions" on public.chore_completions;
create policy "Members manage own completions"
  on public.chore_completions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- agreements
drop policy if exists "Members manage own agreements" on public.agreements;
create policy "Members manage own agreements"
  on public.agreements for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- course_progress
drop policy if exists "Members manage own progress" on public.course_progress;
create policy "Members manage own progress"
  on public.course_progress for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- Parent / kid dashboards (added 2026-09-29)
-- Kids join with a one-time parent code via anonymous sign-in:
-- no email or phone needed for kids.
-- ============================================================

-- ---------- invite_codes ----------
create table if not exists public.invite_codes (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references auth.users(id) on delete cascade,
  code text not null unique,          -- 6-char code, unambiguous charset
  kid_label text not null default '', -- e.g. "Age 9" (never a real name)
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- kid_profiles ----------
create table if not exists public.kid_profiles (
  id uuid primary key references auth.users(id) on delete cascade, -- the kid's anonymous auth user id
  parent_id uuid not null references auth.users(id) on delete cascade,
  kid_label text not null default '',
  created_at timestamptz not null default now()
);

-- ---------- chores: kid assignment columns ----------
alter table public.chores add column if not exists assigned_to uuid references public.kid_profiles(id) on delete set null;
alter table public.chores add column if not exists status text not null default 'assigned'; -- 'assigned' | 'submitted' | 'approved' | 'resubmit'
alter table public.chores add column if not exists proof_required boolean not null default false;
alter table public.chores add column if not exists proof_url text;   -- storage path in chore-proof bucket
alter table public.chores add column if not exists parent_note text; -- note shown to the kid on resubmit

-- ============================================================
-- Row Level Security for the new tables / columns.
-- ============================================================

alter table public.invite_codes enable row level security;
alter table public.kid_profiles enable row level security;

-- invite_codes: parents manage their own codes.
drop policy if exists "Parents manage own invite codes" on public.invite_codes;
create policy "Parents manage own invite codes"
  on public.invite_codes for all
  using (auth.uid() = parent_id)
  with check (auth.uid() = parent_id);

-- invite_codes: anyone signed in (including anonymous kids) can read
-- ACTIVE codes, so a kid can redeem theirs.
drop policy if exists "Anyone can read active codes" on public.invite_codes;
create policy "Anyone can read active codes"
  on public.invite_codes for select
  using (is_active = true);

-- invite_codes: single-use redemption — anyone can flip an active code
-- to inactive, nothing else.
drop policy if exists "Redeem active code" on public.invite_codes;
create policy "Redeem active code"
  on public.invite_codes for update
  using (is_active = true)
  with check (is_active = false);

-- kid_profiles: a parent can read their own kids' rows.
drop policy if exists "Parents read own kids" on public.kid_profiles;
create policy "Parents read own kids"
  on public.kid_profiles for select
  using (auth.uid() = parent_id);

-- kid_profiles: a kid can manage their own row (lets anonymous
-- sign-in create the row on first code redemption).
drop policy if exists "Kids manage own profile" on public.kid_profiles;
create policy "Kids manage own profile"
  on public.kid_profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- chores: kids can SELECT and UPDATE chores assigned to them
-- (parent's own "Members manage own chores" policy still covers parents).
drop policy if exists "Kids read assigned chores" on public.chores;
create policy "Kids read assigned chores"
  on public.chores for select
  using (auth.uid() = assigned_to);

drop policy if exists "Kids update assigned chores" on public.chores;
create policy "Kids update assigned chores"
  on public.chores for update
  using (auth.uid() = assigned_to)
  with check (auth.uid() = assigned_to);

-- ============================================================
-- Storage: chore-proof bucket (private). Path convention:
-- {kid_user_id}/{chore_id}.jpg
-- ============================================================

insert into storage.buckets (id, name, public)
values ('chore-proof', 'chore-proof', false)
on conflict (id) do nothing;

drop policy if exists "Kids upload own proof" on storage.objects;
create policy "Kids upload own proof"
  on storage.objects for insert
  with check (
    bucket_id = 'chore-proof'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Kids read own proof" on storage.objects;
create policy "Kids read own proof"
  on storage.objects for select
  using (
    bucket_id = 'chore-proof'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Parents read kids proof" on storage.objects;
create policy "Parents read kids proof"
  on storage.objects for select
  using (
    bucket_id = 'chore-proof'
    and exists (
      select 1 from public.kid_profiles kp
      where kp.id::text = (storage.foldername(name))[1]
        and kp.parent_id = auth.uid()
    )
  );
