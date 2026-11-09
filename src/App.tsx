import { useState, useEffect, useCallback } from 'react';
import {
  ClipboardList,
  BarChart3,
  Users,
  LogOut,
  Wifi,
  WifiOff,
  RefreshCw,
  CloudUpload,
  Package,
  Plus,
  CheckCircle2,
  Sun,
  Moon,
} from 'lucide-react';
import { LoginView } from './components/LoginView';
import { ActivationForm } from './components/ActivationForm';
import { AnalyticsDashboard } from './components/AnalyticsDashboard';
import { UserManagementPanel } from './components/UserManagementPanel';
import { ThermalInvoiceModal } from './components/ThermalInvoiceModal';
import { ProductMasterModal } from './components/ProductMasterModal';
import {
  addProductToMasterList,
  addUserAccount,
  deleteActivationRecord,
  deleteFromIndexedDBQueue,
  deleteProductFromMasterList,
  fetchActivationsForUser,
  fetchLiveProductMasterList,
  fetchLiveUsers,
  fetchRegisteredUsersCountInSupabase,
  getActiveSessionUser,
  getAllFromIndexedDBQueue,
  getPendingSyncQueue,
  getProductMasterList,
  getStoredActiveTab,
  getUsers,
  handleUpdateUser as syncUserAccountToSupabase,
  insertActivationRecord,
  removeRecordFromPendingQueue,
  resetAllUserPasswordsToDefault,
  saveActiveSessionUser,
  saveStoredActiveTab,
  subscribeToRealtimeSync,
  syncAllDataToSupabase,
  toggleProductActiveInMasterList,
  toggleUserActiveStatus,
  updateActivationRecord,
  updateProductInMasterList,
  updateUserPassword,
} from './services/dataService';
import {
  NoodleActivationRecord,
  SkuDefinition,
  UserAccount,
  UserRole,
} from './types';

type ActiveTab = 'form' | 'dashboard' | 'users';

const ROLE_DISPLAY_NAMES: Record<UserRole, string> = {
  [UserRole.ADMIN]: 'System Administrator',
  [UserRole.NSM]: 'National Sales Manager (NSM)',
  [UserRole.BRAND_MANAGER]: 'Brand Manager',
  [UserRole.MANAGER]: 'Branch Manager',
  [UserRole.SUPERVISOR]: 'Field Sales Supervisor',
  [UserRole.SELLER]: 'Field Activation Seller',
};

export default function App() {
  const [users, setUsers] = useState<UserAccount[]>(() => getUsers());
  const [skus, setSkus] = useState<SkuDefinition[]>(() =>
    getProductMasterList()
  );
  const [isProductMasterOpen, setIsProductMasterOpen] =
    useState<boolean>(false);

  const [currentUser, setCurrentUser] = useState<UserAccount | null>(() =>
    getActiveSessionUser()
  );
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    const saved = getActiveSessionUser();
    const storedTab = getStoredActiveTab();
    if (saved) {
      if (storedTab === 'users' && saved.role === UserRole.ADMIN) {
        return 'users';
      }
      if (storedTab === 'dashboard' || storedTab === 'form') {
        return storedTab;
      }
      return saved.role !== UserRole.SELLER ? 'dashboard' : 'form';
    }
    return 'form';
  });

  const [records, setRecords] = useState<NoodleActivationRecord[]>([]);
  const [editingRecord, setEditingRecord] =
    useState<NoodleActivationRecord | null>(null);

  const [appTheme, setAppTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('app_theme');
      if (saved === 'dark' || saved === 'light') return saved;
      if (
        typeof window !== 'undefined' &&
        window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches
      ) {
        return 'dark';
      }
    } catch {
      // Safe fallback
    }
    return 'light';
  });

  const isDarkTheme = appTheme === 'dark';

  useEffect(() => {
    try {
      localStorage.setItem('app_theme', appTheme);
      const root = document.documentElement;
      if (isDarkTheme) {
        root.classList.add('dark-theme');
        root.classList.remove('light-theme');
      } else {
        root.classList.add('light-theme');
        root.classList.remove('dark-theme');
      }
    } catch {
      // Safe fallback
    }
  }, [appTheme, isDarkTheme]);

  const toggleAppTheme = () => {
    setAppTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  const [invoiceModalRecord, setInvoiceModalRecord] =
    useState<NoodleActivationRecord | null>(null);

  const [isBrowserOnline, setIsBrowserOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [simulateOffline, setSimulateOffline] = useState<boolean>(false);
  const [pendingQueue, setPendingQueue] = useState<NoodleActivationRecord[]>(
    () => getPendingSyncQueue()
  );
  const [isSyncingQueue, setIsSyncingQueue] = useState<boolean>(false);
  const [syncSuccessMessage, setSyncSuccessMessage] = useState<string | null>(
    null
  );
  const [isSyncingAllData, setIsSyncingAllData] = useState<boolean>(false);
  const [manualSyncBanner, setManualSyncBanner] = useState<string | null>(null);
  const [registeredSupabaseUserCount, setRegisteredSupabaseUserCount] =
    useState<number>(() => getUsers().length);

  const effectiveOnline = isBrowserOnline && !simulateOffline;

  const refreshPendingQueue = useCallback(() => {
    void getAllFromIndexedDBQueue().then((idbItems) => {
      const localItems = getPendingSyncQueue();
      const merged = new Map<string, NoodleActivationRecord>();
      for (const item of localItems) {
        if (item && item.id) merged.set(item.id, item);
      }
      for (const item of idbItems) {
        if (item && item.id) merged.set(item.id, item);
      }
      setPendingQueue(Array.from(merged.values()));
    });
  }, []);

  const loadScopedRecords = useCallback(async (user: UserAccount) => {
    const data = await fetchActivationsForUser(user);
    setRecords(data);
  }, []);

  useEffect(() => {
    let mounted = true;
    fetchLiveUsers().then(async (liveUsers) => {
      if (!mounted) return;
      setUsers(liveUsers);
      const liveCount = await fetchRegisteredUsersCountInSupabase();
      if (mounted) {
        setRegisteredSupabaseUserCount(
          liveCount > 0 ? Math.max(liveCount, liveUsers.length) : liveUsers.length
        );
      }
      const savedSession = getActiveSessionUser();
      if (savedSession) {
        const refreshedUser = liveUsers.find(
          (u) =>
            u.id === savedSession.id ||
            u.username.toLowerCase() === savedSession.username.toLowerCase()
        );
        if (refreshedUser && refreshedUser.active) {
          setCurrentUser(refreshedUser);
          saveActiveSessionUser(refreshedUser);
        }
      }
    });
    fetchLiveProductMasterList().then((liveSkus) => {
      if (mounted) {
        setSkus(liveSkus);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const handleManualSyncAllToSupabase = useCallback(async () => {
    setIsSyncingAllData(true);
    setManualSyncBanner(null);
    try {
      const summary = await syncAllDataToSupabase(records);
      setUsers(summary.users);
      setRegisteredSupabaseUserCount(summary.registeredUsersInSupabase);
      refreshPendingQueue();
      if (currentUser) {
        await loadScopedRecords(currentUser);
      }
      setManualSyncBanner(summary.message);
      setTimeout(() => {
        setManualSyncBanner(null);
      }, 6000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setManualSyncBanner(`Sync failed: ${msg}`);
    } finally {
      setIsSyncingAllData(false);
    }
  }, [records, currentUser, loadScopedRecords, refreshPendingQueue]);

  const handleSyncPendingNow = useCallback(async () => {
    if (!isBrowserOnline) {
      return;
    }
    if (simulateOffline) {
      setSimulateOffline(false);
    }
    setIsSyncingQueue(true);
    setSyncSuccessMessage(null);
    try {
      const idbEntries = await getAllFromIndexedDBQueue();
      const storageEntries = getPendingSyncQueue();
      const entriesById = new Map<string, NoodleActivationRecord>();
      for (const item of pendingQueue) {
        if (item && item.id) entriesById.set(item.id, item);
      }
      for (const item of storageEntries) {
        if (item && item.id) entriesById.set(item.id, item);
      }
      for (const item of idbEntries) {
        if (item && item.id) entriesById.set(item.id, item);
      }
      const queueToSync = Array.from(entriesById.values());

      let syncedCount = 0;
      let failedCount = 0;

      for (let index = 0; index < queueToSync.length; index += 1) {
        const entry = queueToSync[index];
        try {
          const apiResponse = await insertActivationRecord(entry, false);
          const isHttp200Ok =
            Boolean(apiResponse) &&
            apiResponse.ok === true &&
            apiResponse.synced === true &&
            apiResponse.status === 200 &&
            apiResponse.id === entry.id;

          if (isHttp200Ok) {
            await deleteFromIndexedDBQueue(entry.id);
            await removeRecordFromPendingQueue(entry.id);
            setPendingQueue((prev) =>
              prev.filter((queuedItem) => queuedItem.id !== entry.id)
            );
            syncedCount += 1;
          } else {
            failedCount += 1;
          }
        } catch {
          failedCount += 1;
        }
      }

      refreshPendingQueue();
      if (currentUser) {
        await loadScopedRecords(currentUser);
      }
      if (failedCount === 0) {
        setSyncSuccessMessage(
          syncedCount > 0 ? `Synced (${syncedCount})` : 'Synced'
        );
      } else if (syncedCount > 0) {
        setSyncSuccessMessage(`Synced (${syncedCount}) · ${failedCount} Pending`);
      } else {
        setSyncSuccessMessage(`Pending (${failedCount})`);
      }
      setTimeout(() => {
        setSyncSuccessMessage(null);
      }, 3000);
    } finally {
      setIsSyncingQueue(false);
    }
  }, [
    isBrowserOnline,
    simulateOffline,
    pendingQueue,
    refreshPendingQueue,
    currentUser,
    loadScopedRecords,
  ]);

  useEffect(() => {
    const onOnline = () => setIsBrowserOnline(true);
    const onOffline = () => setIsBrowserOnline(false);
    const onQueueUpdate = () => refreshPendingQueue();

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('pahtama-sync-queue-updated', onQueueUpdate);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('pahtama-sync-queue-updated', onQueueUpdate);
    };
  }, [refreshPendingQueue]);

  useEffect(() => {
    if (effectiveOnline && pendingQueue.length > 0) {
      void handleSyncPendingNow();
    }
  }, [effectiveOnline, pendingQueue.length, handleSyncPendingNow]);

  useEffect(() => {
    if (activeTab === 'users' && currentUser?.role !== UserRole.ADMIN) {
      setActiveTab('dashboard');
      return;
    }
    saveStoredActiveTab(activeTab);
  }, [activeTab, currentUser]);

  useEffect(() => {
    if (currentUser) {
      void loadScopedRecords(currentUser);
    }
  }, [currentUser, activeTab, loadScopedRecords]);

  useEffect(() => {
    const unsubscribe = subscribeToRealtimeSync({
      onActivationsChanged: () => {
        if (currentUser) {
          void loadScopedRecords(currentUser);
        }
      },
      onUsersChanged: () => {
        void fetchLiveUsers().then((liveUsers) => {
          setUsers(liveUsers);
          if (currentUser) {
            const refreshed = liveUsers.find(
              (u) =>
                u.id === currentUser.id ||
                u.username.toLowerCase() === currentUser.username.toLowerCase()
            );
            if (refreshed && refreshed.active) {
              setCurrentUser(refreshed);
              saveActiveSessionUser(refreshed);
            }
          }
        });
      },
    });
    return () => {
      unsubscribe();
    };
  }, [currentUser, loadScopedRecords]);

  const handleLoginSuccess = async (user: UserAccount) => {
    saveActiveSessionUser(user);
    setCurrentUser(user);
    if (user.role === UserRole.SELLER) {
      setActiveTab('form');
    } else {
      setActiveTab('dashboard');
    }
    const [liveUsers] = await Promise.all([
      fetchLiveUsers(),
      loadScopedRecords(user),
    ]);
    setUsers(liveUsers);
    const liveCount = await fetchRegisteredUsersCountInSupabase();
    setRegisteredSupabaseUserCount(
      liveCount > 0 ? Math.max(liveCount, liveUsers.length) : liveUsers.length
    );
  };

  const handleLogout = () => {
    saveActiveSessionUser(null);
    setCurrentUser(null);
    setRecords([]);
    setEditingRecord(null);
    setInvoiceModalRecord(null);
  };

  const handleSubmitActivation = async (newRecord: NoodleActivationRecord) => {
    await insertActivationRecord(newRecord, !effectiveOnline);
    setEditingRecord(null);
    refreshPendingQueue();
    if (currentUser) {
      await loadScopedRecords(currentUser);
    }
  };

  const handleUpdateActivation = async (
    updatedRecord: NoodleActivationRecord
  ) => {
    await updateActivationRecord(updatedRecord, !effectiveOnline);
    setEditingRecord(null);
    refreshPendingQueue();
    if (currentUser) {
      await loadScopedRecords(currentUser);
    }
  };

  const handleStartEditRecord = (rec: NoodleActivationRecord) => {
    setEditingRecord(rec);
    setActiveTab('form');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteRecord = async (id: string) => {
    await deleteActivationRecord(id);
    if (editingRecord && editingRecord.id === id) {
      setEditingRecord(null);
    }
    if (currentUser) {
      await loadScopedRecords(currentUser);
    }
  };

  const handlePasswordChange = async (userId: string, newPass: string) => {
    const updated = await updateUserPassword(userId, newPass);
    setUsers(updated);
    if (currentUser && currentUser.id === userId) {
      const refreshed = updated.find((u) => u.id === userId) || null;
      setCurrentUser(refreshed);
      saveActiveSessionUser(refreshed);
    }
    const liveUsers = await fetchLiveUsers();
    setUsers(liveUsers);
  };

  const handleUpdateUser = async (
    updatedUser: UserAccount,
    previousUsername?: string
  ) => {
    const result = await syncUserAccountToSupabase(
      updatedUser,
      previousUsername
    );
    setUsers(result.users);
    if (
      currentUser &&
      (currentUser.id === updatedUser.id ||
        (previousUsername &&
          currentUser.username.toLowerCase() ===
            previousUsername.toLowerCase()))
    ) {
      setCurrentUser(updatedUser);
      saveActiveSessionUser(updatedUser);
    }
    const liveUsers = await fetchLiveUsers();
    setUsers(liveUsers);
    if (currentUser) {
      await loadScopedRecords(
        currentUser.id === updatedUser.id ? updatedUser : currentUser
      );
    }
  };

  const handleAddUserAccount = async (newUser: UserAccount) => {
    const updated = await addUserAccount(newUser);
    setUsers(updated);
    const liveUsers = await fetchLiveUsers();
    setUsers(liveUsers);
  };

  const handleToggleUserActive = async (userId: string) => {
    const updated = await toggleUserActiveStatus(userId);
    setUsers(updated);
    const liveUsers = await fetchLiveUsers();
    setUsers(liveUsers);
  };

  const handleResetAllPasswords = async () => {
    const updated = await resetAllUserPasswordsToDefault();
    setUsers(updated);
    const liveUsers = await fetchLiveUsers();
    setUsers(liveUsers);
  };

  const handleAddSku = (newSku: SkuDefinition) => {
    const updated = addProductToMasterList(newSku);
    setSkus(updated);
  };

  const handleUpdateSku = (updatedSku: SkuDefinition) => {
    const updated = updateProductInMasterList(updatedSku);
    setSkus(updated);
  };

  const handleToggleSkuActive = (skuId: string) => {
    const updated = toggleProductActiveInMasterList(skuId);
    setSkus(updated);
  };

  const handleDeleteSku = (skuId: string) => {
    const updated = deleteProductFromMasterList(skuId);
    setSkus(updated);
  };

  if (!currentUser) {
    return <LoginView users={users} onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div
      className={`min-h-screen w-full max-w-full overflow-x-hidden flex flex-col transition-colors duration-200 ${
        isDarkTheme
          ? 'dark-theme bg-[#0B192C] text-[#E2E8F0]'
          : 'light-theme bg-[#F0F4F8] text-[#0F2C59]'
      }`}
    >
      {/* Top Corporate Deep Navy Header */}
      <header className="no-print w-full bg-[#0F2C59] border-b border-[#1E3E62] sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl w-full mx-auto flex items-center justify-between gap-4 sm:gap-8 px-3 sm:px-6 py-3">
          {/* Zone 1: Brand Wordmark */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab(
                currentUser.role === UserRole.SELLER ? 'form' : 'dashboard'
              );
            }}
            className="text-base sm:text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 hover:text-blue-100 transition-colors"
          >
            Pahtama Group
          </a>

          {/* Zone 2: Navigation Links */}
          <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-blue-100/80">
            <button
              type="button"
              onClick={() => setActiveTab('form')}
              className={`hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer pb-0.5 ${
                activeTab === 'form'
                  ? 'text-white font-semibold border-b-2 border-amber-400'
                  : ''
              }`}
            >
              Activation Form
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('dashboard')}
              className={`hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer pb-0.5 ${
                activeTab === 'dashboard'
                  ? 'text-white font-semibold border-b-2 border-amber-400'
                  : ''
              }`}
            >
              {currentUser.role === UserRole.SELLER
                ? 'My Route Ledger'
                : currentUser.role === UserRole.NSM
                ? 'National Analytics'
                : currentUser.role === UserRole.BRAND_MANAGER
                ? 'Brand Analytics'
                : 'Analytics & Reports'}
            </button>
            {currentUser.role === UserRole.ADMIN && (
              <button
                type="button"
                onClick={() => setActiveTab('users')}
                className={`hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer pb-0.5 ${
                  activeTab === 'users'
                    ? 'text-white font-semibold border-b-2 border-amber-400'
                    : ''
                }`}
              >
                Users &amp; Stores
              </button>
            )}
          </nav>

          {/* Zone 3: Online/Offline Queue Toggle, Theme Switch & Sign Out */}
          <div className="flex items-center justify-end gap-2 shrink-0">
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-[#1E3E62] border border-blue-400/20 rounded-lg text-xs tabular-nums text-white">
              <button
                type="button"
                onClick={() => setSimulateOffline((prev) => !prev)}
                title="Toggle Online / Offline field synchronization mode"
                className={`inline-flex items-center gap-1 font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                  effectiveOnline ? 'text-emerald-300' : 'text-amber-300'
                }`}
              >
                {effectiveOnline ? (
                  <>
                    <Wifi className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="hidden sm:inline">Online</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="hidden sm:inline">Offline</span>
                  </>
                )}
              </button>

              <span aria-hidden="true" className="text-blue-300/40">
                |
              </span>

              <div className="flex items-center gap-1 text-blue-100 whitespace-nowrap shrink-0">
                <CloudUpload
                  className={`w-3.5 h-3.5 shrink-0 ${
                    pendingQueue.length > 0
                      ? 'text-amber-300'
                      : 'text-emerald-300'
                  }`}
                />
                <span className="font-mono font-semibold">
                  {pendingQueue.length}
                </span>
              </div>

              <button
                type="button"
                onClick={() => void handleSyncPendingNow()}
                disabled={isSyncingQueue || !isBrowserOnline}
                title="Flush offline queue now"
                className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  syncSuccessMessage
                    ? 'bg-emerald-500 text-white'
                    : pendingQueue.length > 0
                    ? 'bg-amber-400 hover:bg-amber-300 text-slate-950'
                    : 'bg-[#0F2C59] hover:bg-[#153466] text-blue-100'
                }`}
              >
                {syncSuccessMessage ? (
                  <>
                    <CheckCircle2 className="w-3 h-3 shrink-0" />
                    <span>{syncSuccessMessage}</span>
                  </>
                ) : (
                  <>
                    <RefreshCw
                      className={`w-3 h-3 shrink-0 ${
                        isSyncingQueue ? 'animate-spin' : ''
                      }`}
                    />
                    <span>
                      {isSyncingQueue
                        ? 'Syncing'
                        : pendingQueue.length > 0
                        ? `Push (${pendingQueue.length})`
                        : 'Sync'}
                    </span>
                  </>
                )}
              </button>
            </div>

            <button
              type="button"
              id="app-theme-toggle-btn"
              onClick={toggleAppTheme}
              title={`Switch to ${isDarkTheme ? 'Light' : 'Dark'} mode`}
              aria-label={`Switch to ${isDarkTheme ? 'Light' : 'Dark'} mode`}
              className="inline-flex items-center gap-1.5 px-2.5 py-2 text-xs font-semibold text-white bg-[#1E3E62] hover:bg-[#284f7c] border border-blue-400/20 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isDarkTheme ? (
                <Sun className="w-3.5 h-3.5 text-amber-300" />
              ) : (
                <Moon className="w-3.5 h-3.5 text-blue-200" />
              )}
            </button>

            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-[#1E3E62] hover:bg-[#284f7c] border border-blue-400/20 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Workspace Sub-Toolbar & Unboxed Role Context */}
      <div className="app-subtoolbar no-print w-full bg-white border-b border-slate-200 px-3 sm:px-6 py-3">
        <div className="max-w-7xl w-full mx-auto flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Unboxed Metadata with Clean Typographic Separators */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600 tabular-nums min-w-0">
            <span className="font-semibold text-[#0F2C59]">
              {currentUser.fullName}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{currentUser.username}</span>
            <span aria-hidden="true">·</span>
            <span>{ROLE_DISPLAY_NAMES[currentUser.role]}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">Route: {currentUser.routeCode}</span>
            <span aria-hidden="true">·</span>
            <span>Scope: {currentUser.regionScope}</span>
          </div>

          {/* Workspace Action & View Controls */}
          <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto justify-start lg:justify-end">
            {currentUser.role === UserRole.ADMIN && (
              <button
                type="button"
                onClick={() => void handleManualSyncAllToSupabase()}
                disabled={isSyncingAllData}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#0F2C59] hover:bg-[#1E3E62] disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 shrink-0 ${
                    isSyncingAllData ? 'animate-spin' : ''
                  }`}
                />
                <span>
                  {isSyncingAllData ? 'Syncing...' : 'Sync Data to Supabase'}
                </span>
              </button>
            )}

            {(currentUser.role === UserRole.ADMIN ||
              currentUser.role === UserRole.BRAND_MANAGER) && (
              <button
                type="button"
                onClick={() => setIsProductMasterOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#1E3E62] hover:bg-[#284f7c] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Package className="w-3.5 h-3.5 shrink-0" />
                <span>Product Master ({skus.length})</span>
                <Plus className="w-3 h-3 shrink-0" />
              </button>
            )}

            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg max-w-full">
              <button
                type="button"
                onClick={() => setActiveTab('form')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'form'
                    ? 'bg-white text-[#0F2C59] shadow-xs'
                    : 'text-slate-600 hover:text-[#0F2C59]'
                }`}
              >
                <ClipboardList className="w-3.5 h-3.5 shrink-0" />
                Activation Form
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('dashboard')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === 'dashboard'
                    ? 'bg-white text-[#0F2C59] shadow-xs'
                    : 'text-slate-600 hover:text-[#0F2C59]'
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5 shrink-0" />
                {currentUser.role === UserRole.SELLER
                  ? `My Ledger (${records.length})`
                  : `Analytics (${records.length})`}
              </button>

              {currentUser.role === UserRole.ADMIN && (
                <button
                  type="button"
                  onClick={() => setActiveTab('users')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    activeTab === 'users'
                      ? 'bg-white text-[#0F2C59] shadow-xs'
                      : 'text-slate-600 hover:text-[#0F2C59]'
                  }`}
                >
                  <Users className="w-3.5 h-3.5 shrink-0" />
                  Admin &amp; Stores
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Container */}
      <main className="no-print flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 py-4 sm:py-8 min-w-0 overflow-x-hidden">
        {manualSyncBanner && (
          <div className="mb-5 bg-emerald-50 border border-emerald-300 text-emerald-950 text-xs font-semibold px-4 py-3 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="break-words">{manualSyncBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setManualSyncBanner(null)}
              className="text-xs font-semibold text-emerald-800 hover:underline self-end sm:self-auto shrink-0 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {activeTab === 'form' && (
          <ActivationForm
            currentUser={currentUser}
            allUsers={users}
            skus={skus}
            editingRecord={editingRecord}
            onSubmitRecord={handleSubmitActivation}
            onUpdateRecord={handleUpdateActivation}
            onCancelEditRecord={() => setEditingRecord(null)}
            onOpenInvoicePreview={(rec) => setInvoiceModalRecord(rec)}
            onOpenProductMaster={() => setIsProductMasterOpen(true)}
          />
        )}

        {activeTab === 'dashboard' && (
          <AnalyticsDashboard
            currentUser={currentUser}
            records={records}
            skus={skus}
            isDarkTheme={isDarkTheme}
            onOpenInvoicePreview={(rec) => setInvoiceModalRecord(rec)}
            onEditRecord={handleStartEditRecord}
            onDeleteRecord={handleDeleteRecord}
            onNavigateToForm={() => setActiveTab('form')}
            onOpenProductMaster={() => setIsProductMasterOpen(true)}
          />
        )}

        {activeTab === 'users' && currentUser.role === UserRole.ADMIN && (
          <UserManagementPanel
            currentUser={currentUser}
            users={users}
            registeredSupabaseUserCount={registeredSupabaseUserCount}
            onManualSyncAllData={handleManualSyncAllToSupabase}
            onUpdatePassword={handlePasswordChange}
            onUpdateUserAccount={handleUpdateUser}
            onAddUserAccount={handleAddUserAccount}
            onToggleUserActive={handleToggleUserActive}
            onResetAllPasswords={handleResetAllPasswords}
            onUsersSynced={(syncedUsers) => {
              setUsers(syncedUsers);
              setRegisteredSupabaseUserCount((prev) =>
                Math.max(prev, syncedUsers.length)
              );
            }}
          />
        )}
      </main>

      <ThermalInvoiceModal
        record={invoiceModalRecord}
        skus={skus}
        onClose={() => setInvoiceModalRecord(null)}
      />

      <ProductMasterModal
        isOpen={isProductMasterOpen}
        onClose={() => setIsProductMasterOpen(false)}
        skus={skus}
        currentUser={currentUser}
        onAddSku={handleAddSku}
        onUpdateSku={handleUpdateSku}
        onToggleSkuActive={handleToggleSkuActive}
        onDeleteSku={handleDeleteSku}
      />

      <footer className="app-footer no-print w-full px-3 sm:px-6 py-4 bg-white border-t border-slate-200 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-center sm:text-left">
          <span>
            Pahtama Group Co., Ltd. · Shaloot Noodle Activation &amp; Sales
            System
          </span>
          <span className="font-mono tabular-nums">
            58mm / 80mm Thermal POS · Offline-First Sync
          </span>
        </div>
      </footer>
    </div>
  );
}
