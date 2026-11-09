import 'dotenv/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import express from 'express';
import {
  checkSqlServerConnection,
  executeDbQuery,
  getTableVersions,
  isSqlServerBackend,
  serverSqlExecutor,
} from './server/sqlServerDb.ts';
import { createSqlServerClient } from './src/lib/sqlServerClient.ts';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import type {
  NoodleActivationRecord,
  SkuDefinition,
  UserAccount,
  UserRole,
} from './src/types/index.ts';

interface WholesaleStoreEntry {
  id?: string;
  name: string;
  township?: string;
  region?: string;
  active?: boolean;
  sort_order?: number;
}

interface ServerDatabase {
  users: UserAccount[];
  skus: SkuDefinition[];
  wholesaleStores: WholesaleStoreEntry[];
  activations: NoodleActivationRecord[];
}

const supabaseUrl =
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  '';

const hasServerSupabase = Boolean(
  supabaseUrl &&
    supabaseKey &&
    supabaseUrl.startsWith('http') &&
    !supabaseUrl.includes('your-project-id') &&
    supabaseKey !== 'your-supabase-anon-key'
);

// DATA_BACKEND=sqlserver -> the same query API, executed on SQL Server
const serverSupabase: SupabaseClient | null = isSqlServerBackend()
  ? (createSqlServerClient(serverSqlExecutor) as unknown as SupabaseClient)
  : hasServerSupabase
    ? createClient(supabaseUrl, supabaseKey)
    : null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_FILE = path.join(__dirname, 'server_db.json');
const DATA_DIR = path.join(__dirname, 'data');

const DEFAULT_SKUS: SkuDefinition[] = [
  {
    id: 'chicken_sichat_52g',
    code: 'SHL-CS-52',
    name: 'Shaloot Noodle Chicken Sichat 52g (1x30pcs)',
    myanmarSubName: 'ရှလွတ် ကြက်သားအရသာ ဆီချက်ခေါက်ဆွဲ (52g x 30pcs)',
    packSpec: '1x30pcs',
    defaultLdpPrice: 735,
    imageUrl: '/images/shaloot_chicken_sichat.jpg',
    accentColor: 'amber',
    active: true,
  },
  {
    id: 'coconut_55g',
    code: 'SHL-CC-55',
    name: 'Shaloot Noodle Coconut 55g (1x30pcs)',
    myanmarSubName: 'ရှလွတ် ကြက်သားအရသာ အုန်းနို့ခေါက်ဆွဲ (55g x 30pcs)',
    packSpec: '1x30pcs',
    defaultLdpPrice: 870,
    imageUrl: '/images/shaloot_coconut_noodle.jpg',
    accentColor: 'yellow',
    active: true,
  },
  {
    id: 'tom_yum_55g',
    code: 'SHL-TY-55',
    name: 'Shaloot Noodle Tom Yum 55g (1x30pcs)',
    myanmarSubName: 'ရှလွတ် ပုစွန်အရသာ တုံယမ်းချဉ်စပ်ခေါက်ဆွဲ (55g x 30pcs)',
    packSpec: '1x30pcs',
    defaultLdpPrice: 810,
    imageUrl: '/images/shaloot_tomyum_noodle.jpg',
    accentColor: 'rose',
    active: true,
  },
];

const DEFAULT_WHOLESALE_STORES: WholesaleStoreEntry[] = [
  { name: 'ဝမ်းနိုင်း - C00107520', township: 'Yangon', region: 'Yangon East', sort_order: 1 },
  { name: 'ဝင်းမိသားစု - C00143283', township: 'Yangon', region: 'Yangon West', sort_order: 2 },
  { name: 'ယမင်း - C00130678', township: 'Yangon', region: 'Yangon North', sort_order: 3 },
  { name: 'မိုး - C00113937', township: 'Mandalay', region: 'Mandalay Central', sort_order: 4 },
  { name: 'ကောင်းဝင်းထွန်း - C00102815', township: 'Bago', region: 'Naypyitaw & Bago', sort_order: 5 },
];

const DEFAULT_USERS: UserAccount[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    username: 'admin',
    password: 'password123',
    fullName: 'U Kyaw Zay Ya (System Admin)',
    role: 'admin' as UserRole,
    routeCode: 'ALL-ROUTES',
    regionScope: 'All Regions (National)',
    branch: 'Yangon',
    active: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000099',
    username: 'nsm1',
    password: 'password123',
    fullName: 'U Myo Min (National Sales Manager)',
    role: 'nsm' as UserRole,
    routeCode: 'ALL-BRANCHES',
    regionScope: 'National Head Office (All Branches)',
    branch: 'Yangon',
    active: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000098',
    username: 'brandmanager1',
    password: 'password123',
    fullName: 'Daw Phyu Phyu Thin (Brand Manager - Shaloot)',
    role: 'brand_manager' as UserRole,
    routeCode: 'BRAND-ALL',
    regionScope: 'Brand Portfolio (National)',
    branch: 'Yangon',
    active: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000101',
    username: 'manager1',
    password: 'password123',
    fullName: 'U Aung Ko Latt (Yangon East & West)',
    role: 'manager' as UserRole,
    routeCode: 'MGR-YGN-EW',
    regionScope: 'Yangon East & West',
    branch: 'Yangon',
    active: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000102',
    username: 'manager2',
    password: 'password123',
    fullName: 'Daw Su Su Hlaing (Yangon North)',
    role: 'manager' as UserRole,
    routeCode: 'MGR-YGN-N',
    regionScope: 'Yangon North',
    branch: 'Yangon',
    active: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000103',
    username: 'manager3',
    password: 'password123',
    fullName: 'U Min Thu (Mandalay Central)',
    role: 'manager' as UserRole,
    routeCode: 'MGR-MDY-C',
    regionScope: 'Mandalay Central',
    branch: 'Mandalay',
    active: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000104',
    username: 'manager4',
    password: 'password123',
    fullName: 'U Zaw Win Naing (Naypyitaw & Bago)',
    role: 'manager' as UserRole,
    routeCode: 'MGR-NPT-S',
    regionScope: 'Naypyitaw & Bago',
    branch: 'Naypyitaw',
    active: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000201',
    username: 'supervisor1',
    password: 'password123',
    fullName: 'Ko Thura Aung (Team Alpha - YGN East)',
    role: 'supervisor' as UserRole,
    routeCode: 'SUP-TEAM-01',
    regionScope: 'Yangon East',
    branch: 'Yangon',
    managerUsername: 'manager1',
    active: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000202',
    username: 'supervisor2',
    password: 'password123',
    fullName: 'Ko Htet Naing (Team Beta - YGN West)',
    role: 'supervisor' as UserRole,
    routeCode: 'SUP-TEAM-02',
    regionScope: 'Yangon West',
    branch: 'Yangon',
    managerUsername: 'manager1',
    active: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000203',
    username: 'supervisor3',
    password: 'password123',
    fullName: 'Ma Phyu Phyu Thin (Team Gamma - YGN North)',
    role: 'supervisor' as UserRole,
    routeCode: 'SUP-TEAM-03',
    regionScope: 'Yangon North',
    branch: 'Yangon',
    managerUsername: 'manager2',
    active: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000204',
    username: 'supervisor4',
    password: 'password123',
    fullName: 'Ko Ye Yint (Team Delta - Mandalay)',
    role: 'supervisor' as UserRole,
    routeCode: 'SUP-TEAM-04',
    regionScope: 'Mandalay Central',
    branch: 'Mandalay',
    managerUsername: 'manager3',
    active: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000205',
    username: 'supervisor5',
    password: 'password123',
    fullName: 'Ko Nay Lin (Team Epsilon - NPT/Bago)',
    role: 'supervisor' as UserRole,
    routeCode: 'SUP-TEAM-05',
    regionScope: 'Naypyitaw & Bago',
    branch: 'Naypyitaw',
    managerUsername: 'manager4',
    active: true,
  },
  {
    id: '7ff1e036-e3e8-48c7-b071-de40ac76d8be',
    username: 'seller1',
    password: 'password123',
    fullName: 'Kyaw Swar Lin',
    role: 'seller' as UserRole,
    routeCode: 'RT-YGN-01',
    regionScope: 'Yangon East',
    branch: 'Yangon',
    supervisorUsername: 'supervisor1',
    managerUsername: 'manager1',
    active: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000302',
    username: 'seller2',
    password: 'password123',
    fullName: 'Zin Mar Oo',
    role: 'seller' as UserRole,
    routeCode: 'RT-YGN-02',
    regionScope: 'Yangon East',
    branch: 'Yangon',
    supervisorUsername: 'supervisor1',
    managerUsername: 'manager1',
    active: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000303',
    username: 'seller3',
    password: 'password123',
    fullName: 'Wai Yan Phyo',
    role: 'seller' as UserRole,
    routeCode: 'RT-YGN-03',
    regionScope: 'Yangon East',
    branch: 'Yangon',
    supervisorUsername: 'supervisor1',
    managerUsername: 'manager1',
    active: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000304',
    username: 'seller4',
    password: 'password123',
    fullName: 'Myo Min Hein',
    role: 'seller' as UserRole,
    routeCode: 'RT-YGN-04',
    regionScope: 'Yangon West',
    branch: 'Yangon',
    supervisorUsername: 'supervisor2',
    managerUsername: 'manager1',
    active: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000305',
    username: 'seller5',
    password: 'password123',
    fullName: 'Eiandar Kyaw',
    role: 'seller' as UserRole,
    routeCode: 'RT-YGN-05',
    regionScope: 'Yangon West',
    branch: 'Yangon',
    supervisorUsername: 'supervisor2',
    managerUsername: 'manager1',
    active: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000306',
    username: 'seller6',
    password: 'password123',
    fullName: 'Soe Pyae Aung',
    role: 'seller' as UserRole,
    routeCode: 'RT-YGN-06',
    regionScope: 'Yangon West',
    branch: 'Yangon',
    supervisorUsername: 'supervisor2',
    managerUsername: 'manager1',
    active: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000307',
    username: 'seller7',
    password: 'password123',
    fullName: 'Hnin Wai Lwin',
    role: 'seller' as UserRole,
    routeCode: 'RT-YGN-07',
    regionScope: 'Yangon North',
    branch: 'Yangon',
    supervisorUsername: 'supervisor3',
    managerUsername: 'manager2',
    active: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000308',
    username: 'seller8',
    password: 'password123',
    fullName: 'Kaung Myat Thu',
    role: 'seller' as UserRole,
    routeCode: 'RT-YGN-08',
    regionScope: 'Yangon North',
    branch: 'Yangon',
    supervisorUsername: 'supervisor3',
    managerUsername: 'manager2',
    active: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000309',
    username: 'seller9',
    password: 'password123',
    fullName: 'May Thu Aung',
    role: 'seller' as UserRole,
    routeCode: 'RT-YGN-09',
    regionScope: 'Yangon North',
    branch: 'Yangon',
    supervisorUsername: 'supervisor3',
    managerUsername: 'manager2',
    active: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000310',
    username: 'seller10',
    password: 'password123',
    fullName: 'Aung Myo Khaing',
    role: 'seller' as UserRole,
    routeCode: 'RT-MDY-10',
    regionScope: 'Mandalay Central',
    branch: 'Mandalay',
    supervisorUsername: 'supervisor4',
    managerUsername: 'manager3',
    active: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000311',
    username: 'seller11',
    password: 'password123',
    fullName: 'Thazin Nwe',
    role: 'seller' as UserRole,
    routeCode: 'RT-MDY-11',
    regionScope: 'Mandalay Central',
    branch: 'Mandalay',
    supervisorUsername: 'supervisor4',
    managerUsername: 'manager3',
    active: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000312',
    username: 'seller12',
    password: 'password123',
    fullName: 'Pyae Sone Tun',
    role: 'seller' as UserRole,
    routeCode: 'RT-MDY-12',
    regionScope: 'Mandalay Central',
    branch: 'Mandalay',
    supervisorUsername: 'supervisor4',
    managerUsername: 'manager3',
    active: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000313',
    username: 'seller13',
    password: 'password123',
    fullName: 'Nandar Lin',
    role: 'seller' as UserRole,
    routeCode: 'RT-NPT-13',
    regionScope: 'Naypyitaw & Bago',
    branch: 'Naypyitaw',
    supervisorUsername: 'supervisor5',
    managerUsername: 'manager4',
    active: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000314',
    username: 'seller14',
    password: 'password123',
    fullName: 'Chit Ko Ko',
    role: 'seller' as UserRole,
    routeCode: 'RT-NPT-14',
    regionScope: 'Naypyitaw & Bago',
    branch: 'Naypyitaw',
    supervisorUsername: 'supervisor5',
    managerUsername: 'manager4',
    active: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000315',
    username: 'seller15',
    password: 'password123',
    fullName: 'Su Myat Noe',
    role: 'seller' as UserRole,
    routeCode: 'RT-BGO-15',
    regionScope: 'Naypyitaw & Bago',
    branch: 'Bago',
    supervisorUsername: 'supervisor5',
    managerUsername: 'manager4',
    active: true,
  },
];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ensureServerUuid(rawId: string | undefined, username: string): string {
  const trimmed = String(rawId || '').trim();
  if (UUID_PATTERN.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  const lowerName = String(username || '').trim().toLowerCase();
  if (lowerName === 'admin') {
    return '00000000-0000-4000-8000-000000000001';
  }
  if (lowerName === 'aks') {
    return '93875359-ea2f-48f9-8188-8f1ada228c1e';
  }
  const preset = DEFAULT_USERS.find(
    (u) => u.username.toLowerCase() === lowerName
  );
  if (preset && UUID_PATTERN.test(preset.id)) {
    return preset.id.toLowerCase();
  }
  let hash = 0;
  const seed = `${lowerName}:${trimmed || 'user'}`;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const hex = hash.toString(16).padStart(12, '0').slice(0, 12);
  return `00000000-0000-4000-8000-${hex}`;
}

function mergeServerUsers(
  ...lists: Array<UserAccount[] | undefined>
): UserAccount[] {
  const byId = new Map<string, UserAccount>();
  const usernameToId = new Map<string, string>();

  const putUser = (u: UserAccount) => {
    if (!u || !u.username) return;
    const validId = ensureServerUuid(u.id, u.username);
    const lower = u.username.trim().toLowerCase();
    const targetId = usernameToId.get(lower) || validId;
    const prev = byId.get(targetId);

    const merged: UserAccount = {
      ...prev,
      ...u,
      id: targetId,
      username: u.username.trim(),
      password: u.password || prev?.password || 'password123',
      fullName: u.fullName?.trim() || prev?.fullName || u.username.trim(),
      role: (u.role || prev?.role || 'seller') as UserRole,
      routeCode: u.routeCode?.trim() || prev?.routeCode || 'ALL-ROUTES',
      regionScope: u.regionScope?.trim() || prev?.regionScope || 'All Regions',
      active: u.active !== undefined ? Boolean(u.active) : prev?.active ?? true,
    };

    if (prev && prev.username.toLowerCase() !== lower) {
      usernameToId.delete(prev.username.toLowerCase());
    }
    byId.set(targetId, merged);
    usernameToId.set(lower, targetId);
  };

  for (const initU of DEFAULT_USERS) {
    putUser(initU);
  }
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const u of list) {
      putUser(u);
    }
  }
  return Array.from(byId.values());
}

async function hydrateServerUsersFromSupabase(): Promise<UserAccount[] | null> {
  if (!serverSupabase) return null;

  try {
    const { data: appRows } = await serverSupabase
      .from('app_users')
      .select('*')
      .range(0, 999);

    if (!Array.isArray(appRows) || appRows.length === 0) {
      return null;
    }

    const fromAppUsers: UserAccount[] = appRows
      .filter((r) => r && r.username)
      .map((row) => {
        const username = String(row.username || '').trim();
        const validId = ensureServerUuid(
          row.id ? String(row.id) : undefined,
          username
        );
        const preset = DEFAULT_USERS.find(
          (u) =>
            u.id === validId ||
            u.username.toLowerCase() === username.toLowerCase()
        );
        const rawFullName = row.full_name ?? row.fullName;

        return {
          id: validId,
          username,
          password:
            row.password !== undefined &&
            row.password !== null &&
            String(row.password) !== ''
              ? String(row.password)
              : preset?.password || 'password123',
          fullName:
            rawFullName && String(rawFullName).trim()
              ? String(rawFullName).trim()
              : preset?.fullName || username,
          role: (row.role || preset?.role || 'seller') as UserRole,
          routeCode:
            row.route_code ?? row.routeCode ?? preset?.routeCode ?? 'ALL-ROUTES',
          regionScope:
            row.region_scope ??
            row.regionScope ??
            preset?.regionScope ??
            'All Regions',
          supervisorUsername:
            row.supervisor_username ??
            row.supervisorUsername ??
            preset?.supervisorUsername ??
            undefined,
          managerUsername:
            row.manager_username ??
            row.managerUsername ??
            preset?.managerUsername ??
            undefined,
          active:
            row.active !== undefined && row.active !== null
              ? Boolean(row.active)
              : preset?.active ?? true,
        };
      });

    return mergeServerUsers(fromAppUsers);
  } catch {
    return null;
  }
}

function normalizeSkuImages(skus: SkuDefinition[]): SkuDefinition[] {
  return skus.map((sku) => {
    const fallback = DEFAULT_SKUS.find((s) => s.id === sku.id);
    if (
      !sku.imageUrl ||
      sku.imageUrl.startsWith('file://') ||
      sku.imageUrl.startsWith('/src/assets/images/')
    ) {
      return {
        ...sku,
        imageUrl: fallback ? fallback.imageUrl : '/images/shaloot_chicken_sichat.jpg',
        active: sku.active !== undefined ? Boolean(sku.active) : true,
      };
    }
    return {
      ...sku,
      active: sku.active !== undefined ? Boolean(sku.active) : true,
    };
  });
}

function loadDatabase(): ServerDatabase {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const initialDb: ServerDatabase = {
        users: mergeServerUsers(DEFAULT_USERS),
        skus: DEFAULT_SKUS,
        wholesaleStores: DEFAULT_WHOLESALE_STORES,
        activations: [],
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(initialDb, null, 2), 'utf-8');
      return initialDb;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ServerDatabase>;
    return {
      users: mergeServerUsers(parsed.users),
      skus:
        Array.isArray(parsed.skus) && parsed.skus.length > 0
          ? normalizeSkuImages(parsed.skus)
          : DEFAULT_SKUS,
      wholesaleStores:
        Array.isArray(parsed.wholesaleStores) &&
        parsed.wholesaleStores.length > 0
          ? parsed.wholesaleStores
          : DEFAULT_WHOLESALE_STORES,
      activations: Array.isArray(parsed.activations) ? parsed.activations : [],
    };
  } catch {
    return {
      users: mergeServerUsers(DEFAULT_USERS),
      skus: DEFAULT_SKUS,
      wholesaleStores: DEFAULT_WHOLESALE_STORES,
      activations: [],
    };
  }
}

function saveDatabase(db: ServerDatabase): void {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to write server_db.json:', err);
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // SQL Server data API (used by src/lib/sqlServerClient.ts). Registered before
  // the global 5mb JSON parser because bulk syncs can send large batches.
  app.post('/api/db/query', express.json({ limit: '50mb' }), async (req, res) => {
    if (!isSqlServerBackend()) {
      res.status(404).json({ data: null, error: { message: 'SQL Server backend is not enabled (DATA_BACKEND)' } });
      return;
    }
    const result = await executeDbQuery(req.body);
    res.status(result.error ? result.status : 200).json(result);
  });

  app.get('/api/db/versions', (_req, res) => {
    if (!isSqlServerBackend()) {
      res.status(404).json({ error: 'SQL Server backend is not enabled' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json(getTableVersions());
  });

  app.use(express.json({ limit: '5mb' }));

  const publicFolder = path.join(__dirname, 'public');
  if (fs.existsSync(publicFolder)) {
    app.use(express.static(publicFolder));
  }

  const legacyAssetsFolder = path.join(__dirname, 'src', 'assets', 'images');
  if (fs.existsSync(legacyAssetsFolder)) {
    app.use('/src/assets/images', express.static(legacyAssetsFolder));
  }

  app.get('/favicon.ico', (_req, res) => {
    const faviconFile = path.join(publicFolder, 'favicon.ico');
    if (fs.existsSync(faviconFile)) {
      res.sendFile(faviconFile);
    } else {
      res.status(204).end();
    }
  });

  // 1. Users & Authentication API
  app.get('/api/users', async (_req, res) => {
    const db = loadDatabase();
    const liveUsers = await hydrateServerUsersFromSupabase();
    if (liveUsers && liveUsers.length > 0) {
      db.users = mergeServerUsers(db.users, liveUsers);
      saveDatabase(db);
    }
    res.json({ users: db.users });
  });

  app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body as {
      username?: string;
      password?: string;
    };
    const db = loadDatabase();
    const liveUsers = await hydrateServerUsersFromSupabase();
    if (liveUsers && liveUsers.length > 0) {
      db.users = mergeServerUsers(db.users, liveUsers);
      saveDatabase(db);
    }

    const trimmed = (username || '').trim().toLowerCase();
    const matched = db.users.find((u) => u.username.toLowerCase() === trimmed);

    if (!matched) {
      res
        .status(401)
        .json({ error: 'Username not found. Please check your username.' });
      return;
    }
    if (!matched.active) {
      res.status(403).json({
        error:
          'This account is currently inactive. Contact the System Administrator.',
      });
      return;
    }
    if (matched.password !== password) {
      res
        .status(401)
        .json({ error: 'Invalid password for the selected account.' });
      return;
    }

    res.json({ user: matched });
  });

  app.put('/api/users', (req, res) => {
    const { users } = req.body as { users?: UserAccount[] };
    if (!Array.isArray(users)) {
      res.status(400).json({ error: 'Invalid users payload' });
      return;
    }
    const db = loadDatabase();
    db.users = mergeServerUsers(db.users, users);
    saveDatabase(db);
    res.json({ ok: true, users: db.users });
  });

  app.put('/api/users/:id', (req, res) => {
    const { id } = req.params;
    const { user, previousUsername } = req.body as {
      user?: UserAccount;
      previousUsername?: string;
    };
    if (!user || !user.id) {
      res.status(400).json({ error: 'Invalid user payload' });
      return;
    }
    const normalizedUser: UserAccount = {
      ...user,
      id: ensureServerUuid(user.id, user.username),
    };
    const db = loadDatabase();
    const existing = db.users.find(
      (u) => u.id === id || u.id === user.id || u.id === normalizedUser.id
    );
    const oldUsername =
      previousUsername || existing?.username || normalizedUser.username;

    const existsInDb = db.users.some(
      (u) =>
        u.id === normalizedUser.id ||
        u.id === user.id ||
        u.username.toLowerCase() === oldUsername.toLowerCase()
    );

    if (existsInDb) {
      db.users = db.users.map((u) =>
        u.id === normalizedUser.id ||
        u.id === user.id ||
        u.username.toLowerCase() === oldUsername.toLowerCase()
          ? normalizedUser
          : u
      );
    } else {
      db.users = [...db.users, normalizedUser];
    }
    db.users = mergeServerUsers(db.users);

    db.activations = db.activations.map((act) => {
      if (act.sellerUsername.toLowerCase() === oldUsername.toLowerCase()) {
        return {
          ...act,
          sellerUsername: normalizedUser.username,
          sellerName: normalizedUser.fullName,
          routeCode: normalizedUser.routeCode,
          regionScope: normalizedUser.regionScope,
          supervisorUsername:
            normalizedUser.supervisorUsername || act.supervisorUsername,
          managerUsername:
            normalizedUser.managerUsername || act.managerUsername,
        };
      }
      return act;
    });

    saveDatabase(db);
    res.json({ ok: true, user: normalizedUser, users: db.users });
  });

  // 2. Product Master SKUs API
  app.get('/api/skus', (_req, res) => {
    const db = loadDatabase();
    res.json({ skus: db.skus });
  });

  app.put('/api/skus', (req, res) => {
    const { skus } = req.body as { skus?: SkuDefinition[] };
    if (!Array.isArray(skus)) {
      res.status(400).json({ error: 'Invalid skus payload' });
      return;
    }
    const db = loadDatabase();
    db.skus = normalizeSkuImages(skus);
    saveDatabase(db);
    res.json({ skus: db.skus });
  });

  // 3. Wholesale Stores Catalog API
  app.get('/api/wholesale-stores', (_req, res) => {
    const db = loadDatabase();
    res.json({ stores: db.wholesaleStores });
  });

  app.put('/api/wholesale-stores', (req, res) => {
    const { stores } = req.body as { stores?: WholesaleStoreEntry[] };
    if (!Array.isArray(stores)) {
      res.status(400).json({ error: 'Invalid stores payload' });
      return;
    }
    const db = loadDatabase();
    db.wholesaleStores = stores;
    saveDatabase(db);
    res.json({ ok: true, stores: db.wholesaleStores });
  });

  // 4. Activations Proxy & Persistence API
  app.get('/api/activations', (req, res) => {
    const db = loadDatabase();
    const role = String(req.query.role || '');
    const username = String(req.query.username || '').trim().toLowerCase();

    let records = [...db.activations].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    if (role === 'seller' && username) {
      records = records.filter(
        (r) => (r.sellerUsername || '').toLowerCase() === username
      );
    } else if (role === 'supervisor' && username) {
      records = records.filter(
        (r) => (r.supervisorUsername || '').toLowerCase() === username
      );
    } else if (role === 'manager' && username) {
      records = records.filter(
        (r) => (r.managerUsername || '').toLowerCase() === username
      );
    }

    res.json({ records });
  });

  const syncActivationToServerSupabase = async (
    record: NoodleActivationRecord
  ) => {
    if (!serverSupabase) return;
    try {
      const cs = record.items?.find((i) => i.skuId === 'chicken_sichat_52g');
      const cc = record.items?.find((i) => i.skuId === 'coconut_55g');
      const ty = record.items?.find((i) => i.skuId === 'tom_yum_55g');
      const normalizedPricingMode =
        String(record.pricingMode || '').toLowerCase() === 'manual_wholesale'
          ? 'manual_wholesale'
          : 'company_ldp';

      await serverSupabase.from('noodle_activations').upsert(
        [
          {
            id: record.id,
            invoice_no: record.invoiceNo,
            activation_date: record.activationDate,
            created_at: record.createdAt,
            wholesale_store_name: record.wholesaleStoreName || '',
            pg_cover: record.pgCover || (record.salesStatus ? 'Yes' : 'No'),
            retailer_store_name: record.retailerStoreName || '',
            outlet_type: record.outletType || 'Grocery',
            phone_number: record.phoneNumber || '',
            address_no: record.addressNo || '',
            address_street: record.addressStreet || '',
            address_ward: record.addressWard || '',
            township: record.township || '',
            full_address: record.fullAddress || '',
            sales_status: Boolean(record.salesStatus),
            pricing_mode: normalizedPricingMode,
            covered_status: Boolean(
              record.coveredStatus ?? record.salesStatus
            ),
            non_covered_reason: record.nonCoveredReason || null,
            seller_username: record.sellerUsername,
            seller_name: record.sellerName,
            route_code: record.routeCode,
            supervisor_username: record.supervisorUsername || '',
            manager_username: record.managerUsername || '',
            region_scope: record.regionScope || '',
            items: record.items || [],
            chicken_sichat_qty: cs?.quantity ?? 0,
            chicken_sichat_price: cs?.unitPrice ?? 735,
            chicken_sichat_foc: cs?.focQuantity ?? 0,
            coconut_qty: cc?.quantity ?? 0,
            coconut_price: cc?.unitPrice ?? 870,
            coconut_foc: cc?.focQuantity ?? 0,
            tom_yum_qty: ty?.quantity ?? 0,
            tom_yum_price: ty?.unitPrice ?? 810,
            tom_yum_foc: ty?.focQuantity ?? 0,
            total_paid_qty: record.totalPaidQty ?? 0,
            total_foc_qty: record.totalFocQty ?? 0,
            grand_total_mmk: record.grandTotalMmk ?? 0,
            remarks: record.remarks || null,
          },
        ],
        { onConflict: 'id' }
      );
    } catch {
      // Client also syncs directly
    }
  };

  app.post('/api/activations', async (req, res) => {
    const record = req.body as NoodleActivationRecord;
    if (!record || !record.id) {
      res.status(400).json({ error: 'Invalid activation record' });
      return;
    }
    const db = loadDatabase();
    db.activations = [
      record,
      ...db.activations.filter((r) => r.id !== record.id),
    ];
    saveDatabase(db);
    await syncActivationToServerSupabase(record);
    res.json({ ok: true, record });
  });

  app.put('/api/activations/:id', async (req, res) => {
    const { id } = req.params;
    const record = req.body as NoodleActivationRecord;
    if (!record || !record.id) {
      res.status(400).json({ error: 'Invalid activation record' });
      return;
    }
    const db = loadDatabase();
    const exists = db.activations.some(
      (r) => r.id === id || r.id === record.id
    );
    if (exists) {
      db.activations = db.activations.map((r) =>
        r.id === id || r.id === record.id ? record : r
      );
    } else {
      db.activations = [record, ...db.activations];
    }
    saveDatabase(db);
    await syncActivationToServerSupabase(record);
    res.json({ ok: true, record });
  });

  app.delete('/api/activations/:id', async (req, res) => {
    const { id } = req.params;
    const db = loadDatabase();
    db.activations = db.activations.filter((r) => r.id !== id);
    saveDatabase(db);

    if (serverSupabase) {
      try {
        await Promise.all([
          serverSupabase.from('noodle_activations').delete().eq('id', id),
          serverSupabase.from('user_locations').delete().eq('id', id),
        ]);
      } catch {
        // Non-blocking server-side delete
      }
    }
    res.json({ deletedId: id });
  });

  // 5. PNG Invoice Image Hosting API
  const INVOICE_PNG_DIR = path.join(DATA_DIR, 'invoices');
  const invoicePngMemoryCache = new Map<string, Buffer>();

  app.post('/api/invoices/png', (req, res) => {
    const { filename, dataUrl } = req.body as {
      filename?: string;
      dataUrl?: string;
    };
    if (
      !filename ||
      !dataUrl ||
      !dataUrl.startsWith('data:image/png;base64,')
    ) {
      res.status(400).json({ error: 'Invalid PNG payload' });
      return;
    }

    const safeFilename =
      filename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.png$/i, '') + '.png';
    const base64Data = dataUrl.slice('data:image/png;base64,'.length);
    const pngBuffer = Buffer.from(base64Data, 'base64');

    invoicePngMemoryCache.set(safeFilename, pngBuffer);
    try {
      if (!fs.existsSync(INVOICE_PNG_DIR)) {
        fs.mkdirSync(INVOICE_PNG_DIR, { recursive: true });
      }
      fs.writeFileSync(path.join(INVOICE_PNG_DIR, safeFilename), pngBuffer);
    } catch {
      // Memory cache fallback
    }

    res.json({
      ok: true,
      filename: safeFilename,
      url: `/api/invoices/${safeFilename}`,
    });
  });

  app.get('/api/invoices/:filename', (req, res) => {
    const rawName = String(req.params.filename || '');
    const safeFilename =
      rawName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.png$/i, '') + '.png';

    let pngBuffer = invoicePngMemoryCache.get(safeFilename);
    if (!pngBuffer) {
      const diskPath = path.join(INVOICE_PNG_DIR, safeFilename);
      if (fs.existsSync(diskPath)) {
        try {
          pngBuffer = fs.readFileSync(diskPath);
          invoicePngMemoryCache.set(safeFilename, pngBuffer);
        } catch {
          pngBuffer = undefined;
        }
      }
    }

    if (!pngBuffer) {
      res.status(404).send('Invoice PNG not found');
      return;
    }

    res.setHeader('Content-Type', 'image/png');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${safeFilename}"`
    );
    res.send(pngBuffer);
  });

  // Vite Middleware (Dev) or Static Assets (Production)
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    if (isSqlServerBackend()) {
      checkSqlServerConnection()
        .then((where) => console.log(`[sqlserver] connected: ${where}`))
        .catch((err) => console.error(`[sqlserver] CONNECTION FAILED: ${err?.message || err}`));
    }
    void (async () => {
      const initialDb = loadDatabase();
      const supabaseUsers = await hydrateServerUsersFromSupabase();
      if (supabaseUsers && supabaseUsers.length > 0) {
        initialDb.users = mergeServerUsers(initialDb.users, supabaseUsers);
      }
      saveDatabase(initialDb);
    })();
  });
}

startServer();
