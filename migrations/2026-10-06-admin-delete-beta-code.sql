-- admin_delete_beta_code: owner-only permanent delete of a beta (trial) code.
-- Safe even for used codes: memberships.beta_code_id is ON DELETE SET NULL,
-- so parents who already redeemed keep their access; the code just disappears.

create or replace function public.admin_delete_beta_code(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public._is_owner() then
    raise exception 'Not allowed';
  end if;
  delete from public.beta_codes where id = p_id;
end;
$$;

revoke all on function public.admin_delete_beta_code(uuid) from public;
grant execute on function public.admin_delete_beta_code(uuid) to authenticated;
