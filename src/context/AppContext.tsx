import React, { createContext, useContext, useEffect, useState, useMemo, useRef } from 'react';
import { db, DatabaseState } from '../db/storage';
import { AuthService } from '../services/authService';
import { SyncService, SyncState } from '../services/syncService';
import { CloudflareApi } from '../services/cloudflareApi';
import { User, Sale, ToastMessage, Shop } from '../types';
import { getColorOption } from '../utils/colors';
import { generateUUID } from '../utils/crypto';
import { getShopAdminShopIds, hasAdminAccess, isPlatformAdmin, isShopAdmin } from '../utils/permissions';

export type StoresSubTab = 'stores' | 'inventory' | 'transfer' | 'list' | 'transfer_view';
export type InventoryLocationFilter = 'ALL' | 'SHOP' | 'STORE';
export type PurchasesSubTab = 'list' | 'add' | 'returns' | 'suppliers';
export type ExpensesSubTab = 'list' | 'add';
export type ProductsSubTab = 'product_list' | 'add_product' | 'category_list' | 'add_category';
export type ShopsSubTab = 'list' | 'add';
export type SellersSubTab = 'list' | 'add';

interface AppContextType {
  currentUser: User | null;
  dbState: DatabaseState;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  storesSubTab: StoresSubTab;
  setStoresSubTab: (tab: StoresSubTab) => void;
  storesNavTick: number;
  openStoresSubTab: (tab: 'stores' | 'inventory' | 'transfer' | 'list') => void;
  inventoryFilter: InventoryLocationFilter;
  setInventoryFilter: (filter: InventoryLocationFilter) => void;
  inventoryNavTick: number;
  openInventoryFilter: (filter: InventoryLocationFilter) => void;
  purchasesSubTab: PurchasesSubTab;
  setPurchasesSubTab: (tab: PurchasesSubTab) => void;
  purchasesNavTick: number;
  openPurchasesSubTab: (tab: PurchasesSubTab) => void;
  expensesSubTab: ExpensesSubTab;
  setExpensesSubTab: (tab: ExpensesSubTab) => void;
  expensesNavTick: number;
  openExpensesSubTab: (tab: ExpensesSubTab) => void;
  productsSubTab: ProductsSubTab;
  setProductsSubTab: (tab: ProductsSubTab) => void;
  productsNavTick: number;
  openProductsSubTab: (tab: ProductsSubTab) => void;
  shopsSubTab: ShopsSubTab;
  setShopsSubTab: (tab: ShopsSubTab) => void;
  shopsNavTick: number;
  openShopsSubTab: (tab: ShopsSubTab) => void;
  sellersSubTab: SellersSubTab;
  setSellersSubTab: (tab: SellersSubTab) => void;
  sellersNavTick: number;
  openSellersSubTab: (tab: SellersSubTab) => void;
  login: (user: User) => void;
  logout: () => void;
  refreshUser: () => void;
  // Shop context
  selectedShopId: string;
  setSelectedShopId: (shopId: string) => void;
  currentShop: Shop | null;
  availableShops: Shop[];
  // Toast notifications
  toasts: ToastMessage[];
  addToast: (toast: Omit<ToastMessage, 'id'>) => void;
  removeToast: (id: string) => void;
  // Receipt modal
  activeReceipt: Sale | null;
  showReceipt: (sale: Sale) => void;
  closeReceipt: () => void;
  // Sync status
  syncStatus: { state: SyncState; pendingCount: number };
  triggerSync: () => Promise<void>;
  refreshStoresFromCloud: (showFeedback?: boolean) => Promise<{ success: boolean; count: number; error?: string }>;
  // Settings
  updateSettings: (settings: any) => void;
  refreshSettingsFromCloud: () => Promise<void>;
  // Seller color theme
  sellerColor: ReturnType<typeof getColorOption>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    // Check active session first
    const active = AuthService.getActiveUser();
    if (active) return active;

    // Check remembered user
    const remembered = AuthService.getRememberedUser();
    if (remembered) return remembered;

    return null;
  });
  const [dbState, setDbState] = useState<DatabaseState>(() => db.getState());
  const [activeTab, setActiveTab] = useState<string>(() => {
    const initialUser = AuthService.getActiveUser() || AuthService.getRememberedUser();
    if (initialUser && !hasAdminAccess(initialUser)) {
      return 'new_sale';
    }
    return 'dashboard';
  });

  // Restrict regular sellers strictly to NewSalePOS and Settings
  useEffect(() => {
    if (currentUser && !hasAdminAccess(currentUser)) {
      if (activeTab !== 'new_sale' && activeTab !== 'settings') {
        setActiveTab('new_sale');
      }
    }
  }, [currentUser, activeTab]);
  const [storesSubTab, setStoresSubTab] = useState<StoresSubTab>('stores');
  const [storesNavTick, setStoresNavTick] = useState<number>(0);

  const openStoresSubTab = (tab: 'stores' | 'inventory' | 'transfer' | 'list') => {
    setActiveTab('stores');
    setStoresSubTab(tab);
    setStoresNavTick(t => t + 1);
  };

  const [inventoryFilter, setInventoryFilter] = useState<InventoryLocationFilter>('ALL');
  const [inventoryNavTick, setInventoryNavTick] = useState<number>(0);

  const openInventoryFilter = (filter: InventoryLocationFilter) => {
    setActiveTab('inventory');
    setInventoryFilter(filter);
    setInventoryNavTick(t => t + 1);
  };

  const [purchasesSubTab, setPurchasesSubTab] = useState<PurchasesSubTab>('list');
  const [purchasesNavTick, setPurchasesNavTick] = useState<number>(0);

  const openPurchasesSubTab = (tab: PurchasesSubTab) => {
    setActiveTab('purchases');
    setPurchasesSubTab(tab);
    setPurchasesNavTick(t => t + 1);
  };

  const [expensesSubTab, setExpensesSubTab] = useState<ExpensesSubTab>('list');
  const [expensesNavTick, setExpensesNavTick] = useState<number>(0);

  const openExpensesSubTab = (tab: ExpensesSubTab) => {
    setActiveTab('expenses');
    setExpensesSubTab(tab);
    setExpensesNavTick(t => t + 1);
  };

  const [productsSubTab, setProductsSubTab] = useState<ProductsSubTab>('product_list');
  const [productsNavTick, setProductsNavTick] = useState<number>(0);

  const openProductsSubTab = (tab: ProductsSubTab) => {
    setActiveTab('products');
    setProductsSubTab(tab);
    setProductsNavTick(t => t + 1);
  };

  const [shopsSubTab, setShopsSubTab] = useState<ShopsSubTab>('list');
  const [shopsNavTick, setShopsNavTick] = useState<number>(0);

  const openShopsSubTab = (tab: ShopsSubTab) => {
    setActiveTab('shops');
    setShopsSubTab(tab);
    setShopsNavTick(t => t + 1);
  };

  const [sellersSubTab, setSellersSubTab] = useState<SellersSubTab>('list');
  const [sellersNavTick, setSellersNavTick] = useState<number>(0);

  const openSellersSubTab = (tab: SellersSubTab) => {
    setActiveTab('sellers');
    setSellersSubTab(tab);
    setSellersNavTick(t => t + 1);
  };
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [activeReceipt, setActiveReceipt] = useState<Sale | null>(null);
  const [syncStatus, setSyncStatus] = useState(SyncService.getSyncStatus());
  const [selectedShopId, setSelectedShopIdState] = useState<string>(() => {
    const saved = localStorage.getItem('diocres_selected_shop_id');
    return saved || 'ALL';
  });

  const isSyncingRef = useRef<boolean>(false);
  const isPushingRef = useRef<boolean>(false);
  const lastPullTimeRef = useRef<number>(
    (() => {
      const saved = localStorage.getItem('omnibiz_last_synced_at');
      const parsed = saved ? Date.parse(saved) : NaN;
      return Number.isFinite(parsed) ? parsed : 0;
    })()
  );
  const PULL_INTERVAL = 900000; // 15 minutes between pulls (D1 cost optimization)

  const setSelectedShopId = (shopId: string) => {
    setSelectedShopIdState(shopId);
    localStorage.setItem('diocres_selected_shop_id', shopId);
  };

  // Available shops based on current user
  const availableShops = useMemo(() => {
    const allShops = dbState.shops || [];
    if (!currentUser) return allShops;

    if (isPlatformAdmin(currentUser)) {
      return allShops;
    }

    const assigned = currentUser.assignedShopIds || [];
    if (isShopAdmin(currentUser)) {
      const managedIds = getShopAdminShopIds(currentUser);
      return allShops.filter(s => managedIds.includes(s.id) || (s.status === 'ACTIVE' && assigned.includes(s.id)));
    }

    return allShops.filter(s => s.status === 'ACTIVE' && assigned.includes(s.id));
  }, [dbState.shops, currentUser]);

  // Current Shop entity
  const currentShop = useMemo(() => {
    if (selectedShopId === 'ALL') return null;
    return (dbState.shops || []).find(s => s.id === selectedShopId) || null;
  }, [dbState.shops, selectedShopId]);

  /**
   * PUSH PENDING ITEMS TO CLOUD
   * Called immediately after any local data change (via db.subscribe)
   */
  const pushPendingItems = async () => {
    if (isPushingRef.current || isSyncingRef.current) return;

    const pendingCount = SyncService.getPendingCount();
    if (pendingCount === 0) return;

    isPushingRef.current = true;
    isSyncingRef.current = true;

    try {
      const online = await CloudflareApi.checkConnection();

      if (online) {
        console.log(`[Sync] Pushing ${pendingCount} items to cloud...`);

        const pushResult = await SyncService.pushPendingOnly();

        const state = db.getState();
        setDbState({ ...state });
        setSyncStatus(SyncService.getSyncStatus());

        if (pushResult.success) {
          console.log(`[Sync] Successfully pushed ${pushResult.processedCount} items`);
        } else {
          console.warn('[Sync] Push finished with errors:', pushResult.errors);
        }
      } else {
        console.log('[Sync] Offline - will retry later');
      }
    } catch (error) {
      console.log('[Sync] Push error:', error);
    } finally {
      isPushingRef.current = false;
      isSyncingRef.current = false;
    }
  };

  /**
   * PULL LATEST CLOUD DATA
   * Pulls every 15 minutes or on first load
   */
  const pullCloudData = async (force: boolean = false) => {
    if (isSyncingRef.current) return;

    const now = Date.now();
    const timeSinceLastPull = now - lastPullTimeRef.current;

    if (!force && timeSinceLastPull < PULL_INTERVAL) return;

    isSyncingRef.current = true;

    try {
      const online = await CloudflareApi.checkConnection();
      if (!online) {
        isSyncingRef.current = false;
        return;
      }

      console.log('[Sync] Pulling cloud data...');

      // Pass no since parameter to get ALL data on first load
      const pullResult = await CloudflareApi.pullSync();

      if (pullResult.success && pullResult.data) {
        SyncService.applyCloudData(pullResult.data);

        localStorage.setItem('omnibiz_last_synced_at', new Date().toISOString());
        localStorage.setItem('omnibiz_has_synced', 'true');

        const state = db.getState();
        setDbState({ ...state });
        setSyncStatus(SyncService.getSyncStatus());

        console.log('[Sync] Pull completed');
      }

      lastPullTimeRef.current = Date.now();
    } catch (error) {
      console.log('[Sync] Pull error:', error);
    } finally {
      isSyncingRef.current = false;
    }
  };

  /**
   * REFRESH STORES (AND SHOPS) FROM CLOUD
   * Pushes pending store/shop mutations first so just-created local stores aren't lost,
   * then fetches GET /api/stores + GET /api/shops (with pullSync fallback).
   */
  const refreshStoresFromCloud = async (
    showFeedback: boolean = false
  ): Promise<{ success: boolean; count: number; error?: string }> => {
    try {
      const online = await CloudflareApi.checkConnection();
      if (!online) {
        return {
          success: false,
          count: db.getStores().length,
          error: 'Offline: showing locally saved stores.',
        };
      }

      if (SyncService.getPendingCount() > 0 && !isSyncingRef.current && !isPushingRef.current) {
        await pushPendingItems();
      }

      const [cloudShops, cloudStores] = await Promise.all([
        CloudflareApi.getShops().catch(() => null),
        CloudflareApi.getStores().catch(() => null),
      ]);

      if (Array.isArray(cloudShops) && cloudShops.length > 0) {
        SyncService.applyCloudShops(cloudShops, { reconcileDeleted: true });
      }

      if (Array.isArray(cloudStores)) {
        const merged = SyncService.applyCloudStores(cloudStores, { reconcileDeleted: true });
        const state = db.getState();
        setDbState({ ...state });
        setSyncStatus(SyncService.getSyncStatus());

        if (showFeedback) {
          addToast({
            type: 'success',
            title: 'Stores Refreshed',
            description: `Loaded ${merged.length} store${merged.length === 1 ? '' : 's'} from database.`,
          });
        }
        return { success: true, count: merged.length };
      }

      // Fallback to /api/sync/pull if /api/stores is unavailable
      const pullResult = await CloudflareApi.pullSync();
      if (pullResult?.success && pullResult?.data) {
        if (Array.isArray(pullResult.data.shops) && pullResult.data.shops.length > 0) {
          SyncService.applyCloudShops(pullResult.data.shops);
        }
        const merged = Array.isArray(pullResult.data.stores)
          ? SyncService.applyCloudStores(pullResult.data.stores, { reconcileDeleted: true })
          : db.getStores();
        const state = db.getState();
        setDbState({ ...state });
        setSyncStatus(SyncService.getSyncStatus());
        if (showFeedback) {
          addToast({
            type: 'success',
            title: 'Stores Refreshed',
            description: `Loaded ${merged.length} store${merged.length === 1 ? '' : 's'} from database.`,
          });
        }
        return { success: true, count: merged.length };
      }

      return {
        success: false,
        count: db.getStores().length,
        error: 'Could not retrieve stores from server.',
      };
    } catch (error: any) {
      return {
        success: false,
        count: db.getStores().length,
        error: error?.message || 'Failed to refresh stores.',
      };
    }
  };

  /**
   * LIGHTWEIGHT SETTINGS REFRESH (1 single D1 row read)
   * Ensures sellers under a shop immediately pick up Shop Admin toggles (e.g. Taarifa za Mteja)
   * without waiting for the 15-minute full pull interval.
   */
  const refreshSettingsFromCloud = async () => {
    try {
      if (!CloudflareApi.isOnline()) return;
      const res = await CloudflareApi.getSettings();
      const cloudSettings = res?.settings || res;
      if (!cloudSettings || typeof cloudSettings !== 'object') return;

      const localSettings = db.getSettings();
      const merged: any = { ...localSettings };
      let changed = false;

      if (cloudSettings.enable_sales_assistant !== undefined) {
        const nextVal = !!cloudSettings.enable_sales_assistant;
        if (Boolean(localSettings.enableSalesAssistant) !== nextVal) {
          merged.enableSalesAssistant = nextVal;
          changed = true;
        }
      }
      if (cloudSettings.enable_customer_details !== undefined) {
        const nextVal = !!cloudSettings.enable_customer_details;
        if (Boolean(localSettings.enableCustomerDetails) !== nextVal) {
          merged.enableCustomerDetails = nextVal;
          changed = true;
        }
      }
      if (cloudSettings.customer_details_by_shop !== undefined) {
        try {
          const parsed =
            typeof cloudSettings.customer_details_by_shop === 'string'
              ? JSON.parse(cloudSettings.customer_details_by_shop)
              : cloudSettings.customer_details_by_shop;
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const cleanMap: Record<string, boolean> = {};
            for (const [k, v] of Object.entries(parsed)) {
              if (k && typeof v === 'boolean') cleanMap[k] = v;
              else if (k && (v === 1 || v === 0)) cleanMap[k] = v === 1;
            }
            if (JSON.stringify(localSettings.customerDetailsByShop || {}) !== JSON.stringify(cleanMap)) {
              merged.customerDetailsByShop = cleanMap;
              changed = true;
            }
          }
        } catch {
          // ignore malformed map
        }
      }

      if (changed) {
        db.saveSettings(merged);
        setDbState({ ...db.getState() });
      }
    } catch {
      // Offline or transient error — keep current local settings
    }
  };

  // 1. FORCE FULL PULL ON FIRST LOAD (for incognito/new devices)
  useEffect(() => {
    const hasSynced = localStorage.getItem('omnibiz_has_synced');

    if (!hasSynced) {
      console.log('[FirstLoad] No previous sync - pulling all data from D1...');
      pullCloudData(true);
    } else {
      console.log('[FirstLoad] Has synced before - loading from local storage');
    }
  }, []);

  // 2. Listen to LocalDB changes and push with lightweight debounce
  useEffect(() => {
    let pushTimer: ReturnType<typeof setTimeout> | null = null;

    const unsubscribe = db.subscribe(() => {
      const state = db.getState();
      setDbState({ ...state });
      setSyncStatus(SyncService.getSyncStatus());

      if (currentUser) {
        const freshUser = state.users.find(u => u.id === currentUser.id);
        if (freshUser) {
          if (freshUser.status !== 'ACTIVE') {
            AuthService.logout();
            setCurrentUser(null);
            setToasts(prev => [...prev, {
              id: Date.now().toString(),
              type: 'warning',
              title: 'Account Deactivated',
              description: 'Your seller account has been deactivated by an Administrator.',
            }]);
          } else if (
            freshUser.updatedAt !== currentUser.updatedAt ||
            freshUser.name !== currentUser.name ||
            freshUser.role !== currentUser.role
          ) {
            setCurrentUser(freshUser);
            AuthService.setActiveUser(freshUser);
          }
        }
      }

      // PUSH: Debounce push slightly so multi-table saves during bulk imports coalesce cleanly
      const hasPending = state.syncQueue.some(q => q.status === 'PENDING');
      if (hasPending) {
        if (pushTimer) clearTimeout(pushTimer);
        pushTimer = setTimeout(() => {
          pushPendingItems();
        }, 250);
      }
    });

    return () => {
      if (pushTimer) clearTimeout(pushTimer);
      unsubscribe();
    };
  }, [currentUser]);

  // 3. Pull cloud data every 15 minutes + instant lightweight settings sync on login & app resume
  useEffect(() => {
    if (currentUser) {
      pullCloudData(false);
      refreshSettingsFromCloud();
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && currentUser) {
        refreshSettingsFromCloud();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // Pull every 15 minutes
    const interval = setInterval(() => pullCloudData(false), PULL_INTERVAL);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      clearInterval(interval);
    };
  }, [currentUser]);

  // 4. Push on reconnect
  useEffect(() => {
    const handleOnline = () => {
      console.log('[Sync] Connection restored - pushing pending items');
      pushPendingItems();
      // Pull on reconnect
      pullCloudData(true);
    };

    const handleOffline = () => {
      console.log('[Sync] Connection lost');
      setSyncStatus({ state: 'OFFLINE_LOCAL', pendingCount: SyncService.getPendingCount() });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [currentUser]);

  // Ensure seller and Shop Admin stay on a valid shop (and lock admin/report tabs strictly to managedShopIds)
  useEffect(() => {
    if (!currentUser) return;

    if (currentUser.role === 'SELLER') {
      const managedIds = getShopAdminShopIds(currentUser);
      const isShopAdm = managedIds.length > 0;
      const sellerPersonalTabs = ['new_sale', 'my_sales', 'receipts', 'settings', 'notifications'];
      const inAdminScopedTab = isShopAdm && !sellerPersonalTabs.includes(activeTab);

      const scopedShops = inAdminScopedTab
        ? (dbState.shops || []).filter(s => managedIds.includes(s.id))
        : (dbState.shops || []).filter(
            s =>
              managedIds.includes(s.id) ||
              (s.status === 'ACTIVE' && (currentUser.assignedShopIds || []).includes(s.id))
          );

      if (scopedShops.length > 0) {
        const allowAllOverview = inAdminScopedTab ? managedIds.length > 1 : false;
        const isCurrentValid =
          (allowAllOverview && selectedShopId === 'ALL') ||
          scopedShops.some(s => s.id === selectedShopId);
        if (!isCurrentValid || (!allowAllOverview && selectedShopId === 'ALL')) {
          setSelectedShopId(scopedShops[0].id);
        }
      }
    }
  }, [currentUser, dbState.shops, selectedShopId, activeTab]);

  const refreshUser = () => {
    const u = AuthService.getActiveUser();
    setCurrentUser(u);
  };

  const login = (user: User) => {
    // Get freshest user data from local DB (includes permissions)
    const allUsers = db.getUsers();
    const freshUser = allUsers.find(u => u.id === user.id) || user;

    console.log('[Login] User:', {
      id: freshUser.id,
      role: freshUser.role,
      permissions: freshUser.permissions,
    });

    AuthService.setActiveUser(freshUser);
    setCurrentUser(freshUser);

    if (isPlatformAdmin(freshUser)) {
      setActiveTab('dashboard');
    } else if (isShopAdmin(freshUser)) {
      setActiveTab('dashboard');
      const managedIds = getShopAdminShopIds(freshUser);
      const managedShops = (dbState.shops || []).filter(
        s => managedIds.includes(s.id) || (s.status === 'ACTIVE' && (freshUser.assignedShopIds || []).includes(s.id))
      );
      if (managedShops.length > 0) {
        setSelectedShopId(managedShops[0].id);
      }
    } else {
      setActiveTab('new_sale');
      const sellerShops = (dbState.shops || []).filter(
        s => s.status === 'ACTIVE' && (freshUser.assignedShopIds || []).includes(s.id)
      );
      if (sellerShops.length > 0) {
        setSelectedShopId(sellerShops[0].id);
      }
    }

    addToast({
      type: 'success',
      title: `Welcome back, ${freshUser.name}`,
      description: `Logged in as ${freshUser.role}`,
    });

    // Push any pending items and pull latest data after login
    setTimeout(() => {
      pushPendingItems();
      pullCloudData(false);
    }, 1000);
  };

  const logout = () => {
    // Push pending items before logout
    pushPendingItems();

    AuthService.logout();
    setCurrentUser(null);
    setActiveTab('dashboard');
    addToast({
      type: 'info',
      title: 'Logged Out',
      description: 'Session ended securely.',
    });
  };

  const addToast = (toast: Omit<ToastMessage, 'id'>) => {
    const id = Date.now().toString() + Math.random().toString(36).substring(2, 6);
    setToasts(prev => [...prev, { ...toast, id }]);

    setTimeout(() => {
      removeToast(id);
    }, 4000);
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const showReceipt = (sale: Sale) => {
    setActiveReceipt(sale);
  };

  const closeReceipt = () => {
    setActiveReceipt(null);
  };

  const triggerSync = async () => {
    setSyncStatus({ state: 'SYNCING', pendingCount: syncStatus.pendingCount });

    // Push pending items
    await pushPendingItems();

    // Pull latest data (force)
    await pullCloudData(true);

    setSyncStatus(SyncService.getSyncStatus());

    const pendingCount = SyncService.getPendingCount();

    if (pendingCount === 0) {
      addToast({
        type: 'success',
        title: 'Synchronization Complete',
        description: 'All records up to date.',
      });
    } else {
      addToast({
        type: 'warning',
        title: 'Sync Status',
        description: `${pendingCount} items still pending. Will retry automatically.`,
      });
    }
  };

  const updateSettings = (newSettings: any) => {
    const currentSettings = db.getSettings();
    const { customerDetailsByShopPatch, ...restSettings } = newSettings || {};
    const mergedShopMap =
      customerDetailsByShopPatch && typeof customerDetailsByShopPatch === 'object'
        ? {
            ...(currentSettings.customerDetailsByShop || {}),
            ...customerDetailsByShopPatch,
          }
        : restSettings.customerDetailsByShop !== undefined
          ? restSettings.customerDetailsByShop
          : currentSettings.customerDetailsByShop;

    const updatedSettings = {
      ...currentSettings,
      ...restSettings,
      ...(mergedShopMap !== undefined ? { customerDetailsByShop: mergedShopMap } : {}),
    };
    db.saveSettings(updatedSettings);

    const syncPayload = customerDetailsByShopPatch
      ? { ...updatedSettings, customerDetailsByShopPatch }
      : updatedSettings;

    // Immediately persist to D1 /api/settings when online so all sellers see changes right away
    if (CloudflareApi.isOnline()) {
      CloudflareApi.updateSettings(syncPayload).catch(() => {
        // Fallback handled by sync queue below
      });
    }

    db.enqueueSync({
      id: generateUUID(),
      operation: 'UPDATE_SETTINGS',
      entityType: 'SETTINGS',
      entityId: 'global',
      payload: syncPayload,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    setDbState(db.getState());
    setSyncStatus(SyncService.getSyncStatus());

    // Push immediately
    pushPendingItems();
  };

  const sellerColor = useMemo(() => {
    return getColorOption(currentUser?.color || 'blue');
  }, [currentUser?.color]);

  return (
    <AppContext.Provider
      value={{
        currentUser,
        dbState,
        activeTab,
        setActiveTab,
        storesSubTab,
        setStoresSubTab,
        storesNavTick,
        openStoresSubTab,
        inventoryFilter,
        setInventoryFilter,
        inventoryNavTick,
        openInventoryFilter,
        purchasesSubTab,
        setPurchasesSubTab,
        purchasesNavTick,
        openPurchasesSubTab,
        expensesSubTab,
        setExpensesSubTab,
        expensesNavTick,
        openExpensesSubTab,
        productsSubTab,
        setProductsSubTab,
        productsNavTick,
        openProductsSubTab,
        shopsSubTab,
        setShopsSubTab,
        shopsNavTick,
        openShopsSubTab,
        sellersSubTab,
        setSellersSubTab,
        sellersNavTick,
        openSellersSubTab,
        login,
        logout,
        refreshUser,
        selectedShopId,
        setSelectedShopId,
        currentShop,
        availableShops,
        toasts,
        addToast,
        removeToast,
        activeReceipt,
        showReceipt,
        closeReceipt,
        syncStatus,
        triggerSync,
        refreshStoresFromCloud,
        updateSettings,
        refreshSettingsFromCloud,
        sellerColor,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
