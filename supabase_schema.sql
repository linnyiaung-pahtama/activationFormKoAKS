-- =============================================================================
-- Pahtama Group — Shaloot Noodle Activation & Sales System
-- Complete PostgreSQL / Supabase DDL Schema & Seed Data (6 Tables + Realtime)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- =============================================================================
-- 1. TABLE: public.app_users
-- User Accounts, 6 RBAC Roles, Assigned Routes, Regional Scope & Credentials
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'seller' CHECK (role IN ('admin', 'nsm', 'brand_manager', 'manager', 'supervisor', 'seller')),
  route_code TEXT NOT NULL DEFAULT 'ALL-ROUTES',
  region_scope TEXT NOT NULL DEFAULT 'All Regions',
  supervisor_username TEXT,
  manager_username TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_users_username ON public.app_users (username);
CREATE INDEX IF NOT EXISTS idx_app_users_role ON public.app_users (role);
CREATE INDEX IF NOT EXISTS idx_app_users_route_code ON public.app_users (route_code);

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access for app_users" ON public.app_users;
CREATE POLICY "Allow full access for app_users"
  ON public.app_users
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

INSERT INTO public.app_users (id, username, password, full_name, role, route_code, region_scope, supervisor_username, manager_username, active)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'admin', 'password123', 'U Kyaw Zay Ya (System Admin)', 'admin', 'ALL-ROUTES', 'All Regions (National)', NULL, NULL, TRUE),
  ('00000000-0000-4000-8000-000000000099', 'nsm1', 'password123', 'U Myo Min (National Sales Manager)', 'nsm', 'ALL-BRANCHES', 'National Head Office (All Branches)', NULL, NULL, TRUE),
  ('00000000-0000-4000-8000-000000000098', 'brandmanager1', 'password123', 'Daw Phyu Phyu Thin (Brand Manager - Shaloot)', 'brand_manager', 'BRAND-ALL', 'Brand Portfolio (National)', NULL, NULL, TRUE),
  ('00000000-0000-4000-8000-000000000101', 'manager1', 'password123', 'U Aung Ko Latt (Yangon East & West)', 'manager', 'MGR-YGN-EW', 'Yangon East & West', NULL, NULL, TRUE),
  ('00000000-0000-4000-8000-000000000102', 'manager2', 'password123', 'Daw Su Su Hlaing (Yangon North)', 'manager', 'MGR-YGN-N', 'Yangon North', NULL, NULL, TRUE),
  ('00000000-0000-4000-8000-000000000103', 'manager3', 'password123', 'U Min Thu (Mandalay Central)', 'manager', 'MGR-MDY-C', 'Mandalay Central', NULL, NULL, TRUE),
  ('00000000-0000-4000-8000-000000000104', 'manager4', 'password123', 'U Zaw Win Naing (Naypyitaw & Bago)', 'manager', 'MGR-NPT-S', 'Naypyitaw & Bago', NULL, NULL, TRUE),
  ('00000000-0000-4000-8000-000000000201', 'supervisor1', 'password123', 'Ko Thura Aung (Team Alpha - YGN East)', 'supervisor', 'SUP-TEAM-01', 'Yangon East', NULL, 'manager1', TRUE),
  ('00000000-0000-4000-8000-000000000202', 'supervisor2', 'password123', 'Ko Htet Naing (Team Beta - YGN West)', 'supervisor', 'SUP-TEAM-02', 'Yangon West', NULL, 'manager1', TRUE),
  ('00000000-0000-4000-8000-000000000203', 'supervisor3', 'password123', 'Ma Phyu Phyu Thin (Team Gamma - YGN North)', 'supervisor', 'SUP-TEAM-03', 'Yangon North', NULL, 'manager2', TRUE),
  ('00000000-0000-4000-8000-000000000204', 'supervisor4', 'password123', 'Ko Ye Yint (Team Delta - Mandalay)', 'supervisor', 'SUP-TEAM-04', 'Mandalay Central', NULL, 'manager3', TRUE),
  ('00000000-0000-4000-8000-000000000205', 'supervisor5', 'password123', 'Ko Nay Lin (Team Epsilon - NPT/Bago)', 'supervisor', 'SUP-TEAM-05', 'Naypyitaw & Bago', NULL, 'manager4', TRUE),
  ('7ff1e036-e3e8-48c7-b071-de40ac76d8be', 'seller1', 'password123', 'Kyaw Swar Lin', 'seller', 'RT-YGN-01', 'Yangon East', 'supervisor1', 'manager1', TRUE),
  ('00000000-0000-4000-8000-000000000302', 'seller2', 'password123', 'Zin Mar Oo', 'seller', 'RT-YGN-02', 'Yangon East', 'supervisor1', 'manager1', TRUE),
  ('00000000-0000-4000-8000-000000000303', 'seller3', 'password123', 'Wai Yan Phyo', 'seller', 'RT-YGN-03', 'Yangon East', 'supervisor1', 'manager1', TRUE),
  ('00000000-0000-4000-8000-000000000304', 'seller4', 'password123', 'Myo Min Hein', 'seller', 'RT-YGN-04', 'Yangon West', 'supervisor2', 'manager1', TRUE),
  ('00000000-0000-4000-8000-000000000305', 'seller5', 'password123', 'Eiandar Kyaw', 'seller', 'RT-YGN-05', 'Yangon West', 'supervisor2', 'manager1', TRUE),
  ('00000000-0000-4000-8000-000000000306', 'seller6', 'password123', 'Soe Pyae Aung', 'seller', 'RT-YGN-06', 'Yangon West', 'supervisor2', 'manager1', TRUE),
  ('00000000-0000-4000-8000-000000000307', 'seller7', 'password123', 'Hnin Wai Lwin', 'seller', 'RT-YGN-07', 'Yangon North', 'supervisor3', 'manager2', TRUE),
  ('00000000-0000-4000-8000-000000000308', 'seller8', 'password123', 'Kaung Myat Thu', 'seller', 'RT-YGN-08', 'Yangon North', 'supervisor3', 'manager2', TRUE),
  ('00000000-0000-4000-8000-000000000309', 'seller9', 'password123', 'May Thu Aung', 'seller', 'RT-YGN-09', 'Yangon North', 'supervisor3', 'manager2', TRUE),
  ('00000000-0000-4000-8000-000000000310', 'seller10', 'password123', 'Aung Myo Khaing', 'seller', 'RT-MDY-10', 'Mandalay Central', 'supervisor4', 'manager3', TRUE),
  ('00000000-0000-4000-8000-000000000311', 'seller11', 'password123', 'Thazin Nwe', 'seller', 'RT-MDY-11', 'Mandalay Central', 'supervisor4', 'manager3', TRUE),
  ('00000000-0000-4000-8000-000000000312', 'seller12', 'password123', 'Pyae Sone Tun', 'seller', 'RT-MDY-12', 'Mandalay Central', 'supervisor4', 'manager3', TRUE),
  ('00000000-0000-4000-8000-000000000313', 'seller13', 'password123', 'Nandar Lin', 'seller', 'RT-NPT-13', 'Naypyitaw & Bago', 'supervisor5', 'manager4', TRUE),
  ('00000000-0000-4000-8000-000000000314', 'seller14', 'password123', 'Chit Ko Ko', 'seller', 'RT-NPT-14', 'Naypyitaw & Bago', 'supervisor5', 'manager4', TRUE),
  ('00000000-0000-4000-8000-000000000315', 'seller15', 'password123', 'Su Myat Noe', 'seller', 'RT-BGO-15', 'Naypyitaw & Bago', 'supervisor5', 'manager4', TRUE)
ON CONFLICT (id) DO UPDATE SET
  username = EXCLUDED.username,
  password = EXCLUDED.password,
  full_name = EXCLUDED.full_name,
  role = EXCLUDED.role,
  route_code = EXCLUDED.route_code,
  region_scope = EXCLUDED.region_scope,
  supervisor_username = EXCLUDED.supervisor_username,
  manager_username = EXCLUDED.manager_username,
  active = EXCLUDED.active,
  updated_at = NOW();

-- =============================================================================
-- 2. TABLE: public.noodle_activations
-- Primary Field Activation & Sales Order Header Ledger
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.noodle_activations (
  id TEXT PRIMARY KEY,
  invoice_no TEXT NOT NULL,
  activation_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  branch TEXT DEFAULT 'Yangon',
  wholesale_store_name TEXT NOT NULL DEFAULT '',
  pg_cover TEXT NOT NULL DEFAULT 'Yes',
  retailer_store_name TEXT NOT NULL DEFAULT '',
  outlet_type TEXT NOT NULL DEFAULT 'Grocery',
  phone_number TEXT NOT NULL DEFAULT '',
  address_no TEXT NOT NULL DEFAULT '',
  address_street TEXT NOT NULL DEFAULT '',
  address_ward TEXT NOT NULL DEFAULT '',
  township TEXT NOT NULL DEFAULT '',
  full_address TEXT NOT NULL DEFAULT '',
  sales_status BOOLEAN NOT NULL DEFAULT TRUE,
  pricing_mode TEXT NOT NULL DEFAULT 'company_ldp',
  covered_status BOOLEAN NOT NULL DEFAULT TRUE,
  non_covered_reason TEXT,
  seller_username TEXT NOT NULL,
  seller_name TEXT NOT NULL,
  route_code TEXT NOT NULL,
  supervisor_username TEXT NOT NULL DEFAULT '',
  manager_username TEXT NOT NULL DEFAULT '',
  region_scope TEXT NOT NULL DEFAULT '',
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  chicken_sichat_qty INTEGER NOT NULL DEFAULT 0,
  chicken_sichat_price NUMERIC NOT NULL DEFAULT 735,
  chicken_sichat_foc INTEGER NOT NULL DEFAULT 0,
  coconut_qty INTEGER NOT NULL DEFAULT 0,
  coconut_price NUMERIC NOT NULL DEFAULT 870,
  coconut_foc INTEGER NOT NULL DEFAULT 0,
  tom_yum_qty INTEGER NOT NULL DEFAULT 0,
  tom_yum_price NUMERIC NOT NULL DEFAULT 810,
  tom_yum_foc INTEGER NOT NULL DEFAULT 0,
  total_paid_qty INTEGER NOT NULL DEFAULT 0,
  total_foc_qty INTEGER NOT NULL DEFAULT 0,
  grand_total_mmk NUMERIC NOT NULL DEFAULT 0,
  remarks TEXT
);

CREATE INDEX IF NOT EXISTS idx_noodle_activations_date ON public.noodle_activations (activation_date DESC);
CREATE INDEX IF NOT EXISTS idx_noodle_activations_branch ON public.noodle_activations (branch);
CREATE INDEX IF NOT EXISTS idx_noodle_activations_seller ON public.noodle_activations (seller_username);
CREATE INDEX IF NOT EXISTS idx_noodle_activations_route ON public.noodle_activations (route_code);
CREATE INDEX IF NOT EXISTS idx_noodle_activations_invoice ON public.noodle_activations (invoice_no);

ALTER TABLE public.noodle_activations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access for noodle_activations" ON public.noodle_activations;
CREATE POLICY "Allow full access for noodle_activations"
  ON public.noodle_activations
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- =============================================================================
-- 3. TABLE: public.noodle_activation_sku_details
-- Normalized Itemized SKU Line Items (Paid & FOC Breakdown per Activation)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.noodle_activation_sku_details (
  id TEXT PRIMARY KEY,
  activation_id TEXT NOT NULL REFERENCES public.noodle_activations(id) ON DELETE CASCADE,
  invoice_no TEXT NOT NULL,
  activation_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  branch TEXT DEFAULT 'Yangon',
  seller_username TEXT NOT NULL,
  seller_name TEXT NOT NULL,
  route_code TEXT NOT NULL,
  supervisor_username TEXT DEFAULT '',
  manager_username TEXT DEFAULT '',
  region_scope TEXT DEFAULT '',
  wholesale_store_name TEXT NOT NULL,
  pg_cover TEXT NOT NULL DEFAULT 'Yes',
  retailer_store_name TEXT NOT NULL,
  outlet_type TEXT NOT NULL DEFAULT 'Consumer',
  phone_number TEXT DEFAULT '',
  address_no TEXT DEFAULT '',
  address_street TEXT DEFAULT '',
  address_ward TEXT DEFAULT '',
  township TEXT NOT NULL,
  full_address TEXT DEFAULT '',
  sales_status BOOLEAN NOT NULL DEFAULT TRUE,
  non_covered_reason TEXT,
  pricing_mode TEXT NOT NULL DEFAULT 'company_ldp',
  sku_id TEXT NOT NULL,
  sku_code TEXT NOT NULL,
  sku_name TEXT NOT NULL,
  myanmar_sub_name TEXT DEFAULT '',
  pack_spec TEXT DEFAULT '1x30pcs',
  unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  paid_qty INTEGER NOT NULL DEFAULT 0,
  foc_qty INTEGER NOT NULL DEFAULT 0,
  total_qty INTEGER NOT NULL DEFAULT 0,
  line_total_mmk NUMERIC(14, 2) NOT NULL DEFAULT 0,
  remarks TEXT
);

ALTER TABLE public.noodle_activation_sku_details ADD COLUMN IF NOT EXISTS branch TEXT DEFAULT 'Yangon';
ALTER TABLE public.noodle_activation_sku_details ADD COLUMN IF NOT EXISTS address_no TEXT DEFAULT '';
ALTER TABLE public.noodle_activation_sku_details ADD COLUMN IF NOT EXISTS address_street TEXT DEFAULT '';
ALTER TABLE public.noodle_activation_sku_details ADD COLUMN IF NOT EXISTS address_ward TEXT DEFAULT '';
ALTER TABLE public.noodle_activation_sku_details ADD COLUMN IF NOT EXISTS non_covered_reason TEXT;
ALTER TABLE public.noodle_activation_sku_details ADD COLUMN IF NOT EXISTS myanmar_sub_name TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_sku_details_activation_id ON public.noodle_activation_sku_details (activation_id);
CREATE INDEX IF NOT EXISTS idx_sku_details_invoice_no ON public.noodle_activation_sku_details (invoice_no);
CREATE INDEX IF NOT EXISTS idx_sku_details_date ON public.noodle_activation_sku_details (activation_date DESC);
CREATE INDEX IF NOT EXISTS idx_sku_details_branch ON public.noodle_activation_sku_details (branch);
CREATE INDEX IF NOT EXISTS idx_sku_details_seller ON public.noodle_activation_sku_details (seller_username);
CREATE INDEX IF NOT EXISTS idx_sku_details_route ON public.noodle_activation_sku_details (route_code);
CREATE INDEX IF NOT EXISTS idx_sku_details_sku_id ON public.noodle_activation_sku_details (sku_id);
CREATE INDEX IF NOT EXISTS idx_sku_details_sku_code ON public.noodle_activation_sku_details (sku_code);

ALTER TABLE public.noodle_activation_sku_details ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access for sku details" ON public.noodle_activation_sku_details;
CREATE POLICY "Allow full access for sku details"
  ON public.noodle_activation_sku_details
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.noodle_activation_sku_details REPLICA IDENTITY FULL;

-- =============================================================================
-- 4. TABLE: public.wholesale_stores
-- Searchable Wholesale Store Catalog with Custom Ordering & Realtime Sync
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.wholesale_stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  township TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wholesale_stores_name ON public.wholesale_stores (name);
CREATE INDEX IF NOT EXISTS idx_wholesale_stores_active ON public.wholesale_stores (active);
CREATE INDEX IF NOT EXISTS idx_wholesale_stores_sort ON public.wholesale_stores (sort_order ASC, name ASC);

ALTER TABLE public.wholesale_stores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access for wholesale_stores" ON public.wholesale_stores;
CREATE POLICY "Allow full access for wholesale_stores"
  ON public.wholesale_stores
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.wholesale_stores REPLICA IDENTITY FULL;

INSERT INTO public.wholesale_stores (name, township, region, sort_order)
VALUES
  ('ဝမ်းနိုင်း - C00107520', 'Yangon', 'Yangon East', 1),
  ('ဝင်းမိသားစု - C00143283', 'Yangon', 'Yangon West', 2),
  ('ယမင်း - C00130678', 'Yangon', 'Yangon North', 3),
  ('မိုး - C00113937', 'Mandalay', 'Mandalay Central', 4),
  ('ကောင်းဝင်းထွန်း - C00102815', 'Bago', 'Naypyitaw & Bago', 5)
ON CONFLICT (name) DO UPDATE SET
  township = EXCLUDED.township,
  region = EXCLUDED.region,
  updated_at = NOW();

-- =============================================================================
-- 5. TABLE: public.product_master_skus
-- Shaloot Noodle Product Master List (Prices, Pack Specs, Images, Active Flag)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.product_master_skus (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL DEFAULT '',
  myanmar_sub_name TEXT NOT NULL DEFAULT '',
  pack_spec TEXT NOT NULL DEFAULT '1x30pcs',
  default_ldp_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  accent_color TEXT NOT NULL DEFAULT '#0F2C59',
  image_url TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_master_skus_code ON public.product_master_skus (code);
CREATE INDEX IF NOT EXISTS idx_product_master_skus_active ON public.product_master_skus (active, sort_order ASC);

ALTER TABLE public.product_master_skus ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access for product_master_skus" ON public.product_master_skus;
CREATE POLICY "Allow full access for product_master_skus"
  ON public.product_master_skus
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.product_master_skus REPLICA IDENTITY FULL;

INSERT INTO public.product_master_skus (id, code, name, short_name, myanmar_sub_name, pack_spec, default_ldp_price, accent_color, image_url, active, sort_order)
VALUES
  ('chicken_sichat_52g', 'SHL-CS-52', 'Shaloot Noodle Chicken Sichat 52g (1x30pcs)', 'Chicken Sichat 52g', 'ရှလွတ် ကြက်သားအရသာ ဆီချက်ခေါက်ဆွဲ (52g x 30pcs)', '1x30pcs', 735, '#1D4ED8', '/images/shaloot_chicken_sichat.jpg', TRUE, 1),
  ('coconut_55g', 'SHL-CC-55', 'Shaloot Noodle Coconut 55g (1x30pcs)', 'Coconut 55g', 'ရှလွတ် အုန်းနို့ခေါက်ဆွဲ (55g x 30pcs)', '1x30pcs', 870, '#047857', '/images/shaloot_coconut_noodle.jpg', TRUE, 2),
  ('tom_yum_55g', 'SHL-TY-55', 'Shaloot Noodle Tom Yum 55g (1x30pcs)', 'Tom Yum 55g', 'ရှလွတ် တုံယမ်းခေါက်ဆွဲ (55g x 30pcs)', '1x30pcs', 810, '#DC2626', '/images/shaloot_tomyum_noodle.jpg', TRUE, 3)
ON CONFLICT (id) DO UPDATE SET
  code = EXCLUDED.code,
  name = EXCLUDED.name,
  short_name = EXCLUDED.short_name,
  myanmar_sub_name = EXCLUDED.myanmar_sub_name,
  pack_spec = EXCLUDED.pack_spec,
  default_ldp_price = EXCLUDED.default_ldp_price,
  accent_color = EXCLUDED.accent_color,
  image_url = EXCLUDED.image_url,
  active = EXCLUDED.active,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

-- =============================================================================
-- 6. TABLE: public.user_locations
-- Cross-Device Route Profiles, SKU Catalog Mirror & Offline Sync Payload Store
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.user_locations (
  id TEXT PRIMARY KEY,
  user_id UUID,
  username TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'seller',
  route_code TEXT NOT NULL DEFAULT 'ALL-ROUTES',
  region_scope TEXT NOT NULL DEFAULT 'All Regions',
  supervisor_username TEXT,
  manager_username TEXT,
  wholesale_store_name TEXT DEFAULT '',
  retailer_store_name TEXT DEFAULT '',
  outlet_type TEXT DEFAULT 'Grocery',
  phone_number TEXT DEFAULT '',
  township TEXT DEFAULT '',
  full_address TEXT DEFAULT '',
  invoice_no TEXT DEFAULT '',
  activation_date DATE DEFAULT CURRENT_DATE,
  sales_status BOOLEAN DEFAULT TRUE,
  total_paid_qty INTEGER DEFAULT 0,
  total_foc_qty INTEGER DEFAULT 0,
  grand_total_mmk NUMERIC DEFAULT 0,
  payload JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_locations_user_id ON public.user_locations (user_id);
CREATE INDEX IF NOT EXISTS idx_user_locations_username ON public.user_locations (username);

ALTER TABLE public.user_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access for user_locations" ON public.user_locations;
CREATE POLICY "Allow full access for user_locations"
  ON public.user_locations
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- =============================================================================
-- SUPABASE REALTIME PUBLICATION REGISTRATION
-- =============================================================================
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'app_users',
    'noodle_activations',
    'noodle_activation_sku_details',
    'wholesale_stores',
    'product_master_skus',
    'user_locations'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
    END IF;
  END LOOP;
END $$;

-- =============================================================================
-- 7. ITEMIZED SKU ROWS AUTO-SYNC TRIGGER & EXPORT VIEW
-- =============================================================================
CREATE OR REPLACE FUNCTION public.sync_noodle_activation_sku_details()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_has_active_sku BOOLEAN := FALSE;
BEGIN
  DELETE FROM public.noodle_activation_sku_details
  WHERE activation_id = NEW.id;

  IF NEW.sales_status IS TRUE AND jsonb_typeof(NEW.items) = 'array' THEN
    INSERT INTO public.noodle_activation_sku_details (
      id, activation_id, invoice_no, activation_date, created_at, branch,
      seller_username, seller_name, route_code, supervisor_username, manager_username, region_scope,
      wholesale_store_name, pg_cover, retailer_store_name, outlet_type, phone_number,
      address_no, address_street, address_ward, township, full_address,
      sales_status, non_covered_reason, pricing_mode,
      sku_id, sku_code, sku_name, myanmar_sub_name, pack_spec,
      unit_price, paid_qty, foc_qty, total_qty, line_total_mmk, remarks
    )
    SELECT
      NEW.id || '_' || COALESCE(item->>'skuId', 'sku'),
      NEW.id,
      NEW.invoice_no,
      NEW.activation_date,
      NEW.created_at,
      COALESCE(NEW.branch, 'Yangon'),
      NEW.seller_username,
      NEW.seller_name,
      NEW.route_code,
      COALESCE(NEW.supervisor_username, ''),
      COALESCE(NEW.manager_username, ''),
      COALESCE(NEW.region_scope, ''),
      NEW.wholesale_store_name,
      NEW.pg_cover,
      NEW.retailer_store_name,
      NEW.outlet_type,
      COALESCE(NEW.phone_number, ''),
      COALESCE(NEW.address_no, ''),
      COALESCE(NEW.address_street, ''),
      COALESCE(NEW.address_ward, ''),
      NEW.township,
      COALESCE(NEW.full_address, ''),
      TRUE,
      NULL,
      NEW.pricing_mode,
      COALESCE(item->>'skuId', 'sku'),
      COALESCE(pm.code, item->>'skuId', '-'),
      COALESCE(item->>'skuName', pm.name, item->>'skuId'),
      COALESCE(pm.myanmar_sub_name, ''),
      COALESCE(pm.pack_spec, '1x30pcs'),
      COALESCE((item->>'unitPrice')::NUMERIC, 0),
      COALESCE((item->>'quantity')::INTEGER, 0),
      COALESCE((item->>'focQuantity')::INTEGER, 0),
      COALESCE((item->>'quantity')::INTEGER, 0) + COALESCE((item->>'focQuantity')::INTEGER, 0),
      COALESCE((item->>'lineTotal')::NUMERIC, 0),
      NEW.remarks
    FROM jsonb_array_elements(NEW.items) AS item
    LEFT JOIN public.product_master_skus pm
      ON pm.id = (item->>'skuId')
    WHERE COALESCE((item->>'quantity')::INTEGER, 0) > 0
       OR COALESCE((item->>'focQuantity')::INTEGER, 0) > 0
    ON CONFLICT (id) DO UPDATE SET
      invoice_no = EXCLUDED.invoice_no,
      activation_date = EXCLUDED.activation_date,
      branch = EXCLUDED.branch,
      unit_price = EXCLUDED.unit_price,
      paid_qty = EXCLUDED.paid_qty,
      foc_qty = EXCLUDED.foc_qty,
      total_qty = EXCLUDED.total_qty,
      line_total_mmk = EXCLUDED.line_total_mmk,
      remarks = EXCLUDED.remarks;

    SELECT EXISTS (
      SELECT 1 FROM public.noodle_activation_sku_details WHERE activation_id = NEW.id
    ) INTO v_has_active_sku;
  END IF;

  IF NOT v_has_active_sku THEN
    INSERT INTO public.noodle_activation_sku_details (
      id, activation_id, invoice_no, activation_date, created_at, branch,
      seller_username, seller_name, route_code, supervisor_username, manager_username, region_scope,
      wholesale_store_name, pg_cover, retailer_store_name, outlet_type, phone_number,
      address_no, address_street, address_ward, township, full_address,
      sales_status, non_covered_reason, pricing_mode,
      sku_id, sku_code, sku_name, myanmar_sub_name, pack_spec,
      unit_price, paid_qty, foc_qty, total_qty, line_total_mmk, remarks
    ) VALUES (
      NEW.id || '_no_sale',
      NEW.id,
      NEW.invoice_no,
      NEW.activation_date,
      NEW.created_at,
      COALESCE(NEW.branch, 'Yangon'),
      NEW.seller_username,
      NEW.seller_name,
      NEW.route_code,
      COALESCE(NEW.supervisor_username, ''),
      COALESCE(NEW.manager_username, ''),
      COALESCE(NEW.region_scope, ''),
      NEW.wholesale_store_name,
      NEW.pg_cover,
      NEW.retailer_store_name,
      NEW.outlet_type,
      COALESCE(NEW.phone_number, ''),
      COALESCE(NEW.address_no, ''),
      COALESCE(NEW.address_street, ''),
      COALESCE(NEW.address_ward, ''),
      NEW.township,
      COALESCE(NEW.full_address, ''),
      FALSE,
      COALESCE(NEW.non_covered_reason, 'Recorded Visit'),
      NEW.pricing_mode,
      'none',
      '-',
      'No SKU Sold (Non-Sales Visit)',
      '-',
      '-',
      0, 0, 0, 0, 0,
      COALESCE(NEW.remarks, NEW.non_covered_reason)
    )
    ON CONFLICT (id) DO UPDATE SET
      invoice_no = EXCLUDED.invoice_no,
      activation_date = EXCLUDED.activation_date,
      branch = EXCLUDED.branch,
      non_covered_reason = EXCLUDED.non_covered_reason,
      remarks = EXCLUDED.remarks;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_noodle_activation_sku_details ON public.noodle_activations;
CREATE TRIGGER trg_sync_noodle_activation_sku_details
  AFTER INSERT OR UPDATE ON public.noodle_activations
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_noodle_activation_sku_details();

CREATE OR REPLACE VIEW public.v_itemized_sku_export AS
SELECT
  d.id AS "Row ID",
  d.activation_id AS "Activation ID",
  d.invoice_no AS "Invoice No",
  d.activation_date AS "Activation Date",
  COALESCE(d.branch, a.branch, 'Yangon') AS "Branch",
  COALESCE(d.region_scope, '') AS "Region Scope",
  d.route_code AS "Route Code",
  d.seller_username AS "Seller Username",
  d.seller_name AS "Seller Name",
  COALESCE(d.supervisor_username, '') AS "Supervisor",
  COALESCE(d.manager_username, '') AS "Manager",
  d.wholesale_store_name AS "Wholesale Store Name",
  d.pg_cover AS "PG Cover",
  d.retailer_store_name AS "Retailer Store Name",
  d.outlet_type AS "Outlet Type",
  COALESCE(d.phone_number, '') AS "Phone Number",
  COALESCE(NULLIF(d.address_no, ''), a.address_no, '') AS "Address No",
  COALESCE(NULLIF(d.address_street, ''), a.address_street, '') AS "Street",
  COALESCE(NULLIF(d.address_ward, ''), a.address_ward, '') AS "Ward",
  d.township AS "Township",
  COALESCE(d.full_address, '') AS "Full Address",
  CASE WHEN d.sales_status THEN 'Yes' ELSE 'No' END AS "Sales Status",
  CASE
    WHEN d.sales_status THEN '-'
    ELSE COALESCE(d.non_covered_reason, a.non_covered_reason, 'Recorded Visit')
  END AS "Non-Covered Reason",
  CASE
    WHEN d.pricing_mode = 'manual_wholesale' THEN 'Manual Wholesale Store Price'
    ELSE 'Company LTP Price'
  END AS "Pricing Mode",
  d.sku_id AS "SKU ID",
  d.sku_code AS "SKU Code",
  d.sku_name AS "SKU Name",
  COALESCE(NULLIF(d.myanmar_sub_name, ''), pm.myanmar_sub_name, '-') AS "Myanmar Name",
  COALESCE(d.pack_spec, pm.pack_spec, '1x30pcs') AS "Pack Spec",
  d.unit_price AS "Unit Price (MMK)",
  d.paid_qty AS "Paid Qty",
  d.foc_qty AS "FOC Qty (0 MMK)",
  d.total_qty AS "Total Qty",
  d.line_total_mmk AS "Line Total (MMK)",
  COALESCE(d.remarks, '') AS "Remarks"
FROM public.noodle_activation_sku_details d
LEFT JOIN public.noodle_activations a
  ON a.id = d.activation_id
LEFT JOIN public.product_master_skus pm
  ON pm.id = d.sku_id
ORDER BY d.activation_date DESC, d.invoice_no DESC, d.sku_code ASC;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.v_itemized_sku_export TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;
NOTIFY pgrst, 'reload schema';


