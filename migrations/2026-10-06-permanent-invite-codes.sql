-- ============================================================
-- 2026-10-06: permanent kid invite codes (v3 of redeem_invite_code)
--
-- WHY: one-time codes are the wrong tool for a kid's daily login.
-- When a kid's anonymous session died, recovery needed a brand-new
-- parent code every time — parents can't troubleshoot, it must
-- just work. Now each kid keeps ONE permanent code:
--   - codes NO LONGER BURN on redeem (the is_active=false line is gone)
--   - rejoining (new device, dead session) reattaches the existing
--     kid row, preserving chores AND affirmation check-ins
--   - parents revoke/replace via the dashboard "New code" button,
--     which deactivates the old code (is_active=false still honored)
-- Run: paste this whole file into Supabase Dashboard -> SQL Editor
-- -> New query -> Run.
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
    raise exception 'Invalid or replaced code';
  end if;
  -- 2026-10-06: codes are permanent — no burn on redeem.

  -- Already has a row (double-submit / same-session rejoin)? Return it.
  perform 1 from public.kid_profiles kp where kp.id = v_uid;
  if found then
    parent_id := v_parent;
    kid_label := v_label;
    return next;
    return;
  end if;

  -- Reattach: exactly one existing kid row for this parent+label under a
  -- different auth id -> move it over to the new anonymous user,
  -- preserving chores and affirmation history.
  select count(*) into v_match_count
  from public.kid_profiles kp
  where kp.parent_id = v_parent
    and kp.kid_label = v_label
    and kp.id != v_uid;

  if v_match_count = 1 then
    select kp.id into v_old_id
    from public.kid_profiles kp
    where kp.parent_id = v_parent
      and kp.kid_label = v_label
      and kp.id != v_uid
    limit 1;
    -- Create the new row FIRST so the FKs are satisfied (carry age_band over).
    insert into public.kid_profiles (id, parent_id, kid_label, age_band)
    select v_uid, v_parent, v_label, kp.age_band
    from public.kid_profiles kp where kp.id = v_old_id
    on conflict (id) do nothing;
    update public.chores set assigned_to = v_uid where assigned_to = v_old_id;
    -- Move affirmation history BEFORE deleting the old row
    -- (check-ins cascade-delete with the kid row).
    update public.affirmation_checkins set kid_id = v_uid where kid_id = v_old_id;
    delete from public.kid_profiles where id = v_old_id;
  else
    insert into public.kid_profiles (id, parent_id, kid_label)
    values (v_uid, v_parent, v_label)
    on conflict (id) do nothing;
  end if;

  parent_id := v_parent;
  kid_label := v_label;
  return next;
end;
$$;

revoke all on function public.redeem_invite_code(text) from public;
grant execute on function public.redeem_invite_code(text) to authenticated;
