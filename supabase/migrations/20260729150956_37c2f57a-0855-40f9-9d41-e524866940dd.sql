
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT 'dark';
ALTER TABLE public.stores DROP CONSTRAINT IF EXISTS stores_theme_chk;
ALTER TABLE public.stores ADD CONSTRAINT stores_theme_chk CHECK (theme IN ('dark','light'));

CREATE TABLE public.store_stripe_config (
  store_id uuid PRIMARY KEY REFERENCES public.stores(id) ON DELETE CASCADE,
  secret_key text,
  webhook_secret text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.store_stripe_config TO service_role;
ALTER TABLE public.store_stripe_config ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.store_membership_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL UNIQUE REFERENCES public.stores(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Membership',
  description text,
  price_cents integer NOT NULL DEFAULT 1999,
  interval text NOT NULL DEFAULT 'month' CHECK (interval IN ('month','year')),
  mode text NOT NULL DEFAULT 'quota' CHECK (mode IN ('quota','all_access')),
  lease_quota integer NOT NULL DEFAULT 2,
  download_quota integer NOT NULL DEFAULT 5,
  discount_percent integer NOT NULL DEFAULT 10 CHECK (discount_percent >= 0 AND discount_percent <= 90),
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.store_membership_plans TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_membership_plans TO authenticated;
GRANT ALL ON public.store_membership_plans TO service_role;
ALTER TABLE public.store_membership_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "active plans of published stores are public"
ON public.store_membership_plans FOR SELECT TO anon
USING (active = true AND EXISTS (
  SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.published = true
));

CREATE POLICY "owner manages own membership plan"
ON public.store_membership_plans FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.user_id = auth.uid()));

CREATE TABLE public.store_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  email text NOT NULL,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text NOT NULL DEFAULT 'pending',
  current_period_start timestamptz,
  current_period_end timestamptz,
  leases_used integer NOT NULL DEFAULT 0,
  downloads_used integer NOT NULL DEFAULT 0,
  access_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, email)
);
CREATE UNIQUE INDEX store_subscribers_token_idx ON public.store_subscribers (access_token);
CREATE INDEX store_subscribers_sub_idx ON public.store_subscribers (stripe_subscription_id);
GRANT SELECT ON public.store_subscribers TO authenticated;
GRANT ALL ON public.store_subscribers TO service_role;
ALTER TABLE public.store_subscribers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner reads own subscribers"
ON public.store_subscribers FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.user_id = auth.uid()));

CREATE TRIGGER store_membership_plans_updated
BEFORE UPDATE ON public.store_membership_plans
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER store_subscribers_updated
BEFORE UPDATE ON public.store_subscribers
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
