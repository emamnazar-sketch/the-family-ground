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
