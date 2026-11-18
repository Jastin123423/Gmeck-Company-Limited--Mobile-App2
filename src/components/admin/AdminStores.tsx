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

  // Store Inventory Browser state
  const [selectedInventoryStoreId, setSelectedInventoryStoreId] = useState('ALL_COMBINED');
  const [invSearch, setInvSearch] = useState('');
  const [invCategoryFilter, setInvCategoryFilter] = useState('ALL');
  const [invStockedOnly, setInvStockedOnly] = useState(true);

  // Transfer Stock Form state
  const [sourceStoreId, setSourceStoreId] = useState('');
  const [transferProductId, setTransferProductId] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [transferQty, setTransferQty] = useState('');
  const [destShopId, setDestShopId] = useState('');
  const [transferNotes, setTransferNotes] = useState('');
  const [transferError, setTransferError] = useState('');

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

  // Products belonging to the selected store's shop (with available qty in selected source store first)
  const storeScopedProducts = useMemo(() => {
    const base = accessibleProducts.filter(p => {
      if (selectedSourceStore) return p.shopId === selectedSourceStore.shopId;
      return true;
    });

    const filtered = productSearch.trim()
      ? base.filter(p => {
          const q = productSearch.trim().toLowerCase();
          return (
            p.name.toLowerCase().includes(q) ||
            (p.variation || '').toLowerCase().includes(q) ||
            (p.sku || '').toLowerCase().includes(q) ||
            (p.barcode || '').toLowerCase().includes(q)
          );
        })
      : base;

    return [...filtered].sort((a, b) => {
      const aQty = selectedSourceStore ? getProductQtyInStore(a, selectedSourceStore) : Number(a.storeStock || 0);
      const bQty = selectedSourceStore ? getProductQtyInStore(b, selectedSourceStore) : Number(b.storeStock || 0);
      return bQty - aQty;
    });
  }, [accessibleProducts, selectedSourceStore, productSearch, productStoreQtyCache]);

  const selectedTransferProduct = useMemo(
    () => storeScopedProducts.find(p => p.id === transferProductId) || accessibleProducts.find(p => p.id === transferProductId),
    [storeScopedProducts, accessibleProducts, transferProductId]
  );

  // Recent store transfer & warehouse initial stock movements
  const transferMovements = useMemo(() => {
    return (dbState.movements || [])
      .filter(
        m =>
          (m.type === 'STORE_TRANSFER' || m.type === 'INITIAL_STOCK') &&
          (platformAdmin || accessibleShopIdSet.has(m.shopId))
      )
      .slice(0, 25);
  }, [dbState.movements, platformAdmin, accessibleShopIdSet]);

  // Summary metrics
  const totalStoreStockUnits = useMemo(() => {
    return accessibleProducts.reduce((sum, p) => sum + Number(p.storeStock || 0), 0);
  }, [accessibleProducts]);

  const productsInStoreCount = useMemo(() => {
    return accessibleProducts.filter(p => (p.storeStock || 0) > 0).length;
  }, [accessibleProducts]);

  // Store Inventory Browser derived data
  const selectedInventoryStore = useMemo(
    () =>
      selectedInventoryStoreId === 'ALL_COMBINED'
        ? undefined
        : accessibleStores.find(st => st.id === selectedInventoryStoreId),
    [accessibleStores, selectedInventoryStoreId]
  );

  const inventoryProducts = useMemo(() => {
    return accessibleProducts.filter(p => {
      if (selectedInventoryStore && p.shopId !== selectedInventoryStore.shopId) {
        return false;
      }
      if (invCategoryFilter !== 'ALL' && p.categoryId !== invCategoryFilter) {
        return false;
      }
      if (selectedInventoryStore && invStockedOnly) {
        const qtyHere = getProductQtyInStore(p, selectedInventoryStore);
        const hasDetailsHere = Boolean(p.storeDetails?.[selectedInventoryStore.id]);
        if (qtyHere <= 0 && !hasDetailsHere) return false;
      }
      if (invSearch.trim()) {
        const q = invSearch.trim().toLowerCase();
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
    });
  }, [
    accessibleProducts,
    selectedInventoryStore,
    invCategoryFilter,
    invStockedOnly,
    invSearch,
    productStoreQtyCache,
  ]);

  const inventoryTotals = useMemo(() => {
    let totalUnits = 0;
    let totalCostValue = 0;
    let totalSaleValue = 0;

    for (const p of inventoryProducts) {
      if (selectedInventoryStore) {
        const qty = getProductQtyInStore(p, selectedInventoryStore);
        const detail = p.storeDetails?.[selectedInventoryStore.id];
        totalUnits += qty;
        totalCostValue +=
          detail?.importedPurchaseValue !== undefined
            ? detail.importedPurchaseValue
            : qty * (p.purchasePrice || 0);
        totalSaleValue +=
          detail?.importedSaleValue !== undefined
            ? detail.importedSaleValue
            : qty * (p.sellingPrice || 0);
      } else {
        const qty = getProductTotalTrackedUnits(p);
        totalUnits += qty;
        totalCostValue +=
          p.importedPurchaseValue !== undefined
            ? p.importedPurchaseValue
            : qty * (p.purchasePrice || 0);
        totalSaleValue +=
          p.importedSaleValue !== undefined
            ? p.importedSaleValue
            : qty * (p.sellingPrice || 0);
      }
    }

    return {
      skuCount: inventoryProducts.length,
      totalUnits,
      totalCostValue,
      totalSaleValue,
      potentialProfit: totalSaleValue - totalCostValue,
    };
  }, [inventoryProducts, selectedInventoryStore, accessibleStores, productStoreQtyCache]);

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

  const handleSourceStoreChange = (nextStoreId: string) => {
    setSourceStoreId(nextStoreId);
    const st = activeStores.find(s => s.id === nextStoreId);
    if (st) {
      setDestShopId(st.shopId);
    }
    setTransferProductId('');
    setTransferQty('');
    setTransferError('');
  };

  const availableQtyForSelected =
    selectedTransferProduct && selectedSourceStore
      ? getProductQtyInStore(selectedTransferProduct, selectedSourceStore)
      : Number(selectedTransferProduct?.storeStock || 0);

  const handleSubmitTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    setTransferError('');

    if (!effectiveSourceStoreId) {
      setTransferError('Please select a source store.');
      return;
    }
    if (!transferProductId || !selectedTransferProduct) {
      setTransferError('Please select a product to transfer.');
      return;
    }

    const qty = Number(transferQty);
    const available = availableQtyForSelected;
    if (!Number.isFinite(qty) || qty <= 0) {
      setTransferError('Enter a valid quantity greater than 0.');
      return;
    }
    if (qty > available) {
      setTransferError(
        `Transfer quantity (${qty}) exceeds available store stock (${available} ${selectedTransferProduct.unit || 'pcs'}).`
      );
      return;
    }
    if (!effectiveDestShopId) {
      setTransferError('Please select a destination shop.');
      return;
    }

    const res = StoreService.transferStoreToShop(
      {
        storeId: effectiveSourceStoreId,
        productId: transferProductId,
        shopId: effectiveDestShopId,
        quantity: qty,
        notes: transferNotes.trim() || undefined,
      },
      currentUser
    );

    if (res.success) {
      const destShopName =
        accessibleShops.find(s => s.id === effectiveDestShopId)?.name || 'Shop Floor';
      addToast({
        type: 'success',
        title: 'Stock Transferred to Shop Floor',
        description: `Moved ${qty} ${selectedTransferProduct.unit || 'pcs'} of "${selectedTransferProduct.name}" to ${destShopName}.`,
      });
      setTransferQty('');
      setTransferNotes('');
      setTransferError('');
    } else {
      setTransferError(res.error || 'Transfer failed.');
    }
  };

  const parsedQty = Number(transferQty);
  const isQtyExceeding =
    Boolean(selectedTransferProduct) &&
    Number.isFinite(parsedQty) &&
    parsedQty > availableQtyForSelected;

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
    product: Product
  ) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    clearLongPressTimer();
    longPressTriggeredRef.current = false;
    pointerStartRef.current = { x: e.clientX, y: e.clientY };

    longPressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
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

  const handleInventoryCardClick = (product: Product) => {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    setActionProduct(product);
  };

  const handleOpenEditProductFromAction = (product: Product) => {
    setActionProduct(null);
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
      addToast({
        type: 'warning',
        title: 'No Warehouse Store',
        description:
          'Create an active warehouse store in this shop before transferring stock onto the shop floor.',
      });
      return;
    }

    let bestStore =
      selectedInventoryStore &&
      selectedInventoryStore.shopId === product.shopId &&
      !selectedInventoryStore.isShopFloor &&
      selectedInventoryStore.status === 'ACTIVE'
        ? selectedInventoryStore
        : activeWarehousesInShop[0];

    if (
      !selectedInventoryStore ||
      selectedInventoryStore.isShopFloor ||
      selectedInventoryStore.shopId !== product.shopId
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

    setSourceStoreId(bestStore.id);
    setDestShopId(product.shopId);
    setTransferProductId(product.id);
    setProductSearch('');
    setTransferQty('');
    setTransferError('');
    setActionProduct(null);
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
      if (transferProductId === deletingProduct.id) {
        setTransferProductId('');
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
                    All Stores Combined (Comparison)
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
                  <>
                    <span className="text-[11px] text-slate-400">
                      Viewing{' '}
                      <strong className="text-white">{selectedInventoryStore.name}</strong>
                      {selectedInventoryStore.isShopFloor ? ' (POS Sellable Floor)' : ' (Warehouse)'}
                    </span>
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
                  </>
                ) : (
                  <span className="text-[11px] text-slate-400">
                    Showing combined inventory across {accessibleStores.length} store(s)
                  </span>
                )}
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
              {inventoryProducts.length.toLocaleString()} item{inventoryProducts.length === 1 ? '' : 's'}
            </span>
          </div>

          {/* Inventory List */}
          {inventoryProducts.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-xl py-12 px-4 text-center">
              <Package className="w-10 h-10 mx-auto text-slate-600 mb-2" />
              <p className="text-sm font-semibold text-white">No Products Found</p>
              <p className="text-xs text-slate-400 mt-1">
                Try clearing search/category filters or importing store stock in Data Management.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {inventoryProducts.slice(0, 150).map(product => {
                const cat = accessibleCategories.find(c => c.id === product.categoryId);
                const shopStores = accessibleStores.filter(st => st.shopId === product.shopId);
                const storeQty = selectedInventoryStore
                  ? getProductQtyInStore(product, selectedInventoryStore)
                  : getProductTotalTrackedUnits(product);
                const detail = selectedInventoryStore
                  ? product.storeDetails?.[selectedInventoryStore.id]
                  : undefined;
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
                    key={product.id}
                    role="button"
                    tabIndex={0}
                    onPointerDown={e => handleInventoryCardPointerDown(e, product)}
                    onPointerMove={handleInventoryCardPointerMove}
                    onPointerUp={handleInventoryCardPointerEnd}
                    onPointerCancel={handleInventoryCardPointerEnd}
                    onPointerLeave={handleInventoryCardPointerEnd}
                    onClick={() => handleInventoryCardClick(product)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setActionProduct(product);
                      }
                    }}
                    className="bg-slate-900 border border-slate-800 hover:border-blue-500/50 active:bg-slate-800/70 rounded-xl p-3.5 space-y-2.5 text-xs cursor-pointer select-none transition"
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
                            {selectedInventoryStore ? selectedInventoryStore.name : 'All Stores'}
                          </div>
                          <div className="text-base font-bold font-mono tabular-nums text-blue-400">
                            {storeQty} {product.unit}
                          </div>
                        </div>
                        <button
                          type="button"
                          aria-label={`Actions for ${product.name}`}
                          onPointerDown={e => e.stopPropagation()}
                          onClick={e => {
                            e.stopPropagation();
                            setActionProduct(product);
                          }}
                          className="p-1.5 rounded-lg bg-slate-950/70 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white transition"
                        >
                          <MoreVertical className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Multi-Store Quantity Breakdown in Combined Mode */}
                    {!selectedInventoryStore && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {shopStores.map(st => {
                          const qtyHere = getProductQtyInStore(product, st);
                          return (
                            <button
                              key={st.id}
                              type="button"
                              onPointerDown={e => e.stopPropagation()}
                              onClick={e => {
                                e.stopPropagation();
                                setSelectedInventoryStoreId(st.id);
                                setInvStockedOnly(true);
                              }}
                              className={`px-2 py-1 rounded-lg border text-[10px] font-mono tabular-nums transition ${
                                qtyHere > 0
                                  ? st.isShopFloor
                                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20'
                                    : 'bg-blue-500/10 border-blue-500/30 text-blue-300 hover:bg-blue-500/20'
                                  : 'bg-slate-950 border-slate-800 text-slate-500'
                              }`}
                            >
                              {st.name}
                              {st.isShopFloor ? ' (Floor)' : ''}: <strong>{qtyHere}</strong>
                            </button>
                          );
                        })}
                        {shopStores.length === 0 && (
                          <span className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 text-[10px] font-mono">
                            Floor: {product.currentStock} · Store: {product.storeStock || 0}
                          </span>
                        )}
                      </div>
                    )}

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
              {inventoryProducts.length > 150 && (
                <div className="text-center text-xs text-slate-500 py-2">
                  Showing first 150 of {inventoryProducts.length} matching products. Refine search or filter by store/category.
                </div>
              )}
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

                {/* 3. Select Product (showing storeStock in selected store) */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="block text-slate-300 font-medium">
                      Select Product *
                    </label>
                    {selectedTransferProduct && (
                      <span className="text-[11px] font-mono tabular-nums text-blue-400">
                        Available in {selectedSourceStore?.name || 'Store'}: {availableQtyForSelected}{' '}
                        {selectedTransferProduct.unit || 'pcs'}
                      </span>
                    )}
                  </div>

                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      value={productSearch}
                      onChange={e => setProductSearch(e.target.value)}
                      placeholder="Filter products by name, variation, SKU, or barcode..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <select
                    value={transferProductId}
                    onChange={e => {
                      setTransferProductId(e.target.value);
                      setTransferError('');
                    }}
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">Choose a product...</option>
                    {storeScopedProducts.map(p => {
                      const qtyHere = selectedSourceStore
                        ? getProductQtyInStore(p, selectedSourceStore)
                        : Number(p.storeStock || 0);
                      return (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.variation ? ` [${p.variation}]` : ''} ({p.sku}) — Store: {qtyHere}{' '}
                          {p.unit} · Floor: {p.currentStock} {p.unit}
                        </option>
                      );
                    })}
                  </select>

                  {selectedTransferProduct && availableQtyForSelected <= 0 && (
                    <p className="text-[11px] text-amber-400">
                      This product currently has 0 units in {selectedSourceStore?.name || 'this store'}. Record a purchase or import stock to this store first.
                    </p>
                  )}
                </div>

                {/* 4. Quantity + 5. Notes */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-slate-300 font-medium">
                        Quantity to Transfer *
                      </label>
                      {selectedTransferProduct && availableQtyForSelected > 0 && (
                        <button
                          type="button"
                          onClick={() => setTransferQty(String(availableQtyForSelected))}
                          className="text-[11px] font-semibold text-blue-400 hover:text-blue-300"
                        >
                          Max ({availableQtyForSelected})
                        </button>
                      )}
                    </div>
                    <input
                      type="number"
                      min="1"
                      max={availableQtyForSelected > 0 ? availableQtyForSelected : undefined}
                      inputMode="numeric"
                      required
                      value={transferQty}
                      onChange={e => {
                        setTransferQty(e.target.value);
                        setTransferError('');
                      }}
                      placeholder="0"
                      className={`w-full bg-slate-950 border rounded-lg px-3 py-2.5 text-white font-mono tabular-nums placeholder-slate-500 focus:outline-none focus:ring-1 ${
                        isQtyExceeding
                          ? 'border-rose-500 focus:ring-rose-500'
                          : 'border-slate-800 focus:ring-blue-500'
                      }`}
                    />
                    {isQtyExceeding && (
                      <p className="text-[11px] text-rose-400 mt-1">
                        Cannot exceed available store stock ({availableQtyForSelected}{' '}
                        {selectedTransferProduct?.unit || 'pcs'}).
                      </p>
                    )}
                  </div>

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
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="submit"
                    disabled={
                      !effectiveSourceStoreId ||
                      !transferProductId ||
                      availableQtyForSelected <= 0 ||
                      isQtyExceeding
                    }
                    className="w-full sm:w-auto px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition disabled:opacity-45 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Transfer Stock to Shop Floor</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Recent Store Transfers & Warehouse Movements */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-slate-400" />
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                  Recent Store Transfers &amp; Warehouse Logs
                </h3>
              </div>
              <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                {transferMovements.length}
              </span>
            </div>

            {transferMovements.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500">
                No store transfers or warehouse openings recorded yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-800/80">
                {transferMovements.map(m => {
                  const store = m.storeId
                    ? (dbState.stores || []).find(s => s.id === m.storeId)
                    : undefined;
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
                          {store ? ` · ${store.name}` : ''}
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
                          {isIncoming ? `+${m.changeQty}` : m.changeQty}
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
        const contextQty = selectedInventoryStore
          ? getProductQtyInStore(actionProduct, selectedInventoryStore)
          : getProductTotalTrackedUnits(actionProduct);
        return (
          <div
            onClick={() => setActionProduct(null)}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/80 backdrop-blur-sm sm:p-4"
          >
            <div
              onClick={e => e.stopPropagation()}
              className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl max-w-sm w-full p-4 sm:p-5 shadow-2xl space-y-4"
            >
              <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-800">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-blue-400">
                    {selectedInventoryStore ? selectedInventoryStore.name : shopName}
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
                  onClick={() => setActionProduct(null)}
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
