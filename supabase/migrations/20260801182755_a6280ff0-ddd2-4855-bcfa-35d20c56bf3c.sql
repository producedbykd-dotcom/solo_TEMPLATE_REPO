CREATE TABLE IF NOT EXISTS public.square_checkout_intents (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  email text,
  tier text NOT NULL,
  "interval" text NOT NULL,
  payment_link_id text,
  square_variation_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS square_checkout_intents_email_idx ON public.square_checkout_intents (lower(email), created_at DESC);
CREATE INDEX IF NOT EXISTS square_checkout_intents_user_idx ON public.square_checkout_intents (user_id, created_at DESC);
GRANT SELECT ON public.square_checkout_intents TO authenticated;
GRANT ALL ON public.square_checkout_intents TO service_role;
ALTER TABLE public.square_checkout_intents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own checkout intents" ON public.square_checkout_intents FOR SELECT TO authenticated USING (auth.uid() = user_id);

UPDATE public.subscriptions s
SET tier = 'pro', "interval" = 'yearly', kind = 'subscription', status = 'active',
    canceled_at = NULL,
    current_period_start = now(),
    current_period_end = now() + interval '1 year',
    updated_at = now()
FROM auth.users u
WHERE u.id = s.user_id AND lower(u.email) = 'akbeatz73@gmail.com';