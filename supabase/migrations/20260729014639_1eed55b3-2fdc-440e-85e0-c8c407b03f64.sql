CREATE TABLE public.stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  handle text NOT NULL UNIQUE,
  display_name text NOT NULL DEFAULT '',
  bio text,
  logo_path text,
  accent text NOT NULL DEFAULT '#7c3aed',
  paypal_email text,
  paypal_verified_at timestamptz,
  published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stores TO authenticated;
GRANT SELECT ON public.stores TO anon;
GRANT ALL ON public.stores TO service_role;
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages own store" ON public.stores FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "published stores are public" ON public.stores FOR SELECT TO anon
  USING (published = true);
CREATE TRIGGER stores_updated_at BEFORE UPDATE ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.store_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'single',
  title text NOT NULL,
  description text,
  artwork_path text,
  audio_path text,
  audio_bucket text NOT NULL DEFAULT 'audio',
  preview_path text,
  free_download_enabled boolean NOT NULL DEFAULT false,
  free_download_path text,
  position integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX store_products_store_idx ON public.store_products(store_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_products TO authenticated;
GRANT SELECT ON public.store_products TO anon;
GRANT ALL ON public.store_products TO service_role;
ALTER TABLE public.store_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages own products" ON public.store_products FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.user_id = auth.uid()));
CREATE POLICY "active products of published stores are public" ON public.store_products FOR SELECT TO anon
  USING (active = true AND EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.published = true));
CREATE TRIGGER store_products_updated_at BEFORE UPDATE ON public.store_products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.product_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.store_products(id) ON DELETE CASCADE,
  kind text NOT NULL,
  price_cents integer NOT NULL DEFAULT 0,
  stream_limit integer,
  distribution_limit integer,
  video_limit integer,
  term_months integer,
  extra_terms text,
  active boolean NOT NULL DEFAULT true,
  sold_out boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_tiers_product_idx ON public.product_tiers(product_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_tiers TO authenticated;
GRANT SELECT ON public.product_tiers TO anon;
GRANT ALL ON public.product_tiers TO service_role;
ALTER TABLE public.product_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages own tiers" ON public.product_tiers FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.store_products p JOIN public.stores s ON s.id = p.store_id
                 WHERE p.id = product_id AND s.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.store_products p JOIN public.stores s ON s.id = p.store_id
                 WHERE p.id = product_id AND s.user_id = auth.uid()));
CREATE POLICY "active tiers of published stores are public" ON public.product_tiers FOR SELECT TO anon
  USING (active = true AND EXISTS (
    SELECT 1 FROM public.store_products p JOIN public.stores s ON s.id = p.store_id
    WHERE p.id = product_id AND p.active = true AND s.published = true));
CREATE TRIGGER product_tiers_updated_at BEFORE UPDATE ON public.product_tiers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.store_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'percent',
  percent integer NOT NULL DEFAULT 0,
  bogo_buy integer NOT NULL DEFAULT 1,
  bogo_free integer NOT NULL DEFAULT 1,
  scope text NOT NULL DEFAULT 'all',
  exclude_exclusive boolean NOT NULL DEFAULT true,
  headline text,
  active boolean NOT NULL DEFAULT false,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX store_promotions_one_per_store ON public.store_promotions(store_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_promotions TO authenticated;
GRANT SELECT ON public.store_promotions TO anon;
GRANT ALL ON public.store_promotions TO service_role;
ALTER TABLE public.store_promotions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages own promo" ON public.store_promotions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.user_id = auth.uid()));
CREATE POLICY "active promos of published stores are public" ON public.store_promotions FOR SELECT TO anon
  USING (active = true AND EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.published = true));
CREATE TRIGGER store_promotions_updated_at BEFORE UPDATE ON public.store_promotions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.store_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  buyer_name text NOT NULL,
  buyer_email text NOT NULL,
  subtotal_cents integer NOT NULL DEFAULT 0,
  discount_cents integer NOT NULL DEFAULT 0,
  total_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'pending',
  paypal_txn_id text,
  paypal_payer_email text,
  promo_snapshot jsonb,
  ipn_raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX store_orders_store_idx ON public.store_orders(store_id);
GRANT SELECT ON public.store_orders TO authenticated;
GRANT ALL ON public.store_orders TO service_role;
ALTER TABLE public.store_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads own orders" ON public.store_orders FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.user_id = auth.uid()));
CREATE TRIGGER store_orders_updated_at BEFORE UPDATE ON public.store_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.store_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.store_orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.store_products(id) ON DELETE SET NULL,
  tier_id uuid REFERENCES public.product_tiers(id) ON DELETE SET NULL,
  title text NOT NULL,
  tier_kind text NOT NULL,
  unit_price_cents integer NOT NULL DEFAULT 0,
  price_cents integer NOT NULL DEFAULT 0,
  license_pdf_path text,
  terms_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX store_order_items_order_idx ON public.store_order_items(order_id);
GRANT SELECT ON public.store_order_items TO authenticated;
GRANT ALL ON public.store_order_items TO service_role;
ALTER TABLE public.store_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads own order items" ON public.store_order_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.store_orders o JOIN public.stores s ON s.id = o.store_id
                 WHERE o.id = order_id AND s.user_id = auth.uid()));

CREATE TABLE public.free_downloads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.store_products(id) ON DELETE SET NULL,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX free_downloads_store_idx ON public.free_downloads(store_id);
GRANT SELECT ON public.free_downloads TO authenticated;
GRANT ALL ON public.free_downloads TO service_role;
ALTER TABLE public.free_downloads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads own leads" ON public.free_downloads FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.user_id = auth.uid()));