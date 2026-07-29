ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS auto_chain_ran_at timestamptz;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS cover_thumb_url text;