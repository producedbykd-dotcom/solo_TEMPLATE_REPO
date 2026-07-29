
CREATE TABLE public.meta_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  fb_user_id text NOT NULL,
  fb_user_name text,
  page_id text,
  page_name text,
  page_access_token text,
  ig_user_id text,
  ig_username text,
  user_access_token text NOT NULL,
  token_expires_at timestamptz,
  scope text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_connections TO authenticated;
GRANT ALL ON public.meta_connections TO service_role;
ALTER TABLE public.meta_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own meta connection" ON public.meta_connections
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER meta_connections_updated_at BEFORE UPDATE ON public.meta_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.tiktok_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  open_id text NOT NULL,
  union_id text,
  display_name text,
  avatar_url text,
  access_token text NOT NULL,
  refresh_token text,
  token_expires_at timestamptz,
  refresh_expires_at timestamptz,
  scope text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tiktok_connections TO authenticated;
GRANT ALL ON public.tiktok_connections TO service_role;
ALTER TABLE public.tiktok_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own tiktok connection" ON public.tiktok_connections
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER tiktok_connections_updated_at BEFORE UPDATE ON public.tiktok_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
