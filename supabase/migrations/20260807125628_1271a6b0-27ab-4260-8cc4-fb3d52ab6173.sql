ALTER TABLE public.product_tiers
  ADD COLUMN IF NOT EXISTS custom_label text,
  ADD COLUMN IF NOT EXISTS license_text text;

ALTER TABLE public.store_promotions
  ADD COLUMN IF NOT EXISTS scope_kinds text[],
  ADD COLUMN IF NOT EXISTS scope_tier_ids uuid[];

UPDATE public.store_promotions
SET scope_kinds = CASE
      WHEN scope = 'leases' AND exclude_exclusive THEN ARRAY['non_exclusive']
      WHEN scope = 'leases' THEN ARRAY['non_exclusive','exclusive']
      WHEN exclude_exclusive THEN ARRAY['single','album','non_exclusive','custom']
      ELSE ARRAY['single','album','non_exclusive','exclusive','custom']
    END
WHERE scope_kinds IS NULL;

CREATE TABLE IF NOT EXISTS public.store_license_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  name text NOT NULL,
  body text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS store_license_templates_store_idx
  ON public.store_license_templates (store_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_license_templates TO authenticated;
GRANT ALL ON public.store_license_templates TO service_role;

ALTER TABLE public.store_license_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner manages own licence templates"
  ON public.store_license_templates FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_license_templates.store_id AND s.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_license_templates.store_id AND s.user_id = auth.uid()));

CREATE TRIGGER store_license_templates_updated_at
  BEFORE UPDATE ON public.store_license_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();