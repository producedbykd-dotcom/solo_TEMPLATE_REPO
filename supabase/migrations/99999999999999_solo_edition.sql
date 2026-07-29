-- Release Engine — Solo Edition
-- Strips every multi-tenant / SaaS artefact out of the database and locks the
-- installation down to a single owner. Runs last, after all base migrations.

-- 1. Drop SaaS-only tables (billing, metering, tenant signup capture).
drop table if exists public.credit_ledger cascade;
drop table if exists public.user_credits cascade;
drop table if exists public.credit_topups cascade;
drop table if exists public.subscriptions cascade;
drop table if exists public.billing_plans cascade;
drop table if exists public.payhip_subscriptions cascade;
drop table if exists public.notify_signups cascade;
drop table if exists public.marketing_assets cascade;
drop table if exists public.solo_licenses cascade;

-- 2. Drop the metering / entitlement functions.
drop function if exists public.user_entitlement(uuid);
drop function if exists public.grant_credits(uuid, bigint, text, bigint, uuid, uuid, jsonb);
drop function if exists public.spend_credits(uuid, bigint, text, jsonb, uuid);
drop function if exists public.refund_credits(uuid, text);
drop function if exists public.get_credit_history(integer);
drop function if exists public.propagate_payhip_status(text, boolean);

-- 3. Drop the SaaS billing enums (now unreferenced).
drop type if exists public.billing_tier cascade;
drop type if exists public.billing_interval cascade;
drop type if exists public.subscription_status cascade;

-- 4. The profile no longer tracks external subscription state.
alter table public.profiles drop column if exists is_payhip_subscriber;

-- 5. Replace the new-user trigger function with a single-owner version:
--    it creates the profile and refuses a second account outright.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  existing_count integer;
begin
  select count(*) into existing_count from public.profiles;
  if existing_count >= 1 then
    raise exception 'This is a single-owner installation. An owner account already exists.';
  end if;

  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- 6. Hard guard: block any insert that would create a second profile,
--    regardless of how the row arrives.
create or replace function public.enforce_single_owner()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  existing_count integer;
begin
  select count(*) into existing_count from public.profiles;
  if existing_count >= 1 then
    raise exception 'Single-owner installation: a second account is not permitted.';
  end if;
  return new;
end;
$$;

drop trigger if exists single_owner_guard on public.profiles;
create trigger single_owner_guard
  before insert on public.profiles
  for each row execute function public.enforce_single_owner();