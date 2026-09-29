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

-- invite_codes: single-use redemption happens through an atomic
-- SECURITY DEFINER function (avoids cross-user RLS update quirks and
-- double-redeem races). Kids call it via rpc("redeem_invite_code").
drop policy if exists "Redeem active code" on public.invite_codes;
drop policy if exists "Redeemers deactivate used code" on public.invite_codes;

create or replace function public.redeem_invite_code(p_code text)
returns table (parent_id uuid, kid_label text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent uuid;
  v_label text;
begin
  select ic.parent_id, ic.kid_label into v_parent, v_label
  from public.invite_codes ic
  where ic.code = p_code and ic.is_active = true
  for update;
  if not found then
    raise exception 'Invalid or used code';
  end if;
  update public.invite_codes set is_active = false where code = p_code;
  parent_id := v_parent;
  kid_label := v_label;
  return next;
end;
$$;

revoke all on function public.redeem_invite_code(text) from public;
grant execute on function public.redeem_invite_code(text) to authenticated;

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

-- ============================================================
-- Membership via Stripe (added 2026-09-29)
-- $9.99/month recurring. The webhook (service_role) is the only
-- writer of the membership columns; a trigger blocks everyone else.
-- Run in the Supabase SQL editor (safe to re-run).
-- ============================================================

alter table public.profiles add column if not exists membership_status text not null default 'none';
alter table public.profiles add column if not exists stripe_customer_id text;
alter table public.profiles add column if not exists stripe_subscription_id text;
alter table public.profiles add column if not exists membership_updated_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_membership_status_check') then
    alter table public.profiles
      add constraint profiles_membership_status_check
      check (membership_status in ('none', 'active', 'past_due', 'canceled'));
  end if;
end $$;

create unique index if not exists profiles_stripe_customer_id_key
  on public.profiles (stripe_customer_id);

-- Replace the broad "for all" profile policy with read/insert/update,
-- so members can still edit their own name but never their membership.
drop policy if exists "Members manage own profile" on public.profiles;

drop policy if exists "Members read own profile" on public.profiles;
create policy "Members read own profile"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "Members insert own profile" on public.profiles;
create policy "Members insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "Members update own profile" on public.profiles;
create policy "Members update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Only the service_role (the Stripe webhook) may change membership columns.
create or replace function public.protect_membership_columns()
returns trigger
language plpgsql
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    new.membership_status      := old.membership_status;
    new.stripe_customer_id     := old.stripe_customer_id;
    new.stripe_subscription_id := old.stripe_subscription_id;
    new.membership_updated_at  := old.membership_updated_at;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_membership_columns on public.profiles;
create trigger protect_membership_columns
  before update on public.profiles
  for each row execute function public.protect_membership_columns();
