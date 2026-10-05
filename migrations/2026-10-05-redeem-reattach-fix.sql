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
