import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Warehouse,
  ArrowRightLeft,
  Plus,
  MapPin,
  Store as StoreIcon,
  AlertCircle,
  CheckCircle2,
  Package,
  Search,
  Edit3,
  Trash2,
  AlertTriangle,
  X,
  Layers,
  Tag,
  History,
  Eye,
  Upload,
  Download,
  FileSpreadsheet,
  RefreshCw,
  MoreVertical,
  ChevronDown,
  ChevronRight,
  Calendar,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { StoreService } from '../../services/storeService';
import { ProductService } from '../../services/productService';
import { db } from '../../db/storage';
import { generateUUID } from '../../utils/crypto';
import {
  ExcelImportService,
  ExcelParseResult,
  ImportProgressInfo,
} from '../../services/excelImportService';
import { ImportProgressBar } from '../common/ImportProgressBar';
import { ExcelExportService } from '../../services/excelExportService';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import {
  getAdminManagedShops,
  hasAdminAccess,
  isPlatformAdmin,
  isShopAdmin,
} from '../../utils/permissions';
import type {
  InventoryMovement,
  Product,
  ProductStoreStockDetail,
  Store,
} from '../../types';

const STORE_PAGE_SIZE = 15;

export type TransferDatePreset = 'TODAY' | 'WEEKLY' | 'MONTH' | 'CUSTOM';

export const formatDateYMD = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const computeTransferDatePresetRange = (
  preset: TransferDatePreset,
  now: Date = new Date()
): { start: string; end: string } | null => {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  if (preset === 'TODAY') {
    return { start: formatDateYMD(today), end: formatDateYMD(today) };
  }
  if (preset === 'WEEKLY') {
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    return { start: formatDateYMD(start), end: formatDateYMD(today) };
  }
  if (preset === 'MONTH') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { start: formatDateYMD(start), end: formatDateYMD(today) };
  }
  return null;
};

export const isTimestampInDateRange = (
  isoOrTimestamp: string,
  startYMD: string,
  endYMD: string
): boolean => {
  const ts = new Date(isoOrTimestamp).getTime();
  if (Number.isNaN(ts)) return false;

  if (startYMD) {
    const [sy, sm, sd] = startYMD.split('-').map(Number);
    if (sy && sm && sd) {
      const startMs = new Date(sy, sm - 1, sd, 0, 0, 0, 0).getTime();
      if (ts < startMs) return false;
    }
  }

  if (endYMD) {
    const [ey, em, ed] = endYMD.split('-').map(Number);
    if (ey && em && ed) {
      const endMs = new Date(ey, em - 1, ed, 23, 59, 59, 999).getTime();
      if (ts > endMs) return false;
    }
  }

  return true;
};

export const deduplicateStoreTransferMovements = (
  movements: InventoryMovement[]
): InventoryMovement[] => {
  const byTransferProductKey = new Map<string, InventoryMovement>();
  for (const m of movements) {
    const key = m.referenceId
      ? `${m.storeId || 'NO_STORE'}::${m.referenceId}::${m.productId}`
      : m.id;
    const existing = byTransferProductKey.get(key);
    if (!existing) {
      byTransferProductKey.set(key, m);
    } else if (existing.changeQty > 0 && m.changeQty < 0) {
      byTransferProductKey.set(key, m);
    }
  }
  return Array.from(byTransferProductKey.values()).sort((a, b) =>
    (b.createdAt || '').localeCompare(a.createdAt || '')
  );
};

export const AdminStores: React.FC = () => {
  const { currentUser, dbState, addToast, selectedShopId, refreshStoresFromCloud } = useApp();

  const [activeSubTab, setActiveSubTab] = useState<'stores' | 'inventory' | 'transfer'>('stores');
  const [isRefreshingStores, setIsRefreshingStores] = useState(false);

  // Create Store Modal / Form state
  const [isStoreModalOpen, setIsStoreModalOpen] = useState(false);
  const [editingStore, setEditingStore] = useState<Store | null>(null);
  const [storeName, setStoreName] = useState('');
  const [storeLocation, setStoreLocation] = useState('');
  const [storeShopId, setStoreShopId] = useState('');
  const [storeFormError, setStoreFormError] = useState('');

  // Store filter
  const [shopFilter, setShopFilter] = useState('ALL');
  const [storeSearch, setStoreSearch] = useState('');

  // Store Inventory Browser state (grouped by store, 15 per store + See More)
  const [selectedInventoryStoreId, setSelectedInventoryStoreId] = useState('ALL_COMBINED');
  const [invSearch, setInvSearch] = useState('');
  const [invCategoryFilter, setInvCategoryFilter] = useState('ALL');
  const [invStockedOnly, setInvStockedOnly] = useState(true);
  const [invVisibleCounts, setInvVisibleCounts] = useState<Record<string, number>>({});
  const [collapsedInvStores, setCollapsedInvStores] = useState<Record<string, boolean>>({});

  // Transfer Stock Form state (multi-product batch up to 1,000, paginated at 15)
  const [sourceStoreId, setSourceStoreId] = useState('');
  const [selectedTransferMap, setSelectedTransferMap] = useState<Record<string, string>>({});
  const [productSearch, setProductSearch] = useState('');
  const [transferStockedOnly, setTransferStockedOnly] = useState(true);
  const [transferVisibleLimit, setTransferVisibleLimit] = useState(STORE_PAGE_SIZE);
  const [selectedQueueFilter, setSelectedQueueFilter] = useState('');
  const [selectedQueueVisibleLimit, setSelectedQueueVisibleLimit] = useState(STORE_PAGE_SIZE);
  const [bulkTransferQty, setBulkTransferQty] = useState('');
  const [destShopId, setDestShopId] = useState('');
  const [transferNotes, setTransferNotes] = useState('');
  const [transferError, setTransferError] = useState('');

  // Transferred History filter & store grouping state
  const [transferDatePreset, setTransferDatePreset] = useState<TransferDatePreset>('TODAY');
  const [transferStartDate, setTransferStartDate] = useState(() => formatDateYMD(new Date()));
  const [transferEndDate, setTransferEndDate] = useState(() => formatDateYMD(new Date()));
  const [transferLogVisibleCounts, setTransferLogVisibleCounts] = useState<Record<string, number>>({});
  const [collapsedTransferStores, setCollapsedTransferStores] = useState<Record<string, boolean>>({});

  // Store Excel Import Modal state
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importTargetStoreId, setImportTargetStoreId] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importParseResult, setImportParseResult] = useState<ExcelParseResult | null>(null);
  const [isParsingImport, setIsParsingImport] = useState(false);
  const [isCommittingImport, setIsCommittingImport] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgressInfo | null>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);

  // Store Delete Confirmation state
  const [deletingStore, setDeletingStore] = useState<Store | null>(null);

  // Store Inventory Product Click / Press-and-Hold Action Menu state
  const [actionProduct, setActionProduct] = useState<Product | null>(null);
  const [actionStoreContext, setActionStoreContext] = useState<Store | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editProdName, setEditProdName] = useState('');
  const [editProdVariation, setEditProdVariation] = useState('');
  const [editProdSku, setEditProdSku] = useState('');
  const [editProdCategoryId, setEditProdCategoryId] = useState('');
  const [editProdPurchasePrice, setEditProdPurchasePrice] = useState('');
  const [editProdSellingPrice, setEditProdSellingPrice] = useState('');
  const [editProdUnit, setEditProdUnit] = useState('pcs');
  const [editProdMinStock, setEditProdMinStock] = useState('0');
  const [editProdFloorStock, setEditProdFloorStock] = useState('0');
  const [editProdStoreQtys, setEditProdStoreQtys] = useState<Record<string, string>>({});
  const [editProdError, setEditProdError] = useState('');
  const [isSavingProductEdit, setIsSavingProductEdit] = useState(false);
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);

  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (transferDatePreset === 'CUSTOM') return;
    const range = computeTransferDatePresetRange(transferDatePreset);
    if (range) {
      setTransferStartDate(range.start);
      setTransferEndDate(range.end);
    }
  }, [transferDatePreset]);

  useEffect(() => {
    setInvVisibleCounts({});
  }, [invSearch, invCategoryFilter, selectedInventoryStoreId, invStockedOnly]);

  useEffect(() => {
    setTransferLogVisibleCounts({});
  }, [transferDatePreset, transferStartDate, transferEndDate]);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    setIsRefreshingStores(true);
    refreshStoresFromCloud(false)
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsRefreshingStores(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id]);

  const handleManualRefreshStores = async () => {
    if (isRefreshingStores) return;
    setIsRefreshingStores(true);
    try {
      const res = await refreshStoresFromCloud(true);
      if (!res.success && res.error) {
        addToast({
          type: 'warning',
          title: 'Refresh Notice',
          description: res.error,
        });
      }
    } finally {
      setIsRefreshingStores(false);
    }
  };

  if (!currentUser || !hasAdminAccess(currentUser)) return null;

  const settings = dbState.settings;
  const platformAdmin = isPlatformAdmin(currentUser);
  const shopAdmin = isShopAdmin(currentUser);
  const allShops = dbState.shops || [];

  const accessibleShops = useMemo(() => {
    return platformAdmin
      ? allShops
      : shopAdmin
        ? getAdminManagedShops(currentUser, allShops)
        : [];
  }, [allShops, currentUser, platformAdmin, shopAdmin]);

  const accessibleShopIdSet = useMemo(
    () => new Set(accessibleShops.map(s => s.id)),
    [accessibleShops]
  );

  const accessibleStores = useMemo(() => {
    return (dbState.stores || []).filter(
      st => platformAdmin || accessibleShopIdSet.has(st.shopId)
    );
  }, [dbState.stores, platformAdmin, accessibleShopIdSet]);

  const activeStores = useMemo(
    () => accessibleStores.filter(st => st.status === 'ACTIVE'),
    [accessibleStores]
  );

  const transferableStores = useMemo(
    () => activeStores.filter(st => !st.isShopFloor),
    [activeStores]
  );

  const accessibleCategories = useMemo(
    () =>
      (dbState.categories || []).filter(
        c => platformAdmin || accessibleShopIdSet.has(c.shopId)
      ),
    [dbState.categories, platformAdmin, accessibleShopIdSet]
  );

  const accessibleProducts = useMemo(
    () =>
      (dbState.products || []).filter(
        p => p.status !== 'INACTIVE' && (platformAdmin || accessibleShopIdSet.has(p.shopId))
      ),
    [dbState.products, platformAdmin, accessibleShopIdSet]
  );

  const productStoreQtyCache = useMemo(() => {
    const qtyMap = new Map<string, Record<string, number>>();
    let hasFallbackMultiStoreAttribution = false;

    const storesByShop = new Map<string, Store[]>();
    for (const st of accessibleStores) {
      const arr = storesByShop.get(st.shopId) || [];
      arr.push(st);
      storesByShop.set(st.shopId, arr);
    }

    const movementWeightsByProd = new Map<string, Map<string, number>>();
    for (const m of dbState.movements || []) {
      if (!m.productId || !m.storeId) continue;
      if (m.type === 'STORE_TRANSFER' || m.type === 'INITIAL_STOCK' || m.type === 'PURCHASE') {
        const delta = Math.abs(Number(m.newQty ?? m.changeQty ?? 0)) || 1;
        let storeMap = movementWeightsByProd.get(m.productId);
        if (!storeMap) {
          storeMap = new Map<string, number>();
          movementWeightsByProd.set(m.productId, storeMap);
        }
        storeMap.set(m.storeId, (storeMap.get(m.storeId) || 0) + delta);
      }
    }

    for (const pur of dbState.purchases || []) {
      if (!pur.storeId) continue;
      for (const item of pur.items || []) {
        if (!item.productId) continue;
        let storeMap = movementWeightsByProd.get(item.productId);
        if (!storeMap) {
          storeMap = new Map<string, number>();
          movementWeightsByProd.set(item.productId, storeMap);
        }
        storeMap.set(
          pur.storeId,
          (storeMap.get(pur.storeId) || 0) + Math.max(1, Number(item.quantity || 1))
        );
      }
    }

    for (const product of accessibleProducts) {
      const shopStores = storesByShop.get(product.shopId) || [];
      const shopStoreIds = new Set(shopStores.map(s => s.id));
      const floorStores = shopStores.filter(s => s.isShopFloor);
      const floorSet = new Set(floorStores.map(s => s.id));
      const warehouseStores = shopStores
        .filter(s => !s.isShopFloor)
        .sort((a, b) => {
          if (a.status !== b.status) return a.status === 'ACTIVE' ? -1 : 1;
          return (a.createdAt || '').localeCompare(b.createdAt || '');
        });

      const qtyByStore: Record<string, number> = {};

      // 1. Floor stores
      for (const fl of floorStores) {
        qtyByStore[fl.id] =
          product.storeStocks && product.storeStocks[fl.id] !== undefined
            ? Math.max(0, Number(product.storeStocks[fl.id] || 0))
            : Math.max(0, Number(product.currentStock || 0));
      }

      // 2. Explicit valid per-store stock mappings for this shop
      if (product.storeStocks) {
        for (const [sid, qty] of Object.entries(product.storeStocks)) {
          if (shopStoreIds.has(sid) && !floorSet.has(sid)) {
            qtyByStore[sid] = Math.max(0, Number(qty || 0));
          }
        }
      }

      // 3. Recover legacy / cloud-synced products that have aggregate storeStock > 0 without per-store breakdown
      const mappedWarehouseSum = warehouseStores.reduce(
        (sum, s) => sum + (qtyByStore[s.id] || 0),
        0
      );
      const rawStoreStock = Math.max(0, Number(product.storeStock || 0));

      if (mappedWarehouseSum === 0 && rawStoreStock > 0 && warehouseStores.length > 0) {
        const warehouseIdSet = new Set(warehouseStores.map(s => s.id));

        if (product.storeId && warehouseIdSet.has(product.storeId)) {
          qtyByStore[product.storeId] = rawStoreStock;
        } else {
          const weights = movementWeightsByProd.get(product.id);
          const matchedWeights: { storeId: string; weight: number }[] = [];
          if (weights) {
            for (const ws of warehouseStores) {
              const w = weights.get(ws.id) || 0;
              if (w > 0) matchedWeights.push({ storeId: ws.id, weight: w });
            }
          }

          if (matchedWeights.length === 1) {
            qtyByStore[matchedWeights[0].storeId] = rawStoreStock;
          } else if (matchedWeights.length > 1) {
            const totalW = matchedWeights.reduce((s, e) => s + e.weight, 0);
            let allocated = 0;
            matchedWeights.sort((a, b) => b.weight - a.weight);
            matchedWeights.forEach((entry, idx) => {
              if (idx === matchedWeights.length - 1) {
                qtyByStore[entry.storeId] = Math.max(0, rawStoreStock - allocated);
              } else {
                const share = Math.round((rawStoreStock * entry.weight) / totalW);
                qtyByStore[entry.storeId] = share;
                allocated += share;
              }
            });
          } else {
            qtyByStore[warehouseStores[0].id] = rawStoreStock;
            if (warehouseStores.length > 1) {
              hasFallbackMultiStoreAttribution = true;
            }
          }
        }
      }

      qtyMap.set(product.id, qtyByStore);
    }

    return { qtyMap, hasFallbackMultiStoreAttribution };
  }, [accessibleProducts, accessibleStores, dbState.movements, dbState.purchases]);

  const getProductQtyInStore = (product: Product, store: Store): number => {
    const cached = productStoreQtyCache.qtyMap.get(product.id);
    if (cached && cached[store.id] !== undefined) {
      return cached[store.id];
    }
    if (product.storeStocks && product.storeStocks[store.id] !== undefined) {
      return Number(product.storeStocks[store.id] || 0);
    }
    if (store.isShopFloor) {
      return Number(product.currentStock || 0);
    }
    return 0;
  };

  const getProductTotalTrackedUnits = (product: Product): number => {
    const shopStores = accessibleStores.filter(st => st.shopId === product.shopId);
    if (shopStores.length > 0) {
      const storeSum = shopStores.reduce(
        (sum, st) => sum + getProductQtyInStore(product, st),
        0
      );
      const hasFloorStore = shopStores.some(st => st.isShopFloor);
      return hasFloorStore ? storeSum : storeSum + Number(product.currentStock || 0);
    }
    return Number(product.currentStock || 0) + Number(product.storeStock || 0);
  };

  const filteredStores = useMemo(() => {
    return accessibleStores.filter(st => {
      if (shopFilter !== 'ALL' && st.shopId !== shopFilter) return false;
      if (storeSearch.trim()) {
        const q = storeSearch.trim().toLowerCase();
        const shopName = accessibleShops.find(s => s.id === st.shopId)?.name.toLowerCase() || '';
        return (
          st.name.toLowerCase().includes(q) ||
          (st.location || '').toLowerCase().includes(q) ||
          shopName.includes(q)
        );
      }
      return true;
    });
  }, [accessibleStores, shopFilter, storeSearch, accessibleShops]);

  // Resolve effective source store for transfer tab (prefer warehouse stores, not POS floor)
  const effectiveSourceStoreId =
    sourceStoreId && transferableStores.some(s => s.id === sourceStoreId)
      ? sourceStoreId
      : transferableStores[0]?.id || '';

  const selectedSourceStore = useMemo(
    () => transferableStores.find(s => s.id === effectiveSourceStoreId),
    [transferableStores, effectiveSourceStoreId]
  );

  const effectiveDestShopId =
    destShopId && accessibleShops.some(s => s.id === destShopId)
      ? destShopId
      : selectedSourceStore?.shopId || accessibleShops[0]?.id || '';

  const productByIdMap = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of accessibleProducts) {
      map.set(p.id, p);
    }
    return map;
  }, [accessibleProducts]);

  // Products belonging to the selected store's shop — detects even a single searched letter
  const storeScopedProducts = useMemo(() => {
    const base = accessibleProducts.filter(p => {
      if (selectedSourceStore && p.shopId !== selectedSourceStore.shopId) return false;
      if (transferStockedOnly && selectedSourceStore) {
        if (getProductQtyInStore(p, selectedSourceStore) <= 0) return false;
      }
      return true;
    });

    const q = productSearch.trim().toLowerCase();
    const filtered = q
      ? base.filter(p => {
          const cf = p.customFields;
          const customMatch = cf
            ? [cf.field1, cf.field2, cf.field3, cf.field4].some(v =>
                (v || '').toLowerCase().includes(q)
              )
            : false;
          return (
            p.name.toLowerCase().includes(q) ||
            (p.variation || '').toLowerCase().includes(q) ||
            (p.sku || '').toLowerCase().includes(q) ||
            (p.barcode || '').toLowerCase().includes(q) ||
            customMatch
          );
        })
      : base;

    return [...filtered].sort((a, b) => {
      if (q) {
        const aStarts = a.name.toLowerCase().startsWith(q) ? 1 : 0;
        const bStarts = b.name.toLowerCase().startsWith(q) ? 1 : 0;
        if (aStarts !== bStarts) return bStarts - aStarts;
      }
      const aQty = selectedSourceStore
        ? getProductQtyInStore(a, selectedSourceStore)
        : Number(a.storeStock || 0);
      const bQty = selectedSourceStore
        ? getProductQtyInStore(b, selectedSourceStore)
        : Number(b.storeStock || 0);
      if (bQty !== aQty) return bQty - aQty;
      return a.name.localeCompare(b.name);
    });
  }, [
    accessibleProducts,
    selectedSourceStore,
    productSearch,
    transferStockedOnly,
    productStoreQtyCache,
  ]);

  const selectedTransferEntries = useMemo(() => {
    const entries: {
      product: Product;
      qtyStr: string;
      parsedQty: number;
      available: number;
      isInvalidQty: boolean;
      isExceeding: boolean;
    }[] = [];

    for (const [productId, rawQty] of Object.entries(selectedTransferMap)) {
      const qtyStr = typeof rawQty === 'string' ? rawQty : String(rawQty ?? '');
      const product = productByIdMap.get(productId);
      if (!product) continue;
      if (selectedSourceStore && product.shopId !== selectedSourceStore.shopId) continue;

      const available = selectedSourceStore
        ? getProductQtyInStore(product, selectedSourceStore)
        : Number(product.storeStock || 0);
      const parsedQty = Number(qtyStr);
      const isExceeding = Number.isFinite(parsedQty) && parsedQty > available;
      const isInvalidQty = !Number.isFinite(parsedQty) || parsedQty <= 0 || available <= 0;

      entries.push({
        product,
        qtyStr,
        parsedQty,
        available,
        isInvalidQty,
        isExceeding,
      });
    }
    return entries;
  }, [selectedTransferMap, productByIdMap, selectedSourceStore, productStoreQtyCache]);

  const transferSelectionSummary = useMemo(() => {
    let totalUnits = 0;
    let invalidCount = 0;
    let exceedingCount = 0;
    for (const entry of selectedTransferEntries) {
      if (entry.isExceeding) exceedingCount++;
      if (entry.isInvalidQty || entry.isExceeding) {
        invalidCount++;
      } else {
        totalUnits += entry.parsedQty;
      }
    }
    return {
      selectedCount: selectedTransferEntries.length,
      totalUnits,
      invalidCount,
      exceedingCount,
    };
  }, [selectedTransferEntries]);

  // Store transfer logs filtered by date range, deduplicated, and grouped strictly by store
  const transferMovementsFiltered = useMemo(() => {
    const rawTransfers = (dbState.movements || []).filter(
      m =>
        m.type === 'STORE_TRANSFER' &&
        (platformAdmin || accessibleShopIdSet.has(m.shopId)) &&
        isTimestampInDateRange(m.createdAt, transferStartDate, transferEndDate)
    );
    return deduplicateStoreTransferMovements(rawTransfers);
  }, [
    dbState.movements,
    platformAdmin,
    accessibleShopIdSet,
    transferStartDate,
    transferEndDate,
  ]);

  const transferLogsByStore = useMemo(() => {
    const storeMap = new Map<string, Store>();
    for (const st of accessibleStores) {
      storeMap.set(st.id, st);
    }

    const grouped = new Map<string, InventoryMovement[]>();
    for (const m of transferMovementsFiltered) {
      const sid = m.storeId && storeMap.has(m.storeId) ? m.storeId : '__UNASSIGNED__';
      const arr = grouped.get(sid) || [];
      arr.push(m);
      grouped.set(sid, arr);
    }

    const warehouseStores = accessibleStores
      .filter(st => !st.isShopFloor)
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === 'ACTIVE' ? -1 : 1;
        return (a.createdAt || '').localeCompare(b.createdAt || '') || a.name.localeCompare(b.name);
      });

    const groups: {
      storeId: string;
      store?: Store;
      title: string;
      shopName: string;
      movements: InventoryMovement[];
      totalUnits: number;
    }[] = [];

    const seenStoreIds = new Set<string>();
    for (const st of warehouseStores) {
      seenStoreIds.add(st.id);
      const list = grouped.get(st.id) || [];
      const shopName = accessibleShops.find(s => s.id === st.shopId)?.name || 'Shop';
      groups.push({
        storeId: st.id,
        store: st,
        title: `${st.name} Transferred`,
        shopName,
        movements: list,
        totalUnits: list.reduce((sum, m) => sum + Math.abs(Number(m.changeQty || 0)), 0),
      });
    }

    // Include any non-warehouse store or unassigned transfers if present
    for (const [sid, list] of grouped.entries()) {
      if (seenStoreIds.has(sid)) continue;
      const st = storeMap.get(sid);
      const shopName = st
        ? accessibleShops.find(s => s.id === st.shopId)?.name || 'Shop'
        : 'All Shops';
      groups.push({
        storeId: sid,
        store: st,
        title: st ? `${st.name} Transferred` : 'Other Store Transferred',
        shopName,
        movements: list,
        totalUnits: list.reduce((sum, m) => sum + Math.abs(Number(m.changeQty || 0)), 0),
      });
    }

    // Put stores with transfers in the selected date window first
    return groups.sort((a, b) => {
      if ((a.movements.length > 0) !== (b.movements.length > 0)) {
        return a.movements.length > 0 ? -1 : 1;
      }
      return 0;
    });
  }, [transferMovementsFiltered, accessibleStores, accessibleShops]);

  // Summary metrics
  const totalStoreStockUnits = useMemo(() => {
    return accessibleProducts.reduce((sum, p) => sum + Number(p.storeStock || 0), 0);
  }, [accessibleProducts]);

  const productsInStoreCount = useMemo(() => {
    return accessibleProducts.filter(p => (p.storeStock || 0) > 0).length;
  }, [accessibleProducts]);

  // Store Inventory Browser derived data — grouped strictly by Store (never mixed)
  const selectedInventoryStore = useMemo(
    () =>
      selectedInventoryStoreId === 'ALL_COMBINED'
        ? undefined
        : accessibleStores.find(st => st.id === selectedInventoryStoreId),
    [accessibleStores, selectedInventoryStoreId]
  );

  const inventoryStoreGroups = useMemo(() => {
    const q = invSearch.trim().toLowerCase();
    const matchesFilters = (p: Product): boolean => {
      if (invCategoryFilter !== 'ALL' && p.categoryId !== invCategoryFilter) {
        return false;
      }
      if (q) {
        const cf = p.customFields;
        const customMatch = cf
          ? [cf.field1, cf.field2, cf.field3, cf.field4].some(v =>
              (v || '').toLowerCase().includes(q)
            )
          : false;
        return (
          p.name.toLowerCase().includes(q) ||
          (p.variation || '').toLowerCase().includes(q) ||
          (p.sku || '').toLowerCase().includes(q) ||
          (p.barcode || '').toLowerCase().includes(q) ||
          customMatch
        );
      }
      return true;
    };

    const targetStores = selectedInventoryStore
      ? [selectedInventoryStore]
      : [...accessibleStores].sort((a, b) => {
          if (a.isShopFloor !== b.isShopFloor) return a.isShopFloor ? 1 : -1;
          if (a.status !== b.status) return a.status === 'ACTIVE' ? -1 : 1;
          return (a.createdAt || '').localeCompare(b.createdAt || '') || a.name.localeCompare(b.name);
        });

    const groups: {
      store: Store;
      shopName: string;
      products: Product[];
      totalUnits: number;
      totalCostValue: number;
      totalSaleValue: number;
    }[] = [];

    for (const st of targetStores) {
      const storeProducts = accessibleProducts
        .filter(p => {
          if (p.shopId !== st.shopId) return false;
          if (!matchesFilters(p)) return false;
          if (invStockedOnly) {
            const qtyHere = getProductQtyInStore(p, st);
            const hasDetailsHere = Boolean(p.storeDetails?.[st.id]);
            if (qtyHere <= 0 && !hasDetailsHere) return false;
          }
          return true;
        })
        .sort((a, b) => {
          const aq = getProductQtyInStore(a, st);
          const bq = getProductQtyInStore(b, st);
          if (bq !== aq) return bq - aq;
          return a.name.localeCompare(b.name);
        });

      // When viewing All Stores during a search or category filter, hide empty stores so matching stores stand out
      if (!selectedInventoryStore && (q || invCategoryFilter !== 'ALL') && storeProducts.length === 0) {
        continue;
      }

      let totalUnits = 0;
      let totalCostValue = 0;
      let totalSaleValue = 0;

      for (const p of storeProducts) {
        const qty = getProductQtyInStore(p, st);
        const detail = p.storeDetails?.[st.id];
        totalUnits += qty;
        totalCostValue +=
          detail?.importedPurchaseValue !== undefined
            ? detail.importedPurchaseValue
            : qty * (p.purchasePrice || 0);
        totalSaleValue +=
          detail?.importedSaleValue !== undefined
            ? detail.importedSaleValue
            : qty * (p.sellingPrice || 0);
      }

      const shopName = accessibleShops.find(s => s.id === st.shopId)?.name || 'Shop';
      groups.push({
        store: st,
        shopName,
        products: storeProducts,
        totalUnits,
        totalCostValue,
        totalSaleValue,
      });
    }

    return groups;
  }, [
    accessibleProducts,
    accessibleStores,
    accessibleShops,
    selectedInventoryStore,
    invCategoryFilter,
    invStockedOnly,
    invSearch,
    productStoreQtyCache,
  ]);

  const inventoryProducts = useMemo(() => {
    const seen = new Set<string>();
    const list: Product[] = [];
    for (const g of inventoryStoreGroups) {
      for (const p of g.products) {
        if (!seen.has(p.id)) {
          seen.add(p.id);
          list.push(p);
        }
      }
    }
    return list;
  }, [inventoryStoreGroups]);

  const inventoryTotals = useMemo(() => {
    let totalUnits = 0;
    let totalCostValue = 0;
    let totalSaleValue = 0;

    for (const g of inventoryStoreGroups) {
      totalUnits += g.totalUnits;
      totalCostValue += g.totalCostValue;
      totalSaleValue += g.totalSaleValue;
    }

    return {
      skuCount: inventoryProducts.length,
      totalUnits,
      totalCostValue,
      totalSaleValue,
      potentialProfit: totalSaleValue - totalCostValue,
    };
  }, [inventoryStoreGroups, inventoryProducts]);

  // Modal handlers
  const openCreateStoreModal = () => {
    setEditingStore(null);
    setStoreName('');
    setStoreLocation('');
    const defaultShop =
      selectedShopId && selectedShopId !== 'ALL' && accessibleShopIdSet.has(selectedShopId)
        ? selectedShopId
        : accessibleShops[0]?.id || '';
    setStoreShopId(defaultShop);
    setStoreFormError('');
    setIsStoreModalOpen(true);
  };

  const openEditStoreModal = (store: Store) => {
    setEditingStore(store);
    setStoreName(store.name);
    setStoreLocation(store.location || '');
    setStoreShopId(store.shopId);
    setStoreFormError('');
    setIsStoreModalOpen(true);
  };

  const handleSaveStore = (e: React.FormEvent) => {
    e.preventDefault();
    setStoreFormError('');

    if (!storeName.trim()) {
      setStoreFormError('Store name is required.');
      return;
    }
    if (!storeShopId) {
      setStoreFormError('Please assign this store to a shop.');
      return;
    }

    const res = editingStore
      ? StoreService.updateStore(
          editingStore.id,
          {
            name: storeName.trim(),
            location: storeLocation.trim(),
            shopId: storeShopId,
          },
          currentUser
        )
      : StoreService.createStore(
          {
            name: storeName.trim(),
            location: storeLocation.trim() || undefined,
            shopId: storeShopId,
          },
          currentUser
        );

    if (res.success) {
      const assignedShop = accessibleShops.find(s => s.id === storeShopId);
      addToast({
        type: 'success',
        title: editingStore ? 'Store Updated' : 'Store Created',
        description: editingStore
          ? `Store "${storeName.trim()}" updated.`
          : `Store "${storeName.trim()}" assigned to ${assignedShop?.name || 'shop'} and queued for sync.`,
      });
      setIsStoreModalOpen(false);
    } else {
      setStoreFormError(res.error || 'Failed to save store.');
    }
  };

  const handleConfirmDeleteStore = (store: Store) => {
    const res = StoreService.deleteStore(store.id, currentUser);
    if (res.success) {
      if (selectedInventoryStoreId === store.id) {
        setSelectedInventoryStoreId('ALL_COMBINED');
      }
      if (sourceStoreId === store.id) {
        setSourceStoreId('');
      }
      if (importTargetStoreId === store.id) {
        setImportTargetStoreId('');
      }
      addToast({
        type: 'success',
        title: 'Store Deleted',
        description: `"${store.name}" has been deleted and queued for sync.`,
      });
      setDeletingStore(null);
    } else {
      addToast({
        type: 'error',
        title: 'Delete Failed',
        description: res.error || 'Could not delete store.',
      });
    }
  };

  const MAX_BATCH_TRANSFER_PRODUCTS = 1000;

  const handleSourceStoreChange = (nextStoreId: string) => {
    setSourceStoreId(nextStoreId);
    const st = activeStores.find(s => s.id === nextStoreId);
    if (st) {
      setDestShopId(st.shopId);
    }
    setSelectedTransferMap({});
    setTransferVisibleLimit(STORE_PAGE_SIZE);
    setSelectedQueueVisibleLimit(STORE_PAGE_SIZE);
    setTransferError('');
  };

  const handleToggleTransferProduct = (product: Product) => {
    const available = selectedSourceStore
      ? getProductQtyInStore(product, selectedSourceStore)
      : Number(product.storeStock || 0);

    setTransferError('');
    setSelectedTransferMap(prev => {
      if (product.id in prev) {
        const next = { ...prev };
        delete next[product.id];
        return next;
      }
      if (available <= 0) {
        addToast({
          type: 'warning',
          title: 'Out of Stock in Store',
          description: `"${product.name}" currently has 0 units in ${selectedSourceStore?.name || 'this store'}.`,
        });
        return prev;
      }
      if (Object.keys(prev).length >= MAX_BATCH_TRANSFER_PRODUCTS) {
        addToast({
          type: 'warning',
          title: 'Selection Limit Reached',
          description: `You can select up to ${MAX_BATCH_TRANSFER_PRODUCTS.toLocaleString()} products per transfer.`,
        });
        return prev;
      }
      return {
        ...prev,
        [product.id]: '1',
      };
    });
  };

  const handleChangeSelectedTransferQty = (productId: string, nextVal: string) => {
    setTransferError('');
    setSelectedTransferMap(prev => ({
      ...prev,
      [productId]: nextVal,
    }));
  };

  const handleSelectAllMatchingProducts = () => {
    setTransferError('');
    const stockedMatches = storeScopedProducts.filter(p => {
      const avail = selectedSourceStore
        ? getProductQtyInStore(p, selectedSourceStore)
        : Number(p.storeStock || 0);
      return avail > 0;
    });
    if (stockedMatches.length === 0) return;

    let added = 0;
    let hitCap = false;
    setSelectedTransferMap(prev => {
      const next = { ...prev };
      for (const p of stockedMatches) {
        if (p.id in next) continue;
        if (Object.keys(next).length >= MAX_BATCH_TRANSFER_PRODUCTS) {
          hitCap = true;
          break;
        }
        next[p.id] = '1';
        added++;
      }
      return next;
    });

    if (hitCap) {
      addToast({
        type: 'warning',
        title: 'Maximum 1,000 Products Selected',
        description: `Added ${added} matching product(s) up to the ${MAX_BATCH_TRANSFER_PRODUCTS.toLocaleString()} item limit.`,
      });
    } else if (added > 0) {
      addToast({
        type: 'info',
        title: 'Products Selected',
        description: `Ticked ${added.toLocaleString()} product(s) from current search results.`,
      });
    }
  };

  const handleDeselectMatchingProducts = () => {
    setTransferError('');
    setSelectedTransferMap(prev => {
      const next = { ...prev };
      for (const p of storeScopedProducts) {
        delete next[p.id];
      }
      return next;
    });
  };

  const handleApplyBulkQtyToSelected = () => {
    const qtyNum = Number(bulkTransferQty);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      setTransferError('Enter a valid bulk quantity greater than 0.');
      return;
    }
    setTransferError('');
    setSelectedTransferMap(prev => {
      const next: Record<string, string> = {};
      for (const pid of Object.keys(prev)) {
        const prod = productByIdMap.get(pid);
        const avail =
          prod && selectedSourceStore
            ? getProductQtyInStore(prod, selectedSourceStore)
            : Number(prod?.storeStock || 0);
        const clamped = avail > 0 ? Math.min(qtyNum, avail) : qtyNum;
        next[pid] = String(clamped);
      }
      return next;
    });
  };

  const handleFillMaxAllSelected = () => {
    setTransferError('');
    setSelectedTransferMap(prev => {
      const next: Record<string, string> = {};
      for (const pid of Object.keys(prev)) {
        const prod = productByIdMap.get(pid);
        const avail =
          prod && selectedSourceStore
            ? getProductQtyInStore(prod, selectedSourceStore)
            : Number(prod?.storeStock || 0);
        next[pid] = String(Math.max(1, avail));
      }
      return next;
    });
  };

  const handleSubmitTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    setTransferError('');

    if (!effectiveSourceStoreId) {
      setTransferError('Please select a source store.');
      return;
    }
    if (!effectiveDestShopId) {
      setTransferError('Please select a destination shop.');
      return;
    }
    if (selectedTransferEntries.length === 0) {
      setTransferError('Search and tick at least one product to transfer.');
      return;
    }
    if (selectedTransferEntries.length > MAX_BATCH_TRANSFER_PRODUCTS) {
      setTransferError(
        `Maximum ${MAX_BATCH_TRANSFER_PRODUCTS.toLocaleString()} products allowed per transfer.`
      );
      return;
    }

    const firstBad = selectedTransferEntries.find(
      entry => entry.isInvalidQty || entry.isExceeding
    );
    if (firstBad) {
      if (firstBad.isExceeding) {
        setTransferError(
          `Quantity for "${firstBad.product.name}" (${firstBad.parsedQty}) exceeds available store stock (${firstBad.available} ${firstBad.product.unit || 'pcs'}).`
        );
      } else {
        setTransferError(
          `Enter a valid quantity greater than 0 for "${firstBad.product.name}".`
        );
      }
      return;
    }

    const items = selectedTransferEntries.map(entry => ({
      productId: entry.product.id,
      quantity: entry.parsedQty,
    }));

    const res = StoreService.transferBatchStoreToShop(
      {
        storeId: effectiveSourceStoreId,
        shopId: effectiveDestShopId,
        items,
        notes: transferNotes.trim() || undefined,
      },
      currentUser
    );

    if (res.success) {
      const destShopName =
        accessibleShops.find(s => s.id === effectiveDestShopId)?.name || 'Shop Floor';
      const movedCount = res.transferredCount || items.length;
      const movedUnits = res.totalUnits || transferSelectionSummary.totalUnits;
      addToast({
        type: 'success',
        title:
          movedCount === 1
            ? 'Stock Transferred to Shop Floor'
            : `${movedCount.toLocaleString()} Products Transferred`,
        description:
          movedCount === 1
            ? `Moved ${movedUnits.toLocaleString()} ${selectedTransferEntries[0].product.unit || 'pcs'} of "${selectedTransferEntries[0].product.name}" to ${destShopName}.`
            : `Moved ${movedUnits.toLocaleString()} total units across ${movedCount.toLocaleString()} products to ${destShopName}.`,
      });
      setSelectedTransferMap({});
      setBulkTransferQty('');
      setSelectedQueueFilter('');
      setTransferNotes('');
      setTransferError('');
    } else {
      setTransferError(res.error || 'Transfer failed.');
    }
  };

  // Store Excel Import / Export handlers
  const openImportModal = (preselectedStoreId?: string) => {
    const preferred =
      preselectedStoreId && activeStores.some(s => s.id === preselectedStoreId)
        ? preselectedStoreId
        : selectedInventoryStore && selectedInventoryStore.status === 'ACTIVE'
          ? selectedInventoryStore.id
          : activeStores[0]?.id || '';
    setImportTargetStoreId(preferred);
    setImportFile(null);
    setImportParseResult(null);
    setImportProgress(null);
    if (importFileInputRef.current) importFileInputRef.current.value = '';
    setIsImportModalOpen(true);
  };

  const handleStoreExcelFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!importTargetStoreId) {
      addToast({
        type: 'warning',
        title: 'Select Store First',
        description: 'Choose the destination store before selecting an Excel file.',
      });
      if (importFileInputRef.current) importFileInputRef.current.value = '';
      return;
    }

    setImportFile(file);
    setImportParseResult(null);
    setIsParsingImport(true);
    setImportProgress({
      stage: 'READING',
      percent: 2,
      processedRows: 0,
      totalRows: 0,
      message: `Opening "${file.name}"...`,
    });

    try {
      const result = await ExcelImportService.parseExcelFile(file, progress => {
        setImportProgress(progress);
      });
      setImportParseResult(result);

      if (result.errors.length > 0 && result.rows.length === 0) {
        addToast({
          type: 'error',
          title: 'Invalid Excel Format',
          description: result.errors[0]?.message || 'Could not read products from file.',
        });
      } else if (result.errors.length > 0) {
        addToast({
          type: 'warning',
          title: 'Validation Issues',
          description: `${result.rows.length.toLocaleString()} valid rows, ${result.errors.length.toLocaleString()} error(s).`,
        });
      } else {
        addToast({
          type: 'success',
          title: 'Excel Ready',
          description: `${result.rows.length.toLocaleString()} products ready to import.`,
        });
      }
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Failed to Read File',
        description: err?.message || 'Unexpected error while reading spreadsheet.',
      });
    } finally {
      setIsParsingImport(false);
    }
  };

  const handleCommitStoreExcelImport = async () => {
    if (!importParseResult || importParseResult.rows.length === 0) return;

    const targetStore = activeStores.find(s => s.id === importTargetStoreId);
    if (!targetStore) {
      addToast({
        type: 'warning',
        title: 'Select Store First',
        description: 'Please select an active destination store.',
      });
      return;
    }

    setIsCommittingImport(true);
    setImportProgress({
      stage: 'SAVING',
      percent: 2,
      processedRows: 0,
      totalRows: importParseResult.rows.length,
      message: `Starting import of ${importParseResult.rows.length.toLocaleString()} products...`,
    });

    try {
      const res = await ExcelImportService.commitImportAsync(
        importParseResult.rows,
        targetStore.shopId,
        currentUser,
        targetStore.id,
        progress => {
          setImportProgress(progress);
        }
      );

      if (res.success) {
        const shopName = accessibleShops.find(s => s.id === targetStore.shopId)?.name || 'Shop';
        addToast({
          type: 'success',
          title: 'Store Import Successful',
          description: `${res.created.toLocaleString()} created, ${res.updated.toLocaleString()} updated in ${targetStore.name} (${shopName}).`,
        });
        setIsImportModalOpen(false);
        setImportFile(null);
        setImportParseResult(null);
        setImportProgress(null);
        if (importFileInputRef.current) importFileInputRef.current.value = '';
      } else {
        addToast({
          type: 'error',
          title: 'Import Completed with Errors',
          description: `${res.created.toLocaleString()} created, ${res.updated.toLocaleString()} updated, ${res.errors.length.toLocaleString()} error(s).`,
        });
      }
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Import Failed',
        description: err?.message || 'Unexpected error while saving products.',
      });
    } finally {
      setIsCommittingImport(false);
    }
  };

  const handleExportStoreExcel = (store: Store, customProducts?: Product[]) => {
    const res = ExcelExportService.exportStoreProducts(store, customProducts);
    if (res.success) {
      addToast({
        type: 'success',
        title: 'Store Excel Exported',
        description: `${res.rowCount} products saved to ${res.fileName}`,
      });
    } else {
      addToast({
        type: 'warning',
        title: 'Nothing to Export',
        description: res.error || `No products available in ${store.name}.`,
      });
    }
  };

  const handleExportInventoryExcel = () => {
    if (selectedInventoryStore) {
      handleExportStoreExcel(selectedInventoryStore, inventoryProducts);
      return;
    }
    const res = ExcelExportService.exportCombinedStoresProducts(
      accessibleStores,
      inventoryProducts
    );
    if (res.success) {
      addToast({
        type: 'success',
        title: 'Inventory Exported',
        description: `${res.rowCount} products saved to ${res.fileName}`,
      });
    } else {
      addToast({
        type: 'warning',
        title: 'Nothing to Export',
        description: res.error || 'No products found to export.',
      });
    }
  };

  // Store Inventory Product Click / Hold Gesture & Action Handlers
  const clearLongPressTimer = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleInventoryCardPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    product: Product,
    store: Store
  ) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    clearLongPressTimer();
    longPressTriggeredRef.current = false;
    pointerStartRef.current = { x: e.clientX, y: e.clientY };

    longPressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      setActionStoreContext(store);
      setActionProduct(product);
    }, 420);
  };

  const handleInventoryCardPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointerStartRef.current || longPressTimerRef.current === null) return;
    const dx = Math.abs(e.clientX - pointerStartRef.current.x);
    const dy = Math.abs(e.clientY - pointerStartRef.current.y);
    if (dx > 10 || dy > 10) {
      clearLongPressTimer();
    }
  };

  const handleInventoryCardPointerEnd = () => {
    clearLongPressTimer();
    pointerStartRef.current = null;
  };

  const handleInventoryCardClick = (product: Product, store: Store) => {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    setActionStoreContext(store);
    setActionProduct(product);
  };

  const handleOpenEditProductFromAction = (product: Product) => {
    setActionProduct(null);
    setActionStoreContext(null);
    setEditingProduct(product);
    setEditProdName(product.name || '');
    setEditProdVariation(product.variation || '');
    setEditProdSku(product.sku || '');
    setEditProdCategoryId(product.categoryId || '');
    setEditProdPurchasePrice(String(product.purchasePrice ?? 0));
    setEditProdSellingPrice(String(product.sellingPrice ?? 0));
    setEditProdUnit(product.unit || 'pcs');
    setEditProdMinStock(String(product.minStock ?? 0));
    setEditProdFloorStock(String(product.currentStock ?? 0));

    const warehouseStoresInShop = accessibleStores.filter(
      st => st.shopId === product.shopId && !st.isShopFloor
    );
    const initialQtys: Record<string, string> = {};
    for (const st of warehouseStoresInShop) {
      initialQtys[st.id] = String(getProductQtyInStore(product, st));
    }
    setEditProdStoreQtys(initialQtys);
    setEditProdError('');
  };

  const handleSaveEditedProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    setEditProdError('');

    const cleanName = editProdName.trim();
    const cleanSku = editProdSku.trim();
    const buyPrice = Number(editProdPurchasePrice);
    const sellPrice = Number(editProdSellingPrice);
    const minStk = Number(editProdMinStock);
    const floorStk = Number(editProdFloorStock);

    if (!cleanName) {
      setEditProdError('Product name is required.');
      return;
    }
    if (!cleanSku) {
      setEditProdError('SKU is required.');
      return;
    }
    if (!Number.isFinite(buyPrice) || buyPrice < 0) {
      setEditProdError('Buying price must be 0 or greater.');
      return;
    }
    if (!Number.isFinite(sellPrice) || sellPrice < 0) {
      setEditProdError('Selling price must be 0 or greater.');
      return;
    }
    if (!Number.isFinite(floorStk) || floorStk < 0) {
      setEditProdError('Shop floor stock cannot be negative.');
      return;
    }

    const shopStores = accessibleStores.filter(st => st.shopId === editingProduct.shopId);
    const warehouseStoresInShop = shopStores.filter(st => !st.isShopFloor);
    const floorStoresInShop = shopStores.filter(st => st.isShopFloor);

    const nextStoreStocks: Record<string, number> = {
      ...(editingProduct.storeStocks || {}),
    };
    const nextStoreDetails: Record<string, ProductStoreStockDetail> = {
      ...(editingProduct.storeDetails || {}),
    };

    let nextStoreStockTotal = 0;
    let primaryStoreId = editingProduct.storeId;
    let maxStoreQty = -1;

    for (const st of warehouseStoresInShop) {
      const parsed = Number(editProdStoreQtys[st.id] ?? 0);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setEditProdError(`Quantity for "${st.name}" cannot be negative.`);
        return;
      }
      nextStoreStocks[st.id] = parsed;
      nextStoreStockTotal += parsed;
      if (parsed > maxStoreQty) {
        maxStoreQty = parsed;
        primaryStoreId = st.id;
      }

      const prevDetail = nextStoreDetails[st.id];
      nextStoreDetails[st.id] = {
        ...(prevDetail || {
          storeId: st.id,
          storeName: st.name,
          quantity: parsed,
          unitPurchasePrice: buyPrice,
          unitSellingPrice: sellPrice,
        }),
        storeId: st.id,
        storeName: st.name,
        quantity: parsed,
        unitPurchasePrice: buyPrice,
        unitSellingPrice: sellPrice,
        importedPurchaseValue: parsed * buyPrice,
        importedSaleValue: parsed * sellPrice,
        importedPotentialProfit: parsed * (sellPrice - buyPrice),
      };
    }

    for (const fl of floorStoresInShop) {
      nextStoreStocks[fl.id] = floorStk;
      const prevDetail = nextStoreDetails[fl.id];
      nextStoreDetails[fl.id] = {
        ...(prevDetail || {
          storeId: fl.id,
          storeName: fl.name,
          quantity: floorStk,
          unitPurchasePrice: buyPrice,
          unitSellingPrice: sellPrice,
        }),
        storeId: fl.id,
        storeName: fl.name,
        quantity: floorStk,
        unitPurchasePrice: buyPrice,
        unitSellingPrice: sellPrice,
        importedPurchaseValue: floorStk * buyPrice,
        importedSaleValue: floorStk * sellPrice,
        importedPotentialProfit: floorStk * (sellPrice - buyPrice),
      };
    }

    if (warehouseStoresInShop.length === 0) {
      nextStoreStockTotal = Math.max(0, Number(editingProduct.storeStock || 0));
    }

    setIsSavingProductEdit(true);
    try {
      const res = await ProductService.updateProduct(
        editingProduct.id,
        {
          name: cleanName,
          variation: editProdVariation.trim() || undefined,
          sku: cleanSku,
          categoryId: editProdCategoryId || editingProduct.categoryId,
          purchasePrice: buyPrice,
          sellingPrice: sellPrice,
          unit: editProdUnit.trim() || 'pcs',
          minStock: Number.isFinite(minStk) && minStk >= 0 ? minStk : 0,
          currentStock: floorStk,
          storeId: primaryStoreId,
          storeStock: nextStoreStockTotal,
          storeStocks: nextStoreStocks,
          storeDetails: nextStoreDetails,
        },
        currentUser
      );

      if (!res.success) {
        setEditProdError(res.error || 'Failed to update product.');
        return;
      }

      const oldTotal =
        Number(editingProduct.currentStock || 0) + Number(editingProduct.storeStock || 0);
      const newTotal = floorStk + nextStoreStockTotal;
      if (oldTotal !== newTotal) {
        const shopName = accessibleShops.find(s => s.id === editingProduct.shopId)?.name;
        const adjMovement: InventoryMovement = {
          id: generateUUID(),
          shopId: editingProduct.shopId,
          shopName,
          storeId: selectedInventoryStore?.id || primaryStoreId,
          productId: editingProduct.id,
          productName: cleanName,
          previousQty: oldTotal,
          changeQty: newTotal - oldTotal,
          newQty: newTotal,
          type: 'ADJUSTMENT',
          reason: `Manual edit in Stores Inventory${
            selectedInventoryStore ? ` (${selectedInventoryStore.name})` : ''
          }`,
          userId: currentUser.id,
          userName: currentUser.name,
          createdAt: new Date().toISOString(),
        };
        db.saveMovements([adjMovement, ...db.getMovements()]);
      }

      addToast({
        type: 'success',
        title: 'Product Updated',
        description: `"${cleanName}" saved (${nextStoreStockTotal.toLocaleString()} in stores, ${floorStk.toLocaleString()} on floor).`,
      });
      setEditingProduct(null);
    } catch (err: any) {
      setEditProdError(err?.message || 'Unexpected error while saving product.');
    } finally {
      setIsSavingProductEdit(false);
    }
  };

  const handleOpenTransferFromAction = (product: Product) => {
    const activeWarehousesInShop = transferableStores.filter(s => s.shopId === product.shopId);
    if (activeWarehousesInShop.length === 0) {
      setActionProduct(null);
      setActionStoreContext(null);
      addToast({
        type: 'warning',
        title: 'No Warehouse Store',
        description:
          'Create an active warehouse store in this shop before transferring stock onto the shop floor.',
      });
      return;
    }

    const preferredStore = actionStoreContext || selectedInventoryStore;
    let bestStore =
      preferredStore &&
      preferredStore.shopId === product.shopId &&
      !preferredStore.isShopFloor &&
      preferredStore.status === 'ACTIVE'
        ? preferredStore
        : activeWarehousesInShop[0];

    if (
      !preferredStore ||
      preferredStore.isShopFloor ||
      preferredStore.shopId !== product.shopId
    ) {
      let bestQty = -1;
      for (const st of activeWarehousesInShop) {
        const q = getProductQtyInStore(product, st);
        if (q > bestQty) {
          bestQty = q;
          bestStore = st;
        }
      }
    }

    const availableHere = getProductQtyInStore(product, bestStore);
    setSourceStoreId(bestStore.id);
    setDestShopId(product.shopId);
    setSelectedTransferMap({
      [product.id]: availableHere > 0 ? '1' : '0',
    });
    setProductSearch('');
    setTransferVisibleLimit(STORE_PAGE_SIZE);
    setSelectedQueueVisibleLimit(STORE_PAGE_SIZE);
    setTransferError('');
    setActionProduct(null);
    setActionStoreContext(null);
    setActiveSubTab('transfer');
  };

  const handleConfirmDeleteProduct = () => {
    if (!deletingProduct) return;
    const res = ProductService.deleteProduct(deletingProduct.id, currentUser);
    if (res.success) {
      addToast({
        type: 'success',
        title: 'Product Deleted',
        description: `"${deletingProduct.name}" has been deleted and queued for sync.`,
      });
      if (deletingProduct.id in selectedTransferMap) {
        setSelectedTransferMap(prev => {
          const next = { ...prev };
          delete next[deletingProduct.id];
          return next;
        });
      }
      setDeletingProduct(null);
    } else {
      addToast({
        type: 'error',
        title: 'Delete Failed',
        description: res.error || 'Could not delete product.',
      });
    }
  };

  return (
    <div
      id="admin-stores-view"
      className="flex-1 p-3.5 sm:p-6 bg-slate-950 text-slate-100 overflow-y-auto pb-24 sm:pb-6"
    >
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
            Stores &amp; Transfers
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Manage warehouse stores assigned to shops and transfer stock onto the shop floor
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-1 text-xs overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveSubTab('stores')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-semibold transition whitespace-nowrap ${
                activeSubTab === 'stores'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Warehouse className="w-3.5 h-3.5" />
              <span>Stores ({accessibleStores.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('inventory')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-semibold transition whitespace-nowrap ${
                activeSubTab === 'inventory'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Package className="w-3.5 h-3.5" />
              <span>Inventory</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('transfer')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-semibold transition whitespace-nowrap ${
                activeSubTab === 'transfer'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              <span>Transfer Stock</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleManualRefreshStores}
            disabled={isRefreshingStores}
            title="Refresh stores from database"
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-semibold text-xs transition disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshingStores ? 'animate-spin' : ''}`} />
            <span>{isRefreshingStores ? 'Refreshing...' : 'Refresh'}</span>
          </button>

          <button
            type="button"
            onClick={() => openImportModal()}
            disabled={activeStores.length === 0}
            className="flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 font-semibold text-xs transition disabled:opacity-45 disabled:cursor-not-allowed"
          >
            <Upload className="w-4 h-4" />
            <span>Import Excel</span>
          </button>

          <button
            id="create-store-btn"
            type="button"
            onClick={openCreateStoreModal}
            className="flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-semibold text-xs transition"
          >
            <Plus className="w-4 h-4" />
            <span>Create Store</span>
          </button>
        </div>
      </div>

      {/* Overview Metrics Row */}
      <div className="grid grid-cols-3 gap-2.5 sm:gap-4 mb-5">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 sm:p-4">
          <div className="text-[11px] text-slate-400 font-medium">Active Stores</div>
          <div className="text-lg sm:text-2xl font-bold text-white font-mono tabular-nums mt-1">
            {activeStores.length}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            {accessibleShops.length} shop{accessibleShops.length === 1 ? '' : 's'}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 sm:p-4">
          <div className="text-[11px] text-slate-400 font-medium">Stocked SKUs</div>
          <div className="text-lg sm:text-2xl font-bold text-white font-mono tabular-nums mt-1">
            {productsInStoreCount}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">In warehouse</div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 sm:p-4">
          <div className="text-[11px] text-slate-400 font-medium">Store Units</div>
          <div className="text-lg sm:text-2xl font-bold text-blue-400 font-mono tabular-nums mt-1">
            {totalStoreStockUnits.toLocaleString()}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Ready to transfer</div>
        </div>
      </div>

      {/* SUB-TAB 1: STORES DIRECTORY */}
      {activeSubTab === 'stores' && (
        <div className="space-y-4">
          {/* Search & Shop filter */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={storeSearch}
                onChange={e => setStoreSearch(e.target.value)}
                placeholder="Search store name, location, or shop..."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <select
              value={shopFilter}
              onChange={e => setShopFilter(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="ALL">
                {shopAdmin && !platformAdmin && accessibleShops.length === 1
                  ? accessibleShops[0].name
                  : 'All Assigned Shops'}
              </option>
              {(platformAdmin || accessibleShops.length > 1) &&
                accessibleShops.map(sh => (
                  <option key={sh.id} value={sh.id}>
                    {sh.name}
                  </option>
                ))}
            </select>
          </div>

          {filteredStores.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl py-14 px-4 text-center">
              <Warehouse className="w-10 h-10 mx-auto text-slate-600 mb-2.5" />
              <h3 className="text-sm font-semibold text-white">No Stores Created Yet</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                Create warehouse stores and assign them to any shop. One shop can have multiple stores for separate storage locations.
              </p>
              <button
                type="button"
                onClick={openCreateStoreModal}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition"
              >
                <Plus className="w-4 h-4" />
                <span>Create First Store</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredStores.map(store => {
                const shop = accessibleShops.find(s => s.id === store.shopId);
                const storeStockedProducts = accessibleProducts.filter(
                  p => p.shopId === store.shopId && getProductQtyInStore(p, store) > 0
                );
                const storeTotalUnits = storeStockedProducts.reduce(
                  (sum, p) => sum + getProductQtyInStore(p, store),
                  0
                );
                const isActive = store.status === 'ACTIVE';

                return (
                  <div
                    key={store.id}
                    className={`bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 ${
                      !isActive ? 'opacity-65' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-slate-950 border border-slate-800 text-blue-400 flex items-center justify-center shrink-0">
                          <Warehouse className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <h3 className="text-sm font-bold text-white truncate">
                              {store.name}
                            </h3>
                            {store.isShopFloor && (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[9px] font-bold">
                                POS Floor
                              </span>
                            )}
                          </div>
                          <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-slate-400 mt-0.5">
                            <span className="inline-flex items-center gap-1 text-slate-300">
                              <StoreIcon className="w-3 h-3 text-slate-500" />
                              {shop?.name || 'Unknown Shop'}
                            </span>
                            {store.location && (
                              <span className="inline-flex items-center gap-1 text-slate-400">
                                <span>·</span>
                                <MapPin className="w-3 h-3 text-slate-500" />
                                {store.location}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <span
                        className={`text-[11px] font-semibold ${
                          isActive ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs bg-slate-950/70 border border-slate-800/80 rounded-lg p-2.5">
                      <div>
                        <div className="text-[10px] text-slate-500">Store SKUs</div>
                        <div className="font-mono font-semibold text-white tabular-nums mt-0.5">
                          {storeStockedProducts.length}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-500">Total Units</div>
                        <div className="font-mono font-semibold text-blue-400 tabular-nums mt-0.5">
                          {storeTotalUnits.toLocaleString()}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center flex-wrap gap-2 pt-1 border-t border-slate-800/80 text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedInventoryStoreId(store.id);
                          setInvStockedOnly(true);
                          setActiveSubTab('inventory');
                        }}
                        className="flex-1 min-w-[110px] flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-300 font-semibold transition"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>View Inventory</span>
                      </button>
                      {isActive && (
                        <button
                          type="button"
                          onClick={() => openImportModal(store.id)}
                          className="flex items-center justify-center gap-1 py-2 px-3 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/25 font-semibold transition"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          <span>Import</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleExportStoreExcel(store)}
                        className="flex items-center justify-center gap-1 py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold transition"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Export</span>
                      </button>
                      {isActive && !store.isShopFloor && (
                        <button
                          type="button"
                          onClick={() => {
                            handleSourceStoreChange(store.id);
                            setActiveSubTab('transfer');
                          }}
                          className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-blue-600/15 hover:bg-blue-600/25 text-blue-300 font-semibold transition"
                        >
                          <ArrowRightLeft className="w-3.5 h-3.5" />
                          <span>Transfer</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openEditStoreModal(store)}
                        className="flex items-center justify-center gap-1 py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold transition"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingStore(store)}
                        className="flex items-center justify-center gap-1 py-2 px-3 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/20 font-semibold transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 2: STORE INVENTORY BROWSER */}
      {activeSubTab === 'inventory' && (
        <div className="space-y-4">
          {/* Store Filter & Search */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2.5 text-xs">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1">
                  Select Store View
                </label>
                <select
                  value={selectedInventoryStoreId}
                  onChange={e => setSelectedInventoryStoreId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="ALL_COMBINED">
                    All Stores (Grouped by Store)
                  </option>
                  {accessibleStores.map(st => {
                    const sh = accessibleShops.find(s => s.id === st.shopId);
                    return (
                      <option key={st.id} value={st.id}>
                        {st.name}
                        {st.isShopFloor ? ' (POS Floor)' : ''} — {sh?.name || 'Shop'}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1">
                  Category Filter
                </label>
                <select
                  value={invCategoryFilter}
                  onChange={e => setInvCategoryFilter(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="ALL">All Categories</option>
                  {accessibleCategories.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-slate-400 uppercase mb-1">
                  Search Product / Variation / Custom Field
                </label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={invSearch}
                    onChange={e => setInvSearch(e.target.value)}
                    placeholder="Name, SKU, variation, custom field..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/70">
              <div className="flex items-center gap-2 flex-wrap">
                {selectedInventoryStore ? (
                  <span className="text-[11px] text-slate-400">
                    Viewing{' '}
                    <strong className="text-white">{selectedInventoryStore.name}</strong>
                    {selectedInventoryStore.isShopFloor ? ' (POS Sellable Floor)' : ' (Warehouse)'}
                  </span>
                ) : (
                  <span className="text-[11px] text-slate-400">
                    Grouped by store across {inventoryStoreGroups.length} store(s)
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setInvStockedOnly(v => !v)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
                    invStockedOnly
                      ? 'bg-blue-600/20 border-blue-500/40 text-blue-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  {invStockedOnly ? 'Stocked Here Only' : 'Show All Shop Items'}
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openImportModal(selectedInventoryStore?.id)}
                  disabled={activeStores.length === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 text-[11px] font-semibold transition disabled:opacity-45"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Import Excel</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportInventoryExcel}
                  disabled={inventoryProducts.length === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-300 text-[11px] font-semibold transition disabled:opacity-45"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>
                    Export Excel{selectedInventoryStore ? ` (${selectedInventoryStore.name})` : ''}
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* Legacy unmapped multi-store notice */}
          {productStoreQtyCache.hasFallbackMultiStoreAttribution && (
            <div className="bg-amber-950/30 border border-amber-500/30 rounded-xl px-3.5 py-2.5 flex items-start gap-2.5 text-[11px] text-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>
                Some synced items did not have a per-store tag and are temporarily displayed under each shop&apos;s primary store so all units remain visible. Click or hold any product to <strong>Edit</strong> store quantities or <strong>Transfer</strong> stock.
              </span>
            </div>
          )}

          {/* Store-Scoped Inventory KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <div className="text-[10px] text-slate-400 font-semibold uppercase">SKUs</div>
              <div className="text-base sm:text-lg font-bold text-white font-mono tabular-nums mt-0.5">
                {inventoryTotals.skuCount}
              </div>
              <div className="text-[10px] text-slate-500 font-mono tabular-nums">
                {inventoryTotals.totalUnits.toLocaleString()} units
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <div className="text-[10px] text-slate-400 font-semibold uppercase">Cost Value</div>
              <div className="text-sm sm:text-base font-bold text-purple-300 font-mono tabular-nums mt-0.5 truncate">
                {formatCurrency(inventoryTotals.totalCostValue, settings.currencySymbol)}
              </div>
              <div className="text-[10px] text-slate-500">Purchase basis</div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <div className="text-[10px] text-slate-400 font-semibold uppercase">Sale Value</div>
              <div className="text-sm sm:text-base font-bold text-blue-300 font-mono tabular-nums mt-0.5 truncate">
                {formatCurrency(inventoryTotals.totalSaleValue, settings.currencySymbol)}
              </div>
              <div className="text-[10px] text-slate-500">Retail basis</div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <div className="text-[10px] text-slate-400 font-semibold uppercase">Potential Profit</div>
              <div className="text-sm sm:text-base font-bold text-emerald-400 font-mono tabular-nums mt-0.5 truncate">
                {formatCurrency(inventoryTotals.potentialProfit, settings.currencySymbol)}
              </div>
              <div className="text-[10px] text-slate-500">Est. margin</div>
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-400 px-0.5">
            <span>Tip: Click or press &amp; hold any product card to Edit, Transfer, or Delete.</span>
            <span className="font-mono tabular-nums text-slate-500">
              {inventoryStoreGroups.length} store{inventoryStoreGroups.length === 1 ? '' : 's'}
            </span>
          </div>

          {/* Per-Store Grouped Inventory Sections (15 items per store + See More) */}
          {inventoryStoreGroups.length === 0 || inventoryProducts.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl py-12 px-4 text-center">
              <Package className="w-10 h-10 mx-auto text-slate-600 mb-2" />
              <p className="text-sm font-semibold text-white">No Products Found</p>
              <p className="text-xs text-slate-400 mt-1">
                Try clearing search/category filters or importing store stock in Data Management.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {inventoryStoreGroups.map(group => {
                const { store: st, shopName, products: storeProducts } = group;
                const isCollapsed = !!collapsedInvStores[st.id];
                const visibleCount = invVisibleCounts[st.id] ?? STORE_PAGE_SIZE;
                const visibleProducts = storeProducts.slice(0, visibleCount);
                const remaining = Math.max(0, storeProducts.length - visibleCount);

                return (
                  <div
                    key={st.id}
                    className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg"
                  >
                    {/* Store Inventory Group Header */}
                    <button
                      type="button"
                      onClick={() =>
                        setCollapsedInvStores(prev => ({
                          ...prev,
                          [st.id]: !prev[st.id],
                        }))
                      }
                      className="w-full flex items-center justify-between gap-2.5 p-3.5 bg-slate-950/60 hover:bg-slate-900/90 border-b border-slate-800 transition text-left"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`p-2 rounded-xl border shrink-0 ${
                            st.isShopFloor
                              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                              : 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                          }`}
                        >
                          {st.isShopFloor ? (
                            <StoreIcon className="w-4 h-4" />
                          ) : (
                            <Warehouse className="w-4 h-4" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-bold text-white truncate">
                              {st.name} Inventory
                            </h3>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${
                                st.isShopFloor
                                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                                  : 'bg-blue-500/15 border-blue-500/30 text-blue-300'
                              }`}
                            >
                              {st.isShopFloor ? 'Shop Floor' : 'Store'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                            {shopName}
                            {st.location ? ` · ${st.location}` : ''} ·{' '}
                            <span className="font-mono text-slate-300">
                              {storeProducts.length.toLocaleString()} SKU{storeProducts.length === 1 ? '' : 's'}
                            </span>{' '}
                            ·{' '}
                            <span className="font-mono text-blue-300 font-semibold">
                              {group.totalUnits.toLocaleString()} units
                            </span>
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <div className="hidden sm:block text-right font-mono tabular-nums">
                          <div className="text-[10px] text-slate-400">Store Sale Value</div>
                          <div className="text-xs font-semibold text-emerald-400">
                            {formatCurrency(group.totalSaleValue, settings.currencySymbol)}
                          </div>
                        </div>
                        {isCollapsed ? (
                          <ChevronRight className="w-5 h-5 text-slate-400" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-slate-400" />
                        )}
                      </div>
                    </button>

                    {!isCollapsed && (
                      <>
                        {storeProducts.length === 0 ? (
                          <div className="py-8 px-4 text-center text-xs text-slate-500">
                            No stocked products in {st.name}.
                          </div>
                        ) : (
                          <div className="divide-y divide-slate-800/80">
                            {visibleProducts.map(product => {
                              const cat = accessibleCategories.find(c => c.id === product.categoryId);
                              const storeQty = getProductQtyInStore(product, st);
                              const detail = product.storeDetails?.[st.id];
                              const costVal =
                                detail?.importedPurchaseValue !== undefined
                                  ? detail.importedPurchaseValue
                                  : storeQty * (product.purchasePrice || 0);
                              const saleVal =
                                detail?.importedSaleValue !== undefined
                                  ? detail.importedSaleValue
                                  : storeQty * (product.sellingPrice || 0);

                              const customEntries = product.customFields
                                ? [
                                    product.customFields.field1 && `CF1: ${product.customFields.field1}`,
                                    product.customFields.field2 && `CF2: ${product.customFields.field2}`,
                                    product.customFields.field3 && `CF3: ${product.customFields.field3}`,
                                    product.customFields.field4 && `CF4: ${product.customFields.field4}`,
                                  ].filter(Boolean) as string[]
                                : [];

                              const hasHistorical =
                                (product.historicalUnitsSold || 0) > 0 ||
                                (product.historicalUnitsTransferred || 0) > 0 ||
                                (product.historicalUnitsAdjusted || 0) > 0;

                              return (
                                <div
                                  key={`${st.id}-${product.id}`}
                                  role="button"
                                  tabIndex={0}
                                  onPointerDown={e => handleInventoryCardPointerDown(e, product, st)}
                                  onPointerMove={handleInventoryCardPointerMove}
                                  onPointerUp={handleInventoryCardPointerEnd}
                                  onPointerCancel={handleInventoryCardPointerEnd}
                                  onPointerLeave={handleInventoryCardPointerEnd}
                                  onClick={() => handleInventoryCardClick(product, st)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      setActionStoreContext(st);
                                      setActionProduct(product);
                                    }
                                  }}
                                  className="p-3.5 space-y-2.5 text-xs hover:bg-slate-800/35 active:bg-slate-800/60 cursor-pointer select-none transition"
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <h4 className="font-bold text-white text-sm truncate">
                                          {product.name}
                                        </h4>
                                        {product.variation && (
                                          <span className="px-2 py-0.5 rounded bg-violet-500/15 border border-violet-500/30 text-violet-300 text-[10px] font-semibold inline-flex items-center gap-1">
                                            <Layers className="w-3 h-3" />
                                            {product.variation}
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-2 flex-wrap text-[11px] text-slate-400 mt-1">
                                        <span className="font-mono">SKU: {product.sku}</span>
                                        {cat && (
                                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">
                                            <Tag className="w-2.5 h-2.5" />
                                            {cat.name}
                                          </span>
                                        )}
                                        {customEntries.map((cf, idx) => (
                                          <span
                                            key={idx}
                                            className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-400 text-[10px]"
                                          >
                                            {cf}
                                          </span>
                                        ))}
                                      </div>
                                    </div>

                                    <div className="flex items-start gap-2 shrink-0">
                                      <div className="text-right">
                                        <div className="text-[10px] text-slate-400">
                                          {st.name}
                                        </div>
                                        <div className="text-base font-bold font-mono tabular-nums text-blue-400">
                                          {storeQty.toLocaleString()} {product.unit}
                                        </div>
                                      </div>
                                      <button
                                        type="button"
                                        aria-label={`Actions for ${product.name}`}
                                        onPointerDown={e => e.stopPropagation()}
                                        onClick={e => {
                                          e.stopPropagation();
                                          setActionStoreContext(st);
                                          setActionProduct(product);
                                        }}
                                        className="p-1.5 rounded-lg bg-slate-950/70 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white transition"
                                      >
                                        <MoreVertical className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </div>

                                  {/* Prices & Valuations */}
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-950/60 border border-slate-800/80 rounded-lg p-2 text-[11px]">
                                    <div>
                                      <span className="text-slate-500 block text-[10px]">Buy Price</span>
                                      <span className="font-mono text-slate-300">
                                        {formatCurrency(product.purchasePrice, settings.currencySymbol)}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-slate-500 block text-[10px]">Sell Price</span>
                                      <span className="font-mono font-semibold text-white">
                                        {formatCurrency(product.sellingPrice, settings.currencySymbol)}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-slate-500 block text-[10px]">Cost Value</span>
                                      <span className="font-mono text-purple-300">
                                        {formatCurrency(costVal, settings.currencySymbol)}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-slate-500 block text-[10px]">Sale Value</span>
                                      <span className="font-mono font-semibold text-emerald-400">
                                        {formatCurrency(saleVal, settings.currencySymbol)}
                                      </span>
                                    </div>
                                  </div>

                                  {/* Isolated Historical Reference Metadata */}
                                  {hasHistorical && (
                                    <div className="flex items-center justify-between flex-wrap gap-2 px-2.5 py-1.5 rounded-lg bg-amber-950/20 border border-amber-500/20 text-[10px] text-amber-200/90">
                                      <span className="inline-flex items-center gap-1 font-semibold">
                                        <History className="w-3 h-3 text-amber-400" />
                                        {product.historicalNote || 'Historical date unavailable'}
                                      </span>
                                      <span className="font-mono tabular-nums">
                                        Sold: {product.historicalUnitsSold || 0} · Transferred:{' '}
                                        {product.historicalUnitsTransferred || 0} · Adjusted:{' '}
                                        {product.historicalUnitsAdjusted || 0}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Pagination Footer matching Products & Categories (15 items + See More) */}
                        {storeProducts.length > STORE_PAGE_SIZE && (
                          <div className="p-3 bg-slate-950/40 border-t border-slate-800/80 space-y-2">
                            <div className="text-[10px] text-slate-500 text-center">
                              Showing{' '}
                              <span className="text-slate-300 font-semibold">
                                {Math.min(visibleCount, storeProducts.length).toLocaleString()}
                              </span>{' '}
                              of{' '}
                              <span className="text-slate-300 font-semibold">
                                {storeProducts.length.toLocaleString()}
                              </span>{' '}
                              products in {st.name}
                            </div>
                            <div className="flex items-center gap-2">
                              {visibleCount > STORE_PAGE_SIZE && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setInvVisibleCounts(prev => ({
                                      ...prev,
                                      [st.id]: STORE_PAGE_SIZE,
                                    }))
                                  }
                                  className="flex-1 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-300 text-[11px] font-semibold transition"
                                >
                                  Show Less
                                </button>
                              )}
                              {remaining > 0 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setInvVisibleCounts(prev => ({
                                      ...prev,
                                      [st.id]: (prev[st.id] ?? STORE_PAGE_SIZE) + STORE_PAGE_SIZE,
                                    }))
                                  }
                                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-[11px] font-semibold shadow transition"
                                >
                                  <ChevronDown className="w-3.5 h-3.5" />
                                  <span>See More ({Math.min(STORE_PAGE_SIZE, remaining)})</span>
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 3: TRANSFER STOCK (STORE -> SHOP FLOOR) */}
      {activeSubTab === 'transfer' && (
        <div className="space-y-5">
          {transferableStores.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl py-12 px-4 text-center">
              <Warehouse className="w-10 h-10 mx-auto text-slate-600 mb-2.5" />
              <h3 className="text-sm font-semibold text-white">No Active Warehouse Stores Available</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                Create an active warehouse store (not a POS floor store) before transferring stock onto the shop floor.
              </p>
              <button
                type="button"
                onClick={openCreateStoreModal}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition"
              >
                <Plus className="w-4 h-4" />
                <span>Create Store</span>
              </button>
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5">
              <div className="flex items-center gap-2 pb-3 border-b border-slate-800 mb-4">
                <ArrowRightLeft className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-bold text-white">
                  Transfer Stock from Store to Shop Floor
                </h3>
              </div>

              {transferError && (
                <div className="mb-4 p-3 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{transferError}</span>
                </div>
              )}

              <form onSubmit={handleSubmitTransfer} className="space-y-4 text-xs">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {/* 1. Source Store */}
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Select Store (Source) *
                    </label>
                    <select
                      value={effectiveSourceStoreId}
                      onChange={e => handleSourceStoreChange(e.target.value)}
                      required
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      {transferableStores.map(st => {
                        const sh = accessibleShops.find(s => s.id === st.shopId);
                        return (
                          <option key={st.id} value={st.id}>
                            {st.name} ({sh?.name || 'Shop'})
                            {st.location ? ` · ${st.location}` : ''}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  {/* 2. Destination Shop */}
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Select Destination Shop *
                    </label>
                    <select
                      value={effectiveDestShopId}
                      onChange={e => setDestShopId(e.target.value)}
                      required
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      {accessibleShops.map(sh => (
                        <option key={sh.id} value={sh.id}>
                          {sh.name} ({sh.code || 'UNIT'})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* 3. Live Search & Multi-Select Checkboxes (1 to 1,000 products at once) */}
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="block text-slate-300 font-medium">
                      Search &amp; Select Products to Transfer *
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setTransferStockedOnly(v => !v);
                          setTransferVisibleLimit(STORE_PAGE_SIZE);
                        }}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
                          transferStockedOnly
                            ? 'bg-blue-600/20 border-blue-500/40 text-blue-300'
                            : 'bg-slate-950 border-slate-800 text-slate-400'
                        }`}
                      >
                        {transferStockedOnly ? 'In Stock Only' : 'Include Out-of-Stock'}
                      </button>
                      <span className="text-[11px] font-mono tabular-nums text-blue-300">
                        {transferSelectionSummary.selectedCount.toLocaleString()} / 1,000 selected
                      </span>
                    </div>
                  </div>

                  {/* Single-letter responsive search bar */}
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      value={productSearch}
                      onChange={e => {
                        setProductSearch(e.target.value);
                        setTransferVisibleLimit(STORE_PAGE_SIZE);
                      }}
                      placeholder="Type 1 or more letters to search by name, SKU, variation, or barcode..."
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-9 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    {productSearch && (
                      <button
                        type="button"
                        onClick={() => {
                          setProductSearch('');
                          setTransferVisibleLimit(STORE_PAGE_SIZE);
                        }}
                        aria-label="Clear search"
                        className="absolute right-2.5 top-2 p-0.5 rounded text-slate-400 hover:text-white"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {/* Search Results Checklist */}
                  <div className="bg-slate-950/70 border border-slate-800 rounded-xl overflow-hidden">
                    <div className="px-3 py-2 bg-slate-950 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <span className="text-slate-400">
                        {productSearch.trim() ? (
                          <>
                            Found <strong className="text-white">{storeScopedProducts.length.toLocaleString()}</strong> match
                            {storeScopedProducts.length === 1 ? '' : 'es'} for &ldquo;{productSearch.trim()}&rdquo;
                          </>
                        ) : (
                          <>
                            Showing <strong className="text-white">{storeScopedProducts.length.toLocaleString()}</strong> product
                            {storeScopedProducts.length === 1 ? '' : 's'} in {selectedSourceStore?.name || 'store'}
                          </>
                        )}
                      </span>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={handleSelectAllMatchingProducts}
                          disabled={storeScopedProducts.length === 0}
                          className="px-2.5 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 font-semibold transition disabled:opacity-40"
                        >
                          Tick Matching
                        </button>
                        {storeScopedProducts.some(p => p.id in selectedTransferMap) && (
                          <button
                            type="button"
                            onClick={handleDeselectMatchingProducts}
                            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition"
                          >
                            Untick Matching
                          </button>
                        )}
                      </div>
                    </div>

                    {storeScopedProducts.length === 0 ? (
                      <div className="py-8 px-4 text-center text-slate-500 text-xs">
                        {productSearch.trim()
                          ? `No products matching "${productSearch.trim()}" in ${selectedSourceStore?.name || 'this store'}.`
                          : `No stocked products available in ${selectedSourceStore?.name || 'this store'}.`}
                      </div>
                    ) : (
                      <div className="max-h-72 overflow-y-auto divide-y divide-slate-800/70">
                        {storeScopedProducts.slice(0, transferVisibleLimit).map(p => {
                          const qtyHere = selectedSourceStore
                            ? getProductQtyInStore(p, selectedSourceStore)
                            : Number(p.storeStock || 0);
                          const isChecked = p.id in selectedTransferMap;
                          const enteredStr = selectedTransferMap[p.id] ?? '';
                          const enteredNum = Number(enteredStr);
                          const rowExceeds =
                            isChecked && Number.isFinite(enteredNum) && enteredNum > qtyHere;
                          const rowInvalid =
                            isChecked && (!Number.isFinite(enteredNum) || enteredNum <= 0);

                          return (
                            <div
                              key={p.id}
                              onClick={() => handleToggleTransferProduct(p)}
                              className={`px-3 py-2.5 flex items-center justify-between gap-2.5 cursor-pointer transition ${
                                isChecked
                                  ? 'bg-blue-600/10 hover:bg-blue-600/15'
                                  : qtyHere <= 0
                                    ? 'opacity-55 hover:bg-slate-900/60'
                                    : 'hover:bg-slate-900/80'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  disabled={!isChecked && qtyHere <= 0}
                                  onChange={() => {}}
                                  onClick={e => {
                                    e.stopPropagation();
                                    handleToggleTransferProduct(p);
                                  }}
                                  className="w-4 h-4 rounded border-slate-600 bg-slate-900 text-blue-600 focus:ring-blue-500 shrink-0 cursor-pointer"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-semibold text-white truncate">
                                      {p.name}
                                    </span>
                                    {p.variation && (
                                      <span className="px-1.5 py-0.5 rounded bg-violet-500/15 border border-violet-500/30 text-violet-300 text-[10px]">
                                        {p.variation}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-slate-400 font-mono mt-0.5 truncate">
                                    SKU: {p.sku} · Store:{' '}
                                    <strong className={qtyHere > 0 ? 'text-blue-300' : 'text-rose-400'}>
                                      {qtyHere.toLocaleString()} {p.unit}
                                    </strong>{' '}
                                    · Floor: {Number(p.currentStock || 0).toLocaleString()} {p.unit}
                                  </div>
                                </div>
                              </div>

                              {isChecked ? (
                                <div
                                  onClick={e => e.stopPropagation()}
                                  className="flex items-center gap-1.5 shrink-0"
                                >
                                  <input
                                    type="number"
                                    min="1"
                                    max={qtyHere > 0 ? qtyHere : undefined}
                                    inputMode="numeric"
                                    value={enteredStr}
                                    onChange={e =>
                                      handleChangeSelectedTransferQty(p.id, e.target.value)
                                    }
                                    aria-label={`Transfer quantity for ${p.name}`}
                                    className={`w-20 bg-slate-900 border rounded-lg px-2 py-1.5 text-right text-xs font-mono text-white focus:outline-none focus:ring-1 ${
                                      rowExceeds || rowInvalid
                                        ? 'border-rose-500 focus:ring-rose-500'
                                        : 'border-blue-500/60 focus:ring-blue-500'
                                    }`}
                                  />
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleChangeSelectedTransferQty(p.id, String(qtyHere))
                                    }
                                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-semibold text-blue-300"
                                  >
                                    Max
                                  </button>
                                </div>
                              ) : (
                                <span className="text-[10px] font-mono text-slate-500 shrink-0">
                                  {qtyHere > 0 ? `${qtyHere.toLocaleString()} avail` : '0 avail'}
                                </span>
                              )}
                            </div>
                          );
                        })}

                        {storeScopedProducts.length > STORE_PAGE_SIZE && (
                          <div className="p-2.5 bg-slate-950 border-t border-slate-800/80 space-y-1.5">
                            <div className="text-[10px] text-slate-500 text-center">
                              Showing{' '}
                              <span className="text-slate-300 font-semibold">
                                {Math.min(transferVisibleLimit, storeScopedProducts.length).toLocaleString()}
                              </span>{' '}
                              of{' '}
                              <span className="text-slate-300 font-semibold">
                                {storeScopedProducts.length.toLocaleString()}
                              </span>{' '}
                              products
                            </div>
                            <div className="flex items-center gap-2">
                              {transferVisibleLimit > STORE_PAGE_SIZE && (
                                <button
                                  type="button"
                                  onClick={() => setTransferVisibleLimit(STORE_PAGE_SIZE)}
                                  className="flex-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold transition"
                                >
                                  Show Less
                                </button>
                              )}
                              {storeScopedProducts.length > transferVisibleLimit && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setTransferVisibleLimit(v => v + STORE_PAGE_SIZE)
                                  }
                                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold transition"
                                >
                                  <ChevronDown className="w-3.5 h-3.5" />
                                  <span>
                                    See More (
                                    {Math.min(
                                      STORE_PAGE_SIZE,
                                      storeScopedProducts.length - transferVisibleLimit
                                    )}
                                    )
                                  </span>
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* 4. Selected Products Queue (Persists across multiple searches, 1 to 1,000 items) */}
                {selectedTransferEntries.length > 0 && (() => {
                  const qSel = selectedQueueFilter.trim().toLowerCase();
                  const filteredSelected = qSel
                    ? selectedTransferEntries.filter(
                        entry =>
                          entry.product.name.toLowerCase().includes(qSel) ||
                          (entry.product.sku || '').toLowerCase().includes(qSel) ||
                          (entry.product.variation || '').toLowerCase().includes(qSel)
                      )
                    : selectedTransferEntries;

                  return (
                    <div className="bg-blue-950/20 border border-blue-500/30 rounded-xl overflow-hidden">
                      <div className="px-3.5 py-2.5 bg-slate-950/90 border-b border-blue-500/20 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-bold text-white">
                            Selected Products to Transfer ({transferSelectionSummary.selectedCount.toLocaleString()} / 1,000)
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                            Total units: <strong className="text-emerald-400">{transferSelectionSummary.totalUnits.toLocaleString()}</strong>
                            {transferSelectionSummary.invalidCount > 0 && (
                              <span className="text-rose-400 ml-2">
                                · {transferSelectionSummary.invalidCount} need valid qty
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min="1"
                              value={bulkTransferQty}
                              onChange={e => setBulkTransferQty(e.target.value)}
                              placeholder="Qty"
                              className="w-16 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-[11px] font-mono text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                            <button
                              type="button"
                              onClick={handleApplyBulkQtyToSelected}
                              className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold transition"
                            >
                              Apply All
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={handleFillMaxAllSelected}
                            className="px-2.5 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 text-[11px] font-semibold transition"
                          >
                            All Max
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedTransferMap({});
                              setSelectedQueueFilter('');
                              setTransferError('');
                            }}
                            className="px-2.5 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-[11px] font-semibold transition"
                          >
                            Clear All
                          </button>
                        </div>
                      </div>

                        {selectedTransferEntries.length > 10 && (
                        <div className="px-3 py-2 border-b border-slate-800/70 bg-slate-950/60">
                          <input
                            type="text"
                            value={selectedQueueFilter}
                            onChange={e => {
                              setSelectedQueueFilter(e.target.value);
                              setSelectedQueueVisibleLimit(STORE_PAGE_SIZE);
                            }}
                            placeholder="Filter inside selected products..."
                            className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-[11px] text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                      )}

                      <div className="max-h-64 overflow-y-auto divide-y divide-slate-800/60">
                        {filteredSelected.slice(0, selectedQueueVisibleLimit).map(entry => (
                          <div
                            key={entry.product.id}
                            className="px-3 py-2 flex items-center justify-between gap-2 text-xs"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="font-semibold text-white truncate">
                                {entry.product.name}
                                {entry.product.variation ? ` (${entry.product.variation})` : ''}
                              </div>
                              <div className="text-[10px] text-slate-400 font-mono">
                                {entry.product.sku} · Avail: {entry.available.toLocaleString()}{' '}
                                {entry.product.unit || 'pcs'}
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <input
                                type="number"
                                min="1"
                                max={entry.available > 0 ? entry.available : undefined}
                                inputMode="numeric"
                                value={entry.qtyStr}
                                onChange={e =>
                                  handleChangeSelectedTransferQty(entry.product.id, e.target.value)
                                }
                                className={`w-20 bg-slate-900 border rounded-lg px-2 py-1 text-right text-xs font-mono text-white focus:outline-none focus:ring-1 ${
                                  entry.isExceeding || entry.isInvalidQty
                                    ? 'border-rose-500 focus:ring-rose-500'
                                    : 'border-slate-700 focus:ring-blue-500'
                                }`}
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  handleChangeSelectedTransferQty(
                                    entry.product.id,
                                    String(entry.available)
                                  )
                                }
                                className="px-1.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-semibold text-blue-300"
                              >
                                Max
                              </button>
                              <button
                                type="button"
                                aria-label={`Remove ${entry.product.name}`}
                                onClick={() =>
                                  setSelectedTransferMap(prev => {
                                    const next = { ...prev };
                                    delete next[entry.product.id];
                                    return next;
                                  })
                                }
                                className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}

                        {filteredSelected.length > STORE_PAGE_SIZE && (
                          <div className="p-2 bg-slate-950/70 flex items-center gap-2">
                            {selectedQueueVisibleLimit > STORE_PAGE_SIZE && (
                              <button
                                type="button"
                                onClick={() => setSelectedQueueVisibleLimit(STORE_PAGE_SIZE)}
                                className="flex-1 px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold"
                              >
                                Show Less
                              </button>
                            )}
                            {filteredSelected.length > selectedQueueVisibleLimit && (
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedQueueVisibleLimit(v => v + STORE_PAGE_SIZE)
                                }
                                className="flex-1 flex items-center justify-center gap-1 px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold"
                              >
                                <ChevronDown className="w-3.5 h-3.5" />
                                <span>
                                  See More (
                                  {Math.min(
                                    STORE_PAGE_SIZE,
                                    filteredSelected.length - selectedQueueVisibleLimit
                                  )}
                                  )
                                </span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* 5. Notes & Transfer Action */}
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Notes (Optional)
                  </label>
                  <input
                    type="text"
                    value={transferNotes}
                    onChange={e => setTransferNotes(e.target.value)}
                    placeholder="e.g. Shelf restock for weekend rush"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="submit"
                    disabled={
                      !effectiveSourceStoreId ||
                      transferSelectionSummary.selectedCount === 0 ||
                      transferSelectionSummary.selectedCount > MAX_BATCH_TRANSFER_PRODUCTS ||
                      transferSelectionSummary.invalidCount > 0
                    }
                    className="w-full sm:w-auto px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition disabled:opacity-45 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      {transferSelectionSummary.selectedCount > 0
                        ? `Transfer ${transferSelectionSummary.selectedCount.toLocaleString()} Product${transferSelectionSummary.selectedCount === 1 ? '' : 's'} (${transferSelectionSummary.totalUnits.toLocaleString()} units)`
                        : 'Select Products Above to Transfer'}
                    </span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Recent Store Transfers — Colored Date Filter + Grouped by Store (15 per store + See More) */}
          <div className="space-y-3">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-blue-400" />
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                    Transferred Stock by Store
                  </h3>
                </div>
                <span className="text-[10px] font-mono text-slate-400">
                  {transferStartDate === transferEndDate
                    ? transferStartDate
                    : `${transferStartDate || '...'} → ${transferEndDate || '...'}`}
                  {' · '}
                  <strong className="text-white">
                    {transferMovementsFiltered.length.toLocaleString()}
                  </strong>{' '}
                  item{transferMovementsFiltered.length === 1 ? '' : 's'}
                </span>
              </div>

              <div className="grid grid-cols-4 gap-1.5">
                {(
                  [
                    {
                      id: 'TODAY',
                      label: 'Today',
                      activeClass:
                        'bg-blue-600 border-blue-500 text-white shadow-md shadow-blue-500/30',
                      idleClass:
                        'bg-blue-500/10 border-blue-500/30 text-blue-300 hover:bg-blue-500/20',
                    },
                    {
                      id: 'WEEKLY',
                      label: 'Weekly',
                      activeClass:
                        'bg-emerald-600 border-emerald-500 text-white shadow-md shadow-emerald-500/30',
                      idleClass:
                        'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20',
                    },
                    {
                      id: 'MONTH',
                      label: 'Month',
                      activeClass:
                        'bg-violet-600 border-violet-500 text-white shadow-md shadow-violet-500/30',
                      idleClass:
                        'bg-violet-500/10 border-violet-500/30 text-violet-300 hover:bg-violet-500/20',
                    },
                    {
                      id: 'CUSTOM',
                      label: 'Custom',
                      activeClass:
                        'bg-amber-500 border-amber-400 text-white shadow-md shadow-amber-500/30',
                      idleClass:
                        'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20',
                    },
                  ] as const
                ).map(preset => {
                  const isActive = transferDatePreset === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setTransferDatePreset(preset.id)}
                      className={`py-2 rounded-lg border text-[11px] font-semibold transition active:scale-95 ${
                        isActive ? preset.activeClass : preset.idleClass
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>

              {transferDatePreset === 'CUSTOM' && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">From</label>
                    <input
                      type="date"
                      value={transferStartDate}
                      onChange={e => setTransferStartDate(e.target.value)}
                      className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white w-full focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block mb-1">To</label>
                    <input
                      type="date"
                      value={transferEndDate}
                      onChange={e => setTransferEndDate(e.target.value)}
                      className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-xs text-white w-full focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </div>
                </div>
              )}
            </div>

            {transferLogsByStore.length === 0 ? (
              <div className="bg-slate-900 border border-slate-800 rounded-xl py-10 text-center text-xs text-slate-500">
                No warehouse stores configured yet.
              </div>
            ) : (
              <div className="space-y-3">
                {transferLogsByStore.map(group => {
                  const isCollapsed = !!collapsedTransferStores[group.storeId];
                  const visibleCount =
                    transferLogVisibleCounts[group.storeId] ?? STORE_PAGE_SIZE;
                  const visibleMovements = group.movements.slice(0, visibleCount);
                  const remaining = Math.max(0, group.movements.length - visibleCount);

                  return (
                    <div
                      key={group.storeId}
                      className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setCollapsedTransferStores(prev => ({
                            ...prev,
                            [group.storeId]: !prev[group.storeId],
                          }))
                        }
                        className="w-full flex items-center justify-between gap-2.5 px-4 py-3 bg-slate-950/60 hover:bg-slate-900/90 border-b border-slate-800 transition text-left"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 shrink-0">
                            <ArrowRightLeft className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <h4 className="text-sm font-bold text-white truncate">
                              {group.title}
                            </h4>
                            <p className="text-[11px] text-slate-400 truncate">
                              {group.shopName} ·{' '}
                              <span className="font-mono text-slate-300">
                                {group.movements.length.toLocaleString()} item
                                {group.movements.length === 1 ? '' : 's'}
                              </span>{' '}
                              ·{' '}
                              <span className="font-mono text-amber-300 font-semibold">
                                {group.totalUnits.toLocaleString()} units moved
                              </span>
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-[10px] font-mono tabular-nums">
                            {group.movements.length.toLocaleString()}
                          </span>
                          {isCollapsed ? (
                            <ChevronRight className="w-5 h-5 text-slate-400" />
                          ) : (
                            <ChevronDown className="w-5 h-5 text-slate-400" />
                          )}
                        </div>
                      </button>

                      {!isCollapsed && (
                        <>
                          {group.movements.length === 0 ? (
                            <div className="py-8 px-4 text-center text-xs text-slate-500">
                              No transfers recorded for {group.store?.name || 'this store'} in the selected period.
                            </div>
                          ) : (
                            <div className="divide-y divide-slate-800/80">
                              {visibleMovements.map(m => {
                                const isIncoming = m.changeQty > 0;
                                return (
                                  <div
                                    key={m.id}
                                    className="px-4 py-3 flex items-center justify-between gap-3 text-xs"
                                  >
                                    <div className="min-w-0 flex-1">
                                      <div className="font-semibold text-white truncate">
                                        {m.productName}
                                      </div>
                                      <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                                        {m.reason}
                                      </div>
                                      <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                                        {formatDateTime(m.createdAt)} · {m.userName}
                                      </div>
                                    </div>
                                    <div className="text-right shrink-0 font-mono tabular-nums">
                                      <div
                                        className={`font-bold ${
                                          isIncoming ? 'text-emerald-400' : 'text-amber-400'
                                        }`}
                                      >
                                        {isIncoming
                                          ? `+${m.changeQty}`
                                          : `-${Math.abs(m.changeQty)}`}
                                      </div>
                                      <div className="text-[10px] text-slate-500">
                                        Bal: {m.newQty}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {group.movements.length > STORE_PAGE_SIZE && (
                            <div className="p-3 bg-slate-950/40 border-t border-slate-800/80 space-y-2">
                              <div className="text-[10px] text-slate-500 text-center">
                                Showing{' '}
                                <span className="text-slate-300 font-semibold">
                                  {Math.min(visibleCount, group.movements.length).toLocaleString()}
                                </span>{' '}
                                of{' '}
                                <span className="text-slate-300 font-semibold">
                                  {group.movements.length.toLocaleString()}
                                </span>{' '}
                                transfers in {group.store?.name || 'store'}
                              </div>
                              <div className="flex items-center gap-2">
                                {visibleCount > STORE_PAGE_SIZE && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setTransferLogVisibleCounts(prev => ({
                                        ...prev,
                                        [group.storeId]: STORE_PAGE_SIZE,
                                      }))
                                    }
                                    className="flex-1 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold transition"
                                  >
                                    Show Less
                                  </button>
                                )}
                                {remaining > 0 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setTransferLogVisibleCounts(prev => ({
                                        ...prev,
                                        [group.storeId]:
                                          (prev[group.storeId] ?? STORE_PAGE_SIZE) +
                                          STORE_PAGE_SIZE,
                                      }))
                                    }
                                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-semibold shadow transition"
                                  >
                                    <ChevronDown className="w-3.5 h-3.5" />
                                    <span>See More ({Math.min(STORE_PAGE_SIZE, remaining)})</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create / Edit Store Modal */}
      {isStoreModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/80 backdrop-blur-sm sm:p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl max-w-md w-full p-4 sm:p-6 shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2">
                <Warehouse className="w-5 h-5 text-blue-400" />
                <h3 className="text-base font-bold text-white">
                  {editingStore ? 'Edit Store' : 'Create Store'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsStoreModalOpen(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {storeFormError && (
              <div className="mb-4 p-3 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{storeFormError}</span>
              </div>
            )}

            <form onSubmit={handleSaveStore} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Shop Assignment *
                </label>
                <select
                  value={storeShopId}
                  onChange={e => setStoreShopId(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="" disabled>
                    Select shop...
                  </option>
                  {accessibleShops.map(sh => (
                    <option key={sh.id} value={sh.id}>
                      {sh.name} ({sh.code || 'UNIT'})
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  A shop can have multiple stores (warehouses).
                </p>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Store Name *
                </label>
                <input
                  type="text"
                  required
                  value={storeName}
                  onChange={e => setStoreName(e.target.value)}
                  placeholder="e.g. Kariakoo Main Store"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Location (Optional)
                </label>
                <input
                  type="text"
                  value={storeLocation}
                  onChange={e => setStoreLocation(e.target.value)}
                  placeholder="e.g. Block C, Ground Floor"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsStoreModalOpen(false)}
                  className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={accessibleShops.length === 0}
                  className="px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition disabled:opacity-50"
                >
                  {editingStore ? 'Save Changes' : 'Create Store'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Store 4-Column Excel Import Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/80 backdrop-blur-sm sm:p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl max-w-lg w-full p-4 sm:p-6 shadow-2xl max-h-[92vh] overflow-y-auto space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="text-base font-bold text-white">Import Excel to Store</h3>
                  <p className="text-[11px] text-slate-400">
                    Accepts: Product Name, Buying Price, Selling Price, Quantity
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isParsingImport || isCommittingImport}
                onClick={() => setIsImportModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1.5">
                  Target Store <span className="text-rose-400">*</span>
                </label>
                <select
                  value={importTargetStoreId}
                  disabled={isParsingImport || isCommittingImport}
                  onChange={e => setImportTargetStoreId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                >
                  <option value="">-- Select a store --</option>
                  {activeStores.map(st => {
                    const sh = accessibleShops.find(s => s.id === st.shopId);
                    return (
                      <option key={st.id} value={st.id}>
                        {st.name}
                        {st.isShopFloor ? ' (POS Floor)' : ''} — {sh?.name || 'Shop'}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1.5">
                  Excel File (.xlsx / .xls / .csv) <span className="text-rose-400">*</span>
                </label>
                <input
                  ref={importFileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  disabled={!importTargetStoreId || isParsingImport || isCommittingImport}
                  onChange={handleStoreExcelFileSelected}
                  className="w-full bg-slate-950 text-xs text-slate-300 file:mr-2 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-emerald-600 file:text-white hover:file:bg-emerald-500 cursor-pointer p-1.5 rounded-xl border border-slate-800 disabled:opacity-40"
                />
                {!importTargetStoreId && (
                  <p className="text-[10px] text-amber-400 mt-1">
                    Select a store above to enable file upload.
                  </p>
                )}
              </div>

              <div className="p-3 bg-blue-950/30 border border-blue-800/40 rounded-xl text-[11px] text-blue-200">
                <strong>Expected Excel Columns:</strong>
                <div className="mt-1 font-mono text-[10px] text-blue-100 overflow-x-auto whitespace-nowrap">
                  Product Name | Buying Price | Selling Price | Quantity
                </div>
              </div>
            </div>

            {(isParsingImport || isCommittingImport) && (
              <ImportProgressBar
                progress={importProgress}
                phaseLabel={isCommittingImport ? 'Importing Products' : undefined}
              />
            )}

            {importParseResult && !isParsingImport && (
              <div className="space-y-3 border-t border-slate-800 pt-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-white truncate">
                    {importFile?.name || 'Spreadsheet'}
                  </span>
                  <span className="text-[11px] text-slate-400 shrink-0">
                    Valid:{' '}
                    <strong className="text-emerald-400">
                      {importParseResult.rows.length.toLocaleString()}
                    </strong>{' '}
                    · Errors:{' '}
                    <strong className="text-rose-400">
                      {importParseResult.errors.length.toLocaleString()}
                    </strong>
                  </span>
                </div>

                {importParseResult.errors.length > 0 && (
                  <div className="p-2.5 bg-rose-950/25 border border-rose-800/40 rounded-xl max-h-32 overflow-y-auto space-y-1 text-[11px] text-rose-200">
                    {importParseResult.errors.slice(0, 50).map((err, i) => (
                      <div key={i}>
                        <span className="font-mono text-[10px] bg-rose-900/60 px-1 py-0.2 rounded mr-1.5">
                          Row {err.rowNumber}
                        </span>
                        {err.message}
                      </div>
                    ))}
                    {importParseResult.errors.length > 50 && (
                      <div className="text-[10px] text-rose-300/80 pt-1 border-t border-rose-900/40">
                        Showing first 50 of {importParseResult.errors.length.toLocaleString()} errors.
                      </div>
                    )}
                  </div>
                )}

                {importParseResult.rows.length > 0 && (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {importParseResult.rows.slice(0, 15).map((r, idx) => (
                      <div
                        key={idx}
                        className="p-2 rounded-lg bg-slate-950 border border-slate-800 text-xs flex items-center justify-between gap-2"
                      >
                        <span className="font-semibold text-white truncate">{r.productName}</span>
                        <span className="text-[11px] font-mono text-slate-400 shrink-0">
                          Buy {r.buyingPrice.toLocaleString()} ·{' '}
                          <strong className="text-emerald-400">{r.sellingPrice.toLocaleString()}</strong> · Qty{' '}
                          <strong className="text-blue-300">{r.quantity}</strong>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="pt-2 border-t border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                disabled={isParsingImport || isCommittingImport}
                onClick={() => setIsImportModalOpen(false)}
                className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition disabled:opacity-45 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCommitStoreExcelImport}
                disabled={
                  isParsingImport ||
                  isCommittingImport ||
                  !importTargetStoreId ||
                  !importParseResult ||
                  importParseResult.rows.length === 0
                }
                className="px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition disabled:opacity-45 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {isCommittingImport
                    ? `Importing (${Math.round(importProgress?.percent ?? 0)}%)...`
                    : `Import (${(importParseResult?.rows.length || 0).toLocaleString()}) to ${
                        activeStores.find(s => s.id === importTargetStoreId)?.name || 'Store'
                      }`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Store Delete Confirmation Modal */}
      {deletingStore && (() => {
        const deletingShop = accessibleShops.find(s => s.id === deletingStore.shopId);
        const stockedItems = accessibleProducts.filter(
          p => p.shopId === deletingStore.shopId && getProductQtyInStore(p, deletingStore) > 0
        );
        const stockedUnits = stockedItems.reduce(
          (sum, p) => sum + getProductQtyInStore(p, deletingStore),
          0
        );
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/80 backdrop-blur-sm sm:p-4">
            <div className="bg-slate-900 border border-rose-800/60 rounded-t-2xl sm:rounded-2xl max-w-md w-full p-4 sm:p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2.5 text-rose-400">
                  <div className="p-2 rounded-xl bg-rose-950/80 border border-rose-800/50">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm sm:text-base font-bold text-white">Delete Store?</h3>
                    <p className="text-[11px] text-slate-400">
                      {deletingStore.name}
                      {deletingShop ? ` — ${deletingShop.name}` : ''}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDeletingStore(null)}
                  className="text-slate-400 hover:text-white p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-300 space-y-1.5">
                <p>
                  Are you sure you want to permanently delete{' '}
                  <strong className="text-white">{deletingStore.name}</strong>?
                </p>
                {stockedUnits > 0 ? (
                  <p className="text-amber-300 text-[11px]">
                    This store currently holds{' '}
                    <strong className="font-mono">{stockedUnits.toLocaleString()}</strong> units across{' '}
                    <strong className="font-mono">{stockedItems.length}</strong> product(s).
                    Deleting the store removes its store-level stock count while preserving sales history and shop floor inventory.
                  </p>
                ) : (
                  <p className="text-slate-400 text-[11px]">
                    This action removes the store from Stores &amp; Transfers and queues deletion across synced devices.
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setDeletingStore(null)}
                  className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleConfirmDeleteStore(deletingStore)}
                  className="px-4 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Store</span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Store Inventory Product Click / Hold Action Modal (Edit, Transfer, Delete) */}
      {actionProduct && (() => {
        const shopName = accessibleShops.find(s => s.id === actionProduct.shopId)?.name || 'Shop';
        const effectiveContextStore = actionStoreContext || selectedInventoryStore;
        const contextQty = effectiveContextStore
          ? getProductQtyInStore(actionProduct, effectiveContextStore)
          : getProductTotalTrackedUnits(actionProduct);
        return (
          <div
            onClick={() => {
              setActionProduct(null);
              setActionStoreContext(null);
            }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/80 backdrop-blur-sm sm:p-4"
          >
            <div
              onClick={e => e.stopPropagation()}
              className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl max-w-sm w-full p-4 sm:p-5 shadow-2xl space-y-4"
            >
              <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-800">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-blue-400">
                    {effectiveContextStore ? effectiveContextStore.name : shopName}
                  </div>
                  <h3 className="text-sm sm:text-base font-bold text-white truncate mt-0.5">
                    {actionProduct.name}
                  </h3>
                  <div className="flex items-center gap-2 flex-wrap text-[11px] text-slate-400 mt-1 font-mono">
                    <span>SKU: {actionProduct.sku}</span>
                    <span>·</span>
                    <span className="text-blue-300 font-semibold">
                      {contextQty.toLocaleString()} {actionProduct.unit || 'pcs'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setActionProduct(null);
                    setActionStoreContext(null);
                  }}
                  className="text-slate-400 hover:text-white p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-2 text-xs">
                <button
                  type="button"
                  onClick={() => handleOpenEditProductFromAction(actionProduct)}
                  className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl bg-blue-600/15 hover:bg-blue-600/25 border border-blue-500/30 text-left text-blue-200 transition"
                >
                  <div className="w-9 h-9 rounded-lg bg-blue-600/25 border border-blue-500/40 flex items-center justify-center text-blue-300 shrink-0">
                    <Edit3 className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-white">Edit Product &amp; Stock</div>
                    <div className="text-[11px] text-slate-400">
                      Update name, prices, or per-store quantities
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleOpenTransferFromAction(actionProduct)}
                  className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl bg-emerald-600/15 hover:bg-emerald-600/25 border border-emerald-500/30 text-left text-emerald-200 transition"
                >
                  <div className="w-9 h-9 rounded-lg bg-emerald-600/25 border border-emerald-500/40 flex items-center justify-center text-emerald-300 shrink-0">
                    <ArrowRightLeft className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-white">Transfer Stock</div>
                    <div className="text-[11px] text-slate-400">
                      Move units from store warehouse to shop floor
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const target = actionProduct;
                    setActionProduct(null);
                    setDeletingProduct(target);
                  }}
                  className="w-full flex items-center gap-3 px-3.5 py-3 rounded-xl bg-rose-600/15 hover:bg-rose-600/25 border border-rose-500/30 text-left text-rose-200 transition"
                >
                  <div className="w-9 h-9 rounded-lg bg-rose-600/25 border border-rose-500/40 flex items-center justify-center text-rose-300 shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-white">Delete Product</div>
                    <div className="text-[11px] text-slate-400">
                      Permanently remove this item from catalog &amp; stores
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Edit Product from Store Inventory Modal */}
      {editingProduct && (() => {
        const warehouseStoresInShop = accessibleStores
          .filter(st => st.shopId === editingProduct.shopId && !st.isShopFloor)
          .sort((a, b) => {
            if (selectedInventoryStore?.id === a.id) return -1;
            if (selectedInventoryStore?.id === b.id) return 1;
            return a.name.localeCompare(b.name);
          });
        const shopCategories = accessibleCategories.filter(
          c => c.shopId === editingProduct.shopId
        );

        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/80 backdrop-blur-sm sm:p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl max-w-lg w-full p-4 sm:p-6 shadow-2xl max-h-[92vh] overflow-y-auto">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
                <div className="flex items-center gap-2">
                  <Edit3 className="w-5 h-5 text-blue-400" />
                  <div>
                    <h3 className="text-base font-bold text-white">Edit Store Product</h3>
                    <p className="text-[11px] text-slate-400 truncate max-w-[260px]">
                      {editingProduct.name} ({editingProduct.sku})
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={isSavingProductEdit}
                  onClick={() => setEditingProduct(null)}
                  className="text-slate-400 hover:text-white p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {editProdError && (
                <div className="mb-4 p-3 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{editProdError}</span>
                </div>
              )}

              <form onSubmit={handleSaveEditedProduct} className="space-y-3.5 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Product Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={editProdName}
                      onChange={e => setEditProdName(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Variation
                    </label>
                    <input
                      type="text"
                      value={editProdVariation}
                      onChange={e => setEditProdVariation(e.target.value)}
                      placeholder="e.g. 500ml, Red, 12V"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">SKU *</label>
                    <input
                      type="text"
                      required
                      value={editProdSku}
                      onChange={e => setEditProdSku(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">Unit</label>
                    <input
                      type="text"
                      value={editProdUnit}
                      onChange={e => setEditProdUnit(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-slate-300 font-medium mb-1">Category</label>
                    <select
                      value={editProdCategoryId}
                      onChange={e => setEditProdCategoryId(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      {shopCategories.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Buy Price *
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      required
                      value={editProdPurchasePrice}
                      onChange={e => setEditProdPurchasePrice(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Sell Price *
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      required
                      value={editProdSellingPrice}
                      onChange={e => setEditProdSellingPrice(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Min Alert
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={editProdMinStock}
                      onChange={e => setEditProdMinStock(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl space-y-2.5">
                  <div className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                    Stock Quantities by Store
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {warehouseStoresInShop.map(st => {
                      const isCurrent = selectedInventoryStore?.id === st.id;
                      return (
                        <div key={st.id}>
                          <label
                            className={`block text-[11px] font-medium mb-1 ${
                              isCurrent ? 'text-blue-300 font-semibold' : 'text-slate-400'
                            }`}
                          >
                            {st.name}
                            {isCurrent ? ' (Current)' : ''}
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={editProdStoreQtys[st.id] ?? '0'}
                            onChange={e =>
                              setEditProdStoreQtys(prev => ({
                                ...prev,
                                [st.id]: e.target.value,
                              }))
                            }
                            className={`w-full bg-slate-900 border rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                              isCurrent ? 'border-blue-500/60' : 'border-slate-800'
                            }`}
                          />
                        </div>
                      );
                    })}
                    <div>
                      <label className="block text-[11px] font-medium text-emerald-300 mb-1">
                        Shop Floor (POS Stock)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={editProdFloorStock}
                        onChange={e => setEditProdFloorStock(e.target.value)}
                        className="w-full bg-slate-900 border border-emerald-500/40 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={isSavingProductEdit}
                    onClick={() => setEditingProduct(null)}
                    className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingProductEdit}
                    className="px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition disabled:opacity-50"
                  >
                    {isSavingProductEdit ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* Delete Product from Store Inventory Confirmation Modal */}
      {deletingProduct && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/80 backdrop-blur-sm sm:p-4">
          <div className="bg-slate-900 border border-rose-800/60 rounded-t-2xl sm:rounded-2xl max-w-md w-full p-4 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5 text-rose-400">
                <div className="p-2 rounded-xl bg-rose-950/80 border border-rose-800/50">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-white">Delete Product?</h3>
                  <p className="text-[11px] text-slate-400 font-mono">
                    SKU: {deletingProduct.sku}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeletingProduct(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-300 space-y-1.5">
              <p>
                Are you sure you want to permanently delete{' '}
                <strong className="text-white">{deletingProduct.name}</strong>?
              </p>
              <p className="text-amber-300 text-[11px]">
                Tracked stock: <strong className="font-mono">{getProductTotalTrackedUnits(deletingProduct).toLocaleString()}</strong>{' '}
                {deletingProduct.unit || 'pcs'}. Deleting removes this item from all stores and POS catalog while preserving past receipts.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDeletingProduct(null)}
                className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteProduct}
                className="px-4 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Product</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
