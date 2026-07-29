
create or replace function public.propagate_payhip_status(_email text, _is_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid;
begin
  select id into _uid from auth.users where lower(email) = lower(_email) limit 1;
  if _uid is not null then
    update public.profiles set is_payhip_subscriber = _is_active where id = _uid;
  end if;
end;
$$;

revoke all on function public.propagate_payhip_status(text, boolean) from public, anon, authenticated;
grant execute on function public.propagate_payhip_status(text, boolean) to service_role;
