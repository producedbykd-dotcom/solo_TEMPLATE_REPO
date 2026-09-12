ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS preview_mode text NOT NULL DEFAULT 'clip',
  ADD COLUMN IF NOT EXISTS tag_phrase text,
  ADD COLUMN IF NOT EXISTS tag_style text,
  ADD COLUMN IF NOT EXISTS tag_gender text,
  ADD COLUMN IF NOT EXISTS tag_voice text,
  ADD COLUMN IF NOT EXISTS tag_audio_path text;

ALTER TABLE public.store_products
  ADD COLUMN IF NOT EXISTS preview_mode text;