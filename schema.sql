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

-- ---------- onboarding (welcome questionnaire) ----------
create table if not exists public.onboarding (
  user_id uuid primary key references auth.users(id) on delete cascade,
  kids_ages jsonb not null default '[]'::jsonb,  -- e.g. [9, 9, 13]
  struggle text,                                  -- 'screens' | 'chores' | 'calm' | 'close'
  completed_at timestamptz,
  created_at timestamptz not null default now()
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

-- onboarding: members manage their own row.
alter table public.onboarding enable row level security;
drop policy if exists "Members manage own onboarding" on public.onboarding;
create policy "Members manage own onboarding"
  on public.onboarding for all
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
-- The Family Ground — Trial codes + memberships + paywall gate
-- Run in Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to run more than once (IF NOT EXISTS / OR REPLACE / DROP IF EXISTS).
-- Date: 2026-10-05
-- ============================================================

-- ---------- beta_codes ----------
-- Free-access codes Amam hands out. Each code carries its own trial length.
create table if not exists public.beta_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,          -- e.g. "FAMILY30" (auto-uppercased, A-Z0-9)
  duration_days int not null default 30,
  max_uses int,                       -- null = unlimited uses
  used_count int not null default 0,
  is_active boolean not null default true,
  note text,                          -- e.g. "Cousins — October testers"
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- memberships ----------
-- One row per parent: trial or paid state. The paywall gate reads this.
create table if not exists public.memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'trialing',  -- 'trialing' | 'active' | 'past_due' | 'canceled'
  trial_ends_at timestamptz,
  beta_code_id uuid references public.beta_codes(id) on delete set null,
  stripe_customer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.beta_codes enable row level security;
alter table public.memberships enable row level security;

-- memberships: a member can READ their own row. Writes happen only
-- through SECURITY DEFINER functions / service role (so nobody can
-- extend their own trial by hand).
drop policy if exists "Members read own membership" on public.memberships;
create policy "Members read own membership"
  on public.memberships for select
  using (auth.uid() = user_id);

-- beta_codes: NO direct table access for members at all (RLS on, no
-- policies). All code operations go through the functions below.

-- ---------- redeem_beta_code ----------
-- Parent enters a code -> gets a trialing membership for duration_days.
-- Atomic: validates, burns one use, creates/refreshes the membership.
create or replace function public.redeem_beta_code(p_code text)
returns table (trial_ends_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code public.beta_codes%rowtype;
  v_end timestamptz;
  v_existing public.memberships%rowtype;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  -- Already trialing? Return the current end date without burning a use.
  select * into v_existing from public.memberships where user_id = v_uid;
  if found and v_existing.status = 'trialing'
     and v_existing.trial_ends_at is not null
     and v_existing.trial_ends_at > now() then
    trial_ends_at := v_existing.trial_ends_at;
    return next;
    return;
  end if;

  select * into v_code from public.beta_codes
    where code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
      and is_active = true
    for update;
  if not found then
    raise exception 'Invalid code';
  end if;
  if v_code.max_uses is not null and v_code.used_count >= v_code.max_uses then
    raise exception 'Code fully used';
  end if;

  v_end := now() + (v_code.duration_days || ' days')::interval;

  update public.beta_codes
    set used_count = used_count + 1
    where id = v_code.id;

  insert into public.memberships (user_id, status, trial_ends_at, beta_code_id, updated_at)
    values (v_uid, 'trialing', v_end, v_code.id, now())
  on conflict (user_id) do update set
    status = 'trialing',
    trial_ends_at = excluded.trial_ends_at,
    beta_code_id = excluded.beta_code_id,
    updated_at = now();

  trial_ends_at := v_end;
  return next;
end;
$$;

revoke all on function public.redeem_beta_code(text) from public;
grant execute on function public.redeem_beta_code(text) to authenticated;

-- ---------- owner-only code management ----------
-- Only the site owner can create / list / toggle codes.
-- (Checked by login email inside each SECURITY DEFINER function.)

create or replace function public._is_owner()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  return lower(coalesce((auth.jwt() ->> 'email'), '')) in
    ('emamnazar@gmail.com', 'thefamilyground@gmail.com');
end;
$$;

create or replace function public.admin_create_beta_code(
  p_code text, p_days int, p_max_uses int, p_note text
)
returns table (id uuid, code text, duration_days int, max_uses int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clean text;
begin
  if not public._is_owner() then
    raise exception 'Not allowed';
  end if;
  v_clean := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if v_clean is null or length(v_clean) < 4 then
    raise exception 'Code must be at least 4 letters/numbers';
  end if;
  return query
    insert into public.beta_codes (code, duration_days, max_uses, note, created_by)
    values (v_clean, greatest(1, coalesce(p_days, 30)), p_max_uses, nullif(p_note, ''), auth.uid())
    returning public.beta_codes.id, public.beta_codes.code,
              public.beta_codes.duration_days, public.beta_codes.max_uses;
end;
$$;

revoke all on function public.admin_create_beta_code(text, int, int, text) from public;
grant execute on function public.admin_create_beta_code(text, int, int, text) to authenticated;

create or replace function public.admin_list_beta_codes()
returns table (
  id uuid, code text, duration_days int, max_uses int, used_count int,
  is_active boolean, note text, created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public._is_owner() then
    raise exception 'Not allowed';
  end if;
  return query
    select bc.id, bc.code, bc.duration_days, bc.max_uses, bc.used_count,
           bc.is_active, bc.note, bc.created_at
    from public.beta_codes bc
    order by bc.created_at desc;
end;
$$;

revoke all on function public.admin_list_beta_codes() from public;
grant execute on function public.admin_list_beta_codes() to authenticated;

create or replace function public.admin_toggle_beta_code(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public._is_owner() then
    raise exception 'Not allowed';
  end if;
  update public.beta_codes set is_active = p_active where id = p_id;
end;
$$;

revoke all on function public.admin_toggle_beta_code(uuid, boolean) from public;
grant execute on function public.admin_toggle_beta_code(uuid, boolean) to authenticated;

-- ============================================================
-- 2026-10-05: redeem_invite_code — reattach fix
-- If a kid rejoins with a fresh code on a new device/session (new
-- anonymous auth id), reattach their existing kid row instead of
-- creating a duplicate "TestKid"-style card and orphaning chores.
-- Only reattaches when the parent has EXACTLY ONE kid row with that
-- label (twins with the same label are left alone).
-- ============================================================

create or replace function public.redeem_invite_code(p_code text)
returns table (parent_id uuid, kid_label text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_parent uuid;
  v_label text;
  v_old_id uuid;
  v_match_count int;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  select ic.parent_id, ic.kid_label into v_parent, v_label
  from public.invite_codes ic
  where ic.code = p_code and ic.is_active = true
  for update;
  if not found then
    raise exception 'Invalid or used code';
  end if;
  update public.invite_codes set is_active = false where code = p_code;

  -- Reattach: exactly one existing kid row for this parent+label under a
  -- different auth id (kid got a new device/session) -> move it over to
  -- the new anonymous user instead of duplicating.
  select count(*), max(kp.id) into v_match_count, v_old_id
  from public.kid_profiles kp
  where kp.parent_id = v_parent
    and kp.kid_label = v_label
    and kp.id != v_uid;
  if v_match_count = 1 then
    update public.chores set assigned_to = v_uid where assigned_to = v_old_id;
    delete from public.kid_profiles where id = v_old_id;
  end if;

  parent_id := v_parent;
  kid_label := v_label;
  return next;
end;
$$;

revoke all on function public.redeem_invite_code(text) from public;
grant execute on function public.redeem_invite_code(text) to authenticated;

