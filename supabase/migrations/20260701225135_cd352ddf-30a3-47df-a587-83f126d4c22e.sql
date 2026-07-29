CREATE OR REPLACE FUNCTION public.user_entitlement(_user_id uuid)
 RETURNS TABLE(entitled boolean, source text, tier text, uploads_remaining integer, ai_regens_remaining integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  sub record;
  is_payhip boolean := false;
begin
  select * into sub from public.subscriptions where user_id = _user_id;
  select coalesce(is_payhip_subscriber, false) into is_payhip from public.profiles where id = _user_id;

  if sub.id is not null and sub.status = 'active' and sub.kind = 'subscription' then
    return query select true,
      'subscription'::text,
      sub.tier::text,
      case
        when sub.tier = 'label' then NULL
        when sub.tier = 'pro' then greatest(75 - sub.uploads_this_period, 0)
        when sub.tier = 'starter' then greatest(35 - sub.uploads_this_period, 0)
        else 0
      end,
      NULL::integer;
    return;
  end if;

  if sub.id is not null and sub.status = 'active' and sub.kind = 'test_drive' then
    return query select true,
      'test_drive'::text,
      'test_drive'::text,
      greatest(1 - sub.test_drive_uploads_used, 0),
      greatest(1 - sub.test_drive_analysis_regens_used, 0)
        + greatest(20 - sub.test_drive_image_regens_used, 0);
    return;
  end if;

  if is_payhip then
    return query select true,
      'payhip'::text,
      'starter'::text,
      case when sub.id is not null then greatest(35 - sub.uploads_this_period, 0) else 35 end,
      NULL::integer;
    return;
  end if;

  return query select false, NULL::text, NULL::text, 0, 0;
end;
$function$;