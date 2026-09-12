ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS tag_preset text,
  ADD COLUMN IF NOT EXISTS tag_fx jsonb;