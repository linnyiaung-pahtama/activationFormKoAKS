import { PRESET_WHOLESALE_STORES } from '../constants/catalog';
import { safeLocalApiFetch, supabase } from '../lib/supabase';

export interface WholesaleStoreItem {
  id?: string;
  name: string;
  township?: string;
  region?: string;
  active?: boolean;
  sort_order?: number;
}

const STORAGE_KEY = 'pahtama_custom_wholesale_stores';
const EVENT_NAME = 'wholesale_stores_updated';

export function parseWholesaleStoresFromExcel(pastedText: string): string[] {
  if (!pastedText) return [];

  const lines = pastedText.split(/\r?\n|\r/);
  const parsedNames: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of lines) {
    let clean = rawLine.trim();

    if (clean.includes('\t')) {
      const cols = clean.split('\t');
      clean = (cols[0] || '').trim();
    }

    if (clean.startsWith('"') && clean.endsWith('"') && clean.length >= 2) {
      clean = clean.slice(1, -1).trim();
    }

    if (!clean) continue;

    const lower = clean.toLowerCase();
    if (
      lower === 'wholesale store name' ||
      lower === 'wholesale store' ||
      lower === 'wholesale_store_name' ||
      lower === 'store name'
    ) {
      continue;
    }

    if (!seen.has(lower)) {
      seen.add(lower);
      parsedNames.push(clean);
    }
  }

  return parsedNames;
}

export function getStoredWholesaleStores(): WholesaleStoreItem[] {
  if (typeof window === 'undefined') {
    return PRESET_WHOLESALE_STORES;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((item) =>
          typeof item === 'string' ? { name: item } : item
        );
      }
    }
  } catch {
    // Fallback to preset wholesale stores
  }

  return PRESET_WHOLESALE_STORES;
}

async function fetchWholesaleStoresFromServer(): Promise<WholesaleStoreItem[] | null> {
  try {
    const res = await safeLocalApiFetch('/api/wholesale-stores', {
      cache: 'no-store',
    });
    if (res) {
      const json = (await res.json()) as { stores?: WholesaleStoreItem[] };
      if (Array.isArray(json.stores) && json.stores.length > 0) {
        return json.stores;
      }
    }
  } catch {
    // Offline or static Netlify fallback
  }
  return null;
}

async function persistWholesaleStoresToServer(
  stores: WholesaleStoreItem[]
): Promise<void> {
  try {
    await safeLocalApiFetch('/api/wholesale-stores', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stores }),
    });
  } catch {
    // Offline or static Netlify fallback
  }
}

export async function fetchWholesaleStoresFromSupabase(): Promise<
  WholesaleStoreItem[] | null
> {
  if (!supabase) {
    return fetchWholesaleStoresFromServer();
  }

  try {
    const allRows: any[] = [];
    let from = 0;
    const batchSize = 1000;
    let queryError: any = null;

    while (true) {
      const { data, error } = await supabase
        .from('wholesale_stores')
        .select('id, name, township, region, active, sort_order')
        .eq('active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true })
        .range(from, from + batchSize - 1);

      if (error) {
        queryError = error;
        break;
      }

      if (Array.isArray(data) && data.length > 0) {
        allRows.push(...data);
        if (data.length < batchSize) {
          break;
        }
        from += batchSize;
      } else {
        break;
      }
    }

    if (queryError && allRows.length === 0) {
      return fetchWholesaleStoresFromServer();
    }

    if (allRows.length > 0) {
      const formatted: WholesaleStoreItem[] = allRows.map((row) => ({
        id: row.id,
        name: row.name,
        township: row.township || '',
        region: row.region || '',
        active: row.active ?? true,
        sort_order: row.sort_order ?? 0,
      }));

      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(formatted));
          window.dispatchEvent(
            new CustomEvent(EVENT_NAME, { detail: formatted })
          );
        } catch {
          // Ignore storage error
        }
      }
      void persistWholesaleStoresToServer(formatted);
      return formatted;
    }
  } catch {
    // Fallback to server
  }

  return fetchWholesaleStoresFromServer();
}

export async function syncWholesaleStoresToSupabase(
  stores: WholesaleStoreItem[]
): Promise<boolean> {
  void persistWholesaleStoresToServer(stores);
  if (!supabase) return false;

  try {
    const payload = stores.map((s, index) => ({
      name: s.name.trim(),
      township: s.township || '',
      region: s.region || '',
      active: true,
      sort_order: index + 1,
      updated_at: new Date().toISOString(),
    }));

    const chunkSize = 500;
    for (let i = 0; i < payload.length; i += chunkSize) {
      const chunk = payload.slice(i, i + chunkSize);
      const { error } = await supabase
        .from('wholesale_stores')
        .upsert(chunk, { onConflict: 'name' });
      if (error) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

export function saveStoredWholesaleStores(
  stores: WholesaleStoreItem[] | string[]
): WholesaleStoreItem[] {
  const normalized: WholesaleStoreItem[] = stores
    .map((s, idx) => {
      if (typeof s === 'string') {
        return { name: s.trim(), sort_order: idx + 1 };
      }
      return {
        id: s.id,
        name: s.name.trim(),
        township: s.township,
        region: s.region,
        active: s.active ?? true,
        sort_order: s.sort_order ?? idx + 1,
      };
    })
    .filter((s) => s.name.length > 0);

  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      window.dispatchEvent(
        new CustomEvent(EVENT_NAME, { detail: normalized })
      );
    } catch {
      // Ignore storage error
    }
  }

  void syncWholesaleStoresToSupabase(normalized);

  return normalized;
}

export function resetWholesaleStoresToDefault(): WholesaleStoreItem[] {
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem(STORAGE_KEY);
      window.dispatchEvent(
        new CustomEvent(EVENT_NAME, { detail: PRESET_WHOLESALE_STORES })
      );
    } catch {
      // Ignore storage error
    }
  }

  void syncWholesaleStoresToSupabase(PRESET_WHOLESALE_STORES);

  return PRESET_WHOLESALE_STORES;
}

export function deleteWholesaleStore(storeName: string): WholesaleStoreItem[] {
  const current = getStoredWholesaleStores();
  const trimmedTarget = storeName.trim().toLowerCase();
  const updated = current.filter(
    (s) => s.name.trim().toLowerCase() !== trimmedTarget
  );

  if (supabase) {
    try {
      void supabase
        .from('wholesale_stores')
        .delete()
        .eq('name', storeName.trim());
    } catch {
      // Ignore
    }
  }

  return saveStoredWholesaleStores(updated);
}

export function updateWholesaleStore(
  oldName: string,
  newName: string
): WholesaleStoreItem[] {
  const trimmedNew = newName.trim();
  const trimmedOld = oldName.trim();
  if (!trimmedNew || trimmedNew === trimmedOld) {
    return getStoredWholesaleStores();
  }

  const current = getStoredWholesaleStores();
  const updated = current.map((s) => {
    if (s.name.trim() === trimmedOld) {
      return { ...s, name: trimmedNew };
    }
    return s;
  });

  if (supabase) {
    try {
      void supabase
        .from('wholesale_stores')
        .update({ name: trimmedNew, updated_at: new Date().toISOString() })
        .eq('name', trimmedOld);
    } catch {
      // Ignore
    }
  }

  return saveStoredWholesaleStores(updated);
}

export function moveWholesaleStore(
  storeName: string,
  direction: 'up' | 'down'
): WholesaleStoreItem[] {
  const current = [...getStoredWholesaleStores()];
  const index = current.findIndex((s) => s.name.trim() === storeName.trim());
  if (index === -1) return current;

  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= current.length) return current;

  const temp = current[index];
  current[index] = current[targetIndex];
  current[targetIndex] = temp;

  return saveStoredWholesaleStores(current);
}

export function sortWholesaleStores(
  direction: 'asc' | 'desc'
): WholesaleStoreItem[] {
  const current = [...getStoredWholesaleStores()];
  current.sort((a, b) => {
    const comp = a.name.localeCompare(b.name, undefined, {
      sensitivity: 'base',
      numeric: true,
    });
    return direction === 'asc' ? comp : -comp;
  });

  return saveStoredWholesaleStores(current);
}

export function addWholesaleStore(storeName: string): WholesaleStoreItem[] {
  const trimmed = storeName.trim();
  if (!trimmed) return getStoredWholesaleStores();

  const current = getStoredWholesaleStores();
  const exists = current.some(
    (s) => s.name.toLowerCase() === trimmed.toLowerCase()
  );
  if (exists) return current;

  const updated = [
    ...current,
    { name: trimmed, sort_order: current.length + 1 },
  ];
  return saveStoredWholesaleStores(updated);
}

export function subscribeToWholesaleStores(
  callback: (stores: WholesaleStoreItem[]) => void
): () => void {
  if (typeof window === 'undefined') return () => {};

  const handler = (e: Event) => {
    const custom = e as CustomEvent<WholesaleStoreItem[]>;
    if (custom.detail) {
      callback(custom.detail);
    } else {
      callback(getStoredWholesaleStores());
    }
  };
  window.addEventListener(EVENT_NAME, handler);

  const storageHandler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      callback(getStoredWholesaleStores());
    }
  };
  window.addEventListener('storage', storageHandler);

  void fetchWholesaleStoresFromSupabase().then((remoteStores) => {
    if (remoteStores && remoteStores.length > 0) {
      callback(remoteStores);
    }
  });

  let realtimeChannel: ReturnType<NonNullable<typeof supabase>['channel']> | null =
    null;

  if (supabase) {
    try {
      realtimeChannel = supabase
        .channel('wholesale-stores-realtime-sync')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'wholesale_stores' },
          () => {
            void fetchWholesaleStoresFromSupabase().then((updated) => {
              if (updated && updated.length > 0) {
                callback(updated);
              }
            });
          }
        )
        .subscribe();
    } catch {
      // Realtime optional fallback
    }
  }

  return () => {
    window.removeEventListener(EVENT_NAME, handler);
    window.removeEventListener('storage', storageHandler);
    if (supabase && realtimeChannel) {
      void supabase.removeChannel(realtimeChannel);
    }
  };
}
