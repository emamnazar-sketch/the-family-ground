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
