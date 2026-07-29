
-- Expand enums
ALTER TYPE public.billing_tier ADD VALUE IF NOT EXISTS 'test_drive';
ALTER TYPE public.billing_interval ADD VALUE IF NOT EXISTS 'one_time';

-- Subscription kind + Test Drive counters
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'subscription',
  ADD COLUMN IF NOT EXISTS test_drive_uploads_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS test_drive_analysis_regens_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS test_drive_image_regens_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS square_payment_link_id text;

-- Payhip subscriber flag on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_payhip_subscriber boolean NOT NULL DEFAULT false;

-- Payhip subscriptions ledger (keyed by email so it works pre-signup)
CREATE TABLE IF NOT EXISTS public.payhip_subscriptions (
  customer_email text PRIMARY KEY,
  is_active boolean NOT NULL DEFAULT true,
  payhip_event_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.payhip_subscriptions TO authenticated;
GRANT ALL ON public.payhip_subscriptions TO service_role;
ALTER TABLE public.payhip_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role manages payhip subscriptions"
  ON public.payhip_subscriptions FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER trg_payhip_subscriptions_updated_at BEFORE UPDATE ON public.payhip_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Release compilations (combine multiple tracks into a single video)
CREATE TABLE IF NOT EXISTS public.release_compilations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  ordered_track_ids uuid[] NOT NULL,
  cover_image_path text,
  output_storage_path text,
  status text NOT NULL DEFAULT 'draft',
  duration_sec numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.release_compilations TO authenticated;
GRANT ALL ON public.release_compilations TO service_role;
ALTER TABLE public.release_compilations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their compilations"
  ON public.release_compilations FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER trg_release_compilations_updated_at BEFORE UPDATE ON public.release_compilations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Update handle_new_user to flip Payhip flag if email already subscribed
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  email_lower text := lower(new.email);
  has_payhip boolean := false;
begin
  select coalesce(is_active, false) into has_payhip
    from public.payhip_subscriptions where customer_email = email_lower;
  insert into public.profiles (id, display_name, avatar_url, is_payhip_subscriber)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    new.raw_user_meta_data->>'avatar_url',
    coalesce(has_payhip, false)
  )
  on conflict (id) do update
    set is_payhip_subscriber = excluded.is_payhip_subscriber OR public.profiles.is_payhip_subscriber;
  return new;
end;
$$;

-- Entitlement helper (SECURITY DEFINER so callers can use it cheaply)
CREATE OR REPLACE FUNCTION public.user_entitlement(_user_id uuid)
RETURNS TABLE (
  entitled boolean,
  source text,
  tier text,
  uploads_remaining integer,
  ai_regens_remaining integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
declare
  sub record;
  is_payhip boolean := false;
begin
  select * into sub from public.subscriptions where user_id = _user_id;
  select coalesce(is_payhip_subscriber, false) into is_payhip from public.profiles where id = _user_id;

  -- Active paid subscription wins
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

  -- Active test drive: 1 release total, 1 analysis regen, 1 image regen
  if sub.id is not null and sub.status = 'active' and sub.kind = 'test_drive' then
    return query select (sub.test_drive_uploads_used < 1),
      'test_drive'::text,
      'test_drive'::text,
      greatest(1 - sub.test_drive_uploads_used, 0),
      greatest(2 - sub.test_drive_analysis_regens_used - sub.test_drive_image_regens_used, 0);
    return;
  end if;

  -- Payhip subscribers get free Starter
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
$$;

GRANT EXECUTE ON FUNCTION public.user_entitlement(uuid) TO authenticated, service_role;
