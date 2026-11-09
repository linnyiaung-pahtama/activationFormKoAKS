import { supabase } from '../lib/supabase';
import { INITIAL_USERS } from '../constants/catalog';
import { UserAccount, UserRole } from '../types';

export interface UserSyncResult {
  ok: boolean;
  syncedToSupabase: boolean;
  user: UserAccount;
  users: UserAccount[];
  error?: string;
}

export interface BulkUserSyncSummary {
  ok: boolean;
  totalAppUsers: number;
  syncedInSupabaseCount: number;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  rlsInsertBlocked: boolean;
  error?: string;
  users: UserAccount[];
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LEGACY_ID_TO_UUID: Record<string, string> = {
  'usr-admin-1': '00000000-0000-4000-8000-000000000001',
  'usr-mgr-1': '00000000-0000-4000-8000-000000000101',
  'usr-mgr-2': '00000000-0000-4000-8000-000000000102',
  'usr-mgr-3': '00000000-0000-4000-8000-000000000103',
  'usr-mgr-4': '00000000-0000-4000-8000-000000000104',
  'usr-sup-1': '00000000-0000-4000-8000-000000000201',
  'usr-sup-2': '00000000-0000-4000-8000-000000000202',
  'usr-sup-3': '00000000-0000-4000-8000-000000000203',
  'usr-sup-4': '00000000-0000-4000-8000-000000000204',
  'usr-sup-5': '00000000-0000-4000-8000-000000000205',
  'usr-sel-1': '7ff1e036-e3e8-48c7-b071-de40ac76d8be',
  'usr-sel-2': '00000000-0000-4000-8000-000000000302',
  'usr-sel-3': '00000000-0000-4000-8000-000000000303',
  'usr-sel-4': '00000000-0000-4000-8000-000000000304',
  'usr-sel-5': '00000000-0000-4000-8000-000000000305',
  'usr-sel-6': '00000000-0000-4000-8000-000000000306',
  'usr-sel-7': '00000000-0000-4000-8000-000000000307',
  'usr-sel-8': '00000000-0000-4000-8000-000000000308',
  'usr-sel-9': '00000000-0000-4000-8000-000000000309',
  'usr-sel-10': '00000000-0000-4000-8000-000000000310',
  'usr-sel-11': '00000000-0000-4000-8000-000000000311',
  'usr-sel-12': '00000000-0000-4000-8000-000000000312',
  'usr-sel-13': '00000000-0000-4000-8000-000000000313',
  'usr-sel-14': '00000000-0000-4000-8000-000000000314',
  'usr-sel-15': '00000000-0000-4000-8000-000000000315',
};

let cachedAppUsersColumns: Set<string> | null = null;
let lastBulkSyncSummary: BulkUserSyncSummary | null = null;

export function getLastBulkUserSyncSummary(): BulkUserSyncSummary | null {
  return lastBulkSyncSummary;
}

export function ensureValidUuid(
  rawId: string | undefined,
  username: string
): string {
  const trimmedId = String(rawId || '').trim();
  if (UUID_REGEX.test(trimmedId)) {
    return trimmedId.toLowerCase();
  }
  if (LEGACY_ID_TO_UUID[trimmedId]) {
    return LEGACY_ID_TO_UUID[trimmedId];
  }
  const lowerUser = String(username || '').trim().toLowerCase();
  if (lowerUser === 'admin') {
    return '00000000-0000-4000-8000-000000000001';
  }
  if (lowerUser === 'aks') {
    return '93875359-ea2f-48f9-8188-8f1ada228c1e';
  }
  const preset = INITIAL_USERS.find(
    (u) => u.username.toLowerCase() === lowerUser
  );
  if (preset && UUID_REGEX.test(preset.id)) {
    return preset.id.toLowerCase();
  }

  let hash = 0;
  const seed = `${lowerUser}:${trimmedId || 'user'}`;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const hex = hash.toString(16).padStart(12, '0').slice(0, 12);
  return `00000000-0000-4000-8000-${hex}`;
}

function normalizeRole(
  rawRole: unknown,
  fallback: UserRole = UserRole.SELLER
): UserRole {
  const val = String(rawRole || '').trim().toLowerCase();
  if (val === UserRole.ADMIN) return UserRole.ADMIN;
  if (
    val === UserRole.NSM ||
    val === 'nsm' ||
    val === 'national sales manager' ||
    val === 'national_sales_manager'
  ) {
    return UserRole.NSM;
  }
  if (
    val === UserRole.BRAND_MANAGER ||
    val === 'brand_manager' ||
    val === 'brand manager' ||
    val === 'brand_mgr' ||
    val === 'bm'
  ) {
    return UserRole.BRAND_MANAGER;
  }
  if (val === UserRole.MANAGER) return UserRole.MANAGER;
  if (val === UserRole.SUPERVISOR) return UserRole.SUPERVISOR;
  if (val === UserRole.SELLER) return UserRole.SELLER;
  return fallback;
}

export function buildCompleteUserRoster(
  ...userLists: Array<UserAccount[] | null | undefined>
): UserAccount[] {
  const byId = new Map<string, UserAccount>();
  const usernameToId = new Map<string, string>();

  const upsertIntoMap = (rawUser: UserAccount, overwriteExisting: boolean) => {
    if (!rawUser || !rawUser.username) return;
    const normalizedId = ensureValidUuid(rawUser.id, rawUser.username);
    const lowerUsername = rawUser.username.trim().toLowerCase();

    const existingIdByUsername = usernameToId.get(lowerUsername);
    const targetId = byId.has(normalizedId)
      ? normalizedId
      : existingIdByUsername || normalizedId;
    const existing = byId.get(targetId);

    const normalizedUser: UserAccount = {
      ...existing,
      ...rawUser,
      id: normalizedId,
      username: rawUser.username.trim(),
      password: rawUser.password || existing?.password || 'password123',
      fullName:
        rawUser.fullName?.trim() ||
        existing?.fullName ||
        rawUser.username.trim(),
      role: normalizeRole(rawUser.role, existing?.role ?? UserRole.SELLER),
      routeCode:
        rawUser.routeCode?.trim() || existing?.routeCode || 'ALL-ROUTES',
      regionScope:
        rawUser.regionScope?.trim() || existing?.regionScope || 'All Regions',
      branch: rawUser.branch || existing?.branch,
      supervisorUsername:
        rawUser.supervisorUsername !== undefined
          ? rawUser.supervisorUsername
          : existing?.supervisorUsername,
      managerUsername:
        rawUser.managerUsername !== undefined
          ? rawUser.managerUsername
          : existing?.managerUsername,
      active:
        rawUser.active !== undefined
          ? Boolean(rawUser.active)
          : existing?.active !== undefined
          ? existing.active
          : true,
    };

    if (!existing || overwriteExisting) {
      if (existing && existing.username.toLowerCase() !== lowerUsername) {
        usernameToId.delete(existing.username.toLowerCase());
      }
      if (targetId !== normalizedId) {
        byId.delete(targetId);
      }
      byId.set(normalizedId, normalizedUser);
      usernameToId.set(lowerUsername, normalizedId);
    }
  };

  for (const initUser of INITIAL_USERS) {
    upsertIntoMap(initUser, true);
  }

  for (const list of userLists) {
    if (!Array.isArray(list)) continue;
    for (const u of list) {
      upsertIntoMap(u, true);
    }
  }

  const roleOrder: Record<UserRole, number> = {
    [UserRole.ADMIN]: 0,
    [UserRole.NSM]: 1,
    [UserRole.BRAND_MANAGER]: 2,
    [UserRole.MANAGER]: 3,
    [UserRole.SUPERVISOR]: 4,
    [UserRole.SELLER]: 5,
  };

  return Array.from(byId.values()).sort((a, b) => {
    const roleDiff = (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9);
    if (roleDiff !== 0) return roleDiff;
    return a.username.localeCompare(b.username, undefined, { numeric: true });
  });
}

export function mapRowToUser(
  row: Record<string, any>,
  fallback?: UserAccount
): UserAccount {
  const payloadUser =
    row.payload &&
    typeof row.payload === 'object' &&
    row.payload.user &&
    typeof row.payload.user === 'object'
      ? (row.payload.user as Partial<UserAccount>)
      : undefined;

  const username = String(
    row.username || payloadUser?.username || fallback?.username || ''
  ).trim();
  const rowId = String(row.id || row.user_id || payloadUser?.id || '').trim();
  const normalizedId = ensureValidUuid(
    rowId.startsWith('user_') ? rowId.slice(5) : rowId || fallback?.id,
    username
  );

  const isAdminAccount =
    username.toLowerCase() === 'aks' ||
    username.toLowerCase() === 'admin' ||
    normalizedId === '00000000-0000-4000-8000-000000000001' ||
    normalizedId === '93875359-ea2f-48f9-8188-8f1ada228c1e';

  const preset =
    fallback ||
    INITIAL_USERS.find(
      (u) =>
        ensureValidUuid(u.id, u.username) === normalizedId ||
        u.username.toLowerCase() === username.toLowerCase()
    );
  const defaultFullName =
    preset?.fullName ??
    (isAdminAccount ? 'U Kyaw Zay Ya (System Admin)' : username);

  const nonEmptyStr = (...candidates: Array<unknown>): string | undefined => {
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim().length > 0) {
        return c.trim();
      }
    }
    return undefined;
  };

  const resolvedFullName =
    nonEmptyStr(
      row.full_name,
      row.fullName,
      row.name,
      payloadUser?.fullName,
      fallback?.fullName,
      defaultFullName
    ) || defaultFullName;

  const resolvedRouteCode =
    nonEmptyStr(
      row.route_code !== 'ALL-ROUTES' ? row.route_code : undefined,
      row.routeCode,
      payloadUser?.routeCode,
      fallback?.routeCode,
      row.route_code,
      preset?.routeCode
    ) || 'ALL-ROUTES';

  const resolvedRegionScope =
    nonEmptyStr(
      row.region_scope !== 'All Regions' ? row.region_scope : undefined,
      row.regionScope,
      payloadUser?.regionScope,
      fallback?.regionScope,
      row.region_scope,
      preset?.regionScope
    ) || (isAdminAccount ? 'All Regions (National)' : 'All Regions');

  const resolvedSupervisor =
    row.supervisor_username !== undefined
      ? row.supervisor_username || undefined
      : row.supervisorUsername !== undefined
      ? row.supervisorUsername || undefined
      : payloadUser?.supervisorUsername !== undefined
      ? payloadUser.supervisorUsername || undefined
      : fallback?.supervisorUsername ?? preset?.supervisorUsername;

  const resolvedManager =
    row.manager_username !== undefined
      ? row.manager_username || undefined
      : row.managerUsername !== undefined
      ? row.managerUsername || undefined
      : payloadUser?.managerUsername !== undefined
      ? payloadUser.managerUsername || undefined
      : fallback?.managerUsername ?? preset?.managerUsername;

  const resolvedPassword =
    nonEmptyStr(
      row.password,
      payloadUser?.password,
      fallback?.password,
      preset?.password
    ) || 'password123';

  return {
    id: normalizedId,
    username,
    password: resolvedPassword,
    fullName: resolvedFullName,
    role: normalizeRole(
      row.role ?? payloadUser?.role,
      fallback?.role ??
        (isAdminAccount ? UserRole.ADMIN : preset?.role ?? UserRole.SELLER)
    ),
    routeCode: resolvedRouteCode,
    regionScope: resolvedRegionScope,
    branch: payloadUser?.branch ?? fallback?.branch ?? preset?.branch,
    supervisorUsername: resolvedSupervisor
      ? String(resolvedSupervisor)
      : undefined,
    managerUsername: resolvedManager ? String(resolvedManager) : undefined,
    active:
      row.active !== undefined
        ? Boolean(row.active)
        : payloadUser?.active !== undefined
        ? Boolean(payloadUser.active)
        : fallback?.active !== undefined
        ? fallback.active
        : preset?.active !== undefined
        ? preset.active
        : true,
  };
}

export function mapUserToRow(
  user: UserAccount,
  includeId = true,
  knownColumns?: Set<string> | null
): Record<string, any> {
  const validId = ensureValidUuid(user.id, user.username);
  const fullRow: Record<string, any> = {
    username: user.username.trim(),
    password: user.password,
    full_name: user.fullName.trim(),
    role: user.role,
    route_code: user.routeCode.trim() || 'ALL-ROUTES',
    region_scope: user.regionScope.trim() || 'All Regions',
    supervisor_username: user.supervisorUsername?.trim() || null,
    manager_username: user.managerUsername?.trim() || null,
    active: Boolean(user.active),
    updated_at: new Date().toISOString(),
  };

  if (includeId) {
    fullRow.id = validId;
  }

  const activeColumns = knownColumns ?? cachedAppUsersColumns;
  if (activeColumns && activeColumns.size > 0) {
    const filtered: Record<string, any> = {};
    for (const [key, val] of Object.entries(fullRow)) {
      if (activeColumns.has(key)) {
        filtered[key] = val;
      }
    }
    filtered.username = user.username.trim();
    filtered.password = user.password;
    if (includeId && activeColumns.has('id')) {
      filtered.id = validId;
    }
    return filtered;
  }

  return fullRow;
}

function buildUserLocationProfileRow(user: UserAccount) {
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
      updatedAt: new Date().toISOString(),
      user: {
        ...user,
        id: validId,
      },
    },
    updated_at: new Date().toISOString(),
  };
}

export async function syncUserToSupabase(
  user: UserAccount,
  previousUsername?: string,
  knownColumns?: Set<string> | null
): Promise<{
  ok: boolean;
  record?: UserAccount;
  error?: string;
  rlsBlocked?: boolean;
}> {
  if (!supabase) {
    return {
      ok: false,
      error: 'Supabase client is not configured.',
    };
  }

  const normalizedUser: UserAccount = {
    ...user,
    id: ensureValidUuid(user.id, user.username),
  };
  const lookupUsername = (previousUsername || normalizedUser.username).trim();

  try {
    if (
      previousUsername &&
      previousUsername.trim().toLowerCase() !==
        normalizedUser.username.trim().toLowerCase()
    ) {
      await supabase
        .from('user_locations')
        .delete()
        .eq('id', `user_${previousUsername.trim().toLowerCase()}`);
    }
    await supabase
      .from('user_locations')
      .upsert([buildUserLocationProfileRow(normalizedUser)], {
        onConflict: 'id',
      });
  } catch {
    // Non-blocking user_locations mirror
  }

  try {
    let existingRow: Record<string, any> | null = null;

    if (UUID_REGEX.test(normalizedUser.id)) {
      const { data: byIdData, error: byIdErr } = await supabase
        .from('app_users')
        .select('*')
        .eq('id', normalizedUser.id)
        .maybeSingle();
      if (!byIdErr && byIdData) {
        existingRow = byIdData;
      }
    }

    if (!existingRow) {
      const { data: byUsernameData } = await supabase
        .from('app_users')
        .select('*')
        .ilike('username', lookupUsername)
        .maybeSingle();
      if (byUsernameData) {
        existingRow = byUsernameData;
      }
    }

    if (existingRow) {
      cachedAppUsersColumns = new Set(Object.keys(existingRow));
    }

    const cols = knownColumns ?? cachedAppUsersColumns;

    if (existingRow) {
      const matchColumn = existingRow.id ? 'id' : 'username';
      const matchValue = existingRow.id ? existingRow.id : existingRow.username;

      const compatiblePayload = mapUserToRow(normalizedUser, false, cols);
      const withoutUpdatedAt = { ...compatiblePayload };
      delete withoutUpdatedAt.updated_at;

      const coreProfilePayload: Record<string, any> = {
        username: normalizedUser.username.trim(),
        password: normalizedUser.password,
        full_name: normalizedUser.fullName.trim(),
        role: normalizedUser.role,
        route_code: normalizedUser.routeCode.trim() || 'ALL-ROUTES',
        region_scope: normalizedUser.regionScope.trim() || 'All Regions',
        supervisor_username: normalizedUser.supervisorUsername?.trim() || null,
        manager_username: normalizedUser.managerUsername?.trim() || null,
        active: Boolean(normalizedUser.active),
      };

      const minimalPayload = {
        username: normalizedUser.username.trim(),
        password: normalizedUser.password,
      };

      const updateCandidates = [
        compatiblePayload,
        withoutUpdatedAt,
        coreProfilePayload,
        minimalPayload,
      ];

      let lastUpdateErr = '';
      for (const candidate of updateCandidates) {
        const { data: updatedRows, error: updateError } = await supabase
          .from('app_users')
          .update(candidate)
          .eq(matchColumn, matchValue)
          .select();

        if (!updateError && updatedRows && updatedRows.length > 0) {
          cachedAppUsersColumns = new Set(Object.keys(updatedRows[0]));
          return {
            ok: true,
            record: mapRowToUser(updatedRows[0], normalizedUser),
          };
        }
        if (updateError) {
          lastUpdateErr = updateError.message;
        }
      }

      return {
        ok: false,
        error: lastUpdateErr || 'Failed to update user in app_users',
      };
    }

    const payloadWithId = mapUserToRow(normalizedUser, true, cols);
    const payloadWithoutId = mapUserToRow(normalizedUser, false, cols);

    const candidatePayloads = [
      { row: payloadWithId, mode: 'upsert_id' as const },
      { row: payloadWithoutId, mode: 'upsert_username' as const },
      { row: payloadWithId, mode: 'insert' as const },
    ];

    let lastErrorMsg = '';
    let rlsBlocked = false;

    for (const attempt of candidatePayloads) {
      const query =
        attempt.mode === 'upsert_id'
          ? supabase
              .from('app_users')
              .upsert([attempt.row], { onConflict: 'id' })
              .select()
          : attempt.mode === 'upsert_username'
          ? supabase
              .from('app_users')
              .upsert([attempt.row], { onConflict: 'username' })
              .select()
          : supabase.from('app_users').insert([attempt.row]).select();

      const { data: insertedData, error: insertErr } = await query;
      if (!insertErr && insertedData && insertedData.length > 0) {
        cachedAppUsersColumns = new Set(Object.keys(insertedData[0]));
        return {
          ok: true,
          record: mapRowToUser(insertedData[0], normalizedUser),
        };
      }
      if (insertErr) {
        lastErrorMsg = insertErr.message;
        if (insertErr.code === '42501') {
          rlsBlocked = true;
          break;
        }
      }
    }

    return {
      ok: false,
      error: lastErrorMsg,
      rlsBlocked,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export async function syncAllUsersToSupabase(
  users: UserAccount[],
  overwriteExistingInSupabase = false
): Promise<BulkUserSyncSummary> {
  const completeRoster = buildCompleteUserRoster(users);

  const client = supabase;
  if (!client || completeRoster.length === 0) {
    const fallbackSummary: BulkUserSyncSummary = {
      ok: false,
      totalAppUsers: completeRoster.length,
      syncedInSupabaseCount: 0,
      insertedCount: 0,
      updatedCount: 0,
      skippedCount: completeRoster.length,
      rlsInsertBlocked: false,
      error: 'Supabase client is not configured.',
      users: completeRoster,
    };
    lastBulkSyncSummary = fallbackSummary;
    return fallbackSummary;
  }

  let insertedCount = 0;
  let updatedCount = 0;
  let rlsInsertBlocked = false;
  let lastError: string | undefined;

  const fetchAllUsersRowsFromClient = async (
    targetTable: string,
    orderByCol?: string
  ): Promise<{ data: any[]; error: any }> => {
    const allRows: any[] = [];
    let from = 0;
    const batchSize = 1000;
    let queryError: any = null;
    while (true) {
      let q = client
        .from(targetTable)
        .select('*')
        .range(from, from + batchSize - 1);
      if (orderByCol) {
        q = q.order(orderByCol, { ascending: true });
      }
      const { data, error } = await q;
      if (error) {
        queryError = error;
        break;
      }
      if (Array.isArray(data) && data.length > 0) {
        allRows.push(...data);
        if (data.length < batchSize) break;
        from += batchSize;
      } else {
        break;
      }
    }
    return { data: allRows, error: queryError };
  };

  try {
    const { data: existingRows, error: selectErr } =
      await fetchAllUsersRowsFromClient('app_users', 'created_at');

    if (selectErr) {
      const errSummary: BulkUserSyncSummary = {
        ok: false,
        totalAppUsers: completeRoster.length,
        syncedInSupabaseCount: 0,
        insertedCount: 0,
        updatedCount: 0,
        skippedCount: completeRoster.length,
        rlsInsertBlocked: selectErr.code === '42501',
        error: selectErr.message,
        users: completeRoster,
      };
      lastBulkSyncSummary = errSummary;
      return errSummary;
    }

    const rowsList = Array.isArray(existingRows) ? existingRows : [];
    if (rowsList.length > 0) {
      cachedAppUsersColumns = new Set(Object.keys(rowsList[0]));
    }

    const locationProfileById = new Map<string, UserAccount>();
    const locationProfileByUsername = new Map<string, UserAccount>();
    try {
      const { data: locRows } = await fetchAllUsersRowsFromClient('user_locations');
      if (Array.isArray(locRows)) {
        for (const lRow of locRows) {
          if (
            lRow.payload &&
            typeof lRow.payload === 'object' &&
            lRow.payload.recordType === 'user_profile' &&
            lRow.payload.user &&
            lRow.payload.user.username
          ) {
            const u = mapRowToUser(lRow, lRow.payload.user as UserAccount);
            locationProfileById.set(ensureValidUuid(u.id, u.username), u);
            locationProfileByUsername.set(u.username.toLowerCase(), u);
          }
        }
      }
    } catch {
      // Optional user_locations read
    }

    const existingByUsername = new Map<string, Record<string, any>>();
    const existingById = new Map<string, Record<string, any>>();
    for (const row of rowsList) {
      const uName = String(row.username || '').trim().toLowerCase();
      const rId = ensureValidUuid(row.id, row.username);
      if (uName) existingByUsername.set(uName, row);
      if (rId) existingById.set(rId, row);
      if (row.id) existingById.set(String(row.id).trim().toLowerCase(), row);
    }

    const missingUsers: UserAccount[] = [];
    const existingUsersToVerify: Array<{
      user: UserAccount;
      row: Record<string, any>;
    }> = [];

    for (const appUser of completeRoster) {
      const normalizedId = ensureValidUuid(appUser.id, appUser.username);
      const lowerName = appUser.username.trim().toLowerCase();
      const matchedRow =
        existingById.get(normalizedId) || existingByUsername.get(lowerName);
      if (matchedRow) {
        existingUsersToVerify.push({ user: appUser, row: matchedRow });
      } else {
        missingUsers.push({ ...appUser, id: normalizedId });
      }
    }

    if (overwriteExistingInSupabase) {
      for (const { user, row } of existingUsersToVerify) {
        const desiredPayload = mapUserToRow(user, false, cachedAppUsersColumns);
        const needsUpdate = Object.entries(desiredPayload).some(([col, val]) => {
          if (col === 'updated_at') return false;
          return (
            row[col] !== undefined &&
            String(row[col] ?? '') !== String(val ?? '')
          );
        });

        if (needsUpdate) {
          const matchCol = row.id ? 'id' : 'username';
          const matchVal = row.id ? row.id : row.username;
          const { error: updErr } = await client
            .from('app_users')
            .update(desiredPayload)
            .eq(matchCol, matchVal);
          if (!updErr) {
            updatedCount += 1;
          }
        }
      }
    }

    if (missingUsers.length > 0) {
      const payloadsWithUuid = missingUsers.map((u) =>
        mapUserToRow(u, true, cachedAppUsersColumns)
      );
      const payloadsWithoutId = missingUsers.map((u) =>
        mapUserToRow(u, false, cachedAppUsersColumns)
      );

      const batchStrategies = [
        () =>
          client
            .from('app_users')
            .upsert(payloadsWithUuid, { onConflict: 'id' })
            .select(),
        () =>
          client
            .from('app_users')
            .upsert(payloadsWithoutId, { onConflict: 'username' })
            .select(),
        () => client.from('app_users').insert(payloadsWithUuid).select(),
      ];

      let batchSucceeded = false;
      for (const runBatch of batchStrategies) {
        const { data: batchData, error: batchErr } = await runBatch();
        if (!batchErr && batchData && batchData.length > 0) {
          insertedCount += batchData.length;
          batchSucceeded = true;
          cachedAppUsersColumns = new Set(Object.keys(batchData[0]));
          break;
        }
        if (batchErr) {
          lastError = batchErr.message;
          if (batchErr.code === '42501') {
            rlsInsertBlocked = true;
            break;
          }
        }
      }

      if (!batchSucceeded && !rlsInsertBlocked) {
        for (const missingUser of missingUsers) {
          const singleRes = await syncUserToSupabase(
            missingUser,
            undefined,
            cachedAppUsersColumns
          );
          if (singleRes.ok) {
            insertedCount += 1;
          } else {
            lastError = singleRes.error || lastError;
            if (singleRes.rlsBlocked) {
              rlsInsertBlocked = true;
              break;
            }
          }
        }
      }
    }

    let verifiedRows = rowsList;
    if (insertedCount > 0 || updatedCount > 0) {
      const { data: finalRows } = await fetchAllUsersRowsFromClient(
        'app_users',
        'created_at'
      );
      if (Array.isArray(finalRows)) {
        verifiedRows = finalRows;
      }
    }

    const syncedInSupabaseCount = verifiedRows.length;
    const rosterById = new Map<string, UserAccount>();
    const rosterByUsername = new Map<string, UserAccount>();
    for (const u of completeRoster) {
      rosterById.set(ensureValidUuid(u.id, u.username), u);
      rosterByUsername.set(u.username.toLowerCase(), u);
    }

    const mappedFromDb: UserAccount[] = verifiedRows.map((row) => {
      const rId = ensureValidUuid(row.id, row.username);
      const rUser = String(row.username || '').trim().toLowerCase();
      const locProfile =
        locationProfileById.get(rId) || locationProfileByUsername.get(rUser);
      const baseFallback =
        locProfile || rosterById.get(rId) || rosterByUsername.get(rUser);
      return mapRowToUser(row, baseFallback);
    });

    const allAuthoritativeDbUsers = [
      ...Array.from(locationProfileById.values()),
      ...mappedFromDb,
    ];

    const finalUsers = buildCompleteUserRoster(
      completeRoster,
      allAuthoritativeDbUsers
    );
    const skippedCount = Math.max(0, finalUsers.length - syncedInSupabaseCount);

    const summary: BulkUserSyncSummary = {
      ok: skippedCount === 0 && !rlsInsertBlocked,
      totalAppUsers: finalUsers.length,
      syncedInSupabaseCount,
      insertedCount,
      updatedCount,
      skippedCount,
      rlsInsertBlocked,
      error:
        skippedCount > 0
          ? lastError ||
            `Only ${syncedInSupabaseCount} of ${finalUsers.length} users are stored in Supabase app_users.`
          : undefined,
      users: finalUsers,
    };

    lastBulkSyncSummary = summary;
    return summary;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const failSummary: BulkUserSyncSummary = {
      ok: false,
      totalAppUsers: completeRoster.length,
      syncedInSupabaseCount: 0,
      insertedCount,
      updatedCount,
      skippedCount: completeRoster.length,
      rlsInsertBlocked,
      error: msg,
      users: completeRoster,
    };
    lastBulkSyncSummary = failSummary;
    return failSummary;
  }
}

export async function fetchUsersFromSupabase(
  baseUsers: UserAccount[] = INITIAL_USERS
): Promise<UserAccount[] | null> {
  if (!supabase) return null;

  const completeBaseRoster = buildCompleteUserRoster(baseUsers);

  try {
    const { data: rows, error } = await supabase
      .from('app_users')
      .select('*')
      .order('created_at', { ascending: true })
      .range(0, 999);

    if (error) {
      return completeBaseRoster;
    }

    if (Array.isArray(rows) && rows.length > 0) {
      cachedAppUsersColumns = new Set(Object.keys(rows[0]));
      const rosterById = new Map<string, UserAccount>();
      const rosterByUsername = new Map<string, UserAccount>();
      for (const u of completeBaseRoster) {
        rosterById.set(ensureValidUuid(u.id, u.username), u);
        rosterByUsername.set(u.username.toLowerCase(), u);
      }

      const mappedUsers = rows.map((row: Record<string, any>) => {
        const rId = ensureValidUuid(row.id, row.username);
        const rUser = String(row.username || '').trim().toLowerCase();
        const fallback = rosterById.get(rId) || rosterByUsername.get(rUser);
        return mapRowToUser(row, fallback);
      });

      const merged = buildCompleteUserRoster(completeBaseRoster, mappedUsers);
      lastBulkSyncSummary = {
        ok: true,
        totalAppUsers: merged.length,
        syncedInSupabaseCount: rows.length,
        insertedCount: 0,
        updatedCount: 0,
        skippedCount: Math.max(0, merged.length - rows.length),
        rlsInsertBlocked: false,
        users: merged,
      };
      return merged;
    }

    // Only attempt initial seed when app_users table is completely empty
    const syncSummary = await syncAllUsersToSupabase(completeBaseRoster, false);
    return syncSummary.users;
  } catch {
    return completeBaseRoster;
  }
}

export async function authenticateUserDirect(
  rawUsername: string,
  rawPassword: string,
  fallbackUsers: UserAccount[] = INITIAL_USERS
): Promise<{
  user: UserAccount | null;
  errorType?: 'NOT_FOUND' | 'INACTIVE' | 'WRONG_PASSWORD' | 'NETWORK';
}> {
  const trimmedUsername = rawUsername.trim().toLowerCase();
  const roster = buildCompleteUserRoster(fallbackUsers);

  if (supabase) {
    try {
      const { data: matchedRow, error } = await supabase
        .from('app_users')
        .select('*')
        .ilike('username', trimmedUsername)
        .limit(1)
        .maybeSingle();

      if (!error && matchedRow) {
        const preset = roster.find(
          (u) => u.username.toLowerCase() === trimmedUsername
        );
        const mapped = mapRowToUser(matchedRow, preset);
        if (!mapped.active) {
          return { user: null, errorType: 'INACTIVE' };
        }
        if (mapped.password !== rawPassword) {
          return { user: null, errorType: 'WRONG_PASSWORD' };
        }
        return { user: mapped };
      }
    } catch {
      // Fall back to roster check below
    }
  }

  const localMatch = roster.find(
    (u) => u.username.toLowerCase() === trimmedUsername
  );
  if (!localMatch) {
    return { user: null, errorType: 'NOT_FOUND' };
  }
  if (!localMatch.active) {
    return { user: null, errorType: 'INACTIVE' };
  }
  if (localMatch.password !== rawPassword) {
    return { user: null, errorType: 'WRONG_PASSWORD' };
  }
  return { user: localMatch };
}


export async function fetchRegisteredUsersCountInSupabase(): Promise<number> {
  if (!supabase) {
    return lastBulkSyncSummary?.syncedInSupabaseCount ?? 0;
  }

  try {
    const { data: appUsersData, count: appUsersCount, error: appUsersErr } =
      await supabase
        .from('app_users')
        .select('id, username', { count: 'exact' });

    const uniqueUsernames = new Set<string>();
    if (!appUsersErr && Array.isArray(appUsersData)) {
      for (const row of appUsersData) {
        if (row.username) {
          uniqueUsernames.add(String(row.username).trim().toLowerCase());
        }
      }
    }

    const { data: locData, error: locErr } = await supabase
      .from('user_locations')
      .select('username, role');

    if (!locErr && Array.isArray(locData)) {
      for (const row of locData) {
        if (row.username) {
          uniqueUsernames.add(String(row.username).trim().toLowerCase());
        }
      }
    }

    const resolvedCount = Math.max(
      uniqueUsernames.size,
      typeof appUsersCount === 'number' ? appUsersCount : 0,
      lastBulkSyncSummary?.syncedInSupabaseCount ?? 0
    );

    if (
      lastBulkSyncSummary &&
      resolvedCount > lastBulkSyncSummary.syncedInSupabaseCount
    ) {
      lastBulkSyncSummary = {
        ...lastBulkSyncSummary,
        syncedInSupabaseCount: resolvedCount,
      };
    }

    return resolvedCount;
  } catch {
    return lastBulkSyncSummary?.syncedInSupabaseCount ?? 0;
  }
}
