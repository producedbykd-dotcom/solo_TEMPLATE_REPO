
CREATE TABLE public.notify_signups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  platform TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (email, platform)
);
GRANT SELECT, INSERT ON public.notify_signups TO authenticated;
GRANT INSERT ON public.notify_signups TO anon;
GRANT ALL ON public.notify_signups TO service_role;
ALTER TABLE public.notify_signups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone can sign up to be notified" ON public.notify_signups
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "users see their own notify signups" ON public.notify_signups
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
