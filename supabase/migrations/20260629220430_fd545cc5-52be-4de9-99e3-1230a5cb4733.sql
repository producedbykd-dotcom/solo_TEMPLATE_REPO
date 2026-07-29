
CREATE TYPE public.billing_tier AS ENUM ('starter', 'pro', 'label');
CREATE TYPE public.billing_interval AS ENUM ('monthly', 'yearly');
CREATE TYPE public.subscription_status AS ENUM ('active', 'past_due', 'canceled', 'paused', 'pending');

CREATE TABLE public.billing_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier billing_tier NOT NULL,
  interval billing_interval NOT NULL,
  amount_cents integer NOT NULL,
  upload_limit integer,
  ai_cost_cap_cents integer,
  square_plan_id text,
  square_variation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tier, interval)
);

GRANT SELECT ON public.billing_plans TO authenticated;
GRANT ALL ON public.billing_plans TO service_role;
ALTER TABLE public.billing_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Plans readable by authenticated" ON public.billing_plans FOR SELECT TO authenticated USING (true);

CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tier billing_tier NOT NULL,
  interval billing_interval NOT NULL,
  status subscription_status NOT NULL DEFAULT 'pending',
  square_subscription_id text UNIQUE,
  square_customer_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  uploads_this_period integer NOT NULL DEFAULT 0,
  ai_cost_cents_this_period integer NOT NULL DEFAULT 0,
  canceled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view their subscription" ON public.subscriptions FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TRIGGER trg_subscriptions_updated_at BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_billing_plans_updated_at BEFORE UPDATE ON public.billing_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.billing_plans (tier, interval, amount_cents, upload_limit, ai_cost_cap_cents) VALUES
  ('starter', 'monthly', 1200, 35, 1200),
  ('starter', 'yearly', 8640, 35, 1200),
  ('pro', 'monthly', 2200, 75, 2200),
  ('pro', 'yearly', 15840, 75, 2200),
  ('label', 'monthly', 4500, NULL, NULL),
  ('label', 'yearly', 32400, NULL, NULL);
