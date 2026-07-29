
DROP POLICY "anyone can sign up to be notified" ON public.notify_signups;
CREATE POLICY "anyone can sign up to be notified" ON public.notify_signups
  FOR INSERT TO anon, authenticated
  WITH CHECK (length(trim(email)) > 3 AND length(trim(platform)) > 0);
