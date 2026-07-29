
CREATE TABLE public.soundcloud_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sc_user_id text NOT NULL,
  username text,
  display_name text,
  avatar_url text,
  permalink_url text,
  access_token text NOT NULL,
  refresh_token text,
  token_expires_at timestamptz,
  scope text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.soundcloud_connections TO authenticated;
GRANT ALL ON public.soundcloud_connections TO service_role;
ALTER TABLE public.soundcloud_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own SoundCloud connection"
  ON public.soundcloud_connections FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Short-lived PKCE verifier store keyed by signed OAuth state
CREATE TABLE public.soundcloud_oauth_pkce (
  state text PRIMARY KEY,
  user_id uuid NOT NULL,
  code_verifier text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.soundcloud_oauth_pkce TO service_role;
ALTER TABLE public.soundcloud_oauth_pkce ENABLE ROW LEVEL SECURITY;
-- no policies: service role only
