-- ============================================================
-- 2026-10-05: Admin dashboard functions (owner-only)
-- admin_stats: headline numbers for the admin overview.
-- admin_list_users: every parent (non-anonymous) user with profile,
--   kids count, and membership state. Reads auth.users securely.
-- admin_extend_trial: add days to a user's trial (support gesture).
-- All gated by public._is_owner() (emamnazar@gmail.com,
-- thefamilyground@gmail.com).
-- ============================================================

create or replace function public.admin_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public._is_owner() then
    raise exception 'Not allowed';
  end if;
  return jsonb_build_object(
    'parents', (select count(*) from auth.users where coalesce(is_anonymous, false) = false),
    'kids', (select count(*) from public.kid_profiles),
    'chores', (select count(*) from public.chores),
    'chores_done', (select count(*) from public.chores where status = 'approved'),
    'agreements', (select count(*) from public.agreements),
    'trials', (select count(*) from public.memberships
                where status = 'trialing'
                  and (trial_ends_at is null or trial_ends_at > now())),
    'trials_expiring_7d', (select count(*) from public.memberships
                where status = 'trialing'
                  and trial_ends_at is not null
                  and trial_ends_at > now()
                  and trial_ends_at < now() + interval '7 days'),
    'paid', (select count(*) from public.memberships where status = 'active'),
    'codes', (select count(*) from public.beta_codes where is_active = true),
    'code_uses', (select coalesce(sum(used_count), 0) from public.beta_codes)
  );
end;
$$;

revoke all on function public.admin_stats() from public;
grant execute on function public.admin_stats() to authenticated;

create or replace function public.admin_list_users()
returns table (
  id uuid,
  email text,
  full_name text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  kids int,
  mem_status text,
  trial_ends_at timestamptz
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
    select u.id,
           u.email,
           p.full_name,
           u.created_at,
           u.last_sign_in_at,
           (select count(*)::int from public.kid_profiles kp where kp.parent_id = u.id),
           m.status,
           m.trial_ends_at
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join public.memberships m on m.user_id = u.id
    where coalesce(u.is_anonymous, false) = false
    order by u.created_at desc
    limit 500;
end;
$$;

revoke all on function public.admin_list_users() from public;
grant execute on function public.admin_list_users() to authenticated;

create or replace function public.admin_extend_trial(p_user_id uuid, p_days int)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_end timestamptz;
begin
  if not public._is_owner() then
    raise exception 'Not allowed';
  end if;
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'Days must be between 1 and 365';
  end if;
  update public.memberships
  set trial_ends_at = greatest(coalesce(trial_ends_at, now()), now())
                       + (p_days || ' days')::interval,
      status = 'trialing',
      updated_at = now()
  where user_id = p_user_id
  returning trial_ends_at into v_end;
  if not found then
    raise exception 'No membership for that user';
  end if;
  return v_end;
end;
$$;

revoke all on function public.admin_extend_trial(uuid, int) from public;
grant execute on function public.admin_extend_trial(uuid, int) to authenticated;
