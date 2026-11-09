import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createHttpExecutor, createSqlServerClient } from './sqlServerClient';

/**
 * Data backend switch.
 *   VITE_DATA_BACKEND=sqlserver -> all `supabase.from(...)` calls go to the
 *                                  Express server (/api/db), which runs them on
 *                                  SQL Server. Realtime becomes 10-second polling.
 *   anything else (default)     -> Supabase, as before.
 */
export const isSqlServerBackend =
  String(import.meta.env.VITE_DATA_BACKEND || '').trim().toLowerCase() === 'sqlserver';

function sanitizeSupabaseUrl(raw: unknown): string {
  const cleaned = String(raw ?? '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .trim()
    .replace(/\/rest\/v1\/?$/i, '')
    .replace(/\/+$/, '');

  if (!cleaned) return '';
  if (cleaned.startsWith('http://') && cleaned.includes('.supabase.co')) {
    return cleaned.replace(/^http:\/\//i, 'https://');
  }
  return cleaned;
}

function sanitizeSupabaseKey(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/\s+/g, '');
}

const supabaseUrl = sanitizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL);
const supabaseAnonKey = sanitizeSupabaseKey(
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export const isSupabaseConfigured = isSqlServerBackend || Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    /^https?:\/\//i.test(supabaseUrl) &&
    !supabaseUrl.includes('your-project-id') &&
    !supabaseUrl.includes('your-project-ref') &&
    supabaseAnonKey !== 'your-supabase-anon-key' &&
    supabaseAnonKey !== 'your-supabase-anon-or-publishable-key'
);

// Purge any stale GoTrue JWT token from localStorage so custom RBAC queries
// against public.app_users never fail with HTTP 401 PGRST301 (JWT expired).
if (typeof window !== 'undefined') {
  try {
    window.localStorage.removeItem('supabase.auth.token');
  } catch {
    // Ignore restricted storage
  }
}

// Standard CORS-safe fetch WITHOUT keepalive:true (keepalive enforces a hard
// 64 KiB payload ceiling in Chromium/Safari that aborts batch upserts over HTTPS).
const corsSafeFetch: typeof fetch = (input, init) => {
  const fetchFn =
    typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function'
      ? globalThis.fetch.bind(globalThis)
      : window.fetch.bind(window);

  if (!init) {
    return fetchFn(input);
  }

  const nextInit: RequestInit = { ...init };
  if ('keepalive' in nextInit) {
    delete nextInit.keepalive;
  }
  return fetchFn(input, nextInit);
};

// In SQL Server mode the drop-in client is typed as SupabaseClient so the
// existing services compile unchanged; it implements the subset they use.
export const supabase: SupabaseClient | null = isSqlServerBackend
  ? (createSqlServerClient(createHttpExecutor()) as unknown as SupabaseClient)
  : isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: corsSafeFetch,
      },
    })
  : null;

let localExpressApiAvailable: boolean | null = null;

/**
 * Safely calls local Express /api/* routes during local development and
 * automatically bypasses them on static hosts (such as Netlify) where no
 * Node backend runs and /api/* returns 404 or SPA text/html.
 */
export async function safeLocalApiFetch(
  url: string,
  init?: RequestInit
): Promise<Response | null> {
  if (localExpressApiAvailable === false) {
    return null;
  }

  // On production static deployments (e.g. *.netlify.app) when Supabase is configured,
  // skip unnecessary /api/* roundtrips once detected or if not running on localhost/Express.
  if (
    typeof window !== 'undefined' &&
    !isSqlServerBackend &&
    isSupabaseConfigured &&
    window.location.hostname.endsWith('.netlify.app')
  ) {
    localExpressApiAvailable = false;
    return null;
  }

  try {
    const res = await fetch(url, init);
    const contentType = (res.headers.get('content-type') || '').toLowerCase();

    // Static SPA hosts return 404/405 or 200 text/html for /api/* routes
    if (
      res.status === 404 ||
      res.status === 405 ||
      contentType.includes('text/html')
    ) {
      localExpressApiAvailable = false;
      return null;
    }

    if (res.ok && contentType.includes('application/json')) {
      localExpressApiAvailable = true;
      return res;
    }

    return null;
  } catch {
    return null;
  }
}

export const SUPABASE_TABLE_DDL = `-- Run this in your Supabase SQL Editor to initialize tables, grants, RLS policies, and Realtime

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- 1. Table: app_users (User Accounts, 6 RBAC Roles, Routes & Credentials)
CREATE TABLE IF NOT EXISTS public.app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'seller',
  route_code TEXT NOT NULL DEFAULT 'ALL-ROUTES',
  region_scope TEXT NOT NULL DEFAULT 'All Regions',
  supervisor_username TEXT,
  manager_username TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS full_name TEXT NOT NULL DEFAULT '';
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'seller';
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS route_code TEXT NOT NULL DEFAULT 'ALL-ROUTES';
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS region_scope TEXT NOT NULL DEFAULT 'All Regions';
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS supervisor_username TEXT;
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS manager_username TEXT;
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access for app_users" ON public.app_users;
CREATE POLICY "Allow full access for app_users"
  ON public.app_users
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- Seed / Upsert all 27 Organizational Accounts (Admin, NSM, Brand Manager, 4 Managers, 5 Supervisors, 15 Sellers)
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

-- 2. Table: noodle_activations (Field Activation & Sales Collection)
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

ALTER TABLE public.noodle_activations ADD COLUMN IF NOT EXISTS branch TEXT DEFAULT 'Yangon';
CREATE INDEX IF NOT EXISTS idx_noodle_activations_date ON public.noodle_activations (activation_date DESC);
CREATE INDEX IF NOT EXISTS idx_noodle_activations_seller ON public.noodle_activations (seller_username);
CREATE INDEX IF NOT EXISTS idx_noodle_activations_route ON public.noodle_activations (route_code);

ALTER TABLE public.noodle_activations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access for noodle_activations" ON public.noodle_activations;
CREATE POLICY "Allow full access for noodle_activations"
  ON public.noodle_activations
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- 3. Table: noodle_activation_sku_details (Itemized SKU Rows)
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
CREATE INDEX IF NOT EXISTS idx_sku_details_sku_id ON public.noodle_activation_sku_details (sku_id);

ALTER TABLE public.noodle_activation_sku_details ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow full access for sku details" ON public.noodle_activation_sku_details;
CREATE POLICY "Allow full access for sku details"
  ON public.noodle_activation_sku_details
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- 4. Table: user_locations (Cross-Device User Route, SKU Catalog & Activation Payload Mirror)
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

-- 5. Table: wholesale_stores ("Wholesale Store Name" Catalog with Realtime Sync)
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

-- 6. Table: product_master_skus (Shaloot Noodle Product Master List)
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

-- Enable Supabase Realtime for all core operational tables
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['app_users', 'noodle_activations', 'noodle_activation_sku_details', 'user_locations', 'wholesale_stores', 'product_master_skus']
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

ALTER TABLE public.wholesale_stores REPLICA IDENTITY FULL;
ALTER TABLE public.product_master_skus REPLICA IDENTITY FULL;

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

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
`;

export const SUPABASE_WHOLESALE_STORES_SQL = `-- Run this in your Supabase SQL Editor to create the wholesale_stores table with Realtime Sync

GRANT USAGE ON SCHEMA public TO anon, authenticated;

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
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.wholesale_stores TO anon, authenticated;
DROP POLICY IF EXISTS "Allow full access for wholesale_stores" ON public.wholesale_stores;
CREATE POLICY "Allow full access for wholesale_stores"
  ON public.wholesale_stores
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'wholesale_stores'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.wholesale_stores;
  END IF;
END $$;

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

NOTIFY pgrst, 'reload schema';
`;

export const SUPABASE_LINTER_FIX_SQL = `-- Run this in your Supabase SQL Editor to verify grants, RLS policies, foreign key indexes, and PostgREST schema cache

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;

ALTER TABLE IF EXISTS public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.noodle_activations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.noodle_activation_sku_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.user_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.wholesale_stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.product_master_skus ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_sku_details_activation_id ON public.noodle_activation_sku_details (activation_id);
CREATE INDEX IF NOT EXISTS idx_sku_details_invoice_no ON public.noodle_activation_sku_details (invoice_no);
CREATE INDEX IF NOT EXISTS idx_sku_details_date ON public.noodle_activation_sku_details (activation_date DESC);
CREATE INDEX IF NOT EXISTS idx_sku_details_seller ON public.noodle_activation_sku_details (seller_username);
CREATE INDEX IF NOT EXISTS idx_user_locations_user_id ON public.user_locations (user_id);
CREATE INDEX IF NOT EXISTS idx_user_locations_username ON public.user_locations (username);
CREATE INDEX IF NOT EXISTS idx_wholesale_stores_name ON public.wholesale_stores (name);
CREATE INDEX IF NOT EXISTS idx_wholesale_stores_sort ON public.wholesale_stores (sort_order ASC, name ASC);
CREATE INDEX IF NOT EXISTS idx_product_master_skus_code ON public.product_master_skus (code);

ANALYZE public.app_users;
ANALYZE public.noodle_activations;
ANALYZE public.noodle_activation_sku_details;
ANALYZE public.user_locations;
ANALYZE public.wholesale_stores;
ANALYZE public.product_master_skus;

NOTIFY pgrst, 'reload schema';
`;

export const SUPABASE_ITEMIZED_SKU_ROWS_SQL = `-- =============================================================================
-- Itemized SKU Rows Table, Auto-Sync Trigger, Backfill & Export View
-- Run this in your Supabase SQL Editor
-- =============================================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- 1. Create / Upgrade Itemized SKU Rows Table
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

-- Safe migrations for existing deployments
ALTER TABLE public.noodle_activation_sku_details ADD COLUMN IF NOT EXISTS branch TEXT DEFAULT 'Yangon';
ALTER TABLE public.noodle_activation_sku_details ADD COLUMN IF NOT EXISTS address_no TEXT DEFAULT '';
ALTER TABLE public.noodle_activation_sku_details ADD COLUMN IF NOT EXISTS address_street TEXT DEFAULT '';
ALTER TABLE public.noodle_activation_sku_details ADD COLUMN IF NOT EXISTS address_ward TEXT DEFAULT '';
ALTER TABLE public.noodle_activation_sku_details ADD COLUMN IF NOT EXISTS non_covered_reason TEXT;
ALTER TABLE public.noodle_activation_sku_details ADD COLUMN IF NOT EXISTS myanmar_sub_name TEXT DEFAULT '';

-- 2. Performance Indexes for Export & Slicers
CREATE INDEX IF NOT EXISTS idx_sku_details_activation_id ON public.noodle_activation_sku_details (activation_id);
CREATE INDEX IF NOT EXISTS idx_sku_details_invoice_no ON public.noodle_activation_sku_details (invoice_no);
CREATE INDEX IF NOT EXISTS idx_sku_details_date ON public.noodle_activation_sku_details (activation_date DESC);
CREATE INDEX IF NOT EXISTS idx_sku_details_branch ON public.noodle_activation_sku_details (branch);
CREATE INDEX IF NOT EXISTS idx_sku_details_seller ON public.noodle_activation_sku_details (seller_username);
CREATE INDEX IF NOT EXISTS idx_sku_details_route ON public.noodle_activation_sku_details (route_code);
CREATE INDEX IF NOT EXISTS idx_sku_details_sku_id ON public.noodle_activation_sku_details (sku_id);
CREATE INDEX IF NOT EXISTS idx_sku_details_sku_code ON public.noodle_activation_sku_details (sku_code);

-- 3. Row Level Security, Grants & Realtime Publication
ALTER TABLE public.noodle_activation_sku_details ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.noodle_activation_sku_details TO anon, authenticated;

DROP POLICY IF EXISTS "Allow full access for sku details" ON public.noodle_activation_sku_details;
CREATE POLICY "Allow full access for sku details"
  ON public.noodle_activation_sku_details
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.noodle_activation_sku_details REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'noodle_activation_sku_details'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.noodle_activation_sku_details;
  END IF;
END $$;

-- 4. Automatic Trigger: Sync noodle_activations.items JSONB -> noodle_activation_sku_details
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
      seller_username = EXCLUDED.seller_username,
      seller_name = EXCLUDED.seller_name,
      route_code = EXCLUDED.route_code,
      supervisor_username = EXCLUDED.supervisor_username,
      manager_username = EXCLUDED.manager_username,
      region_scope = EXCLUDED.region_scope,
      wholesale_store_name = EXCLUDED.wholesale_store_name,
      pg_cover = EXCLUDED.pg_cover,
      retailer_store_name = EXCLUDED.retailer_store_name,
      outlet_type = EXCLUDED.outlet_type,
      phone_number = EXCLUDED.phone_number,
      address_no = EXCLUDED.address_no,
      address_street = EXCLUDED.address_street,
      address_ward = EXCLUDED.address_ward,
      township = EXCLUDED.township,
      full_address = EXCLUDED.full_address,
      pricing_mode = EXCLUDED.pricing_mode,
      sku_code = EXCLUDED.sku_code,
      sku_name = EXCLUDED.sku_name,
      myanmar_sub_name = EXCLUDED.myanmar_sub_name,
      pack_spec = EXCLUDED.pack_spec,
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

-- 5. Export-Ready SQL View (public.v_itemized_sku_export) matching Excel/CSV Export Columns
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

GRANT SELECT ON public.v_itemized_sku_export TO anon, authenticated;

-- 6. Backfill Itemized SKU Rows from Existing noodle_activations Records
UPDATE public.noodle_activations SET id = id;

NOTIFY pgrst, 'reload schema';
`;

