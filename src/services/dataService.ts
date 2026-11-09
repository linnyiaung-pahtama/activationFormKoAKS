import { safeLocalApiFetch, supabase } from '../lib/supabase';
import {
  INITIAL_ACTIVATIONS,
  INITIAL_USERS,
  SHALOOT_SKUS,
} from '../constants/catalog';
import {
  NoodleActivationRecord,
  PricingMode,
  SkuDefinition,
  SkuLineItem,
  UserAccount,
  UserRole,
} from '../types';
import { getRecordBranch } from '../utils/branchHelper';
import {
  buildCompleteUserRoster,
  BulkUserSyncSummary,
  ensureValidUuid,
  fetchRegisteredUsersCountInSupabase,
  fetchUsersFromSupabase,
  getLastBulkUserSyncSummary,
  syncAllUsersToSupabase,
  syncUserToSupabase,
  UserSyncResult,
} from './UserManager';

export type { UserSyncResult, BulkUserSyncSummary };
export { getLastBulkUserSyncSummary, fetchRegisteredUsersCountInSupabase };

const SESSION_USER_STORAGE_KEY = 'pahtama_active_user_session';
const ACTIVE_TAB_STORAGE_KEY = 'pahtama_active_tab_v1';
const CACHED_USERS_STORAGE_KEY = 'pahtama_cached_users_v1';
const CACHED_SKUS_STORAGE_KEY = 'pahtama_cached_skus_v1';
const CACHED_ACTIVATIONS_STORAGE_KEY = 'pahtama_cached_activations_v1';
const DELETED_ACTIVATIONS_STORAGE_KEY = 'pahtama_deleted_activation_ids_v1';
const PENDING_QUEUE_STORAGE_KEY = 'pahtama_pending_sync_queue_v1';
const IDB_DATABASE_NAME = 'pahtama_offline_db';
const IDB_DATABASE_VERSION = 1;
const IDB_QUEUE_STORE = 'pending_sync_queue';

function normalizeSkuList(skus: SkuDefinition[]): SkuDefinition[] {
  return skus.map((s) => {
    const preset = SHALOOT_SKUS.find((p) => p.id === s.id);
    const resolvedImage =
      !s.imageUrl || s.imageUrl.startsWith('/src/assets/images/')
        ? preset?.imageUrl || '/images/shaloot_chicken_sichat.jpg'
        : s.imageUrl;
    return {
      ...s,
      imageUrl: resolvedImage,
      active: s.active !== undefined ? Boolean(s.active) : true,
    };
  });
}

function loadCachedUsersFromStorage(): UserAccount[] {
  try {
    if (typeof localStorage === 'undefined') {
      return buildCompleteUserRoster(INITIAL_USERS);
    }
    const raw = localStorage.getItem(CACHED_USERS_STORAGE_KEY);
    if (!raw) return buildCompleteUserRoster(INITIAL_USERS);
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return buildCompleteUserRoster(parsed as UserAccount[]);
    }
  } catch {
    // Fallback to INITIAL_USERS
  }
  return buildCompleteUserRoster(INITIAL_USERS);
}

function saveCachedUsersToStorage(users: UserAccount[]): void {
  try {
    if (typeof localStorage !== 'undefined' && Array.isArray(users)) {
      localStorage.setItem(CACHED_USERS_STORAGE_KEY, JSON.stringify(users));
    }
  } catch {
    // Ignore storage error
  }
}

function loadCachedSkusFromStorage(): SkuDefinition[] {
  try {
    if (typeof localStorage === 'undefined') return [...SHALOOT_SKUS];
    const raw = localStorage.getItem(CACHED_SKUS_STORAGE_KEY);
    if (!raw) return [...SHALOOT_SKUS];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return normalizeSkuList(parsed as SkuDefinition[]);
    }
  } catch {
    // Fallback to SHALOOT_SKUS
  }
  return [...SHALOOT_SKUS];
}

function saveCachedSkusToStorage(skus: SkuDefinition[]): void {
  try {
    if (typeof localStorage !== 'undefined' && Array.isArray(skus)) {
      localStorage.setItem(CACHED_SKUS_STORAGE_KEY, JSON.stringify(skus));
    }
  } catch {
    // Ignore storage error
  }
}

const LEGACY_MOCK_IDS = new Set([
  'act-1001',
  'act-1002',
  'act-1003',
  'act-1004',
  'act-1005',
]);

export function getCachedActivations(): NoodleActivationRecord[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(CACHED_ACTIVATIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as NoodleActivationRecord[]).filter(
      (r) => r && r.id && !LEGACY_MOCK_IDS.has(r.id)
    );
  } catch {
    return [];
  }
}

function saveCachedActivationsToStorage(
  records: NoodleActivationRecord[]
): void {
  try {
    if (typeof localStorage !== 'undefined' && Array.isArray(records)) {
      localStorage.setItem(
        CACHED_ACTIVATIONS_STORAGE_KEY,
        JSON.stringify(records)
      );
    }
  } catch {
    // Ignore storage error
  }
}

function getDeletedActivationIds(): Set<string> {
  try {
    if (typeof localStorage === 'undefined') return new Set();
    const raw = localStorage.getItem(DELETED_ACTIVATIONS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set<string>(parsed) : new Set();
  } catch {
    return new Set();
  }
}

function addDeletedActivationId(id: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const set = getDeletedActivationIds();
    set.add(id);
    localStorage.setItem(
      DELETED_ACTIVATIONS_STORAGE_KEY,
      JSON.stringify(Array.from(set))
    );
  } catch {
    // Ignore storage error
  }
}

let runtimeSkus: SkuDefinition[] = loadCachedSkusFromStorage();
let runtimeUsers: UserAccount[] = loadCachedUsersFromStorage();
let pendingQueueMemoryCache: NoodleActivationRecord[] =
  loadInitialPendingQueueFromStorage();

function loadInitialPendingQueueFromStorage(): NoodleActivationRecord[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(PENDING_QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as NoodleActivationRecord[]) : [];
  } catch {
    return [];
  }
}

function openOfflineQueueDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(IDB_DATABASE_NAME, IDB_DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(IDB_QUEUE_STORE)) {
          db.createObjectStore(IDB_QUEUE_STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function getAllFromIndexedDBQueue(): Promise<
  NoodleActivationRecord[]
> {
  const db = await openOfflineQueueDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_QUEUE_STORE, 'readonly');
      const store = tx.objectStore(IDB_QUEUE_STORE);
      const req = store.getAll();
      req.onsuccess = () => {
        resolve(
          Array.isArray(req.result)
            ? (req.result as NoodleActivationRecord[])
            : []
        );
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function putIntoIndexedDBQueue(
  record: NoodleActivationRecord
): Promise<void> {
  const db = await openOfflineQueueDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_QUEUE_STORE, 'readwrite');
      const store = tx.objectStore(IDB_QUEUE_STORE);
      store.put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function deleteFromIndexedDBQueue(
  recordId: string
): Promise<boolean> {
  const db = await openOfflineQueueDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_QUEUE_STORE, 'readwrite');
      const store = tx.objectStore(IDB_QUEUE_STORE);
      store.delete(recordId);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function clearIndexedDBQueue(): Promise<void> {
  const db = await openOfflineQueueDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_QUEUE_STORE, 'readwrite');
      const store = tx.objectStore(IDB_QUEUE_STORE);
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

if (typeof window !== 'undefined') {
  void getAllFromIndexedDBQueue().then((idbItems) => {
    if (idbItems.length > 0) {
      const mergedMap = new Map<string, NoodleActivationRecord>();
      for (const item of pendingQueueMemoryCache) {
        mergedMap.set(item.id, item);
      }
      for (const item of idbItems) {
        mergedMap.set(item.id, item);
      }
      pendingQueueMemoryCache = Array.from(mergedMap.values());
      try {
        localStorage.setItem(
          PENDING_QUEUE_STORAGE_KEY,
          JSON.stringify(pendingQueueMemoryCache)
        );
      } catch {
        // Ignore storage error
      }
      window.dispatchEvent(new CustomEvent('pahtama-sync-queue-updated'));
    }
  });
}

export function getActiveSessionUser(): UserAccount | null {
  try {
    const rawLocal =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(SESSION_USER_STORAGE_KEY)
        : null;
    const rawSession =
      typeof sessionStorage !== 'undefined'
        ? sessionStorage.getItem(SESSION_USER_STORAGE_KEY)
        : null;
    const raw = rawLocal || rawSession;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UserAccount;
    const matched = runtimeUsers.find(
      (u) =>
        u.id === parsed.id ||
        u.username.toLowerCase() === parsed.username.toLowerCase()
    );
    return matched && matched.active ? matched : parsed;
  } catch {
    return null;
  }
}

export function saveActiveSessionUser(user: UserAccount | null): void {
  try {
    if (!user) {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(SESSION_USER_STORAGE_KEY);
      }
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(SESSION_USER_STORAGE_KEY);
      }
    } else {
      const serialized = JSON.stringify(user);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SESSION_USER_STORAGE_KEY, serialized);
      }
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(SESSION_USER_STORAGE_KEY, serialized);
      }
    }
  } catch {
    // Ignore storage errors
  }
}

export function getSavedActiveTab(): 'form' | 'dashboard' | 'users' | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const val = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    if (val === 'form' || val === 'dashboard' || val === 'users') {
      return val;
    }
  } catch {
    // Ignore storage errors
  }
  return null;
}

export function saveActiveTab(tab: 'form' | 'dashboard' | 'users'): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, tab);
    }
  } catch {
    // Ignore storage errors
  }
}

export const getStoredActiveTab = getSavedActiveTab;
export const saveStoredActiveTab = saveActiveTab;

export function getProductMasterList(): SkuDefinition[] {
  return runtimeSkus;
}

export async function fetchLiveProductMasterList(): Promise<SkuDefinition[]> {
  if (supabase) {
    try {
      const { data: skuRows, error: skuErr } = await supabase
        .from('product_master_skus')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });

      if (!skuErr && Array.isArray(skuRows) && skuRows.length > 0) {
        const mapped: SkuDefinition[] = skuRows.map((row: Record<string, any>) => ({
          id: String(row.id),
          code: String(row.code || row.id),
          name: String(row.name || ''),
          myanmarSubName: String(row.myanmar_sub_name || ''),
          packSpec: String(row.pack_spec || '1x30pcs'),
          defaultLdpPrice: Number(row.default_ldp_price || 0),
          accentColor: String(row.accent_color || '#0F2C59'),
          imageUrl: String(row.image_url || ''),
          active: row.active !== undefined ? Boolean(row.active) : true,
        }));
        runtimeSkus = normalizeSkuList(mapped);
        saveCachedSkusToStorage(runtimeSkus);
        void persistSkusToServer(runtimeSkus, false);
        return runtimeSkus;
      }
    } catch {
      // Fallback to user_locations SKU config
    }

    try {
      const { data, error } = await supabase
        .from('user_locations')
        .select('payload')
        .eq('id', 'config_product_master_skus')
        .maybeSingle();

      if (
        !error &&
        data?.payload &&
        typeof data.payload === 'object' &&
        Array.isArray(data.payload.skus) &&
        data.payload.skus.length > 0
      ) {
        runtimeSkus = normalizeSkuList(data.payload.skus as SkuDefinition[]);
        saveCachedSkusToStorage(runtimeSkus);
        void persistSkusToServer(runtimeSkus, false);
        return runtimeSkus;
      }
    } catch {
      // Optional Supabase SKU config fallback
    }
  }

  try {
    const res = await safeLocalApiFetch('/api/skus', { cache: 'no-store' });
    if (res) {
      const data = (await res.json()) as { skus?: SkuDefinition[] };
      if (Array.isArray(data.skus) && data.skus.length > 0) {
        runtimeSkus = normalizeSkuList(data.skus);
        saveCachedSkusToStorage(runtimeSkus);
        return runtimeSkus;
      }
    }
  } catch {
    // Fallback to runtimeSkus if offline or static host
  }
  return runtimeSkus;
}

async function persistSkusToServer(
  updated: SkuDefinition[],
  syncSupabase = true
): Promise<void> {
  saveCachedSkusToStorage(updated);
  try {
    await safeLocalApiFetch('/api/skus', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skus: updated }),
    });
  } catch {
    // Ignore network error
  }

  if (supabase && syncSupabase) {
    try {
      const skuRows = updated.map((sku, idx) => ({
        id: sku.id,
        code: sku.code,
        name: sku.name,
        short_name: sku.name,
        myanmar_sub_name: sku.myanmarSubName || '',
        pack_spec: sku.packSpec || '1x30pcs',
        default_ldp_price: Number(sku.defaultLdpPrice || 0),
        accent_color: sku.accentColor || '#0F2C59',
        image_url: sku.imageUrl || '',
        active: sku.active !== false,
        sort_order: idx + 1,
        updated_at: new Date().toISOString(),
      }));
      await supabase
        .from('product_master_skus')
        .upsert(skuRows, { onConflict: 'id' });
    } catch {
      // Optional product_master_skus table sync
    }

    try {
      await supabase.from('user_locations').upsert(
        [
          {
            id: 'config_product_master_skus',
            username: 'system_config',
            full_name: 'Product Master SKU Catalog',
            role: 'admin',
            route_code: 'ALL-ROUTES',
            region_scope: 'All Regions',
            payload: {
              recordType: 'sku_catalog',
              skus: updated,
              updatedAt: new Date().toISOString(),
            },
            updated_at: new Date().toISOString(),
          },
        ],
        { onConflict: 'id' }
      );
    } catch {
      // Non-blocking Supabase SKU catalog sync
    }
  }
}

export function addProductToMasterList(newSku: SkuDefinition): SkuDefinition[] {
  const current = getProductMasterList();
  const updated = normalizeSkuList([
    ...current,
    { ...newSku, active: newSku.active ?? true },
  ]);
  runtimeSkus = updated;
  void persistSkusToServer(updated);
  return updated;
}

export function updateProductInMasterList(
  updatedSku: SkuDefinition
): SkuDefinition[] {
  const current = getProductMasterList();
  const updated = normalizeSkuList(
    current.map((s) => (s.id === updatedSku.id ? updatedSku : s))
  );
  runtimeSkus = updated;
  void persistSkusToServer(updated);
  return updated;
}

export function toggleProductActiveInMasterList(
  skuId: string
): SkuDefinition[] {
  const current = getProductMasterList();
  const activeCount = current.filter((s) => s.active !== false).length;
  const updated = normalizeSkuList(
    current.map((s) => {
      if (s.id !== skuId) return s;
      const currentlyActive = s.active !== false;
      if (currentlyActive && activeCount <= 1) {
        return s;
      }
      return { ...s, active: !currentlyActive };
    })
  );
  runtimeSkus = updated;
  void persistSkusToServer(updated);
  return updated;
}

export function deleteProductFromMasterList(skuId: string): SkuDefinition[] {
  const current = getProductMasterList();
  if (current.length <= 1) return current;
  const updated = current.filter((s) => s.id !== skuId);
  runtimeSkus = updated;
  if (supabase) {
    void supabase.from('product_master_skus').delete().eq('id', skuId);
  }
  void persistSkusToServer(updated);
  return updated;
}

export function getPendingSyncQueue(): NoodleActivationRecord[] {
  try {
    const raw = localStorage.getItem(PENDING_QUEUE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as NoodleActivationRecord[];
      if (Array.isArray(parsed)) {
        pendingQueueMemoryCache = parsed;
        return parsed;
      }
    }
  } catch {
    // Fallback to memory cache
  }
  return pendingQueueMemoryCache;
}

function savePendingSyncQueue(queue: NoodleActivationRecord[]) {
  pendingQueueMemoryCache = queue;
  try {
    if (queue.length === 0) {
      localStorage.removeItem(PENDING_QUEUE_STORAGE_KEY);
    } else {
      localStorage.setItem(PENDING_QUEUE_STORAGE_KEY, JSON.stringify(queue));
    }
    window.dispatchEvent(new CustomEvent('pahtama-sync-queue-updated'));
  } catch {
    // Ignore storage errors
  }
}

export async function enqueuePendingRecord(
  record: NoodleActivationRecord
): Promise<void> {
  const queue = getPendingSyncQueue();
  const filtered = queue.filter((item) => item.id !== record.id);
  const updated = [...filtered, record];
  savePendingSyncQueue(updated);
  await putIntoIndexedDBQueue(record);
}

export async function removeRecordFromPendingQueue(
  recordId: string
): Promise<boolean> {
  const removedFromIdb = await deleteFromIndexedDBQueue(recordId);
  const queue = getPendingSyncQueue();
  const next = queue.filter((item) => item.id !== recordId);
  savePendingSyncQueue(next);
  return removedFromIdb;
}

export async function clearPendingSyncQueue(): Promise<void> {
  savePendingSyncQueue([]);
  await clearIndexedDBQueue();
}

export type ActivationInsertResult = NoodleActivationRecord & {
  ok: boolean;
  synced: boolean;
  status: number;
  supabaseStatus?: number;
  error?: string;
};

export async function flushPendingSyncQueue(
  forceOffline = false
): Promise<{
  syncedCount: number;
  remainingCount: number;
  failedCount: number;
}> {
  const idbQueue = await getAllFromIndexedDBQueue();
  const localQueue = getPendingSyncQueue();
  const combinedMap = new Map<string, NoodleActivationRecord>();
  for (const item of localQueue) {
    if (item && item.id) combinedMap.set(item.id, item);
  }
  for (const item of idbQueue) {
    if (item && item.id) combinedMap.set(item.id, item);
  }
  const queue = Array.from(combinedMap.values());

  if (queue.length === 0) {
    await clearPendingSyncQueue();
    return { syncedCount: 0, remainingCount: 0, failedCount: 0 };
  }

  if (forceOffline || !navigator.onLine) {
    return { syncedCount: 0, remainingCount: queue.length, failedCount: 0 };
  }

  let syncedCount = 0;
  let failedCount = 0;

  for (let idx = 0; idx < queue.length; idx += 1) {
    const offlineEntry = queue[idx];
    try {
      const response = await insertActivationRecord(offlineEntry, false);
      const isHttp200Ok =
        Boolean(response) &&
        response.ok === true &&
        response.synced === true &&
        response.status === 200 &&
        response.id === offlineEntry.id;

      if (isHttp200Ok) {
        await deleteFromIndexedDBQueue(offlineEntry.id);
        await removeRecordFromPendingQueue(offlineEntry.id);
        syncedCount += 1;
      } else {
        failedCount += 1;
      }
    } catch {
      failedCount += 1;
    }
  }

  const remainingIdb = await getAllFromIndexedDBQueue();
  const remainingLocal = getPendingSyncQueue();
  const remainingCount = Math.max(remainingIdb.length, remainingLocal.length);

  if (remainingCount === 0 && failedCount === 0) {
    await clearPendingSyncQueue();
    return { syncedCount, remainingCount: 0, failedCount: 0 };
  }

  return { syncedCount, remainingCount, failedCount };
}

function mapRowToActivation(row: Record<string, any>): NoodleActivationRecord {
  const items: SkuLineItem[] = Array.isArray(row.items)
    ? row.items
    : [
        {
          skuId: 'chicken_sichat_52g',
          skuName: 'Shaloot Noodle Chicken Sichat 52g (1x30pcs)',
          quantity: Number(row.chicken_sichat_qty || 0),
          unitPrice: Number(row.chicken_sichat_price || 735),
          focQuantity: Number(row.chicken_sichat_foc || 0),
          focPrice: 0,
          lineTotal:
            Number(row.chicken_sichat_qty || 0) *
            Number(row.chicken_sichat_price || 735),
        },
        {
          skuId: 'coconut_55g',
          skuName: 'Shaloot Noodle Coconut 55g (1x30pcs)',
          quantity: Number(row.coconut_qty || 0),
          unitPrice: Number(row.coconut_price || 870),
          focQuantity: Number(row.coconut_foc || 0),
          focPrice: 0,
          lineTotal:
            Number(row.coconut_qty || 0) * Number(row.coconut_price || 870),
        },
        {
          skuId: 'tom_yum_55g',
          skuName: 'Shaloot Noodle Tom Yum 55g (1x30pcs)',
          quantity: Number(row.tom_yum_qty || 0),
          unitPrice: Number(row.tom_yum_price || 810),
          focQuantity: Number(row.tom_yum_foc || 0),
          focPrice: 0,
          lineTotal:
            Number(row.tom_yum_qty || 0) * Number(row.tom_yum_price || 810),
        },
      ];

  const salesBool =
    row.sales_status !== undefined
      ? Boolean(row.sales_status)
      : Boolean(row.covered_status);

  const rawPricingMode = String(row.pricing_mode || '').toLowerCase();

  return {
    id: String(row.id),
    invoiceNo: String(row.invoice_no),
    activationDate: String(row.activation_date),
    createdAt: String(row.created_at || new Date().toISOString()),
    wholesaleStoreName: String(row.wholesale_store_name || ''),
    pgCover: String(row.pg_cover || (salesBool ? 'Yes' : 'No')),
    retailerStoreName: String(
      row.retailer_store_name || row.outlet_name || ''
    ),
    outletType: String(row.outlet_type || 'Grocery'),
    phoneNumber: String(row.phone_number || ''),
    addressNo: String(row.address_no || ''),
    addressStreet: String(row.address_street || ''),
    addressWard: String(row.address_ward || ''),
    township: String(row.township || ''),
    fullAddress: String(row.full_address || row.township || ''),
    salesStatus: salesBool,
    pricingMode:
      rawPricingMode === PricingMode.MANUAL_WHOLESALE
        ? PricingMode.MANUAL_WHOLESALE
        : PricingMode.COMPANY_LDP,
    coveredStatus: salesBool,
    nonCoveredReason: row.non_covered_reason || undefined,
    sellerUsername: String(row.seller_username),
    sellerName: String(row.seller_name),
    routeCode: String(row.route_code),
    supervisorUsername: String(row.supervisor_username || ''),
    managerUsername: String(row.manager_username || ''),
    regionScope: String(row.region_scope || ''),
    branch: row.branch ? String(row.branch) : undefined,
    items,
    totalPaidQty: Number(row.total_paid_qty || 0),
    totalFocQty: Number(row.total_foc_qty || 0),
    grandTotalMmk: Number(row.grand_total_mmk || 0),
    remarks: row.remarks || undefined,
  };
}

export function mapActivationToRow(record: NoodleActivationRecord) {
  const cs = record.items.find((i) => i.skuId === 'chicken_sichat_52g');
  const cc = record.items.find((i) => i.skuId === 'coconut_55g');
  const ty = record.items.find((i) => i.skuId === 'tom_yum_55g');
  const normalizedPricingMode =
    String(record.pricingMode || '').toLowerCase() ===
    PricingMode.MANUAL_WHOLESALE
      ? PricingMode.MANUAL_WHOLESALE
      : PricingMode.COMPANY_LDP;

  return {
    id: record.id,
    invoice_no: record.invoiceNo || `INV-${Date.now()}`,
    activation_date:
      record.activationDate || new Date().toISOString().split('T')[0],
    created_at: record.createdAt || new Date().toISOString(),
    branch: record.branch || getRecordBranch(record),
    wholesale_store_name: record.wholesaleStoreName || '',
    pg_cover: record.pgCover || (record.salesStatus ? 'Yes' : 'No'),
    retailer_store_name: record.retailerStoreName || '',
    outlet_type: record.outletType || 'Grocery',
    phone_number: record.phoneNumber || '',
    address_no: record.addressNo || '',
    address_street: record.addressStreet || '',
    address_ward: record.addressWard || '',
    township: record.township || record.regionScope || '',
    full_address: record.fullAddress || record.township || '',
    sales_status: Boolean(record.salesStatus),
    pricing_mode: normalizedPricingMode,
    covered_status: Boolean(record.coveredStatus ?? record.salesStatus),
    non_covered_reason: record.nonCoveredReason || null,
    seller_username: record.sellerUsername || 'seller1',
    seller_name: record.sellerName || record.sellerUsername || 'Seller',
    route_code: record.routeCode || 'ALL-ROUTES',
    supervisor_username: record.supervisorUsername || '',
    manager_username: record.managerUsername || '',
    region_scope: record.regionScope || 'All Regions',
    items: Array.isArray(record.items) ? record.items : [],
    chicken_sichat_qty: cs?.quantity ?? 0,
    chicken_sichat_price: cs?.unitPrice ?? 735,
    chicken_sichat_foc: cs?.focQuantity ?? 0,
    coconut_qty: cc?.quantity ?? 0,
    coconut_price: cc?.unitPrice ?? 870,
    coconut_foc: cc?.focQuantity ?? 0,
    tom_yum_qty: ty?.quantity ?? 0,
    tom_yum_price: ty?.unitPrice ?? 810,
    tom_yum_foc: ty?.focQuantity ?? 0,
    total_paid_qty: Number(record.totalPaidQty || 0),
    total_foc_qty: Number(record.totalFocQty || 0),
    grand_total_mmk: Number(record.grandTotalMmk || 0),
    remarks: record.remarks || null,
  };
}

export function mapActivationToSkuDetailRows(record: NoodleActivationRecord) {
  const skus = getProductMasterList();
  const branchName = record.branch || getRecordBranch(record);
  const noteText = record.salesStatus
    ? record.remarks || null
    : record.nonCoveredReason || null;
  const activeLines = record.salesStatus
    ? record.items.filter((item) => item.quantity > 0 || item.focQuantity > 0)
    : [];
  const normalizedPricingMode =
    String(record.pricingMode || '').toLowerCase() ===
    PricingMode.MANUAL_WHOLESALE
      ? PricingMode.MANUAL_WHOLESALE
      : PricingMode.COMPANY_LDP;

  if (record.salesStatus && activeLines.length > 0) {
    return activeLines.map((line) => {
      const skuDef = skus.find((s) => s.id === line.skuId);
      return {
        id: `${record.id}_${line.skuId}`,
        activation_id: record.id,
        invoice_no: record.invoiceNo,
        activation_date: record.activationDate,
        created_at: record.createdAt,
        branch: branchName,
        seller_username: record.sellerUsername || 'seller1',
        seller_name: record.sellerName || record.sellerUsername || 'Seller',
        route_code: record.routeCode || 'ALL-ROUTES',
        supervisor_username: record.supervisorUsername || '',
        manager_username: record.managerUsername || '',
        region_scope: record.regionScope || 'All Regions',
        wholesale_store_name: record.wholesaleStoreName || '',
        pg_cover: record.pgCover || 'Yes',
        retailer_store_name: record.retailerStoreName || '',
        outlet_type: record.outletType || 'Consumer',
        phone_number: record.phoneNumber || '',
        address_no: record.addressNo || '',
        address_street: record.addressStreet || '',
        address_ward: record.addressWard || '',
        township: record.township || '',
        full_address: record.fullAddress || '',
        sales_status: Boolean(record.salesStatus),
        non_covered_reason: null as string | null,
        pricing_mode: normalizedPricingMode,
        sku_id: line.skuId,
        sku_code: skuDef?.code ?? line.skuId,
        sku_name: line.skuName || skuDef?.name || line.skuId,
        myanmar_sub_name: skuDef?.myanmarSubName ?? '',
        pack_spec: skuDef?.packSpec ?? '1x30pcs',
        unit_price: line.unitPrice,
        paid_qty: line.quantity,
        foc_qty: line.focQuantity,
        total_qty: line.quantity + line.focQuantity,
        line_total_mmk: line.lineTotal,
        remarks: noteText,
      };
    });
  }

  return [
    {
      id: `${record.id}_no_sale`,
      activation_id: record.id,
      invoice_no: record.invoiceNo,
      activation_date: record.activationDate,
      created_at: record.createdAt,
      branch: branchName,
      seller_username: record.sellerUsername || 'seller1',
      seller_name: record.sellerName || record.sellerUsername || 'Seller',
      route_code: record.routeCode || 'ALL-ROUTES',
      supervisor_username: record.supervisorUsername || '',
      manager_username: record.managerUsername || '',
      region_scope: record.regionScope || 'All Regions',
      wholesale_store_name: record.wholesaleStoreName || '',
      pg_cover: record.pgCover || 'No',
      retailer_store_name: record.retailerStoreName || '',
      outlet_type: record.outletType || 'Consumer',
      phone_number: record.phoneNumber || '',
      address_no: record.addressNo || '',
      address_street: record.addressStreet || '',
      address_ward: record.addressWard || '',
      township: record.township || '',
      full_address: record.fullAddress || '',
      sales_status: Boolean(record.salesStatus),
      non_covered_reason: record.nonCoveredReason || 'Recorded Visit',
      pricing_mode: normalizedPricingMode,
      sku_id: 'none',
      sku_code: '-',
      sku_name: 'No SKU Sold (Non-Sales Visit)',
      myanmar_sub_name: '-',
      pack_spec: '-',
      unit_price: 0,
      paid_qty: 0,
      foc_qty: 0,
      total_qty: 0,
      line_total_mmk: 0,
      remarks: noteText,
    },
  ];
}

function mapUserLocationToRow(user: UserAccount) {
  const validId = ensureValidUuid(user.id, user.username);
  return {
    id: `user_${user.username.trim().toLowerCase()}`,
    user_id: validId,
    username: user.username.trim(),
    full_name: user.fullName.trim(),
    role: user.role,
    route_code: user.routeCode.trim() || 'ALL-ROUTES',
    region_scope: user.regionScope.trim() || 'All Regions',
    supervisor_username: user.supervisorUsername?.trim() || null,
    manager_username: user.managerUsername?.trim() || null,
    township: user.regionScope.trim() || 'All Regions',
    full_address: `${user.routeCode.trim()} · ${user.regionScope.trim()}`,
    payload: {
      recordType: 'user_profile',
      user: {
        ...user,
        id: validId,
      },
    },
    updated_at: new Date().toISOString(),
  };
}

function mapActivationToLocationRow(record: NoodleActivationRecord) {
  return {
    id: record.id,
    username: record.sellerUsername || 'seller1',
    full_name: record.sellerName || record.sellerUsername || 'Seller',
    role: UserRole.SELLER,
    route_code: record.routeCode || 'ALL-ROUTES',
    region_scope: record.regionScope || 'All Regions',
    supervisor_username: record.supervisorUsername || null,
    manager_username: record.managerUsername || null,
    wholesale_store_name: record.wholesaleStoreName || '',
    retailer_store_name: record.retailerStoreName || '',
    outlet_type: record.outletType || 'Grocery',
    phone_number: record.phoneNumber || '',
    township: record.township || record.regionScope || '',
    full_address: record.fullAddress || record.township || '',
    invoice_no: record.invoiceNo || '',
    activation_date:
      record.activationDate || new Date().toISOString().split('T')[0],
    sales_status: Boolean(record.salesStatus),
    total_paid_qty: Number(record.totalPaidQty || 0),
    total_foc_qty: Number(record.totalFocQty || 0),
    grand_total_mmk: Number(record.grandTotalMmk || 0),
    payload: {
      recordType: 'activation_location',
      activation: record,
    },
    updated_at: new Date().toISOString(),
    created_at: record.createdAt || new Date().toISOString(),
  };
}

/**
 * Unlimited Range Pagination: Automated .range(from, from + 999) pagination loops
 * to bypass PostgREST's default 1,000-row limit so datasets of 5,000 to 50,000+ rows
 * are retrieved completely without truncation.
 */
export async function fetchAllRowsFromSupabase<T = Record<string, any>>(
  tableName: string,
  options?: {
    select?: string;
    orderBy?: string;
    ascending?: boolean;
    batchSize?: number;
    maxBatches?: number;
  }
): Promise<{ data: T[]; error: any }> {
  if (!supabase) {
    return { data: [], error: null };
  }

  const select = options?.select || '*';
  const orderBy = options?.orderBy;
  const ascending = options?.ascending ?? false;
  const batchSize = Math.max(100, Math.min(options?.batchSize || 1000, 1000));
  const maxBatches = options?.maxBatches || 500;

  const allRows: T[] = [];
  let from = 0;
  let batchIndex = 0;
  let queryError: any = null;

  while (batchIndex < maxBatches) {
    const to = from + batchSize - 1; // .range(from, from + 999) when batchSize = 1000
    let query = supabase.from(tableName).select(select).range(from, to);

    if (orderBy) {
      query = query.order(orderBy, { ascending });
    }

    const { data, error } = await query;

    if (error) {
      queryError = error;
      break;
    }

    if (Array.isArray(data) && data.length > 0) {
      allRows.push(...(data as T[]));
      if (data.length < batchSize) {
        break;
      }
      from += batchSize;
      batchIndex++;
    } else {
      break;
    }
  }

  return { data: allRows, error: queryError };
}

/**
 * Chunked Batch Upserts: Upsert data in chunks of 500 rows to prevent HTTP payload timeouts.
 */
export async function chunkedUpsertToSupabase(
  tableName: string,
  rows: any[],
  options?: { onConflict?: string; chunkSize?: number }
): Promise<{ error: any }> {
  if (!supabase || rows.length === 0) return { error: null };
  const chunkSize = options?.chunkSize || 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    let { error } = await supabase
      .from(tableName)
      .upsert(chunk, { onConflict: options?.onConflict });

    // Automatic fallback if an existing table has not yet added optional migration columns
    if (
      error &&
      tableName === 'noodle_activations' &&
      String(error.message || '').includes('branch')
    ) {
      const strippedChunk = chunk.map(({ branch: _branch, ...rest }) => rest);
      const retry = await supabase
        .from(tableName)
        .upsert(strippedChunk, { onConflict: options?.onConflict });
      error = retry.error;
    } else if (
      error &&
      tableName === 'noodle_activation_sku_details' &&
      /branch|address_no|address_street|address_ward|non_covered_reason|myanmar_sub_name/i.test(
        String(error.message || '')
      )
    ) {
      const strippedChunk = chunk.map(
        ({
          branch: _branch,
          address_no: _addressNo,
          address_street: _addressStreet,
          address_ward: _addressWard,
          non_covered_reason: _nonCoveredReason,
          myanmar_sub_name: _myanmarSubName,
          ...rest
        }) => rest
      );
      const retry = await supabase
        .from(tableName)
        .upsert(strippedChunk, { onConflict: options?.onConflict });
      error = retry.error;
    }

    if (error) {
      return { error };
    }
  }
  return { error: null };
}

export async function fetchActivationsForUser(
  user: UserAccount
): Promise<NoodleActivationRecord[]> {
  const deletedIds = getDeletedActivationIds();
  let remoteRecords: NoodleActivationRecord[] | null = null;
  const locationRecordsMap = new Map<string, NoodleActivationRecord>();
  let supabaseReachable = false;

  if (supabase) {
    try {
      const { data: userLocData, error: userLocErr } =
        await fetchAllRowsFromSupabase<Record<string, any>>('user_locations', {
          orderBy: 'created_at',
          ascending: false,
        });

      if (!userLocErr && Array.isArray(userLocData)) {
        supabaseReachable = true;
        for (const row of userLocData) {
          if (
            row.payload &&
            typeof row.payload === 'object' &&
            (row.payload.recordType === 'user_profile' ||
              row.payload.recordType === 'sku_catalog' ||
              row.payload.recordType === 'deleted_activation')
          ) {
            if (
              row.payload.recordType === 'deleted_activation' &&
              row.payload.deletedId
            ) {
              deletedIds.add(String(row.payload.deletedId));
            }
            continue;
          }

          if (
            row.payload &&
            typeof row.payload === 'object' &&
            row.payload.activation &&
            row.payload.activation.id
          ) {
            const act = row.payload.activation as NoodleActivationRecord;
            if (!deletedIds.has(act.id)) {
              locationRecordsMap.set(act.id, act);
            }
          } else if (row.invoice_no || row.retailer_store_name) {
            const mapped = mapRowToActivation({
              ...row,
              seller_username: row.seller_username || row.username,
              seller_name: row.seller_name || row.full_name,
            });
            if (!deletedIds.has(mapped.id)) {
              locationRecordsMap.set(mapped.id, mapped);
            }
          }
        }
      }
    } catch {
      // Optional user_locations fallback
    }

    try {
      const { data: actRows, error: actError } =
        await fetchAllRowsFromSupabase<Record<string, any>>(
          'noodle_activations',
          {
            orderBy: 'created_at',
            ascending: false,
          }
        );

      if (!actError && Array.isArray(actRows)) {
        supabaseReachable = true;

        const skuDetailsByActId = new Map<string, SkuLineItem[]>();
        try {
          const { data: skuRows, error: skuError } =
            await fetchAllRowsFromSupabase<Record<string, any>>(
              'noodle_activation_sku_details'
            );

          if (!skuError && Array.isArray(skuRows) && skuRows.length > 0) {
            for (const itemRow of skuRows) {
              const actId = String(itemRow.activation_id || '');
              const skuId = String(itemRow.sku_id || '');
              if (!actId || skuId === 'none') continue;
              const line: SkuLineItem = {
                skuId,
                skuName: String(itemRow.sku_name || ''),
                quantity: Number(itemRow.paid_qty || 0),
                unitPrice: Number(itemRow.unit_price || 0),
                focQuantity: Number(itemRow.foc_qty || 0),
                focPrice: 0,
                lineTotal: Number(itemRow.line_total_mmk || 0),
              };
              const existingList = skuDetailsByActId.get(actId) || [];
              existingList.push(line);
              skuDetailsByActId.set(actId, existingList);
            }
          }
        } catch {
          // Fallback to JSONB items column
        }

        remoteRecords = actRows
          .map((row) => {
            const mapped = mapRowToActivation(row);
            const detailedItems = skuDetailsByActId.get(mapped.id);
            if (detailedItems && detailedItems.length > 0) {
              mapped.items = detailedItems;
            }
            return mapped;
          })
          .filter((r) => !deletedIds.has(r.id));
      }
    } catch {
      // Fallback to server API
    }
  }

  let serverRecords: NoodleActivationRecord[] = [];
  try {
    const params = new URLSearchParams({
      role: user.role,
      username: user.username,
    });
    const res = await safeLocalApiFetch(
      `/api/activations?${params.toString()}`,
      {
        cache: 'no-store',
      }
    );
    if (res) {
      const json = (await res.json()) as { records?: NoodleActivationRecord[] };
      if (Array.isArray(json.records)) {
        serverRecords = json.records.filter((r) => !deletedIds.has(r.id));
      }
    }
  } catch {
    // Offline or static Netlify fallback
  }

  const combinedMap = new Map<string, NoodleActivationRecord>();
  for (const pending of getPendingSyncQueue()) {
    if (!deletedIds.has(pending.id)) {
      combinedMap.set(pending.id, pending);
    }
  }
  for (const [id, locRec] of locationRecordsMap.entries()) {
    if (!combinedMap.has(id) && !deletedIds.has(id)) {
      combinedMap.set(id, locRec);
    }
  }
  if (remoteRecords) {
    for (const r of remoteRecords) {
      if (!deletedIds.has(r.id)) {
        const existingLoc = locationRecordsMap.get(r.id);
        if (existingLoc) {
          combinedMap.set(r.id, {
            ...r,
            ...existingLoc,
            items:
              Array.isArray(existingLoc.items) && existingLoc.items.length > 0
                ? existingLoc.items
                : r.items,
          });
        } else if (!combinedMap.has(r.id)) {
          combinedMap.set(r.id, r);
        }
      }
    }
  }
  for (const s of serverRecords) {
    if (!combinedMap.has(s.id) && !deletedIds.has(s.id)) {
      combinedMap.set(s.id, s);
    }
  }
  if (!supabaseReachable && combinedMap.size === 0) {
    for (const cached of getCachedActivations()) {
      if (!deletedIds.has(cached.id) && !combinedMap.has(cached.id)) {
        combinedMap.set(cached.id, cached);
      }
    }
  }

  const allRecords = Array.from(combinedMap.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  saveCachedActivationsToStorage(allRecords);

  const lowerUsername = user.username.trim().toLowerCase();
  const lowerRoute = user.routeCode.trim().toLowerCase();

  if (
    user.role === UserRole.ADMIN ||
    user.role === UserRole.NSM ||
    user.role === UserRole.BRAND_MANAGER
  ) {
    return allRecords;
  }

  if (user.role === UserRole.MANAGER) {
    const scopeLower = (user.regionScope || '').toLowerCase();
    const userBranch = (user.branch || '').toLowerCase();
    return allRecords.filter((r) => {
      if (
        (r.managerUsername || '').trim().toLowerCase() === lowerUsername ||
        (r.sellerUsername || '').trim().toLowerCase() === lowerUsername
      ) {
        return true;
      }
      const recBranch = getRecordBranch(r).toLowerCase();
      if (userBranch && recBranch === userBranch) return true;
      if (scopeLower.includes('naypyitaw') || scopeLower.includes('bago')) {
        return recBranch === 'naypyitaw' || recBranch === 'bago';
      }
      if (scopeLower.includes('mandalay')) return recBranch === 'mandalay';
      if (scopeLower.includes('yangon')) {
        if (scopeLower.includes('north')) {
          return r.regionScope.toLowerCase().includes('north');
        }
        if (scopeLower.includes('east') || scopeLower.includes('west')) {
          return (
            r.regionScope.toLowerCase().includes('east') ||
            r.regionScope.toLowerCase().includes('west')
          );
        }
        return recBranch === 'yangon';
      }
      return false;
    });
  }

  if (user.role === UserRole.SUPERVISOR) {
    return allRecords.filter(
      (r) =>
        (r.supervisorUsername || '').trim().toLowerCase() === lowerUsername ||
        (r.sellerUsername || '').trim().toLowerCase() === lowerUsername
    );
  }

  return allRecords.filter(
    (r) =>
      (r.sellerUsername || '').trim().toLowerCase() === lowerUsername ||
      (lowerRoute !== 'all-routes' &&
        (r.routeCode || '').trim().toLowerCase() === lowerRoute)
  );
}

export async function insertActivationRecord(
  record: NoodleActivationRecord,
  isOfflineSimulated = false
): Promise<ActivationInsertResult> {
  const currentCached = getCachedActivations().filter((r) => r.id !== record.id);
  saveCachedActivationsToStorage([record, ...currentCached]);

  if (isOfflineSimulated || !navigator.onLine) {
    await enqueuePendingRecord(record);
    return {
      ...record,
      ok: false,
      synced: false,
      status: 0,
      supabaseStatus: 0,
      error: 'Offline mode active; record queued in IndexedDB for later sync.',
    };
  }

  let serverConfirmed = false;
  let supabaseConfirmed = false;
  let httpStatus = 0;
  let supabaseHttpStatus = 0;
  let confirmedRecord: NoodleActivationRecord = record;
  const errorReasons: string[] = [];

  try {
    const res = await safeLocalApiFetch('/api/activations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
    if (res) {
      httpStatus = res.status;
      if (res.status >= 200 && res.status < 300) {
        try {
          const body = (await res.json()) as {
            ok?: boolean;
            record?: NoodleActivationRecord;
          };
          if (body && body.record && body.record.id) {
            confirmedRecord = body.record;
          }
        } catch {
          // Response OK
        }
        serverConfirmed = true;
        httpStatus = 200;
      }
    }
  } catch {
    // Local Express API not present (e.g. static Netlify host)
  }

  if (supabase) {
    try {
      const { error: locErr, status: locStatus } = await supabase
        .from('user_locations')
        .upsert([mapActivationToLocationRow(record)], { onConflict: 'id' });
      if (!locErr && (!locStatus || (locStatus >= 200 && locStatus < 300))) {
        supabaseConfirmed = true;
        httpStatus = 200;
        supabaseHttpStatus = 200;
      }
    } catch {
      // Continue to noodle_activations upsert
    }

    try {
      const payload = mapActivationToRow(record);
      let {
        data,
        error,
        status: supaStatus,
      } = await supabase
        .from('noodle_activations')
        .upsert([payload], { onConflict: 'id' })
        .select();

      // Automatic fallback if existing noodle_activations table lacks 'branch' column
      if (error && String(error.message || '').includes('branch')) {
        const { branch: _branch, ...legacyPayload } = payload;
        const retryRes = await supabase
          .from('noodle_activations')
          .upsert([legacyPayload], { onConflict: 'id' })
          .select();
        data = retryRes.data;
        error = retryRes.error;
        supaStatus = retryRes.status;
      }

      supabaseHttpStatus =
        supaStatus || (error ? (supabaseConfirmed ? 200 : 500) : 200);
      const isSupabaseHttpOk =
        !error && supabaseHttpStatus >= 200 && supabaseHttpStatus < 300;

      if (!isSupabaseHttpOk) {
        if (!supabaseConfirmed) {
          errorReasons.push(error?.message || `Supabase HTTP ${supabaseHttpStatus}`);
          await enqueuePendingRecord(record);
        }
      } else {
        supabaseConfirmed = true;
        httpStatus = 200;
        supabaseHttpStatus = 200;

        if (data && data.length > 0) {
          confirmedRecord = {
            ...mapRowToActivation(data[0]),
            ...record,
          };
        }

        try {
          await supabase
            .from('noodle_activation_sku_details')
            .delete()
            .eq('activation_id', record.id);

          const detailRows = mapActivationToSkuDetailRows(record);
          if (detailRows.length > 0) {
            await supabase
              .from('noodle_activation_sku_details')
              .upsert(detailRows, { onConflict: 'id' });
          }
        } catch {
          // Optional detail table sync
        }
      }

      if (supabaseConfirmed) {
        await deleteFromIndexedDBQueue(record.id);
        await removeRecordFromPendingQueue(record.id);
      }
    } catch (supaEx) {
      if (!supabaseConfirmed) {
        const supaExMsg =
          supaEx instanceof Error ? supaEx.message : String(supaEx);
        errorReasons.push(`Supabase exception: ${supaExMsg}`);
        await enqueuePendingRecord(record);
      } else {
        await deleteFromIndexedDBQueue(record.id);
        await removeRecordFromPendingQueue(record.id);
      }
    }
  } else if (!serverConfirmed) {
    await enqueuePendingRecord(record);
  } else {
    await deleteFromIndexedDBQueue(record.id);
    await removeRecordFromPendingQueue(record.id);
  }

  const isFullySynced = supabase
    ? supabaseConfirmed || serverConfirmed
    : serverConfirmed;

  if (isFullySynced) {
    return {
      ...confirmedRecord,
      ok: true,
      synced: true,
      status: 200,
      supabaseStatus: supabase ? 200 : httpStatus || 200,
    };
  }

  return {
    ...record,
    ok: false,
    synced: false,
    status: supabaseHttpStatus || httpStatus || 500,
    supabaseStatus: supabaseHttpStatus || undefined,
    error: errorReasons.join(' | ') || 'Server confirmation failed during sync.',
  };
}

export async function updateActivationRecord(
  record: NoodleActivationRecord,
  isOfflineSimulated = false
): Promise<ActivationInsertResult> {
  if (!isOfflineSimulated && navigator.onLine) {
    try {
      await safeLocalApiFetch(
        `/api/activations/${encodeURIComponent(record.id)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(record),
        }
      );
    } catch {
      // Handled by insertActivationRecord upsert
    }
  }
  return insertActivationRecord(record, isOfflineSimulated);
}

export async function deleteActivationRecord(id: string): Promise<void> {
  addDeletedActivationId(id);
  saveCachedActivationsToStorage(
    getCachedActivations().filter((r) => r.id !== id)
  );
  await deleteFromIndexedDBQueue(id);
  await removeRecordFromPendingQueue(id);

  try {
    await safeLocalApiFetch(`/api/activations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  } catch {
    // Ignore network error
  }

  if (supabase && navigator.onLine) {
    try {
      await supabase
        .from('noodle_activation_sku_details')
        .delete()
        .eq('activation_id', id);
      await supabase.from('noodle_activations').delete().eq('id', id);
      await supabase.from('user_locations').delete().eq('id', id);
    } catch {
      // Server persistence already updated
    }
  }
}

export function getUsers(): UserAccount[] {
  return runtimeUsers;
}

export async function fetchLiveUsers(): Promise<UserAccount[]> {
  if (supabase) {
    try {
      const supaUsers = await fetchUsersFromSupabase(runtimeUsers);
      if (supaUsers && supaUsers.length > 0) {
        runtimeUsers = supaUsers;
        saveCachedUsersToStorage(runtimeUsers);
        await persistUsersToServer(runtimeUsers);
        return runtimeUsers;
      }
    } catch {
      // Fallback to server/local cache
    }
  }

  try {
    const res = await safeLocalApiFetch('/api/users', { cache: 'no-store' });
    if (res) {
      const data = (await res.json()) as { users?: UserAccount[] };
      if (Array.isArray(data.users) && data.users.length > 0) {
        runtimeUsers = buildCompleteUserRoster(data.users, runtimeUsers);
        saveCachedUsersToStorage(runtimeUsers);
      }
    }
  } catch {
    // Fallback to runtimeUsers
  }

  return runtimeUsers;
}

export interface ManualDataSyncSummary {
  ok: boolean;
  totalUsersSynced: number;
  totalLocationsSynced: number;
  totalRecordsSynced: number;
  registeredUsersInSupabase: number;
  message: string;
  users: UserAccount[];
}

export async function syncAllDataToSupabase(
  currentRecords: NoodleActivationRecord[] = []
): Promise<ManualDataSyncSummary> {
  const completeUsers = buildCompleteUserRoster(runtimeUsers);
  runtimeUsers = completeUsers;

  const idbPending = await getAllFromIndexedDBQueue();
  const localPending = getPendingSyncQueue();
  let serverActivations: NoodleActivationRecord[] = [];

  try {
    const res = await safeLocalApiFetch(
      '/api/activations?role=admin&username=admin',
      {
        cache: 'no-store',
      }
    );
    if (res) {
      const data = (await res.json()) as { records?: NoodleActivationRecord[] };
      if (Array.isArray(data.records)) {
        serverActivations = data.records;
      }
    }
  } catch {
    // Offline or static Netlify fallback
  }

  const deletedIds = getDeletedActivationIds();
  const recordsMap = new Map<string, NoodleActivationRecord>();
  for (const r of INITIAL_ACTIVATIONS) {
    if (r && r.id && !deletedIds.has(r.id)) recordsMap.set(r.id, r);
  }
  for (const r of serverActivations) {
    if (r && r.id && !deletedIds.has(r.id)) recordsMap.set(r.id, r);
  }
  for (const r of getCachedActivations()) {
    if (r && r.id && !deletedIds.has(r.id)) recordsMap.set(r.id, r);
  }
  for (const r of currentRecords) {
    if (r && r.id && !deletedIds.has(r.id)) recordsMap.set(r.id, r);
  }
  for (const r of localPending) {
    if (r && r.id && !deletedIds.has(r.id)) recordsMap.set(r.id, r);
  }
  for (const r of idbPending) {
    if (r && r.id && !deletedIds.has(r.id)) recordsMap.set(r.id, r);
  }

  const allLocationRecords = Array.from(recordsMap.values());

  if (supabase) {
    const userSyncSummary = await syncAllUsersToSupabase(completeUsers, true);
    if (userSyncSummary.users && userSyncSummary.users.length > 0) {
      runtimeUsers = userSyncSummary.users;
      saveCachedUsersToStorage(runtimeUsers);
    }

    const userLocationRows = runtimeUsers.map(mapUserLocationToRow);
    const activationLocationRows = allLocationRecords.map(
      mapActivationToLocationRow
    );
    const combinedLocationRows = [
      ...userLocationRows,
      ...activationLocationRows,
    ];

    try {
      await chunkedUpsertToSupabase('user_locations', combinedLocationRows, {
        onConflict: 'id',
        chunkSize: 500,
      });
    } catch {
      // Non-blocking
    }

    if (allLocationRecords.length > 0) {
      try {
        const activationRows = allLocationRecords.map(mapActivationToRow);
        const { error: actErr } = await chunkedUpsertToSupabase(
          'noodle_activations',
          activationRows,
          { onConflict: 'id', chunkSize: 500 }
        );
        if (!actErr) {
          try {
            const allDetailRows = allLocationRecords.flatMap((rec) =>
              mapActivationToSkuDetailRows(rec)
            );
            if (allDetailRows.length > 0) {
              await chunkedUpsertToSupabase(
                'noodle_activation_sku_details',
                allDetailRows,
                { onConflict: 'id', chunkSize: 500 }
              );
            }
          } catch {
            // Optional detail sync
          }

          for (const rec of allLocationRecords) {
            await deleteFromIndexedDBQueue(rec.id);
            await removeRecordFromPendingQueue(rec.id);
          }
        }
      } catch {
        // Non-blocking
      }
    }
  }

  await persistUsersToServer(runtimeUsers);
  for (const rec of allLocationRecords) {
    try {
      await safeLocalApiFetch('/api/activations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rec),
      });
    } catch {
      // Ignore network error
    }
  }

  const liveRegisteredCount = await fetchRegisteredUsersCountInSupabase();
  const registeredUsersInSupabase = Math.max(
    liveRegisteredCount,
    runtimeUsers.length
  );

  const syncedUsersCount = runtimeUsers.length;
  const syncedLocationsCount = allLocationRecords.length;
  const totalRecordsSynced = syncedUsersCount + syncedLocationsCount;

  return {
    ok: true,
    totalUsersSynced: syncedUsersCount,
    totalLocationsSynced: syncedLocationsCount,
    totalRecordsSynced,
    registeredUsersInSupabase,
    message: `Synchronized ${syncedUsersCount} user accounts and ${syncedLocationsCount} activation records (${totalRecordsSynced} total records).`,
    users: runtimeUsers,
  };
}

export async function syncAllUsersNow(
  overwriteExisting = false
): Promise<BulkUserSyncSummary> {
  const completeRoster = buildCompleteUserRoster(runtimeUsers);
  runtimeUsers = completeRoster;
  const summary = await syncAllUsersToSupabase(
    completeRoster,
    overwriteExisting
  );
  if (summary.users && summary.users.length > 0) {
    runtimeUsers = summary.users;
    saveCachedUsersToStorage(runtimeUsers);
  }
  if (supabase && overwriteExisting) {
    try {
      const userLocationRows = runtimeUsers.map(mapUserLocationToRow);
      await chunkedUpsertToSupabase('user_locations', userLocationRows, {
        onConflict: 'id',
        chunkSize: 500,
      });
    } catch {
      // Optional user_locations sync
    }
  }
  await persistUsersToServer(runtimeUsers);
  return summary;
}

async function persistUsersToServer(updated: UserAccount[]): Promise<void> {
  saveCachedUsersToStorage(updated);
  try {
    await safeLocalApiFetch('/api/users', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ users: updated }),
    });
  } catch {
    // Ignore network error
  }
}

async function persistSingleUserToServer(
  user: UserAccount,
  previousUsername?: string
): Promise<void> {
  saveCachedUsersToStorage(runtimeUsers);
  try {
    await safeLocalApiFetch(`/api/users/${encodeURIComponent(user.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, previousUsername }),
    });
  } catch {
    await persistUsersToServer(runtimeUsers);
  }
}

export async function handleUpdateUser(
  updatedUser: UserAccount,
  previousUsername?: string
): Promise<UserSyncResult> {
  const normalizedUpdatedUser: UserAccount = {
    ...updatedUser,
    id: ensureValidUuid(updatedUser.id, updatedUser.username),
  };

  const current = getUsers();
  const existingUser = current.find(
    (u) =>
      u.id === normalizedUpdatedUser.id ||
      u.id === updatedUser.id ||
      (previousUsername &&
        u.username.toLowerCase() === previousUsername.toLowerCase())
  );
  const oldUsername =
    previousUsername || existingUser?.username || normalizedUpdatedUser.username;

  const updatedList = current.map((u) =>
    u.id === normalizedUpdatedUser.id ||
    u.id === updatedUser.id ||
    u.username.toLowerCase() === oldUsername.toLowerCase()
      ? normalizedUpdatedUser
      : u
  );
  runtimeUsers = buildCompleteUserRoster(updatedList);
  saveCachedUsersToStorage(runtimeUsers);

  const activeSession = getActiveSessionUser();
  if (
    activeSession &&
    (activeSession.id === normalizedUpdatedUser.id ||
      activeSession.id === updatedUser.id ||
      activeSession.username.toLowerCase() === oldUsername.toLowerCase())
  ) {
    saveActiveSessionUser(normalizedUpdatedUser);
  }

  let syncedToSupabase = false;
  let syncError: string | undefined;
  if (supabase) {
    const supaResult = await syncUserToSupabase(
      normalizedUpdatedUser,
      oldUsername
    );
    syncedToSupabase = supaResult.ok;
    syncError = supaResult.error;

    if (supaResult.record) {
      runtimeUsers = runtimeUsers.map((u) =>
        u.id === normalizedUpdatedUser.id ||
        u.username.toLowerCase() === normalizedUpdatedUser.username.toLowerCase()
          ? { ...normalizedUpdatedUser, id: supaResult.record!.id }
          : u
      );
      saveCachedUsersToStorage(runtimeUsers);
    }

    try {
      await supabase
        .from('noodle_activations')
        .update({
          seller_username: normalizedUpdatedUser.username,
          seller_name: normalizedUpdatedUser.fullName,
          route_code: normalizedUpdatedUser.routeCode,
          region_scope: normalizedUpdatedUser.regionScope,
          supervisor_username: normalizedUpdatedUser.supervisorUsername || '',
          manager_username: normalizedUpdatedUser.managerUsername || '',
        })
        .eq('seller_username', oldUsername);
    } catch {
      // Non-blocking activation seller metadata update
    }
  } else {
    syncedToSupabase = true;
  }

  await persistSingleUserToServer(normalizedUpdatedUser, oldUsername);
  await persistUsersToServer(runtimeUsers);

  return {
    ok: true,
    syncedToSupabase,
    user: normalizedUpdatedUser,
    users: runtimeUsers,
    error: syncError,
  };
}

export async function updateUserPassword(
  userId: string,
  newPassword: string
): Promise<UserAccount[]> {
  const users = getUsers();
  let targetUser: UserAccount | null = null;
  const updated = users.map((u) => {
    if (u.id === userId) {
      targetUser = {
        ...u,
        id: ensureValidUuid(u.id, u.username),
        password: newPassword,
      };
      return targetUser;
    }
    return u;
  });
  runtimeUsers = buildCompleteUserRoster(updated);
  saveCachedUsersToStorage(runtimeUsers);

  if (targetUser) {
    await handleUpdateUser(targetUser);
  } else {
    await persistUsersToServer(runtimeUsers);
  }
  return runtimeUsers;
}

export async function addUserAccount(
  newUser: UserAccount
): Promise<UserAccount[]> {
  const normalizedNewUser: UserAccount = {
    ...newUser,
    id: ensureValidUuid(newUser.id, newUser.username),
  };
  const users = getUsers();
  const updated = buildCompleteUserRoster(users, [normalizedNewUser]);
  runtimeUsers = updated;
  saveCachedUsersToStorage(runtimeUsers);

  await syncUserToSupabase(normalizedNewUser);
  await persistUsersToServer(updated);
  return runtimeUsers;
}

export async function toggleUserActiveStatus(
  userId: string
): Promise<UserAccount[]> {
  const users = getUsers();
  let toggledUser: UserAccount | null = null;
  const updated = users.map((u) => {
    if (u.id === userId) {
      toggledUser = {
        ...u,
        id: ensureValidUuid(u.id, u.username),
        active: !u.active,
      };
      return toggledUser;
    }
    return u;
  });
  runtimeUsers = buildCompleteUserRoster(updated);
  saveCachedUsersToStorage(runtimeUsers);

  if (toggledUser) {
    await handleUpdateUser(toggledUser);
  } else {
    await persistUsersToServer(runtimeUsers);
  }
  return runtimeUsers;
}

export async function resetAllUserPasswordsToDefault(): Promise<UserAccount[]> {
  const current = getUsers();
  const resetList = current.map((u) => ({
    ...u,
    password: 'password123',
  }));
  runtimeUsers = buildCompleteUserRoster(INITIAL_USERS, resetList);
  saveCachedUsersToStorage(runtimeUsers);
  await syncAllUsersToSupabase(runtimeUsers, true);
  if (supabase) {
    try {
      const userLocationRows = runtimeUsers.map(mapUserLocationToRow);
      await chunkedUpsertToSupabase('user_locations', userLocationRows, {
        onConflict: 'id',
        chunkSize: 500,
      });
    } catch {
      // Optional user_locations sync
    }
  }
  await persistUsersToServer(runtimeUsers);
  return runtimeUsers;
}

export function subscribeToRealtimeSync(callbacks: {
  onActivationsChanged?: () => void;
  onUsersChanged?: () => void;
}): () => void {
  const client = supabase;
  if (!client) {
    return () => {};
  }

  const channel = client
    .channel('pahtama-supabase-realtime-sync')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'noodle_activations' },
      () => {
        callbacks.onActivationsChanged?.();
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'user_locations' },
      () => {
        callbacks.onActivationsChanged?.();
        callbacks.onUsersChanged?.();
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'app_users' },
      () => {
        callbacks.onUsersChanged?.();
      }
    )
    .subscribe();

  return () => {
    void client.removeChannel(channel);
  };
}
