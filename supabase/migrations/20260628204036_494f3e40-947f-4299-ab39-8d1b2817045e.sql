
CREATE TABLE public.identities (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  artist_name TEXT,
  links JSONB NOT NULL DEFAULT '{}'::jsonb,
  default_tags TEXT[] NOT NULL DEFAULT '{}',
  description_template TEXT,
  image_style_prompt TEXT,
  reference_image_paths TEXT[] NOT NULL DEFAULT '{}',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.identities TO authenticated;
GRANT ALL ON public.identities TO service_role;

ALTER TABLE public.identities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own identities"
  ON public.identities
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER identities_set_updated_at
  BEFORE UPDATE ON public.identities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Optional: link a project to a chosen identity for prefill
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS identity_id UUID REFERENCES public.identities(id) ON DELETE SET NULL;
