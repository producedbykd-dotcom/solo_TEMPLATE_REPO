CREATE TABLE public.solo_licenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  buyer_email text not null,
  license_key text not null unique,
  key_hash text not null,
  purchase_ref text,
  issued_at timestamptz not null default now(),
  activated_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX solo_licenses_email_idx ON public.solo_licenses (lower(buyer_email));
GRANT SELECT ON public.solo_licenses TO authenticated;
GRANT ALL ON public.solo_licenses TO service_role;
ALTER TABLE public.solo_licenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners can view their own licence" ON public.solo_licenses
  FOR SELECT TO authenticated USING (user_id = auth.uid());