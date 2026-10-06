-- Trial-reminder cron support: token-gated candidate lookup + send logging.
-- Run in the Supabase SQL Editor (project "The Family Ground", org "Apex Locals").
-- Statement 1 must run first (sets the shared token the cron presents).

-- STATEMENT 1
alter database postgres set app.trial_reminder_token = 'b4d2d8f634a979fde07b5ce757a797643ca884bbc4ba1187';

-- STATEMENT 2
create table if not exists public.email_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email_type text not null,
  sent_at timestamptz not null default now(),
  recipient_email text,
  unique (user_id, email_type)
);

alter table public.email_log enable row level security;

create or replace function public.trial_reminder_candidates(p_token text)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_token text := current_setting('app.trial_reminder_token', true);
begin
  if v_token is null or p_token != v_token then
    raise exception 'not allowed';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', m.user_id,
      'email', u.email,
      'name', coalesce(nullif(trim(both from u.raw_user_meta_data->>'full_name'), ''), split_part(u.email, '@', 1)),
      'trial_ends_at', m.trial_ends_at,
      'type', case when m.trial_ends_at::date = current_date + 3 then 'trial_expiring_3d' else 'trial_ended' end
    ))
    from public.memberships m
    join auth.users u on u.id = m.user_id
    where m.status = 'trialing'
      and m.trial_ends_at::date in (current_date + 3, current_date)
      and not exists (
        select 1 from public.email_log e
        where e.user_id = m.user_id
          and e.email_type = case when m.trial_ends_at::date = current_date + 3 then 'trial_expiring_3d' else 'trial_ended' end
      )
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.trial_reminder_candidates(text) from public;
grant execute on function public.trial_reminder_candidates(text) to anon, authenticated;

create or replace function public.trial_reminder_logged(p_token text, p_user_id uuid, p_type text, p_email text)
returns void
language plpgsql
security definer
as $$
declare
  v_token text := current_setting('app.trial_reminder_token', true);
begin
  if v_token is null or p_token != v_token then
    raise exception 'not allowed';
  end if;
  insert into public.email_log (user_id, email_type, recipient_email)
  values (p_user_id, p_type, p_email)
  on conflict (user_id, email_type) do nothing;
end;
$$;

revoke all on function public.trial_reminder_logged(text, uuid, text, text) from public;
grant execute on function public.trial_reminder_logged(text, uuid, text, text) to anon, authenticated;

-- VERIFICATION (must return 2):
-- select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('trial_reminder_candidates','trial_reminder_logged');
-- Also confirm public.email_log exists (empty is expected).
