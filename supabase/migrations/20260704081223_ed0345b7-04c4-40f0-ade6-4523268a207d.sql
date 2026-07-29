
-- 1. Add "admin" to app_role enum (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
                 WHERE t.typname = 'app_role' AND e.enumlabel = 'admin') THEN
    ALTER TYPE public.app_role ADD VALUE 'admin';
  END IF;
END $$;

-- 2. user_credits
CREATE TABLE IF NOT EXISTS public.user_credits (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
  plan_grant bigint NOT NULL DEFAULT 0,
  lifetime_granted bigint NOT NULL DEFAULT 0,
  lifetime_spent bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.user_credits TO authenticated;
GRANT ALL ON public.user_credits TO service_role;
ALTER TABLE public.user_credits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "credits self read" ON public.user_credits;
CREATE POLICY "credits self read" ON public.user_credits FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- 3. credit_ledger
CREATE TABLE IF NOT EXISTS public.credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delta bigint NOT NULL,
  reason text NOT NULL,
  subscription_id uuid,
  topup_id uuid,
  project_id uuid,
  metadata jsonb,
  refunded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS credit_ledger_user_created_idx ON public.credit_ledger(user_id, created_at DESC);
GRANT SELECT ON public.credit_ledger TO authenticated;
GRANT ALL ON public.credit_ledger TO service_role;
ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ledger self read" ON public.credit_ledger;
CREATE POLICY "ledger self read" ON public.credit_ledger FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- 4. credit_topups
CREATE TABLE IF NOT EXISTS public.credit_topups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sku text NOT NULL,
  credits bigint NOT NULL,
  amount_cents int NOT NULL,
  square_payment_link_id text,
  square_payment_id text UNIQUE,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);
CREATE INDEX IF NOT EXISTS credit_topups_user_created_idx ON public.credit_topups(user_id, created_at DESC);
GRANT SELECT ON public.credit_topups TO authenticated;
GRANT ALL ON public.credit_topups TO service_role;
ALTER TABLE public.credit_topups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "topups self read" ON public.credit_topups;
CREATE POLICY "topups self read" ON public.credit_topups FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- 5. marketing_assets
CREATE TABLE IF NOT EXISTS public.marketing_assets (
  key text PRIMARY KEY,
  storage_path text NOT NULL,
  public_url text,
  mime_type text,
  size_bytes bigint,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT SELECT ON public.marketing_assets TO anon, authenticated;
GRANT ALL ON public.marketing_assets TO service_role;
ALTER TABLE public.marketing_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "marketing assets public read" ON public.marketing_assets;
CREATE POLICY "marketing assets public read" ON public.marketing_assets FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "marketing assets admin write" ON public.marketing_assets;
CREATE POLICY "marketing assets admin write" ON public.marketing_assets FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 6. billing_plans.credit_grant
ALTER TABLE public.billing_plans ADD COLUMN IF NOT EXISTS credit_grant bigint NOT NULL DEFAULT 0;

-- 7. spend_credits
CREATE OR REPLACE FUNCTION public.spend_credits(
  _user_id uuid, _amount bigint, _reason text, _metadata jsonb DEFAULT NULL, _project_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _new_balance bigint; _ledger_id uuid;
BEGIN
  IF _amount <= 0 THEN RAISE EXCEPTION 'amount must be positive'; END IF;
  INSERT INTO public.user_credits (user_id) VALUES (_user_id) ON CONFLICT (user_id) DO NOTHING;
  UPDATE public.user_credits SET balance = balance - _amount, lifetime_spent = lifetime_spent + _amount, updated_at = now()
    WHERE user_id = _user_id AND balance >= _amount RETURNING balance INTO _new_balance;
  IF _new_balance IS NULL THEN RAISE EXCEPTION 'INSUFFICIENT_CREDITS' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO public.credit_ledger (user_id, delta, reason, metadata, project_id)
    VALUES (_user_id, -_amount, _reason, _metadata, _project_id) RETURNING id INTO _ledger_id;
  RETURN _ledger_id;
END $$;
REVOKE ALL ON FUNCTION public.spend_credits(uuid, bigint, text, jsonb, uuid) FROM PUBLIC, authenticated, anon;

-- 8. grant_credits
CREATE OR REPLACE FUNCTION public.grant_credits(
  _user_id uuid, _amount bigint, _reason text, _plan_grant bigint DEFAULT NULL,
  _subscription_id uuid DEFAULT NULL, _topup_id uuid DEFAULT NULL, _metadata jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _ledger_id uuid;
BEGIN
  IF _amount <= 0 THEN RAISE EXCEPTION 'amount must be positive'; END IF;
  INSERT INTO public.user_credits (user_id, balance, plan_grant, lifetime_granted, updated_at)
    VALUES (_user_id, _amount, COALESCE(_plan_grant, _amount), _amount, now())
    ON CONFLICT (user_id) DO UPDATE
      SET balance = user_credits.balance + EXCLUDED.balance,
          plan_grant = COALESCE(_plan_grant, user_credits.plan_grant),
          lifetime_granted = user_credits.lifetime_granted + EXCLUDED.balance,
          updated_at = now();
  INSERT INTO public.credit_ledger (user_id, delta, reason, subscription_id, topup_id, metadata)
    VALUES (_user_id, _amount, _reason, _subscription_id, _topup_id, _metadata)
    RETURNING id INTO _ledger_id;
  RETURN _ledger_id;
END $$;
REVOKE ALL ON FUNCTION public.grant_credits(uuid, bigint, text, bigint, uuid, uuid, jsonb) FROM PUBLIC, authenticated, anon;

-- 9. refund_credits
CREATE OR REPLACE FUNCTION public.refund_credits(_ledger_id uuid, _reason text DEFAULT 'refund')
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _row public.credit_ledger%ROWTYPE;
BEGIN
  SELECT * INTO _row FROM public.credit_ledger WHERE id = _ledger_id;
  IF _row.id IS NULL OR _row.refunded_at IS NOT NULL OR _row.delta >= 0 THEN RETURN false; END IF;
  UPDATE public.user_credits
    SET balance = balance + (- _row.delta),
        lifetime_spent = GREATEST(lifetime_spent - (- _row.delta), 0),
        updated_at = now()
    WHERE user_id = _row.user_id;
  UPDATE public.credit_ledger SET refunded_at = now() WHERE id = _ledger_id;
  INSERT INTO public.credit_ledger (user_id, delta, reason, project_id, metadata)
    VALUES (_row.user_id, - _row.delta, _reason, _row.project_id, jsonb_build_object('refund_of', _row.id));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.refund_credits(uuid, text) FROM PUBLIC, authenticated, anon;

-- 10. get_credit_history
CREATE OR REPLACE FUNCTION public.get_credit_history(_limit int DEFAULT 20)
RETURNS TABLE(id uuid, delta bigint, reason text, project_id uuid, created_at timestamptz, refunded_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, delta, reason, project_id, created_at, refunded_at
  FROM public.credit_ledger WHERE user_id = auth.uid()
  ORDER BY created_at DESC LIMIT LEAST(_limit, 100)
$$;
GRANT EXECUTE ON FUNCTION public.get_credit_history(int) TO authenticated;

-- 11. Drop + recreate user_entitlement (return type changed)
DROP FUNCTION IF EXISTS public.user_entitlement(uuid);
CREATE OR REPLACE FUNCTION public.user_entitlement(_user_id uuid)
RETURNS TABLE(entitled boolean, source text, tier text, uploads_remaining integer,
              credits bigint, plan_grant bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE sub record; is_payhip boolean := false; uc record;
BEGIN
  SELECT * INTO sub FROM public.subscriptions WHERE user_id = _user_id;
  SELECT COALESCE(is_payhip_subscriber, false) INTO is_payhip FROM public.profiles WHERE id = _user_id;
  SELECT balance, plan_grant INTO uc FROM public.user_credits WHERE user_id = _user_id;

  IF sub.id IS NOT NULL AND sub.status = 'active' AND sub.kind = 'subscription' THEN
    RETURN QUERY SELECT true, 'subscription'::text, sub.tier::text,
      CASE WHEN sub.tier IN ('pro','label') THEN NULL
           WHEN sub.tier = 'starter' THEN GREATEST(35 - sub.uploads_this_period, 0)
           ELSE 0 END,
      COALESCE(uc.balance, 0), COALESCE(uc.plan_grant, 0);
    RETURN;
  END IF;

  IF sub.id IS NOT NULL AND sub.status = 'active' AND sub.kind = 'test_drive' THEN
    RETURN QUERY SELECT true, 'test_drive'::text, 'test_drive'::text,
      GREATEST(1 - sub.test_drive_uploads_used, 0),
      COALESCE(uc.balance, 0), COALESCE(uc.plan_grant, 0);
    RETURN;
  END IF;

  IF is_payhip THEN
    RETURN QUERY SELECT true, 'payhip'::text, 'starter'::text,
      CASE WHEN sub.id IS NOT NULL THEN GREATEST(35 - sub.uploads_this_period, 0) ELSE 35 END,
      COALESCE(uc.balance, 0), COALESCE(uc.plan_grant, 0);
    RETURN;
  END IF;

  RETURN QUERY SELECT false, NULL::text, NULL::text, 0,
    COALESCE(uc.balance, 0), COALESCE(uc.plan_grant, 0);
END $$;

-- 12. Storage RLS for the marketing bucket
DROP POLICY IF EXISTS "marketing public read" ON storage.objects;
DROP POLICY IF EXISTS "marketing admin write" ON storage.objects;
CREATE POLICY "marketing public read" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'marketing');
CREATE POLICY "marketing admin write" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'marketing' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'marketing' AND public.has_role(auth.uid(), 'admin'));
