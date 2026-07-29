CREATE TABLE public.youtube_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  channel_id text NOT NULL,
  channel_title text NOT NULL,
  channel_thumbnail text,
  access_token text NOT NULL,
  refresh_token text,
  scope text,
  token_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, DELETE ON public.youtube_connections TO authenticated;
GRANT ALL ON public.youtube_connections TO service_role;

ALTER TABLE public.youtube_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own youtube connection"
  ON public.youtube_connections FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own youtube connection"
  ON public.youtube_connections FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER youtube_connections_updated_at
  BEFORE UPDATE ON public.youtube_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();