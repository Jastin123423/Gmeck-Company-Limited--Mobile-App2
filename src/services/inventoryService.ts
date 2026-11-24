import { db } from '../db/storage';
import { InventoryMovement, MovementType, User } from '../types';
import { generateUUID } from '../utils/crypto';
import { StoreService } from './storeService';
import { canAccessShopAsAdmin, getShopAdminShopIds, isPlatformAdmin, isShopAdmin } from '../utils/permissions';

export class InventoryService {
  /**
   * Adjust stock manually for count correction, damage, loss, or physical inventory.
   * Admin OR Seller with canManageInventory permission.
   */
  public static adjustStock(
    productId: string,
    newQuantity: number,
    reason: string,
    currentUser: User,
    movementType: MovementType = 'ADJUSTMENT',
    storeId?: string
  ): { success: boolean; error?: string; lossValue?: number } {
    const platformAdmin = isPlatformAdmin(currentUser);
    const shopAdmin = isShopAdmin(currentUser);

    if (!platformAdmin && !shopAdmin && !currentUser.permissions?.canManageInventory) {
      return {
        success: false,
        error: 'Permission Denied: You do not have permission to adjust stock levels.',
      };
    }

    if (!reason?.trim()) {
      return { success: false, error: 'Please provide a reason for the stock adjustment.' };
    }

    const products = db.getProducts();
    const prodIndex = products.findIndex(p => p.id === productId);
    if (prodIndex === -1) {
      return { success: false, error: 'Product not found.' };
    }

    const prod = products[prodIndex];
    if (!platformAdmin && shopAdmin && !canAccessShopAsAdmin(currentUser, prod.shopId)) {
      return {
        success: false,
        error: 'Permission Denied: You can only adjust stock for products in your managed shop.',
      };
    }

    const nowIso = new Date().toISOString();
    const shop = db.getShops().find(s => s.id === prod.shopId);
    const safeNewQty = Math.max(0, Number(newQuantity || 0));

    // Warehouse store stock adjustment
    if (storeId) {
      const allStores = db.getStores();
      const targetStore = allStores.find(
        s => s.id === storeId && s.shopId === prod.shopId && !s.isShopFloor
      );
      if (!targetStore) {
        return { success: false, error: 'Selected store not found for this product.' };
      }

      const floorStoreIds = new Set(allStores.filter(s => s.isShopFloor).map(s => s.id));
      const shopWarehouses = allStores
        .filter(s => s.shopId === prod.shopId && !s.isShopFloor)
        .sort((a, b) => {
          if (a.status !== b.status) return a.status === 'ACTIVE' ? -1 : 1;
          return (a.createdAt || '').localeCompare(b.createdAt || '');
        });
      const shopWarehouseIds = new Set(shopWarehouses.map(s => s.id));

      // Seed storeStocks map cleanly (preserving legacy single-store balance if storeStocks was empty)
      const baseStoreStocks: Record<string, number> = { ...(prod.storeStocks || {}) };
      const mappedWarehouseSum = Object.entries(baseStoreStocks).reduce(
        (sum, [sid, q]) => (shopWarehouseIds.has(sid) ? sum + Math.max(0, Number(q || 0)) : sum),
        0
      );
      const rawStoreStock = Math.max(0, Number(prod.storeStock || 0));
      if (mappedWarehouseSum === 0 && rawStoreStock > 0 && shopWarehouses.length > 0) {
        const legacyStoreId =
          prod.storeId && shopWarehouseIds.has(prod.storeId)
            ? prod.storeId
            : shopWarehouses[0].id;
        baseStoreStocks[legacyStoreId] = rawStoreStock;
      }

      const prevQty =
        baseStoreStocks[targetStore.id] !== undefined
          ? Math.max(0, Number(baseStoreStocks[targetStore.id] || 0))
          : prod.storeDetails?.[targetStore.id] !== undefined
            ? Math.max(0, Number(prod.storeDetails[targetStore.id].quantity || 0))
            : 0;

      const diff = safeNewQty - prevQty;
      if (diff === 0) {
        return { success: true };
      }

      const nextStoreStocks: Record<string, number> = {
        ...baseStoreStocks,
        [targetStore.id]: safeNewQty,
      };
      const nextStoreDetails = prod.storeDetails
        ? {
            ...prod.storeDetails,
            [targetStore.id]: {
              ...(prod.storeDetails[targetStore.id] || {
                storeId: targetStore.id,
                storeName: targetStore.name,
                unitPurchasePrice: prod.purchasePrice || 0,
                unitSellingPrice: prod.sellingPrice || 0,
              }),
              storeId: targetStore.id,
              storeName: targetStore.name,
              quantity: safeNewQty,
            },
          }
        : undefined;

      const nextTotalWarehouseStock = Object.entries(nextStoreStocks).reduce(
        (sum, [sid, q]) => (floorStoreIds.has(sid) ? sum : sum + Math.max(0, Number(q || 0))),
        0
      );

      const updatedProduct = {
        ...prod,
        storeStock: nextTotalWarehouseStock,
        storeStocks: nextStoreStocks,
        ...(nextStoreDetails ? { storeDetails: nextStoreDetails } : {}),
        updatedAt: nowIso,
      };
      products[prodIndex] = updatedProduct;
      db.saveProducts(products);

      const costValue = Number((Math.abs(diff) * (prod.purchasePrice || 0)).toFixed(2));
      const movement: InventoryMovement = {
        id: generateUUID(),
        shopId: prod.shopId,
        shopName: shop?.name || 'Main Shop',
        storeId: targetStore.id,
        productId: prod.id,
        productName: prod.name,
        previousQty: prevQty,
        changeQty: diff,
        newQty: safeNewQty,
        type: movementType,
        costValue,
        reason: `${reason.trim()} [${targetStore.name} · ${shop?.name || 'Shop'}]`,
        userId: currentUser.id,
        userName: currentUser.name,
        createdAt: nowIso,
      };
      db.saveMovements([movement, ...db.getMovements()]);

      db.enqueueSyncBatch([
        {
          id: generateUUID(),
          operation: 'UPDATE_PRODUCT',
          entityType: 'PRODUCT',
          entityId: updatedProduct.id,
          payload: updatedProduct,
          status: 'PENDING',
          createdAt: nowIso,
        },
        {
          id: generateUUID(),
          operation: 'STOCK_ADJUSTMENT',
          entityType: 'INVENTORY',
          entityId: movement.id,
          payload: {
            ...movement,
            totalStoreStock: nextTotalWarehouseStock,
            storeStocks: nextStoreStocks,
            ...(nextStoreDetails ? { storeDetails: nextStoreDetails } : {}),
          },
          status: 'PENDING',
          createdAt: nowIso,
        },
      ]);

      db.addAuditLog({
        id: generateUUID(),
        userId: currentUser.id,
        userName: currentUser.name,
        action: 'STOCK_ADJUSTMENT',
        details: `Adjusted '${prod.name}' stock in store '${targetStore.name}' from ${prevQty} to ${safeNewQty} (${movementType}: ${reason.trim()}, Cost Impact: ${costValue}) [${shop?.name || 'Shop'}]`,
        entityType: 'INVENTORY',
        entityId: prod.id,
        timestamp: nowIso,
      });

      return { success: true, lossValue: diff < 0 ? costValue : 0 };
    }

    // Shop Floor stock adjustment
    const prevQty = Number(prod.currentStock || 0);
    const diff = safeNewQty - prevQty;

    if (diff === 0) {
      return { success: true };
    }

    const costValue = Number((Math.abs(diff) * (prod.purchasePrice || 0)).toFixed(2));

    const synced = StoreService.applyFloorStockDeltaToProduct(prod, safeNewQty);
    const updatedProduct = {
      ...synced,
      currentStock: safeNewQty,
      updatedAt: nowIso,
    };
    products[prodIndex] = updatedProduct;
    db.saveProducts(products);

    const movement: InventoryMovement = {
      id: generateUUID(),
      shopId: prod.shopId,
      shopName: shop?.name || 'Main Shop',
      productId: prod.id,
      productName: prod.name,
      previousQty: prevQty,
      changeQty: diff,
      newQty: safeNewQty,
      type: movementType,
      costValue,
      reason: `${reason.trim()} [${shop?.name || 'Shop'}]`,
      userId: currentUser.id,
      userName: currentUser.name,
      createdAt: nowIso,
    };
    db.saveMovements([movement, ...db.getMovements()]);

    // Sync updated product (in case floor storeStocks changed) + movement
    db.enqueueSyncBatch([
      {
        id: generateUUID(),
        operation: 'UPDATE_PRODUCT',
        entityType: 'PRODUCT',
        entityId: updatedProduct.id,
        payload: updatedProduct,
        status: 'PENDING',
        createdAt: nowIso,
      },
      {
        id: generateUUID(),
        operation: 'STOCK_ADJUSTMENT',
        entityType: 'INVENTORY',
        entityId: movement.id,
        payload: movement,
        status: 'PENDING',
        createdAt: nowIso,
      },
    ]);

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'STOCK_ADJUSTMENT',
      details: `Adjusted '${prod.name}' stock from ${prevQty} to ${safeNewQty} (${movementType}: ${reason.trim()}, Cost Impact: ${costValue}) in [${shop?.name || 'Shop'}]`,
      entityType: 'INVENTORY',
      entityId: prod.id,
      timestamp: nowIso,
    });

    return { success: true, lossValue: diff < 0 ? costValue : 0 };
  }

  /**
   * Receive fast stock-in.
   * Admin OR Seller with canManageInventory permission.
   */
  public static stockIn(
    productId: string,
    addQuantity: number,
    reason: string,
    currentUser: User
  ): { success: boolean; error?: string } {
    if (!isPlatformAdmin(currentUser) && !isShopAdmin(currentUser) && !currentUser.permissions?.canManageInventory) {
      return {
        success: false,
        error: 'Permission Denied: You do not have permission to perform stock-in.',
      };
    }

    if (addQuantity <= 0) {
      return { success: false, error: 'Quantity must be greater than 0.' };
    }

    const products = db.getProducts();
    const prod = products.find(p => p.id === productId);
    if (!prod) return { success: false, error: 'Product not found.' };

    return this.adjustStock(
      productId,
      prod.currentStock + addQuantity,
      reason || 'Quick Stock In',
      currentUser
    );
  }

  public static getMovements(productId?: string, shopId?: string): InventoryMovement[] {
    let movements = db.getMovements();
    if (shopId && shopId !== 'ALL') {
      movements = movements.filter(m => m.shopId === shopId);
    }
    if (productId) {
      movements = movements.filter(m => m.productId === productId);
    }
    return movements;
  }

  public static getMovementHistory(
    filter?: { search?: string; productId?: string; shopId?: string },
    currentUser?: User
  ): InventoryMovement[] {
    let list = db.getMovements();

    if (currentUser && !isPlatformAdmin(currentUser) && isShopAdmin(currentUser)) {
      const managedShopIds = getShopAdminShopIds(currentUser);
      list = list.filter(m => managedShopIds.includes(m.shopId));
    }

    if (filter?.shopId && filter.shopId !== 'ALL') {
      list = list.filter(m => m.shopId === filter.shopId);
    }

    if (filter?.productId) {
      list = list.filter(m => m.productId === filter.productId);
    }

    if (filter?.search?.trim()) {
      const q = filter.search.trim().toLowerCase();
      list = list.filter(
        m =>
          m.productName.toLowerCase().includes(q) ||
          m.reason.toLowerCase().includes(q) ||
          m.userName.toLowerCase().includes(q) ||
          (m.shopName && m.shopName.toLowerCase().includes(q))
      );
    }
    return list;
  }

  public static getInventoryValuation(shopId?: string, currentUser?: User) {
    let products = db.getProducts().filter(p => p.status === 'ACTIVE');
    if (currentUser && !isPlatformAdmin(currentUser) && isShopAdmin(currentUser)) {
      const managedShopIds = getShopAdminShopIds(currentUser);
      products = products.filter(p => managedShopIds.includes(p.shopId));
    }
    if (shopId && shopId !== 'ALL') {
      products = products.filter(p => p.shopId === shopId);
    }

    const totalCost = products.reduce((acc, p) => acc + p.currentStock * p.purchasePrice, 0);
    const totalRetail = products.reduce((acc, p) => acc + p.currentStock * p.sellingPrice, 0);
    const totalUnits = products.reduce((acc, p) => acc + Math.max(0, p.currentStock), 0);
    const potentialProfit = totalRetail - totalCost;
    const lowStockCount = products.filter(
      p => p.currentStock > 0 && p.currentStock <= p.minStock
    ).length;
    const outOfStockCount = products.filter(p => p.currentStock <= 0).length;

    return {
      totalCost: Number(totalCost.toFixed(2)),
      totalRetail: Number(totalRetail.toFixed(2)),
      totalCostValue: Number(totalCost.toFixed(2)),
      totalRetailValue: Number(totalRetail.toFixed(2)),
      totalUnits,
      totalUnitsInStock: totalUnits,
      potentialProfit: Number(potentialProfit.toFixed(2)),
      lowStockCount,
      outOfStockCount,
      productCount: products.length,
      totalProducts: products.length,
    };
  }
}
