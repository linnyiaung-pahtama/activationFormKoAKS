import React, { useState, useEffect, useMemo } from 'react';
import {
  KeyRound,
  Copy,
  Check,
  RotateCcw,
  Search,
  Database,
  ShieldCheck,
  Edit3,
  UserPlus,
  X,
  RefreshCw,
  Store,
  CheckCircle2,
  Trash2,
  ChevronUp,
  ChevronDown,
  ArrowDownAZ,
  ArrowUpZA,
  Plus,
} from 'lucide-react';
import {
  SUPABASE_TABLE_DDL,
  SUPABASE_LINTER_FIX_SQL,
  SUPABASE_WHOLESALE_STORES_SQL,
  SUPABASE_ITEMIZED_SKU_ROWS_SQL,
} from '../lib/supabase';
import {
  BulkUserSyncSummary,
  getLastBulkUserSyncSummary,
  syncAllDataToSupabase,
  syncAllUsersNow,
} from '../services/dataService';
import {
  WholesaleStoreItem,
  getStoredWholesaleStores,
  saveStoredWholesaleStores,
  resetWholesaleStoresToDefault,
  subscribeToWholesaleStores,
  parseWholesaleStoresFromExcel,
  deleteWholesaleStore,
  updateWholesaleStore,
  moveWholesaleStore,
  sortWholesaleStores,
  addWholesaleStore,
} from '../services/wholesaleStoreService';
import { UserAccount, UserRole } from '../types';

interface UserManagementPanelProps {
  currentUser: UserAccount;
  users: UserAccount[];
  registeredSupabaseUserCount?: number;
  onManualSyncAllData?: () => Promise<void> | void;
  onUpdatePassword: (userId: string, newPass: string) => Promise<void> | void;
  onUpdateUserAccount: (
    updatedUser: UserAccount,
    previousUsername?: string
  ) => Promise<void> | void;
  onAddUserAccount: (newUser: UserAccount) => Promise<void> | void;
  onToggleUserActive: (userId: string) => Promise<void> | void;
  onResetAllPasswords: () => Promise<void> | void;
  onUsersSynced?: (users: UserAccount[]) => void;
}

export const UserManagementPanel: React.FC<UserManagementPanelProps> = ({
  currentUser,
  users,
  registeredSupabaseUserCount,
  onManualSyncAllData,
  onUpdateUserAccount,
  onAddUserAccount,
  onToggleUserActive,
  onResetAllPasswords,
  onUsersSynced,
}) => {
  const [roleFilter, setRoleFilter] = useState<'ALL' | UserRole>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [isSyncingUser, setIsSyncingUser] = useState<boolean>(false);
  const [isBulkSyncing, setIsBulkSyncing] = useState<boolean>(false);
  const [confirmBulkReset, setConfirmBulkReset] = useState<boolean>(false);
  const [syncSummary, setSyncSummary] = useState<BulkUserSyncSummary | null>(
    () => getLastBulkUserSyncSummary()
  );

  const [editUsername, setEditUsername] = useState<string>('');
  const [editFullName, setEditFullName] = useState<string>('');
  const [editRole, setEditRole] = useState<UserRole>(UserRole.SELLER);
  const [editRouteCode, setEditRouteCode] = useState<string>('');
  const [editRegionScope, setEditRegionScope] = useState<string>('');
  const [editSupervisor, setEditSupervisor] = useState<string>('');
  const [editManager, setEditManager] = useState<string>('');
  const [editPassword, setEditPassword] = useState<string>('');

  const [showAddUserForm, setShowAddUserForm] = useState<boolean>(false);
  const [newUsername, setNewUsername] = useState<string>('');
  const [newFullName, setNewFullName] = useState<string>('');
  const [newRole, setNewRole] = useState<UserRole>(UserRole.SELLER);
  const [newRouteCode, setNewRouteCode] = useState<string>('RT-YGN-16');
  const [newRegionScope, setNewRegionScope] = useState<string>('Yangon East');
  const [newSupervisor, setNewSupervisor] = useState<string>('supervisor1');
  const [newManager, setNewManager] = useState<string>('manager1');
  const [newPassword, setNewPassword] = useState<string>('password123');

  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [copiedSql, setCopiedSql] = useState<boolean>(false);
  const [showSqlSchema, setShowSqlSchema] = useState<boolean>(false);
  const [sqlTab, setSqlTab] = useState<
    'full_ddl' | 'itemized_sku_rows' | 'wholesale_stores' | 'linter_fix'
  >('full_ddl');

  const [wholesaleStores, setWholesaleStores] = useState<WholesaleStoreItem[]>(
    () => getStoredWholesaleStores()
  );
  const [pastedWholesaleText, setPastedWholesaleText] = useState<string>('');
  const [wholesaleParseMessage, setWholesaleParseMessage] = useState<
    string | null
  >(null);
  const [showWholesaleManager, setShowWholesaleManager] =
    useState<boolean>(true);
  const [searchWholesale, setSearchWholesale] = useState<string>('');

  const [editingStoreName, setEditingStoreName] = useState<string | null>(null);
  const [editStoreInput, setEditStoreInput] = useState<string>('');
  const [confirmDeleteStore, setConfirmDeleteStore] = useState<string | null>(
    null
  );
  const [showAddSingleStore, setShowAddSingleStore] = useState<boolean>(false);
  const [newSingleStoreName, setNewSingleStoreName] = useState<string>('');

  const isAdmin = currentUser.role === UserRole.ADMIN;

  useEffect(() => {
    return subscribeToWholesaleStores((updated) => {
      setWholesaleStores(updated);
    });
  }, []);

  const handleProcessWholesaleInput = (rawText?: string) => {
    const textToParse = rawText !== undefined ? rawText : pastedWholesaleText;
    const parsed = parseWholesaleStoresFromExcel(textToParse);
    if (parsed.length === 0) {
      setWholesaleParseMessage(
        'No valid store names found. Paste store names (one per line) from Excel.'
      );
      return;
    }

    const updated = saveStoredWholesaleStores(parsed);
    setWholesaleStores(updated);
    setPastedWholesaleText('');
    setWholesaleParseMessage(
      `Successfully parsed and updated ${parsed.length} Wholesale Store${
        parsed.length === 1 ? '' : 's'
      }!`
    );
    setTimeout(() => setWholesaleParseMessage(null), 6000);
  };

  const handleWholesalePaste = (
    e: React.ClipboardEvent<HTMLTextAreaElement | HTMLInputElement>
  ) => {
    const pasted = e.clipboardData.getData('text');
    if (pasted) {
      e.preventDefault();
      setPastedWholesaleText(pasted);
      handleProcessWholesaleInput(pasted);
    }
  };

  const handleResetWholesaleDefaults = () => {
    const defaults = resetWholesaleStoresToDefault();
    setWholesaleStores(defaults);
    setPastedWholesaleText('');
    setWholesaleParseMessage(
      'Wholesale stores reset to default Pahtama Group presets (5 stores).'
    );
    setTimeout(() => setWholesaleParseMessage(null), 5000);
  };

  const handleStartEditStore = (storeName: string) => {
    setEditingStoreName(storeName);
    setEditStoreInput(storeName);
    setConfirmDeleteStore(null);
  };

  const handleSaveEditStore = () => {
    if (!editingStoreName) return;
    const trimmed = editStoreInput.trim();
    if (!trimmed) {
      setWholesaleParseMessage('Store name cannot be empty.');
      return;
    }
    const updated = updateWholesaleStore(editingStoreName, trimmed);
    setWholesaleStores(updated);
    setEditingStoreName(null);
    setEditStoreInput('');
    setWholesaleParseMessage(`Store renamed to "${trimmed}".`);
    setTimeout(() => setWholesaleParseMessage(null), 4000);
  };

  const handleCancelEditStore = () => {
    setEditingStoreName(null);
    setEditStoreInput('');
  };

  const handleDeleteStore = (storeName: string) => {
    const updated = deleteWholesaleStore(storeName);
    setWholesaleStores(updated);
    setConfirmDeleteStore(null);
    if (editingStoreName === storeName) {
      setEditingStoreName(null);
      setEditStoreInput('');
    }
    setWholesaleParseMessage(`Deleted wholesale store "${storeName}".`);
    setTimeout(() => setWholesaleParseMessage(null), 4000);
  };

  const handleMoveStore = (storeName: string, direction: 'up' | 'down') => {
    const updated = moveWholesaleStore(storeName, direction);
    setWholesaleStores(updated);
  };

  const handleSortStores = (direction: 'asc' | 'desc') => {
    const updated = sortWholesaleStores(direction);
    setWholesaleStores(updated);
    setWholesaleParseMessage(
      `Wholesale stores sorted ${direction === 'asc' ? 'A to Z' : 'Z to A'}.`
    );
    setTimeout(() => setWholesaleParseMessage(null), 4000);
  };

  const handleAddSingleStore = () => {
    const trimmed = newSingleStoreName.trim();
    if (!trimmed) return;
    const updated = addWholesaleStore(trimmed);
    setWholesaleStores(updated);
    setNewSingleStoreName('');
    setShowAddSingleStore(false);
    setWholesaleParseMessage(`Added wholesale store "${trimmed}".`);
    setTimeout(() => setWholesaleParseMessage(null), 4000);
  };

  const filteredWholesaleStores = useMemo(() => {
    if (!searchWholesale.trim()) return wholesaleStores;
    const q = searchWholesale.toLowerCase();
    return wholesaleStores.filter((s) => s.name.toLowerCase().includes(q));
  }, [wholesaleStores, searchWholesale]);

  useEffect(() => {
    let mounted = true;
    syncAllUsersNow().then((summary) => {
      if (!mounted) return;
      setSyncSummary(summary);
      if (summary.users && summary.users.length > 0) {
        onUsersSynced?.(summary.users);
      }
    });
    return () => {
      mounted = false;
    };
  }, [onUsersSynced]);

  const roleCounts = {
    all: users.length,
    admin: users.filter((u) => u.role === UserRole.ADMIN).length,
    nsm: users.filter((u) => u.role === UserRole.NSM).length,
    brandManager: users.filter((u) => u.role === UserRole.BRAND_MANAGER).length,
    manager: users.filter((u) => u.role === UserRole.MANAGER).length,
    supervisor: users.filter((u) => u.role === UserRole.SUPERVISOR).length,
    seller: users.filter((u) => u.role === UserRole.SELLER).length,
  };

  const handleBulkSyncUsers = async () => {
    setIsBulkSyncing(true);
    setStatusBanner(null);
    try {
      const fullSync = await syncAllDataToSupabase();
      const summary = await syncAllUsersNow();
      setSyncSummary(summary);
      if (summary.users && summary.users.length > 0) {
        onUsersSynced?.(summary.users);
      }
      if (onManualSyncAllData) {
        await onManualSyncAllData();
      }
      setStatusBanner(fullSync.message);
    } finally {
      setIsBulkSyncing(false);
    }
  };

  const visibleUsers = isAdmin
    ? users.filter((u) => {
        if (roleFilter !== 'ALL' && u.role !== roleFilter) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          return (
            u.username.toLowerCase().includes(q) ||
            u.fullName.toLowerCase().includes(q) ||
            u.routeCode.toLowerCase().includes(q) ||
            u.regionScope.toLowerCase().includes(q)
          );
        }
        return true;
      })
    : users.filter((u) => u.id === currentUser.id);

  const startEditingUser = (u: UserAccount) => {
    setEditingUserId(u.id);
    setEditUsername(u.username);
    setEditFullName(u.fullName);
    setEditRole(u.role);
    setEditRouteCode(u.routeCode);
    setEditRegionScope(u.regionScope);
    setEditSupervisor(u.supervisorUsername || '');
    setEditManager(u.managerUsername || '');
    setEditPassword(u.password);
    setStatusBanner(null);
  };

  const handleUpdateUser = async (originalUser: UserAccount) => {
    if (!editUsername.trim() || !editFullName.trim()) {
      setStatusBanner('Username and Full Name cannot be blank.');
      return;
    }
    if (editPassword.trim().length < 4) {
      setStatusBanner('Password must be at least 4 characters.');
      return;
    }

    const duplicate = users.find(
      (other) =>
        other.id !== originalUser.id &&
        other.username.toLowerCase() === editUsername.trim().toLowerCase()
    );
    if (duplicate) {
      setStatusBanner(
        `Username "${editUsername.trim()}" is already used by another account.`
      );
      return;
    }

    const updated: UserAccount = {
      ...originalUser,
      username: editUsername.trim(),
      fullName: editFullName.trim(),
      role: editRole,
      routeCode: editRouteCode.trim() || 'ALL-ROUTES',
      regionScope: editRegionScope.trim() || 'All Regions',
      supervisorUsername: editSupervisor.trim() || undefined,
      managerUsername: editManager.trim() || undefined,
      password: editPassword.trim(),
    };

    setIsSyncingUser(true);
    try {
      await onUpdateUserAccount(updated, originalUser.username);
      setEditingUserId(null);
      setStatusBanner(
        `Updated user "${updated.username}" (${updated.fullName}) · Role: ${updated.role} · Route: ${updated.routeCode}.`
      );
    } finally {
      setIsSyncingUser(false);
    }
  };

  const handleCreateNewUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newFullName.trim()) {
      setStatusBanner('Username and Full Name are required.');
      return;
    }
    const duplicate = users.find(
      (u) => u.username.toLowerCase() === newUsername.trim().toLowerCase()
    );
    if (duplicate) {
      setStatusBanner(`Username "${newUsername.trim()}" already exists.`);
      return;
    }

    const created: UserAccount = {
      id: `usr-${Date.now()}`,
      username: newUsername.trim(),
      password: newPassword.trim() || 'password123',
      fullName: newFullName.trim(),
      role: newRole,
      routeCode: newRouteCode.trim() || 'RT-NEW',
      regionScope: newRegionScope.trim() || 'Yangon',
      supervisorUsername: newSupervisor.trim() || undefined,
      managerUsername: newManager.trim() || undefined,
      active: true,
    };

    setIsSyncingUser(true);
    try {
      await onAddUserAccount(created);
      setNewUsername('');
      setNewFullName('');
      setShowAddUserForm(false);
      setStatusBanner(
        `Created new account "${created.username}" (${created.fullName}) with role ${created.role}.`
      );
    } finally {
      setIsSyncingUser(false);
    }
  };

  const handleCopySql = () => {
    let textToCopy = SUPABASE_TABLE_DDL;
    if (sqlTab === 'itemized_sku_rows') {
      textToCopy = SUPABASE_ITEMIZED_SKU_ROWS_SQL;
    } else if (sqlTab === 'linter_fix') {
      textToCopy = SUPABASE_LINTER_FIX_SQL;
    } else if (sqlTab === 'wholesale_stores') {
      textToCopy = SUPABASE_WHOLESALE_STORES_SQL;
    }
    navigator.clipboard.writeText(textToCopy);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2500);
  };

  return (
    <div className="w-full max-w-full space-y-5 sm:space-y-6 overflow-x-hidden min-w-0">
      {statusBanner && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-950 text-xs font-medium px-4 py-3 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <span className="break-words min-w-0">{statusBanner}</span>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            className="text-xs font-semibold text-emerald-800 hover:underline self-end sm:self-auto shrink-0 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Header & Admin Controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-5 overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h2 className="text-base sm:text-lg font-semibold text-[#0F2C59]">
              User, Route &amp; Wholesale Store Administration
            </h2>
            <p className="text-xs text-slate-500 break-words tabular-nums">
              {users.length} total accounts · Registered roster:{' '}
              {registeredSupabaseUserCount ??
                syncSummary?.syncedInSupabaseCount ??
                users.length}{' '}
              · Manage roles, routes, passwords, wholesale stores, and Supabase
              SQL schema.
            </p>
          </div>

          {isAdmin && (
            <div className="flex flex-wrap items-center gap-2 max-w-full">
              <button
                type="button"
                disabled={isBulkSyncing}
                onClick={() => void handleBulkSyncUsers()}
                className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 shrink-0 ${
                    isBulkSyncing ? 'animate-spin' : ''
                  }`}
                />
                <span>
                  {isBulkSyncing ? 'Syncing...' : 'Sync All to Supabase'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setShowAddUserForm((prev) => !prev)}
                className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-900 bg-amber-400 hover:bg-amber-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5 shrink-0" />
                {showAddUserForm ? 'Hide Add User' : 'Add New User'}
              </button>

              <button
                type="button"
                onClick={() => setShowWholesaleManager((prev) => !prev)}
                className={`min-h-[38px] inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  showWholesaleManager
                    ? 'text-white bg-[#0F2C59] hover:bg-[#1E3E62]'
                    : 'text-slate-800 bg-slate-100 hover:bg-slate-200'
                }`}
              >
                <Store className="w-3.5 h-3.5 shrink-0" />
                <span>Wholesale Catalog ({wholesaleStores.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setShowSqlSchema((prev) => !prev)}
                className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Database className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {showSqlSchema ? 'Hide SQL Viewer' : 'Supabase SQL Viewer'}
                </span>
              </button>

              {confirmBulkReset ? (
                <div className="inline-flex items-center gap-1.5 bg-rose-50 border border-rose-300 rounded-lg px-2.5 py-1.5">
                  <span className="text-xs font-semibold text-rose-900">
                    Reset all to password123?
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmBulkReset(false);
                      void onResetAllPasswords();
                      setEditingUserId(null);
                      setStatusBanner(
                        'All accounts have been reset to default password ("password123").'
                      );
                    }}
                    className="px-2.5 py-1 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded cursor-pointer"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmBulkReset(false)}
                    className="px-2 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmBulkReset(true)}
                  className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                  Bulk Password Reset
                </button>
              )}
            </div>
          )}
        </div>

        {/* Add New User Form */}
        {showAddUserForm && isAdmin && (
          <form
            onSubmit={handleCreateNewUser}
            className="p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
              <h3 className="text-sm font-semibold text-slate-900">
                Create New User Account
              </h3>
              <button
                type="button"
                onClick={() => setShowAddUserForm(false)}
                className="p-1 text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Username <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="e.g., seller16"
                  required
                  className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Full Name <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  value={newFullName}
                  onChange={(e) => setNewFullName(e.target.value)}
                  placeholder="e.g., Ko Aung Myo"
                  required
                  className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Role <span className="text-rose-600">*</span>
                </label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as UserRole)}
                  className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value={UserRole.SELLER}>Seller</option>
                  <option value={UserRole.SUPERVISOR}>Supervisor</option>
                  <option value={UserRole.MANAGER}>Manager</option>
                  <option value={UserRole.BRAND_MANAGER}>Brand Manager</option>
                  <option value={UserRole.NSM}>
                    National Sales Manager (NSM)
                  </option>
                  <option value={UserRole.ADMIN}>Admin</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Password <span className="text-rose-600">*</span>
                </label>
                <input
                  type="text"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Route Code
                </label>
                <input
                  type="text"
                  value={newRouteCode}
                  onChange={(e) => setNewRouteCode(e.target.value)}
                  placeholder="e.g., RT-YGN-16"
                  className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Region / Scope
                </label>
                <input
                  type="text"
                  value={newRegionScope}
                  onChange={(e) => setNewRegionScope(e.target.value)}
                  placeholder="e.g., Yangon East"
                  className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Supervisor Username
                </label>
                <input
                  type="text"
                  value={newSupervisor}
                  onChange={(e) => setNewSupervisor(e.target.value)}
                  placeholder="e.g., supervisor1"
                  className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Manager Username
                </label>
                <input
                  type="text"
                  value={newManager}
                  onChange={(e) => setNewManager(e.target.value)}
                  placeholder="e.g., manager1"
                  className="w-full px-3 py-1.5 text-xs font-mono bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#0F2C59] hover:bg-[#1E3E62] rounded-lg transition-colors cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Save New User Account
              </button>
            </div>
          </form>
        )}

        {/* Supabase SQL Schema Viewer */}
        {showSqlSchema && isAdmin && (
          <div className="p-4 bg-slate-950 text-slate-100 rounded-xl space-y-3 border border-slate-800">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2 border-b border-slate-800">
              <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-900 rounded-lg">
                <button
                  type="button"
                  onClick={() => setSqlTab('full_ddl')}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    sqlTab === 'full_ddl'
                      ? 'bg-amber-400 text-slate-950'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Full Database Setup &amp; Team Roster
                </button>
                <button
                  type="button"
                  onClick={() => setSqlTab('itemized_sku_rows')}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    sqlTab === 'itemized_sku_rows'
                      ? 'bg-amber-400 text-slate-950'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Itemized SKU Rows SQL
                </button>
                <button
                  type="button"
                  onClick={() => setSqlTab('wholesale_stores')}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    sqlTab === 'wholesale_stores'
                      ? 'bg-amber-400 text-slate-950'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Wholesale Stores Realtime SQL
                </button>
                <button
                  type="button"
                  onClick={() => setSqlTab('linter_fix')}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    sqlTab === 'linter_fix'
                      ? 'bg-amber-400 text-slate-950'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  RLS &amp; Index Optimization
                </button>
              </div>

              <button
                type="button"
                onClick={handleCopySql}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-md transition-colors cursor-pointer shrink-0 self-start sm:self-auto"
              >
                {copiedSql ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-white" />
                    Copied to Clipboard!
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copy SQL Script
                  </>
                )}
              </button>
            </div>

            <pre className="text-[11px] font-mono text-slate-300 overflow-x-auto leading-relaxed max-h-80 p-3 bg-slate-900 rounded-lg border border-slate-800">
              {sqlTab === 'itemized_sku_rows'
                ? SUPABASE_ITEMIZED_SKU_ROWS_SQL
                : sqlTab === 'wholesale_stores'
                ? SUPABASE_WHOLESALE_STORES_SQL
                : sqlTab === 'linter_fix'
                ? SUPABASE_LINTER_FIX_SQL
                : SUPABASE_TABLE_DDL}
            </pre>
          </div>
        )}

        {/* Wholesale Store Catalog Manager */}
        {showWholesaleManager && isAdmin && (
          <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#0F2C59] text-white flex items-center justify-center shrink-0">
                  <Store className="w-4 h-4 text-amber-300" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Wholesale Store Catalog Manager (`wholesale_stores`)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Add, rename, delete, reorder, or bulk-paste Excel columns
                    synchronized in real time
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-700 tabular-nums">
                  {wholesaleStores.length} Active Stores
                </span>
                <button
                  type="button"
                  onClick={handleResetWholesaleDefaults}
                  className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                >
                  Reset Presets
                </button>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-1">
                  <label
                    htmlFor="wholesale-store-name-input"
                    className="block text-xs font-semibold text-slate-800"
                  >
                    Bulk Excel Column Import
                  </label>
                  <span className="text-[11px] text-slate-500">
                    Paste wholesale store names (one per line) directly from
                    Excel
                  </span>
                </div>
                <textarea
                  id="wholesale-store-name-input"
                  rows={3}
                  value={pastedWholesaleText}
                  onChange={(e) => setPastedWholesaleText(e.target.value)}
                  onPaste={handleWholesalePaste}
                  placeholder={
                    'ဝမ်းနိုင်း - C00107520\nဝင်းမိသားစု - C00143283\nယမင်း - C00130678'
                  }
                  className="w-full px-3.5 py-2.5 text-xs font-mono bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500 leading-relaxed"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleProcessWholesaleInput()}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#0F2C59] hover:bg-[#1E3E62] rounded-lg transition-colors cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Parse &amp; Save Wholesale Catalog
                  </button>
                  {pastedWholesaleText && (
                    <button
                      type="button"
                      onClick={() => setPastedWholesaleText('')}
                      className="px-3 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {wholesaleParseMessage && (
                <div className="flex items-center justify-between p-3 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-900 border border-emerald-200">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                    <span>{wholesaleParseMessage}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setWholesaleParseMessage(null)}
                    className="text-emerald-800 hover:underline text-xs ml-2 cursor-pointer"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {/* Active Wholesale Stores List */}
              <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-800">
                    Wholesale Stores ({filteredWholesaleStores.length})
                  </span>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleSortStores('asc')}
                      disabled={wholesaleStores.length < 2}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer disabled:opacity-40"
                    >
                      <ArrowDownAZ className="w-3.5 h-3.5 text-amber-600" />
                      Sort A-Z
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSortStores('desc')}
                      disabled={wholesaleStores.length < 2}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer disabled:opacity-40"
                    >
                      <ArrowUpZA className="w-3.5 h-3.5 text-amber-600" />
                      Sort Z-A
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowAddSingleStore((prev) => !prev)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-slate-900 bg-amber-400 hover:bg-amber-500 rounded-md transition-colors cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Store
                    </button>

                    <div className="relative">
                      <input
                        type="text"
                        value={searchWholesale}
                        onChange={(e) => setSearchWholesale(e.target.value)}
                        placeholder="Filter stores..."
                        className="px-2.5 py-1 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-800 focus:outline-none focus:ring-1 focus:ring-amber-500 w-36 sm:w-44"
                      />
                    </div>
                  </div>
                </div>

                {showAddSingleStore && (
                  <div className="flex flex-wrap items-center gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                    <input
                      type="text"
                      autoFocus
                      value={newSingleStoreName}
                      onChange={(e) => setNewSingleStoreName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddSingleStore();
                        if (e.key === 'Escape') setShowAddSingleStore(false);
                      }}
                      placeholder="Enter wholesale store name..."
                      className="flex-1 min-w-[200px] px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                    <button
                      type="button"
                      onClick={handleAddSingleStore}
                      disabled={!newSingleStoreName.trim()}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-[#0F2C59] hover:bg-[#1E3E62] disabled:opacity-50 rounded-md transition-colors cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Save Store
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddSingleStore(false);
                        setNewSingleStoreName('');
                      }}
                      className="px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-md cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 max-h-56 overflow-y-auto p-1">
                  {filteredWholesaleStores.map((s, idx) => {
                    const isEditing = editingStoreName === s.name;
                    const isConfirmingDelete = confirmDeleteStore === s.name;
                    const isFirst = idx === 0;
                    const isLast = idx === filteredWholesaleStores.length - 1;
                    const isFilterActive = searchWholesale.trim().length > 0;

                    return (
                      <div
                        key={`${s.name}-${idx}`}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border ${
                          isEditing
                            ? 'bg-amber-50 border-amber-400 text-slate-900'
                            : isConfirmingDelete
                            ? 'bg-rose-50 border-rose-300 text-rose-900'
                            : 'bg-slate-50 border-slate-200 text-slate-800'
                        }`}
                      >
                        <span className="text-[10px] font-mono text-slate-500">
                          {idx + 1}.
                        </span>

                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              autoFocus
                              value={editStoreInput}
                              onChange={(e) =>
                                setEditStoreInput(e.target.value)
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveEditStore();
                                if (e.key === 'Escape')
                                  handleCancelEditStore();
                              }}
                              className="px-2 py-0.5 text-xs font-medium bg-white border border-amber-500 rounded text-slate-900 w-44"
                            />
                            <button
                              type="button"
                              onClick={handleSaveEditStore}
                              className="p-1 text-emerald-600 hover:bg-emerald-50 rounded cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={handleCancelEditStore}
                              className="p-1 text-slate-500 hover:bg-slate-100 rounded cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : isConfirmingDelete ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold text-rose-700">
                              Delete?
                            </span>
                            <button
                              type="button"
                              onClick={() => handleDeleteStore(s.name)}
                              className="px-2 py-0.5 text-[10px] font-bold text-white bg-rose-600 hover:bg-rose-700 rounded cursor-pointer"
                            >
                              Yes
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteStore(null)}
                              className="px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 bg-white border border-slate-200 rounded cursor-pointer"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <>
                            <span
                              className="truncate max-w-[200px] sm:max-w-[280px]"
                              title={s.name}
                            >
                              {s.name}
                            </span>
                            <div className="flex items-center gap-0.5 ml-1 pl-1 border-l border-slate-200">
                              <button
                                type="button"
                                onClick={() => handleMoveStore(s.name, 'up')}
                                disabled={isFirst || isFilterActive}
                                title="Move store up"
                                className="p-0.5 text-slate-400 hover:text-slate-700 rounded disabled:opacity-25 cursor-pointer"
                              >
                                <ChevronUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleMoveStore(s.name, 'down')}
                                disabled={isLast || isFilterActive}
                                title="Move store down"
                                className="p-0.5 text-slate-400 hover:text-slate-700 rounded disabled:opacity-25 cursor-pointer"
                              >
                                <ChevronDown className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleStartEditStore(s.name)}
                                title="Edit store name"
                                className="p-0.5 text-slate-400 hover:text-amber-600 rounded cursor-pointer"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteStore(s.name)}
                                title="Delete store"
                                className="p-0.5 text-slate-400 hover:text-rose-600 rounded cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Role Filter Tabs */}
        {isAdmin && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-200">
            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  { id: 'ALL', label: `All (${roleCounts.all})` },
                  { id: UserRole.ADMIN, label: `Admin (${roleCounts.admin})` },
                  { id: UserRole.NSM, label: `NSM (${roleCounts.nsm})` },
                  {
                    id: UserRole.BRAND_MANAGER,
                    label: `Brand Mgr (${roleCounts.brandManager})`,
                  },
                  {
                    id: UserRole.MANAGER,
                    label: `Managers (${roleCounts.manager})`,
                  },
                  {
                    id: UserRole.SUPERVISOR,
                    label: `Supervisors (${roleCounts.supervisor})`,
                  },
                  {
                    id: UserRole.SELLER,
                    label: `Sellers (${roleCounts.seller})`,
                  },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setRoleFilter(tab.id)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    roleFilter === tab.id
                      ? 'bg-white text-[#0F2C59] shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search username, route, name..."
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>
        )}
      </div>

      {/* Users Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                <th className="py-3 px-4">Username</th>
                <th className="py-3 px-4">Full Name</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Route / Scope</th>
                <th className="py-3 px-4">Reporting Line</th>
                <th className="py-3 px-4">Password</th>
                <th className="py-3 px-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {visibleUsers.map((u) => {
                const isEditing = editingUserId === u.id;
                return (
                  <tr
                    key={u.id}
                    className={
                      isEditing
                        ? 'bg-amber-50/40'
                        : 'hover:bg-slate-50/80 transition-colors'
                    }
                  >
                    <td className="py-3 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap align-top">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editUsername}
                          onChange={(e) => setEditUsername(e.target.value)}
                          className="w-28 px-2.5 py-1.5 text-xs font-mono bg-white border border-amber-400 rounded-md text-slate-900"
                        />
                      ) : (
                        u.username
                      )}
                    </td>

                    <td className="py-3 px-4 font-medium text-slate-900 align-top">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editFullName}
                          onChange={(e) => setEditFullName(e.target.value)}
                          className="w-48 px-2.5 py-1.5 text-xs bg-white border border-amber-400 rounded-md text-slate-900"
                        />
                      ) : (
                        u.fullName
                      )}
                    </td>

                    <td className="py-3 px-4 text-slate-700 whitespace-nowrap align-top">
                      {isEditing ? (
                        <select
                          value={editRole}
                          onChange={(e) =>
                            setEditRole(e.target.value as UserRole)
                          }
                          className="px-2.5 py-1.5 text-xs bg-white border border-amber-400 rounded-md text-slate-900"
                        >
                          <option value={UserRole.ADMIN}>Admin</option>
                          <option value={UserRole.NSM}>
                            National Sales Manager (NSM)
                          </option>
                          <option value={UserRole.BRAND_MANAGER}>
                            Brand Manager
                          </option>
                          <option value={UserRole.MANAGER}>Manager</option>
                          <option value={UserRole.SUPERVISOR}>
                            Supervisor
                          </option>
                          <option value={UserRole.SELLER}>Seller</option>
                        </select>
                      ) : (
                        <span className="inline-flex items-center gap-1 capitalize font-medium">
                          <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
                          {u.role.replace('_', ' ')}
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 font-mono tabular-nums text-slate-700 whitespace-nowrap align-top">
                      {isEditing ? (
                        <div className="flex flex-col gap-1.5 min-w-[170px]">
                          <input
                            type="text"
                            value={editRouteCode}
                            onChange={(e) => setEditRouteCode(e.target.value)}
                            placeholder="Route Code"
                            className="w-full px-2.5 py-1 text-xs font-mono bg-white border border-amber-400 rounded-md text-slate-900"
                          />
                          <input
                            type="text"
                            value={editRegionScope}
                            onChange={(e) => setEditRegionScope(e.target.value)}
                            placeholder="Region Scope"
                            className="w-full px-2.5 py-1 text-xs font-sans bg-white border border-amber-400 rounded-md text-slate-900"
                          />
                        </div>
                      ) : (
                        `${u.routeCode} · ${u.regionScope}`
                      )}
                    </td>

                    <td className="py-3 px-4 text-slate-500 whitespace-nowrap align-top">
                      {isEditing ? (
                        <div className="flex flex-col gap-1.5 min-w-[155px]">
                          <input
                            type="text"
                            value={editSupervisor}
                            onChange={(e) => setEditSupervisor(e.target.value)}
                            placeholder="Supervisor"
                            className="w-full px-2.5 py-1 text-xs font-mono bg-white border border-amber-400 rounded-md text-slate-900"
                          />
                          <input
                            type="text"
                            value={editManager}
                            onChange={(e) => setEditManager(e.target.value)}
                            placeholder="Manager"
                            className="w-full px-2.5 py-1 text-xs font-mono bg-white border border-amber-400 rounded-md text-slate-900"
                          />
                        </div>
                      ) : u.supervisorUsername ? (
                        `Sup: ${u.supervisorUsername} / Mgr: ${u.managerUsername}`
                      ) : u.managerUsername ? (
                        `Mgr: ${u.managerUsername}`
                      ) : (
                        'National / Executive'
                      )}
                    </td>

                    <td className="py-3 px-4 font-mono tabular-nums text-slate-700 whitespace-nowrap align-top">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editPassword}
                          onChange={(e) => setEditPassword(e.target.value)}
                          className="w-32 px-2.5 py-1.5 text-xs font-mono bg-white border border-amber-400 rounded-md text-slate-900"
                        />
                      ) : (
                        u.password
                      )}
                    </td>

                    <td className="py-3 px-5 text-right whitespace-nowrap align-top">
                      {isEditing ? (
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          <button
                            type="button"
                            disabled={isSyncingUser}
                            onClick={() => void handleUpdateUser(u)}
                            className="px-3 py-1.5 text-xs font-semibold text-white bg-[#0F2C59] hover:bg-[#1E3E62] disabled:opacity-50 rounded-md transition-colors cursor-pointer"
                          >
                            {isSyncingUser ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            type="button"
                            disabled={isSyncingUser}
                            onClick={() => setEditingUserId(null)}
                            className="px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-300 rounded-md cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-2 justify-end">
                          <button
                            type="button"
                            onClick={() => startEditingUser(u)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            {isAdmin ? (
                              <>
                                <Edit3 className="w-3.5 h-3.5" />
                                Edit
                              </>
                            ) : (
                              <>
                                <KeyRound className="w-3.5 h-3.5" />
                                Password
                              </>
                            )}
                          </button>

                          {isAdmin && u.username !== 'admin' && (
                            <button
                              type="button"
                              onClick={() => void onToggleUserActive(u.id)}
                              className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                                u.active
                                  ? 'text-emerald-800 bg-emerald-50 hover:bg-emerald-100'
                                  : 'text-rose-800 bg-rose-50 hover:bg-rose-100'
                              }`}
                            >
                              {u.active ? 'Active' : 'Inactive'}
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
