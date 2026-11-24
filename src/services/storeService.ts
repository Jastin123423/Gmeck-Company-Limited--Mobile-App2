import { db } from '../db/storage';
import {
  Category,
  InventoryMovement,
  Product,
  ProductStoreStockDetail,
  StockTransfer,
  StockTransferItem,
  StockTransferLocationType,
  StockTransferStatus,
  Store,
  StoreStatus,
  User,
} from '../types';
import { generateUUID } from '../utils/crypto';
import {
  canAccessShopAsAdmin,
  getShopAdminShopIds,
  hasAdminAccess,
  isPlatformAdmin,
  isShopAdmin,
} from '../utils/permissions';

export interface StockTransferInputItem {
  productId: string;
  quantity: number;
  unitPrice?: number;
}

export interface ExecuteStockTransferParams {
  transferDate?: string; // YYYY-MM-DD (allows today or past dates)
  sourceType: StockTransferLocationType;
  sourceId: string;
  destType: StockTransferLocationType;
  destId: string;
  items: StockTransferInputItem[];
  shippingCharges?: number;
  notice?: string;
  status?: StockTransferStatus;
}

export class StoreService {
  public static getStores(
    options?: {
      shopId?: string;
      status?: StoreStatus | 'ALL';
    },
    currentUser?: User
  ): Store[] {
    let stores = db.getStores();

    if (currentUser && !isPlatformAdmin(currentUser)) {
      if (isShopAdmin(currentUser)) {
        const managedIds = getShopAdminShopIds(currentUser);
        stores = stores.filter(s => managedIds.includes(s.shopId));
      } else {
        const assigned = currentUser.assignedShopIds || [];
        if (assigned.length > 0) {
          stores = stores.filter(s => assigned.includes(s.shopId));
        }
      }
    }

    if (options?.shopId && options.shopId !== 'ALL') {
      stores = stores.filter(s => s.shopId === options.shopId);
    }

    if (options?.status && options.status !== 'ALL') {
      stores = stores.filter(s => s.status === options.status);
    }

    return stores;
  }

  public static getStoreById(id: string): Store | undefined {
    return db.getStores().find(s => s.id === id);
  }

  public static createStore(
    params: {
      shopId: string;
      name: string;
      location?: string;
      status?: StoreStatus;
    },
    currentUser: User
  ): { success: boolean; store?: Store; error?: string } {
    if (!hasAdminAccess(currentUser)) {
      return {
        success: false,
        error: 'Permission Denied: Only Admins or Shop Admins can create stores.',
      };
    }

    const cleanName = params.name?.trim();
    if (!cleanName) {
      return { success: false, error: 'Store name is required.' };
    }

    if (!params.shopId) {
      return { success: false, error: 'Please select a shop to assign this store to.' };
    }

    if (!isPlatformAdmin(currentUser) && !canAccessShopAsAdmin(currentUser, params.shopId)) {
      return {
        success: false,
        error: 'Permission Denied: You can only create stores for your managed shop.',
      };
    }

    const shop = db.getShops().find(s => s.id === params.shopId);
    if (!shop) {
      return { success: false, error: 'Selected shop does not exist.' };
    }

    const existingStores = db.getStores();
    const duplicate = existingStores.find(
      s => s.shopId === params.shopId && s.name.trim().toLowerCase() === cleanName.toLowerCase()
    );
    if (duplicate) {
      return {
        success: false,
        error: `A store named "${cleanName}" already exists under ${shop.name}.`,
      };
    }

    const now = new Date().toISOString();
    const newStore: Store = {
      id: generateUUID(),
      shopId: params.shopId,
      name: cleanName,
      location: params.location?.trim() || undefined,
      status: params.status || 'ACTIVE',
      isShopFloor: Boolean((params as any).isShopFloor),
      createdAt: now,
      updatedAt: now,
    };

    db.saveStores([newStore, ...existingStores]);

    db.enqueueSync({
      id: generateUUID(),
      operation: 'CREATE_STORE',
      entityType: 'STORE',
      entityId: newStore.id,
      payload: newStore,
      status: 'PENDING',
      createdAt: now,
    });

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'CREATE_STORE',
      details: `Created store "${newStore.name}"${newStore.location ? ` (${newStore.location})` : ''} assigned to [${shop.name}]`,
      entityType: 'STORE',
      entityId: newStore.id,
      shopId: shop.id,
      timestamp: now,
    });

    return { success: true, store: newStore };
  }

  public static updateStore(
    id: string,
    updates: {
      name?: string;
      location?: string;
      shopId?: string;
      status?: StoreStatus;
    },
    currentUser: User
  ): { success: boolean; store?: Store; error?: string } {
    if (!hasAdminAccess(currentUser)) {
      return {
        success: false,
        error: 'Permission Denied: Only Admins or Shop Admins can update stores.',
      };
    }

    const stores = db.getStores();
    const idx = stores.findIndex(s => s.id === id);
    if (idx === -1) {
      return { success: false, error: 'Store not found.' };
    }

    const current = stores[idx];
    const targetShopId = updates.shopId || current.shopId;

    if (
      !isPlatformAdmin(currentUser) &&
      (!canAccessShopAsAdmin(currentUser, current.shopId) ||
        !canAccessShopAsAdmin(currentUser, targetShopId))
    ) {
      return {
        success: false,
        error: 'Permission Denied: You can only manage stores in your assigned shop.',
      };
    }

    const cleanName = updates.name !== undefined ? updates.name.trim() : current.name;
    if (!cleanName) {
      return { success: false, error: 'Store name cannot be empty.' };
    }

    const duplicate = stores.find(
      s =>
        s.id !== id &&
        s.shopId === targetShopId &&
        s.name.trim().toLowerCase() === cleanName.toLowerCase()
    );
    if (duplicate) {
      return {
        success: false,
        error: `Another store named "${cleanName}" already exists in this shop.`,
      };
    }

    const now = new Date().toISOString();
    const updatedStore: Store = {
      ...current,
      name: cleanName,
      shopId: targetShopId,
      location:
        updates.location !== undefined ? updates.location.trim() || undefined : current.location,
      status: updates.status || current.status,
      isShopFloor:
        (updates as any).isShopFloor !== undefined
          ? Boolean((updates as any).isShopFloor)
          : current.isShopFloor,
      updatedAt: now,
    };

    const nextStores = [...stores];
    nextStores[idx] = updatedStore;
    db.saveStores(nextStores);

    db.enqueueSync({
      id: generateUUID(),
      operation: 'UPDATE_STORE',
      entityType: 'STORE',
      entityId: updatedStore.id,
      payload: updatedStore,
      status: 'PENDING',
      createdAt: now,
    });

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'UPDATE_STORE',
      details: `Updated store "${updatedStore.name}" (${updatedStore.status})`,
      entityType: 'STORE',
      entityId: updatedStore.id,
      shopId: updatedStore.shopId,
      timestamp: now,
    });

    return { success: true, store: updatedStore };
  }

  public static deleteStore(
    id: string,
    currentUser: User
  ): { success: boolean; store?: Store; error?: string } {
    if (!hasAdminAccess(currentUser)) {
      return {
        success: false,
        error: 'Permission Denied: Only Admins or Shop Admins can delete stores.',
      };
    }

    const stores = db.getStores();
    const store = stores.find(s => s.id === id);
    if (!store) {
      return { success: false, error: 'Store not found.' };
    }

    if (!isPlatformAdmin(currentUser) && !canAccessShopAsAdmin(currentUser, store.shopId)) {
      return {
        success: false,
        error: 'Permission Denied: You can only delete stores in your managed shop.',
      };
    }

    const now = new Date().toISOString();
    const remainingStores = stores.filter(s => s.id !== id);
    const floorStoreIds = new Set(
      remainingStores
        .filter(s => s.shopId === store.shopId && s.isShopFloor)
        .map(s => s.id)
    );
    const remainingWarehouseInShop = remainingStores.filter(
      s => s.shopId === store.shopId && !s.isShopFloor && s.status === 'ACTIVE'
    );

    // Clean up deleted store's entries from products in that shop
    const products = [...db.getProducts()];
    let productsChanged = false;
    const updatedProducts = products.map(p => {
      if (p.shopId !== store.shopId) return p;

      const hadStoreStockEntry = Boolean(p.storeStocks && id in p.storeStocks);
      const hadStoreDetailEntry = Boolean(p.storeDetails && id in p.storeDetails);
      const wasLegacySingleWarehouse =
        !store.isShopFloor &&
        (!p.storeStocks || Object.keys(p.storeStocks).length === 0) &&
        remainingWarehouseInShop.length === 0 &&
        Number(p.storeStock || 0) > 0;

      if (!hadStoreStockEntry && !hadStoreDetailEntry && !wasLegacySingleWarehouse) {
        return p;
      }

      productsChanged = true;
      const nextStoreStocks = p.storeStocks ? { ...p.storeStocks } : undefined;
      if (nextStoreStocks) {
        delete nextStoreStocks[id];
      }

      const nextStoreDetails = p.storeDetails ? { ...p.storeDetails } : undefined;
      if (nextStoreDetails) {
        delete nextStoreDetails[id];
      }

      let nextWarehouseStock = Number(p.storeStock || 0);
      if (wasLegacySingleWarehouse) {
        nextWarehouseStock = 0;
      } else if (nextStoreStocks) {
        nextWarehouseStock = Object.entries(nextStoreStocks).reduce((sum, [sid, qty]) => {
          return floorStoreIds.has(sid) ? sum : sum + Math.max(0, Number(qty || 0));
        }, 0);
      }

      const updatedProd = {
        ...p,
        storeStock: nextWarehouseStock,
        ...(nextStoreStocks !== undefined ? { storeStocks: nextStoreStocks } : {}),
        ...(nextStoreDetails !== undefined ? { storeDetails: nextStoreDetails } : {}),
        updatedAt: now,
      };

      db.enqueueSync({
        id: generateUUID(),
        operation: 'UPDATE_PRODUCT',
        entityType: 'PRODUCT',
        entityId: updatedProd.id,
        payload: { ...updatedProd, storeId: undefined },
        status: 'PENDING',
        createdAt: now,
      });

      return updatedProd;
    });

    if (productsChanged) {
      db.saveProducts(updatedProducts);
    }

    db.saveStores(remainingStores);

    db.enqueueSync({
      id: generateUUID(),
      operation: 'DELETE_STORE',
      entityType: 'STORE',
      entityId: id,
      payload: { id, shopId: store.shopId },
      status: 'PENDING',
      createdAt: now,
    });

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'DELETE_STORE',
      details: `Deleted store "${store.name}"${store.location ? ` (${store.location})` : ''}`,
      entityType: 'STORE',
      entityId: store.id,
      shopId: store.shopId,
      timestamp: now,
    });

    return { success: true, store };
  }

  private static resolveStoreAvailableQty(
    product: {
      shopId: string;
      storeId?: string;
      storeStock?: number;
      storeStocks?: Record<string, number>;
    },
    store: Store,
    allStores: Store[]
  ): number {
    if (product.storeStocks && product.storeStocks[store.id] !== undefined) {
      return Math.max(0, Number(product.storeStocks[store.id] || 0));
    }
    const shopWarehouses = allStores
      .filter(s => s.shopId === product.shopId && !s.isShopFloor)
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === 'ACTIVE' ? -1 : 1;
        return (a.createdAt || '').localeCompare(b.createdAt || '');
      });
    const shopWarehouseIds = new Set(shopWarehouses.map(s => s.id));
    const mappedWarehouseSum = Object.entries(product.storeStocks || {}).reduce(
      (sum, [sid, q]) => (shopWarehouseIds.has(sid) ? sum + Math.max(0, Number(q || 0)) : sum),
      0
    );
    const rawStoreStock = Math.max(0, Number(product.storeStock || 0));
    if (mappedWarehouseSum === 0 && rawStoreStock > 0 && shopWarehouses.length > 0) {
      if (product.storeId && shopWarehouseIds.has(product.storeId)) {
        return product.storeId === store.id ? rawStoreStock : 0;
      }
      if (shopWarehouses[0]?.id === store.id) {
        return rawStoreStock;
      }
    }
    return 0;
  }

  public static transferStoreToShop(
    params: {
      storeId: string;
      productId: string;
      shopId: string;
      quantity: number;
      notes?: string;
    },
    currentUser: User
  ): { success: boolean; transferId?: string; error?: string } {
    const res = this.transferBatchStoreToShop(
      {
        storeId: params.storeId,
        shopId: params.shopId,
        items: [{ productId: params.productId, quantity: params.quantity }],
        notes: params.notes,
      },
      currentUser
    );
    return {
      success: res.success,
      transferId: res.transferId,
      error: res.error,
    };
  }

  public static transferBatchStoreToShop(
    params: {
      storeId: string;
      shopId: string;
      items: { productId: string; quantity: number; unitPrice?: number }[];
      notes?: string;
      transferDate?: string;
      shippingCharges?: number;
      status?: StockTransferStatus;
    },
    currentUser: User
  ): {
    success: boolean;
    transferId?: string;
    transfer?: StockTransfer;
    transferredCount?: number;
    totalUnits?: number;
    error?: string;
  } {
    const res = this.executeStockTransfer(
      {
        transferDate: params.transferDate,
        sourceType: 'STORE',
        sourceId: params.storeId,
        destType: 'SHOP',
        destId: params.shopId,
        items: params.items,
        shippingCharges: params.shippingCharges,
        notice: params.notes,
        status: params.status || 'COMPLETED',
      },
      currentUser
    );
    return {
      success: res.success,
      transferId: res.transfer?.id,
      transfer: res.transfer,
      transferredCount: res.transfer?.items.length,
      totalUnits: res.transfer?.totalUnits,
      error: res.error,
    };
  }

  private static toTodayYMD(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private static buildTransferTimestamp(transferDate: string, nowIso: string): string {
    const todayYMD = this.toTodayYMD();
    if (!transferDate || transferDate === todayYMD) {
      return nowIso;
    }
    const [y, m, d] = transferDate.split('-').map(Number);
    if (y && m && d) {
      return new Date(y, m - 1, d, 12, 0, 0, 0).toISOString();
    }
    return nowIso;
  }

  private static resolveLocationsForTransfer(
    params: Pick<
      ExecuteStockTransferParams,
      'sourceType' | 'sourceId' | 'destType' | 'destId'
    >,
    currentUser: User
  ): {
    ok: boolean;
    error?: string;
    sourceShopId?: string;
    sourceShopName?: string;
    sourceName?: string;
    sourceLocation?: string;
    destShopId?: string;
    destShopName?: string;
    destName?: string;
    destLocation?: string;
    sourceStore?: Store;
    destStore?: Store;
  } {
    const allStores = db.getStores();
    const allShops = db.getShops();

    let sourceShopId = '';
    let sourceShopName = '';
    let sourceName = '';
    let sourceLocation: string | undefined;
    let sourceStore: Store | undefined;

    if (params.sourceType === 'STORE') {
      sourceStore = allStores.find(s => s.id === params.sourceId);
      if (!sourceStore) {
        return { ok: false, error: 'Selected Location Source store does not exist.' };
      }
      if (sourceStore.status !== 'ACTIVE') {
        return { ok: false, error: `Source store "${sourceStore.name}" is inactive.` };
      }
      if (sourceStore.isShopFloor) {
        return {
          ok: false,
          error: `"${sourceStore.name}" is a POS Shop Floor. Choose the Shop directly as Location Source.`,
        };
      }
      const shop = allShops.find(s => s.id === sourceStore!.shopId);
      sourceShopId = sourceStore.shopId;
      sourceShopName = shop?.name || 'Shop';
      sourceName = sourceStore.name;
      sourceLocation = sourceStore.location || shop?.address || shop?.name;
    } else {
      const shop = allShops.find(s => s.id === params.sourceId);
      if (!shop) {
        return { ok: false, error: 'Selected Location Source shop does not exist.' };
      }
      if (shop.status !== 'ACTIVE') {
        return { ok: false, error: `Source shop "${shop.name}" is inactive.` };
      }
      sourceShopId = shop.id;
      sourceShopName = shop.name;
      sourceName = `${shop.name} (Shop Floor)`;
      sourceLocation = shop.address || shop.name;
    }

    let destShopId = '';
    let destShopName = '';
    let destName = '';
    let destLocation: string | undefined;
    let destStore: Store | undefined;

    if (params.destType === 'SHOP') {
      const destShop = allShops.find(s => s.id === params.destId);
      if (!destShop) {
        return { ok: false, error: 'Selected Location Destination shop does not exist.' };
      }
      if (destShop.status !== 'ACTIVE') {
        return { ok: false, error: `Destination shop "${destShop.name}" is inactive.` };
      }
      destShopId = destShop.id;
      destShopName = destShop.name;
      destName = `${destShop.name} (Shop Floor)`;
      destLocation = destShop.address || destShop.name;
    } else {
      destStore = allStores.find(s => s.id === params.destId);
      if (!destStore) {
        return { ok: false, error: 'Selected Location Destination store does not exist.' };
      }
      if (destStore.status !== 'ACTIVE') {
        return { ok: false, error: `Destination store "${destStore.name}" is inactive.` };
      }
      if (destStore.isShopFloor) {
        return {
          ok: false,
          error: `"${destStore.name}" is a POS Shop Floor. Select the Shop as destination instead.`,
        };
      }
      const shop = allShops.find(s => s.id === destStore!.shopId);
      destShopId = destStore.shopId;
      destShopName = shop?.name || 'Shop';
      destName = destStore.name;
      destLocation = destStore.location || shop?.address || shop?.name;
    }

    if (params.sourceType === params.destType && params.sourceId === params.destId) {
      return {
        ok: false,
        error: 'Location Source and Location Destination cannot be the same location.',
      };
    }

    if (params.sourceType === 'STORE' && params.destType === 'STORE') {
      if (sourceShopId !== destShopId) {
        return {
          ok: false,
          error: 'Store-to-Store transfers must be between stores belonging to the same shop.',
        };
      }
    }

    if (params.sourceType === 'SHOP' && params.destType === 'STORE') {
      if (sourceShopId !== destShopId) {
        return {
          ok: false,
          error: 'Shop-to-Store transfers must return stock into a store belonging to the same shop.',
        };
      }
    }

    if (params.sourceType === 'SHOP' && params.destType === 'SHOP') {
      return {
        ok: false,
        error: 'Choose a destination Store when transferring out from a Shop.',
      };
    }

    if (!isPlatformAdmin(currentUser)) {
      if (
        !canAccessShopAsAdmin(currentUser, sourceShopId) ||
        !canAccessShopAsAdmin(currentUser, destShopId)
      ) {
        return {
          ok: false,
          error: 'Permission Denied: You can only transfer stock within your managed shops.',
        };
      }
    }

    return {
      ok: true,
      sourceShopId,
      sourceShopName,
      sourceName,
      sourceLocation,
      destShopId,
      destShopName,
      destName,
      destLocation,
      sourceStore,
      destStore,
    };
  }

  private static computeNonFloorStoreStockTotal(
    storeStocks: Record<string, number>,
    floorStoreIds: Set<string>
  ): number {
    return Object.entries(storeStocks).reduce((sum, [sid, q]) => {
      return floorStoreIds.has(sid) ? sum : sum + Math.max(0, Number(q || 0));
    }, 0);
  }

  private static upsertStoreStockEntry(
    product: Product,
    store: Store,
    nextQty: number
  ): {
    nextStoreStocks: Record<string, number>;
    nextStoreDetails?: Record<string, ProductStoreStockDetail>;
  } {
    const clampedQty = Math.max(0, nextQty);
    const nextStoreStocks: Record<string, number> = {
      ...(product.storeStocks || {}),
      [store.id]: clampedQty,
    };
    const nextStoreDetails: Record<string, ProductStoreStockDetail> | undefined =
      product.storeDetails
        ? {
            ...product.storeDetails,
            [store.id]: {
              ...(product.storeDetails[store.id] || {
                storeId: store.id,
                storeName: store.name,
                unitPurchasePrice: product.purchasePrice || 0,
                unitSellingPrice: product.sellingPrice || 0,
              }),
              storeId: store.id,
              storeName: store.name,
              quantity: clampedQty,
            },
          }
        : undefined;

    return { nextStoreStocks, nextStoreDetails };
  }

  private static applyStockTransferEffects(params: {
    transferId: string;
    transferDate: string;
    sourceType: StockTransferLocationType;
    sourceId: string;
    sourceName: string;
    sourceShopId: string;
    sourceShopName: string;
    destType: StockTransferLocationType;
    destId: string;
    destName: string;
    destShopId: string;
    destShopName: string;
    items: StockTransferItem[];
    notice?: string;
    nowIso: string;
    currentUser: User;
    products: Product[];
    categories: Category[];
    allStores: Store[];
  }): {
    ok: boolean;
    error?: string;
    products: Product[];
    newCategories: Category[];
    createdProducts: Product[];
    updatedProductIds: Set<string>;
    movements: InventoryMovement[];
    items: StockTransferItem[];
  } {
    const {
      transferId,
      transferDate,
      sourceType,
      sourceId,
      sourceName,
      sourceShopName,
      destType,
      destId,
      destName,
      destShopId,
      destShopName,
      nowIso,
      currentUser,
      allStores,
    } = params;

    const products = params.products.map(p => ({
      ...p,
      ...(p.storeStocks ? { storeStocks: { ...p.storeStocks } } : {}),
      ...(p.storeDetails ? { storeDetails: { ...p.storeDetails } } : {}),
    }));
    const categories = [...params.categories];
    const newCategories: Category[] = [];
    const createdProducts: Product[] = [];
    const updatedProductIds = new Set<string>();
    const movements: InventoryMovement[] = [];
    const movementCreatedAt = this.buildTransferTimestamp(transferDate, nowIso);
    const noteSuffix = params.notice?.trim() ? ` — ${params.notice.trim()}` : '';

    const floorStoreIds = new Set(allStores.filter(s => s.isShopFloor).map(s => s.id));
    const sourceStore =
      sourceType === 'STORE' ? allStores.find(s => s.id === sourceId) : undefined;
    const destStore =
      destType === 'STORE' ? allStores.find(s => s.id === destId) : undefined;
    const srcFloorStore = allStores.find(
      s => s.shopId === params.sourceShopId && s.isShopFloor && s.status === 'ACTIVE'
    );
    const destFloorStore = allStores.find(
      s => s.shopId === destShopId && s.isShopFloor && s.status === 'ACTIVE'
    );

    const resolveOrCreateDestCategory = (sourceCatId: string): string => {
      const srcCat = categories.find(c => c.id === sourceCatId);
      if (srcCat) {
        const match = categories.find(
          c =>
            c.shopId === destShopId &&
            c.name.trim().toLowerCase() === srcCat.name.trim().toLowerCase()
        );
        if (match) return match.id;
      }
      const fallbackExisting = categories.find(c => c.shopId === destShopId);
      if (fallbackExisting && !srcCat) return fallbackExisting.id;

      const createdCat: Category = {
        id: generateUUID(),
        shopId: destShopId,
        name: srcCat?.name || 'General',
        icon: srcCat?.icon,
        color: srcCat?.color,
        status: 'ACTIVE',
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      categories.push(createdCat);
      newCategories.push(createdCat);
      return createdCat.id;
    };

    const resolvedItems: StockTransferItem[] = [];

    for (const item of params.items) {
      const srcIdx = products.findIndex(p => p.id === item.productId);
      if (srcIdx === -1) {
        return {
          ok: false,
          error: `Product "${item.productName}" was not found.`,
          products,
          newCategories,
          createdProducts,
          updatedProductIds,
          movements,
          items: resolvedItems,
        };
      }

      const srcProduct = products[srcIdx];
      const qty = Number(item.quantity);

      // 1. Validate source availability
      let sourceAvail = 0;
      if (sourceType === 'STORE') {
        if (!sourceStore) {
          return {
            ok: false,
            error: 'Source store not found.',
            products,
            newCategories,
            createdProducts,
            updatedProductIds,
            movements,
            items: resolvedItems,
          };
        }
        sourceAvail = this.resolveStoreAvailableQty(srcProduct, sourceStore, allStores);
      } else {
        sourceAvail = Math.max(0, Number(srcProduct.currentStock || 0));
      }

      if (qty > sourceAvail) {
        return {
          ok: false,
          error: `Not enough stock for "${srcProduct.name}" in ${sourceName}. Available: ${sourceAvail} ${srcProduct.unit || 'pcs'}.`,
          products,
          newCategories,
          createdProducts,
          updatedProductIds,
          movements,
          items: resolvedItems,
        };
      }

      // 2. Apply deduction at Source + addition at Destination (qty === 0 copies product to Destination with 0 qty)
      const isZeroCopy = qty === 0;

      if (sourceType === 'STORE' && destType === 'STORE' && sourceStore && destStore) {
        // STORE -> STORE (Same shop)
        const srcUpdated = this.upsertStoreStockEntry(
          srcProduct,
          sourceStore,
          sourceAvail - qty
        );
        const intermediateProd: Product = {
          ...srcProduct,
          storeStocks: srcUpdated.nextStoreStocks,
          ...(srcUpdated.nextStoreDetails ? { storeDetails: srcUpdated.nextStoreDetails } : {}),
        };
        const destBefore = this.resolveStoreAvailableQty(intermediateProd, destStore, allStores);
        const destUpdated = this.upsertStoreStockEntry(
          intermediateProd,
          destStore,
          destBefore + qty
        );
        const hasAnyMappedStores = Object.keys(destUpdated.nextStoreStocks).length > 0;
        const nextTotalWarehouse = hasAnyMappedStores
          ? this.computeNonFloorStoreStockTotal(destUpdated.nextStoreStocks, floorStoreIds)
          : Math.max(0, Number(srcProduct.storeStock || 0));

        products[srcIdx] = {
          ...intermediateProd,
          storeStock: nextTotalWarehouse,
          storeStocks: destUpdated.nextStoreStocks,
          ...(destUpdated.nextStoreDetails ? { storeDetails: destUpdated.nextStoreDetails } : {}),
          updatedAt: nowIso,
        };
        updatedProductIds.add(srcProduct.id);

        if (isZeroCopy) {
          movements.push({
            id: generateUUID(),
            shopId: destShopId,
            shopName: destShopName,
            storeId: destStore.id,
            productId: srcProduct.id,
            productName: srcProduct.name,
            previousQty: destBefore,
            changeQty: 0,
            newQty: destBefore,
            type: 'STORE_TRANSFER',
            reason: `Copied product (0 qty) from ${sourceName} to ${destName}${noteSuffix}`,
            referenceId: transferId,
            userId: currentUser.id,
            userName: currentUser.name,
            createdAt: movementCreatedAt,
          });
        } else {
          movements.push(
            {
              id: generateUUID(),
              shopId: destShopId,
              shopName: destShopName,
              storeId: destStore.id,
              productId: srcProduct.id,
              productName: srcProduct.name,
              previousQty: destBefore,
              changeQty: qty,
              newQty: destBefore + qty,
              type: 'STORE_TRANSFER',
              reason: `Transferred IN from ${sourceName} to ${destName}${noteSuffix}`,
              referenceId: transferId,
              userId: currentUser.id,
              userName: currentUser.name,
              createdAt: movementCreatedAt,
            },
            {
              id: generateUUID(),
              shopId: params.sourceShopId,
              shopName: sourceShopName,
              storeId: sourceStore.id,
              productId: srcProduct.id,
              productName: srcProduct.name,
              previousQty: sourceAvail,
              changeQty: -qty,
              newQty: sourceAvail - qty,
              type: 'STORE_TRANSFER',
              reason: `Transferred OUT from ${sourceName} to ${destName}${noteSuffix}`,
              referenceId: transferId,
              userId: currentUser.id,
              userName: currentUser.name,
              createdAt: movementCreatedAt,
            }
          );
        }

        resolvedItems.push({ ...item, destProductId: srcProduct.id });
      } else if (sourceType === 'SHOP' && destType === 'STORE' && destStore) {
        // SHOP -> STORE (Same shop)
        const newShopFloorQty = Math.max(0, sourceAvail - qty);
        let workingProd: Product = {
          ...srcProduct,
          currentStock: newShopFloorQty,
          customFields: {
            ...(srcProduct.customFields || {}),
            assignedShopFloor: true,
          },
        };
        if (srcFloorStore) {
          const flUpd = this.upsertStoreStockEntry(workingProd, srcFloorStore, newShopFloorQty);
          workingProd = {
            ...workingProd,
            storeStocks: flUpd.nextStoreStocks,
            ...(flUpd.nextStoreDetails ? { storeDetails: flUpd.nextStoreDetails } : {}),
          };
        }

        const destBefore = this.resolveStoreAvailableQty(workingProd, destStore, allStores);
        const destUpd = this.upsertStoreStockEntry(workingProd, destStore, destBefore + qty);
        const nextTotalWarehouse = this.computeNonFloorStoreStockTotal(
          destUpd.nextStoreStocks,
          floorStoreIds
        );

        products[srcIdx] = {
          ...workingProd,
          storeStock: nextTotalWarehouse,
          storeStocks: destUpd.nextStoreStocks,
          ...(destUpd.nextStoreDetails ? { storeDetails: destUpd.nextStoreDetails } : {}),
          updatedAt: nowIso,
        };
        updatedProductIds.add(srcProduct.id);

        if (isZeroCopy) {
          movements.push({
            id: generateUUID(),
            shopId: destShopId,
            shopName: destShopName,
            storeId: destStore.id,
            productId: srcProduct.id,
            productName: srcProduct.name,
            previousQty: destBefore,
            changeQty: 0,
            newQty: destBefore,
            type: 'STORE_TRANSFER',
            reason: `Copied product (0 qty) to ${destName} from ${sourceName}${noteSuffix}`,
            referenceId: transferId,
            userId: currentUser.id,
            userName: currentUser.name,
            createdAt: movementCreatedAt,
          });
        } else {
          movements.push(
            {
              id: generateUUID(),
              shopId: destShopId,
              shopName: destShopName,
              storeId: destStore.id,
              productId: srcProduct.id,
              productName: srcProduct.name,
              previousQty: destBefore,
              changeQty: qty,
              newQty: destBefore + qty,
              type: 'STORE_TRANSFER',
              reason: `Transferred IN to ${destName} from ${sourceName}${noteSuffix}`,
              referenceId: transferId,
              userId: currentUser.id,
              userName: currentUser.name,
              createdAt: movementCreatedAt,
            },
            {
              id: generateUUID(),
              shopId: params.sourceShopId,
              shopName: sourceShopName,
              storeId: destStore.id,
              productId: srcProduct.id,
              productName: srcProduct.name,
              previousQty: sourceAvail,
              changeQty: -qty,
              newQty: newShopFloorQty,
              type: 'STORE_TRANSFER',
              reason: `Returned OUT from ${sourceName} to ${destName}${noteSuffix}`,
              referenceId: transferId,
              userId: currentUser.id,
              userName: currentUser.name,
              createdAt: movementCreatedAt,
            }
          );
        }

        resolvedItems.push({ ...item, destProductId: srcProduct.id });
      } else if (sourceType === 'STORE' && destType === 'SHOP' && sourceStore) {
        // STORE -> SHOP (Same shop or Cross-shop)
        const totalWarehouseBefore = Number(srcProduct.storeStock || 0);
        const srcUpd = this.upsertStoreStockEntry(srcProduct, sourceStore, sourceAvail - qty);

        if (destShopId === params.sourceShopId) {
          const currentShopFloor = Math.max(0, Number(srcProduct.currentStock || 0));
          const newShopFloor = currentShopFloor + qty;

          let nextStocks = srcUpd.nextStoreStocks;
          let nextDetails = srcUpd.nextStoreDetails;
          if (destFloorStore) {
            const flUpd = this.upsertStoreStockEntry(
              { ...srcProduct, storeStocks: nextStocks, storeDetails: nextDetails },
              destFloorStore,
              newShopFloor
            );
            nextStocks = flUpd.nextStoreStocks;
            nextDetails = flUpd.nextStoreDetails;
          }

          const newWarehouseTotal =
            Object.keys(srcProduct.storeStocks || {}).length > 0
              ? this.computeNonFloorStoreStockTotal(nextStocks, floorStoreIds)
              : Math.max(0, totalWarehouseBefore - qty);

          products[srcIdx] = {
            ...srcProduct,
            currentStock: newShopFloor,
            storeStock: newWarehouseTotal,
            storeStocks: nextStocks,
            ...(nextDetails ? { storeDetails: nextDetails } : {}),
            customFields: {
              ...(srcProduct.customFields || {}),
              assignedShopFloor: true,
            },
            updatedAt: nowIso,
          };
          updatedProductIds.add(srcProduct.id);

          if (isZeroCopy) {
            movements.push({
              id: generateUUID(),
              shopId: destShopId,
              shopName: destShopName,
              storeId: sourceStore.id,
              productId: srcProduct.id,
              productName: srcProduct.name,
              previousQty: currentShopFloor,
              changeQty: 0,
              newQty: newShopFloor,
              type: 'STORE_TRANSFER',
              reason: `Copied product (0 qty) from ${sourceName} to ${destName}${noteSuffix}`,
              referenceId: transferId,
              userId: currentUser.id,
              userName: currentUser.name,
              createdAt: movementCreatedAt,
            });
          } else {
            movements.push(
              {
                id: generateUUID(),
                shopId: destShopId,
                shopName: destShopName,
                storeId: sourceStore.id,
                productId: srcProduct.id,
                productName: srcProduct.name,
                previousQty: currentShopFloor,
                changeQty: qty,
                newQty: newShopFloor,
                type: 'STORE_TRANSFER',
                reason: `Transferred IN from ${sourceName} to ${destName}${noteSuffix}`,
                referenceId: transferId,
                userId: currentUser.id,
                userName: currentUser.name,
                createdAt: movementCreatedAt,
              },
              {
                id: generateUUID(),
                shopId: params.sourceShopId,
                shopName: sourceShopName,
                storeId: sourceStore.id,
                productId: srcProduct.id,
                productName: srcProduct.name,
                previousQty: sourceAvail,
                changeQty: -qty,
                newQty: sourceAvail - qty,
                type: 'STORE_TRANSFER',
                reason: `Transferred OUT from ${sourceName} to ${destName}${noteSuffix}`,
                referenceId: transferId,
                userId: currentUser.id,
                userName: currentUser.name,
                createdAt: movementCreatedAt,
              }
            );
          }

          resolvedItems.push({ ...item, destProductId: srcProduct.id });
        } else {
          // Cross-shop STORE -> Another SHOP
          const newWarehouseTotal =
            Object.keys(srcProduct.storeStocks || {}).length > 0
              ? this.computeNonFloorStoreStockTotal(srcUpd.nextStoreStocks, floorStoreIds)
              : Math.max(0, totalWarehouseBefore - qty);

          products[srcIdx] = {
            ...srcProduct,
            storeStock: newWarehouseTotal,
            storeStocks: srcUpd.nextStoreStocks,
            ...(srcUpd.nextStoreDetails ? { storeDetails: srcUpd.nextStoreDetails } : {}),
            updatedAt: nowIso,
          };
          updatedProductIds.add(srcProduct.id);

          // Find or create corresponding product in destShopId
          const destIdx = products.findIndex(
            p =>
              p.shopId === destShopId &&
              ((srcProduct.sku &&
                p.sku &&
                p.sku.trim().toLowerCase() === srcProduct.sku.trim().toLowerCase()) ||
                (p.name.trim().toLowerCase() === srcProduct.name.trim().toLowerCase() &&
                  (p.variation || '').trim().toLowerCase() ===
                    (srcProduct.variation || '').trim().toLowerCase()))
          );

          let destProductId = '';
          let destPrevQty = 0;
          let destNextQty = qty;

          if (destIdx !== -1) {
            const dp = products[destIdx];
            destProductId = dp.id;
            destPrevQty = Math.max(0, Number(dp.currentStock || 0));
            destNextQty = destPrevQty + qty;
            let dpStocks = dp.storeStocks ? { ...dp.storeStocks } : undefined;
            let dpDetails = dp.storeDetails ? { ...dp.storeDetails } : undefined;
            if (destFloorStore && dpStocks) {
              const flUpd = this.upsertStoreStockEntry(dp, destFloorStore, destNextQty);
              dpStocks = flUpd.nextStoreStocks;
              dpDetails = flUpd.nextStoreDetails;
            }
            products[destIdx] = {
              ...dp,
              currentStock: destNextQty,
              ...(dpStocks ? { storeStocks: dpStocks } : {}),
              ...(dpDetails ? { storeDetails: dpDetails } : {}),
              customFields: {
                ...(dp.customFields || {}),
                assignedShopFloor: true,
              },
              updatedAt: nowIso,
            };
            updatedProductIds.add(dp.id);
          } else {
            const destCatId = resolveOrCreateDestCategory(srcProduct.categoryId);
            const newDestProduct: Product = {
              id: generateUUID(),
              shopId: destShopId,
              name: srcProduct.name,
              variation: srcProduct.variation,
              sku: srcProduct.sku || `SKU-${Date.now().toString().slice(-6)}`,
              barcode: srcProduct.barcode || '',
              categoryId: destCatId,
              sellingPrice: srcProduct.sellingPrice,
              proposedSellingPrice: srcProduct.proposedSellingPrice,
              purchasePrice: srcProduct.purchasePrice,
              currentStock: qty,
              storeStock: 0,
              ...(destFloorStore
                ? { storeStocks: { [destFloorStore.id]: qty } }
                : {}),
              minStock: srcProduct.minStock,
              unit: srcProduct.unit || 'pcs',
              status: 'ACTIVE',
              ...(srcProduct.images ? { images: srcProduct.images } : {}),
              ...(srcProduct.imageUrl ? { imageUrl: srcProduct.imageUrl } : {}),
              customFields: {
                ...(srcProduct.customFields || {}),
                assignedShopFloor: true,
              },
              createdAt: nowIso,
              updatedAt: nowIso,
            };
            products.push(newDestProduct);
            createdProducts.push(newDestProduct);
            destProductId = newDestProduct.id;
          }

          if (isZeroCopy) {
            movements.push({
              id: generateUUID(),
              shopId: destShopId,
              shopName: destShopName,
              storeId: sourceStore.id,
              productId: destProductId,
              productName: srcProduct.name,
              previousQty: destPrevQty,
              changeQty: 0,
              newQty: destNextQty,
              type: 'STORE_TRANSFER',
              reason: `Copied product (0 qty) from ${sourceName} (${sourceShopName})${noteSuffix}`,
              referenceId: transferId,
              userId: currentUser.id,
              userName: currentUser.name,
              createdAt: movementCreatedAt,
            });
          } else {
            movements.push(
              {
                id: generateUUID(),
                shopId: destShopId,
                shopName: destShopName,
                storeId: sourceStore.id,
                productId: destProductId,
                productName: srcProduct.name,
                previousQty: destPrevQty,
                changeQty: qty,
                newQty: destNextQty,
                type: 'STORE_TRANSFER',
                reason: `Transferred IN from ${sourceName} (${sourceShopName})${noteSuffix}`,
                referenceId: transferId,
                userId: currentUser.id,
                userName: currentUser.name,
                createdAt: movementCreatedAt,
              },
              {
                id: generateUUID(),
                shopId: params.sourceShopId,
                shopName: sourceShopName,
                storeId: sourceStore.id,
                productId: srcProduct.id,
                productName: srcProduct.name,
                previousQty: sourceAvail,
                changeQty: -qty,
                newQty: sourceAvail - qty,
                type: 'STORE_TRANSFER',
                reason: `Transferred OUT from ${sourceName} to ${destName}${noteSuffix}`,
                referenceId: transferId,
                userId: currentUser.id,
                userName: currentUser.name,
                createdAt: movementCreatedAt,
              }
            );
          }

          resolvedItems.push({ ...item, destProductId });
        }
      }
    }

    return {
      ok: true,
      products,
      newCategories,
      createdProducts,
      updatedProductIds,
      movements,
      items: resolvedItems,
    };
  }

  private static reverseStockTransferEffects(params: {
    transfer: StockTransfer;
    nowIso: string;
    products: Product[];
    allStores: Store[];
  }): {
    products: Product[];
    updatedProductIds: Set<string>;
  } {
    const { transfer, nowIso, allStores } = params;
    const products = params.products.map(p => ({
      ...p,
      ...(p.storeStocks ? { storeStocks: { ...p.storeStocks } } : {}),
      ...(p.storeDetails ? { storeDetails: { ...p.storeDetails } } : {}),
    }));
    const updatedProductIds = new Set<string>();

    if (transfer.status !== 'COMPLETED') {
      return { products, updatedProductIds };
    }

    const floorStoreIds = new Set(allStores.filter(s => s.isShopFloor).map(s => s.id));
    const sourceStore =
      transfer.sourceType === 'STORE'
        ? allStores.find(s => s.id === transfer.sourceId)
        : undefined;
    const destStore =
      transfer.destType === 'STORE'
        ? allStores.find(s => s.id === transfer.destId)
        : undefined;
    const srcFloorStore = allStores.find(
      s => s.shopId === transfer.sourceShopId && s.isShopFloor && s.status === 'ACTIVE'
    );
    const destFloorStore = allStores.find(
      s => s.shopId === transfer.destShopId && s.isShopFloor && s.status === 'ACTIVE'
    );

    for (const item of transfer.items || []) {
      const qty = Math.max(0, Number(item.quantity || 0));
      if (qty <= 0) continue;

      const srcIdx = products.findIndex(p => p.id === item.productId);
      if (srcIdx !== -1) {
        const sp = products[srcIdx];
        if (transfer.sourceType === 'STORE' && sourceStore) {
          const curSrc = this.resolveStoreAvailableQty(sp, sourceStore, allStores);
          const restoredSrc = this.upsertStoreStockEntry(sp, sourceStore, curSrc + qty);
          const nextWarehouseTotal =
            Object.keys(sp.storeStocks || {}).length > 0
              ? this.computeNonFloorStoreStockTotal(restoredSrc.nextStoreStocks, floorStoreIds)
              : Math.max(0, Number(sp.storeStock || 0) + qty);

          products[srcIdx] = {
            ...sp,
            storeStock: nextWarehouseTotal,
            storeStocks: restoredSrc.nextStoreStocks,
            ...(restoredSrc.nextStoreDetails
              ? { storeDetails: restoredSrc.nextStoreDetails }
              : {}),
            updatedAt: nowIso,
          };
          updatedProductIds.add(sp.id);
        } else if (transfer.sourceType === 'SHOP') {
          const nextFloor = Math.max(0, Number(sp.currentStock || 0) + qty);
          let nextStocks = sp.storeStocks;
          let nextDetails = sp.storeDetails;
          if (srcFloorStore && sp.storeStocks) {
            const flUpd = this.upsertStoreStockEntry(sp, srcFloorStore, nextFloor);
            nextStocks = flUpd.nextStoreStocks;
            nextDetails = flUpd.nextStoreDetails;
          }
          products[srcIdx] = {
            ...sp,
            currentStock: nextFloor,
            ...(nextStocks ? { storeStocks: nextStocks } : {}),
            ...(nextDetails ? { storeDetails: nextDetails } : {}),
            updatedAt: nowIso,
          };
          updatedProductIds.add(sp.id);
        }
      }

      const targetDestProdId = item.destProductId || item.productId;
      const destIdx = products.findIndex(p => p.id === targetDestProdId);
      if (destIdx !== -1) {
        const dp = products[destIdx];
        if (transfer.destType === 'STORE' && destStore) {
          const curDest = this.resolveStoreAvailableQty(dp, destStore, allStores);
          const deductedDest = this.upsertStoreStockEntry(
            dp,
            destStore,
            Math.max(0, curDest - qty)
          );
          const nextWarehouseTotal = this.computeNonFloorStoreStockTotal(
            deductedDest.nextStoreStocks,
            floorStoreIds
          );
          products[destIdx] = {
            ...dp,
            storeStock: nextWarehouseTotal,
            storeStocks: deductedDest.nextStoreStocks,
            ...(deductedDest.nextStoreDetails
              ? { storeDetails: deductedDest.nextStoreDetails }
              : {}),
            updatedAt: nowIso,
          };
          updatedProductIds.add(dp.id);
        } else if (transfer.destType === 'SHOP') {
          const nextFloor = Math.max(0, Number(dp.currentStock || 0) - qty);
          let nextStocks = dp.storeStocks;
          let nextDetails = dp.storeDetails;
          if (destFloorStore && dp.storeStocks) {
            const flUpd = this.upsertStoreStockEntry(dp, destFloorStore, nextFloor);
            nextStocks = flUpd.nextStoreStocks;
            nextDetails = flUpd.nextStoreDetails;
          }
          products[destIdx] = {
            ...dp,
            currentStock: nextFloor,
            ...(nextStocks ? { storeStocks: nextStocks } : {}),
            ...(nextDetails ? { storeDetails: nextDetails } : {}),
            updatedAt: nowIso,
          };
          updatedProductIds.add(dp.id);
        }
      }
    }

    return { products, updatedProductIds };
  }

  public static executeStockTransfer(
    params: ExecuteStockTransferParams,
    currentUser: User
  ): {
    success: boolean;
    transfer?: StockTransfer;
    error?: string;
  } {
    if (!hasAdminAccess(currentUser)) {
      return {
        success: false,
        error: 'Permission Denied: Only Admins and Shop Admins can transfer stock.',
      };
    }

    if (!Array.isArray(params.items) || params.items.length === 0) {
      return { success: false, error: 'Search and tick at least one product to transfer.' };
    }
    if (params.items.length > 1000) {
      return { success: false, error: 'Maximum 1,000 products allowed per stock transfer.' };
    }

    const locCheck = this.resolveLocationsForTransfer(params, currentUser);
    if (!locCheck.ok) {
      return { success: false, error: locCheck.error };
    }

    const allProducts = db.getProducts();
    const productById = new Map(allProducts.map(p => [p.id, p]));

    // Merge duplicate product rows & build priced items
    const mergedByProduct = new Map<string, { qty: number; customPrice?: number }>();
    for (const row of params.items) {
      const q = Number(row.quantity);
      if (!Number.isFinite(q) || q < 0) {
        const prodName = productById.get(row.productId)?.name || row.productId;
        return {
          success: false,
          error: `Quantity for "${prodName}" cannot be negative.`,
        };
      }
      if (row.unitPrice !== undefined && (!Number.isFinite(Number(row.unitPrice)) || Number(row.unitPrice) < 0)) {
        return { success: false, error: 'Product price cannot be negative.' };
      }
      const existing = mergedByProduct.get(row.productId);
      mergedByProduct.set(row.productId, {
        qty: (existing?.qty || 0) + q,
        customPrice: row.unitPrice !== undefined ? Number(row.unitPrice) : existing?.customPrice,
      });
    }

    const builtItems: StockTransferItem[] = [];
    let totalUnits = 0;
    let totalAmount = 0;

    for (const [productId, data] of mergedByProduct.entries()) {
      const prod = productById.get(productId);
      if (!prod) {
        return { success: false, error: 'One or more selected products could not be found.' };
      }
      if (prod.shopId !== locCheck.sourceShopId) {
        return {
          success: false,
          error: `Product "${prod.name}" does not belong to the selected Location Source.`,
        };
      }
      const unitPrice =
        data.customPrice !== undefined
          ? data.customPrice
          : Number(prod.sellingPrice || prod.purchasePrice || 0);
      const subtotal = Math.round(unitPrice * data.qty * 100) / 100;
      totalUnits += data.qty;
      totalAmount += subtotal;

      builtItems.push({
        id: generateUUID(),
        productId: prod.id,
        productName: prod.name,
        variation: prod.variation,
        sku: prod.sku,
        unit: prod.unit || 'pcs',
        quantity: data.qty,
        unitPrice,
        subtotal,
      });
    }

    const nowIso = new Date().toISOString();
    const transferDate = (params.transferDate || '').trim() || this.toTodayYMD();
    const shippingCharges = Math.max(0, Number(params.shippingCharges || 0));
    const status: StockTransferStatus =
      params.status === 'NOT_COMPLETED' ? 'NOT_COMPLETED' : 'COMPLETED';
    const transferId = generateUUID();
    const transferNumber = `TRF-${transferDate.replace(/-/g, '')}-${transferId.slice(0, 4).toUpperCase()}`;

    const allStores = db.getStores();
    const allCategories = db.getCategories();

    let finalProducts = allProducts;
    let finalItems = builtItems;
    const syncQueueItems: any[] = [];
    let movementsToPrepend: InventoryMovement[] = [];

    if (status === 'COMPLETED') {
      const effectRes = this.applyStockTransferEffects({
        transferId,
        transferDate,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        sourceName: locCheck.sourceName!,
        sourceShopId: locCheck.sourceShopId!,
        sourceShopName: locCheck.sourceShopName!,
        destType: params.destType,
        destId: params.destId,
        destName: locCheck.destName!,
        destShopId: locCheck.destShopId!,
        destShopName: locCheck.destShopName!,
        items: builtItems,
        notice: params.notice,
        nowIso,
        currentUser,
        products: allProducts,
        categories: allCategories,
        allStores,
      });

      if (!effectRes.ok) {
        return { success: false, error: effectRes.error };
      }

      finalProducts = effectRes.products;
      finalItems = effectRes.items;
      movementsToPrepend = effectRes.movements;

      if (effectRes.newCategories.length > 0) {
        db.saveCategories([...allCategories, ...effectRes.newCategories]);
        for (const cat of effectRes.newCategories) {
          syncQueueItems.push({
            id: generateUUID(),
            operation: 'CREATE_CATEGORY',
            entityType: 'CATEGORY',
            entityId: cat.id,
            payload: cat,
            status: 'PENDING',
            createdAt: nowIso,
          });
        }
      }

      for (const cp of effectRes.createdProducts) {
        syncQueueItems.push({
          id: generateUUID(),
          operation: 'CREATE_PRODUCT',
          entityType: 'PRODUCT',
          entityId: cp.id,
          payload: cp,
          status: 'PENDING',
          createdAt: nowIso,
        });
      }

      const finalProdMap = new Map(finalProducts.map(p => [p.id, p]));
      for (const pid of effectRes.updatedProductIds) {
        const up = finalProdMap.get(pid);
        if (up) {
          syncQueueItems.push({
            id: generateUUID(),
            operation: 'UPDATE_PRODUCT',
            entityType: 'PRODUCT',
            entityId: up.id,
            payload: up,
            status: 'PENDING',
            createdAt: nowIso,
          });
        }
      }

      db.saveProducts(finalProducts);
      if (movementsToPrepend.length > 0) {
        db.saveMovements([...movementsToPrepend, ...db.getMovements()]);
      }
    }

    const newTransfer: StockTransfer = {
      id: transferId,
      transferNumber,
      transferDate,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      sourceName: locCheck.sourceName!,
      sourceLocation: locCheck.sourceLocation,
      sourceShopId: locCheck.sourceShopId!,
      sourceShopName: locCheck.sourceShopName,
      destType: params.destType,
      destId: params.destId,
      destName: locCheck.destName!,
      destLocation: locCheck.destLocation,
      destShopId: locCheck.destShopId!,
      destShopName: locCheck.destShopName,
      status,
      shippingCharges,
      notice: params.notice?.trim() || undefined,
      items: finalItems,
      totalUnits,
      totalAmount: Math.round(totalAmount * 100) / 100,
      createdByUserId: currentUser.id,
      createdByName: currentUser.name,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const existingTransfers = db.getStockTransfers();
    db.saveStockTransfers([newTransfer, ...existingTransfers]);

    syncQueueItems.push({
      id: generateUUID(),
      operation: 'UPSERT_STOCK_TRANSFER',
      entityType: 'STOCK_TRANSFER',
      entityId: newTransfer.id,
      payload: newTransfer,
      status: 'PENDING',
      createdAt: nowIso,
    });
    db.enqueueSyncBatch(syncQueueItems);

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'STOCK_TRANSFER',
      details: `${status === 'COMPLETED' ? 'Transferred' : 'Saved pending transfer of'} ${totalUnits.toLocaleString()} unit(s) across ${finalItems.length} product(s) from "${newTransfer.sourceName}" to "${newTransfer.destName}" (${newTransfer.transferDate})`,
      entityType: 'STORE',
      entityId: newTransfer.id,
      shopId: newTransfer.destShopId,
      timestamp: nowIso,
    });

    return { success: true, transfer: newTransfer };
  }

  public static updateStockTransfer(
    transferId: string,
    params: ExecuteStockTransferParams,
    currentUser: User
  ): {
    success: boolean;
    transfer?: StockTransfer;
    error?: string;
  } {
    if (!hasAdminAccess(currentUser)) {
      return {
        success: false,
        error: 'Permission Denied: Only Admins and Shop Admins can edit stock transfers.',
      };
    }

    const existingTransfers = db.getStockTransfers();
    const existingIdx = existingTransfers.findIndex(t => t.id === transferId);
    if (existingIdx === -1) {
      return { success: false, error: 'Stock transfer record not found.' };
    }
    const oldTransfer = existingTransfers[existingIdx];

    if (!Array.isArray(params.items) || params.items.length === 0) {
      return { success: false, error: 'Select at least one product for this transfer.' };
    }
    if (params.items.length > 1000) {
      return { success: false, error: 'Maximum 1,000 products allowed per transfer.' };
    }

    const locCheck = this.resolveLocationsForTransfer(params, currentUser);
    if (!locCheck.ok) {
      return { success: false, error: locCheck.error };
    }

    const nowIso = new Date().toISOString();
    const allStores = db.getStores();
    const allCategories = db.getCategories();

    // Step 1: Reverse old COMPLETED stock effect in memory
    const reversed = this.reverseStockTransferEffects({
      transfer: oldTransfer,
      nowIso,
      products: db.getProducts(),
      allStores,
    });

    const productById = new Map(reversed.products.map(p => [p.id, p]));
    const mergedByProduct = new Map<string, { qty: number; customPrice?: number }>();
    for (const row of params.items) {
      const q = Number(row.quantity);
      if (!Number.isFinite(q) || q < 0) {
        const prodName = productById.get(row.productId)?.name || row.productId;
        return {
          success: false,
          error: `Quantity for "${prodName}" cannot be negative.`,
        };
      }
      const existing = mergedByProduct.get(row.productId);
      mergedByProduct.set(row.productId, {
        qty: (existing?.qty || 0) + q,
        customPrice: row.unitPrice !== undefined ? Number(row.unitPrice) : existing?.customPrice,
      });
    }

    const builtItems: StockTransferItem[] = [];
    let totalUnits = 0;
    let totalAmount = 0;

    for (const [productId, data] of mergedByProduct.entries()) {
      const prod = productById.get(productId);
      if (!prod) {
        return { success: false, error: 'One or more selected products were not found.' };
      }
      if (prod.shopId !== locCheck.sourceShopId) {
        return {
          success: false,
          error: `Product "${prod.name}" does not belong to Location Source.`,
        };
      }
      const unitPrice =
        data.customPrice !== undefined
          ? data.customPrice
          : Number(prod.sellingPrice || prod.purchasePrice || 0);
      const subtotal = Math.round(unitPrice * data.qty * 100) / 100;
      totalUnits += data.qty;
      totalAmount += subtotal;

      builtItems.push({
        id: generateUUID(),
        productId: prod.id,
        productName: prod.name,
        variation: prod.variation,
        sku: prod.sku,
        unit: prod.unit || 'pcs',
        quantity: data.qty,
        unitPrice,
        subtotal,
      });
    }

    const transferDate = (params.transferDate || '').trim() || oldTransfer.transferDate || this.toTodayYMD();
    const shippingCharges = Math.max(0, Number(params.shippingCharges || 0));
    const status: StockTransferStatus =
      params.status === 'NOT_COMPLETED' ? 'NOT_COMPLETED' : 'COMPLETED';

    let finalProducts = reversed.products;
    let finalItems = builtItems;
    const allUpdatedIds = new Set<string>(reversed.updatedProductIds);
    const syncQueueItems: any[] = [];
    let newMovements: InventoryMovement[] = [];

    if (status === 'COMPLETED') {
      const applyRes = this.applyStockTransferEffects({
        transferId,
        transferDate,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        sourceName: locCheck.sourceName!,
        sourceShopId: locCheck.sourceShopId!,
        sourceShopName: locCheck.sourceShopName!,
        destType: params.destType,
        destId: params.destId,
        destName: locCheck.destName!,
        destShopId: locCheck.destShopId!,
        destShopName: locCheck.destShopName!,
        items: builtItems,
        notice: params.notice,
        nowIso,
        currentUser,
        products: reversed.products,
        categories: allCategories,
        allStores,
      });

      if (!applyRes.ok) {
        return { success: false, error: applyRes.error };
      }

      finalProducts = applyRes.products;
      finalItems = applyRes.items;
      newMovements = applyRes.movements;
      applyRes.updatedProductIds.forEach(id => allUpdatedIds.add(id));

      if (applyRes.newCategories.length > 0) {
        db.saveCategories([...allCategories, ...applyRes.newCategories]);
        for (const cat of applyRes.newCategories) {
          syncQueueItems.push({
            id: generateUUID(),
            operation: 'CREATE_CATEGORY',
            entityType: 'CATEGORY',
            entityId: cat.id,
            payload: cat,
            status: 'PENDING',
            createdAt: nowIso,
          });
        }
      }

      for (const cp of applyRes.createdProducts) {
        syncQueueItems.push({
          id: generateUUID(),
          operation: 'CREATE_PRODUCT',
          entityType: 'PRODUCT',
          entityId: cp.id,
          payload: cp,
          status: 'PENDING',
          createdAt: nowIso,
        });
      }
    }

    if (oldTransfer.status === 'COMPLETED' || status === 'COMPLETED') {
      db.saveProducts(finalProducts);
      const finalProdMap = new Map(finalProducts.map(p => [p.id, p]));
      for (const pid of allUpdatedIds) {
        const up = finalProdMap.get(pid);
        if (up) {
          syncQueueItems.push({
            id: generateUUID(),
            operation: 'UPDATE_PRODUCT',
            entityType: 'PRODUCT',
            entityId: up.id,
            payload: up,
            status: 'PENDING',
            createdAt: nowIso,
          });
        }
      }

      // Replace previous STORE_TRANSFER movements for this transfer ID
      const remainingMovements = db
        .getMovements()
        .filter(m => !(m.type === 'STORE_TRANSFER' && m.referenceId === transferId));
      db.saveMovements([...newMovements, ...remainingMovements]);
    }

    const updatedTransfer: StockTransfer = {
      ...oldTransfer,
      transferDate,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      sourceName: locCheck.sourceName!,
      sourceLocation: locCheck.sourceLocation,
      sourceShopId: locCheck.sourceShopId!,
      sourceShopName: locCheck.sourceShopName,
      destType: params.destType,
      destId: params.destId,
      destName: locCheck.destName!,
      destLocation: locCheck.destLocation,
      destShopId: locCheck.destShopId!,
      destShopName: locCheck.destShopName,
      status,
      shippingCharges,
      notice: params.notice?.trim() || undefined,
      items: finalItems,
      totalUnits,
      totalAmount: Math.round(totalAmount * 100) / 100,
      updatedAt: nowIso,
    };

    const nextTransfers = [...existingTransfers];
    nextTransfers[existingIdx] = updatedTransfer;
    db.saveStockTransfers(nextTransfers);

    syncQueueItems.push({
      id: generateUUID(),
      operation: 'UPSERT_STOCK_TRANSFER',
      entityType: 'STOCK_TRANSFER',
      entityId: updatedTransfer.id,
      payload: updatedTransfer,
      status: 'PENDING',
      createdAt: nowIso,
    });
    db.enqueueSyncBatch(syncQueueItems);

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'UPDATE_STOCK_TRANSFER',
      details: `Updated transfer ${updatedTransfer.transferNumber} (${updatedTransfer.status}): ${totalUnits} unit(s) across ${finalItems.length} item(s)`,
      entityType: 'STORE',
      entityId: updatedTransfer.id,
      shopId: updatedTransfer.destShopId,
      timestamp: nowIso,
    });

    return { success: true, transfer: updatedTransfer };
  }

  public static deleteStockTransfer(
    transferId: string,
    currentUser: User
  ): { success: boolean; error?: string } {
    if (!hasAdminAccess(currentUser)) {
      return {
        success: false,
        error: 'Permission Denied: Only Admins and Shop Admins can delete stock transfers.',
      };
    }

    const existingTransfers = db.getStockTransfers();
    const target = existingTransfers.find(t => t.id === transferId);
    if (!target) {
      return { success: false, error: 'Stock transfer record not found.' };
    }

    if (
      !isPlatformAdmin(currentUser) &&
      (!canAccessShopAsAdmin(currentUser, target.sourceShopId) ||
        !canAccessShopAsAdmin(currentUser, target.destShopId))
    ) {
      return {
        success: false,
        error: 'Permission Denied: You can only delete transfers belonging to your managed shops.',
      };
    }

    const nowIso = new Date().toISOString();
    const syncQueueItems: any[] = [];

    if (target.status === 'COMPLETED') {
      const reversed = this.reverseStockTransferEffects({
        transfer: target,
        nowIso,
        products: db.getProducts(),
        allStores: db.getStores(),
      });
      db.saveProducts(reversed.products);
      const prodMap = new Map(reversed.products.map(p => [p.id, p]));
      for (const pid of reversed.updatedProductIds) {
        const up = prodMap.get(pid);
        if (up) {
          syncQueueItems.push({
            id: generateUUID(),
            operation: 'UPDATE_PRODUCT',
            entityType: 'PRODUCT',
            entityId: up.id,
            payload: up,
            status: 'PENDING',
            createdAt: nowIso,
          });
        }
      }
    }

    const nextTransfers = existingTransfers.filter(t => t.id !== transferId);
    db.saveStockTransfers(nextTransfers);

    const nextMovements = db
      .getMovements()
      .filter(m => !(m.type === 'STORE_TRANSFER' && m.referenceId === transferId));
    db.saveMovements(nextMovements);

    syncQueueItems.push({
      id: generateUUID(),
      operation: 'DELETE_STOCK_TRANSFER',
      entityType: 'STOCK_TRANSFER',
      entityId: transferId,
      payload: { id: transferId },
      status: 'PENDING',
      createdAt: nowIso,
    });
    db.enqueueSyncBatch(syncQueueItems);

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'DELETE_STOCK_TRANSFER',
      details: `Deleted stock transfer ${target.transferNumber} (${target.sourceName} -> ${target.destName})`,
      entityType: 'STORE',
      entityId: transferId,
      shopId: target.destShopId,
      timestamp: nowIso,
    });

    return { success: true };
  }

  /**
   * Synchronize a product's shop-floor quantity into its `storeStocks` / `storeDetails`
   * map when a store in that shop is designated as `isShopFloor` (e.g. SONKO SOUND SHOP).
   */
  public static applyFloorStockDeltaToProduct<T extends { shopId: string; storeStocks?: Record<string, number>; storeDetails?: Record<string, any> }>(
    product: T,
    newFloorQty: number
  ): T {
    if (!product.storeStocks) return product;
    const floorStore = db
      .getStores()
      .find(s => s.shopId === product.shopId && s.isShopFloor && s.status === 'ACTIVE');
    if (!floorStore) return product;

    const nextStoreStocks = {
      ...product.storeStocks,
      [floorStore.id]: Math.max(0, newFloorQty),
    };
    const nextStoreDetails = product.storeDetails
      ? {
          ...product.storeDetails,
          ...(product.storeDetails[floorStore.id]
            ? {
                [floorStore.id]: {
                  ...product.storeDetails[floorStore.id],
                  quantity: Math.max(0, newFloorQty),
                },
              }
            : {}),
        }
      : undefined;

    return {
      ...product,
      storeStocks: nextStoreStocks,
      ...(nextStoreDetails ? { storeDetails: nextStoreDetails } : {}),
    };
  }
}
