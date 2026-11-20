import { db } from '../db/storage';
import {
  Purchase,
  PurchaseItem,
  PurchaseReturn,
  PurchaseReturnItem,
  PaymentStatus,
  User,
} from '../types';
import { generateUUID } from '../utils/crypto';
import { generatePurchaseNumber } from '../utils/formatters';
import { StoreService } from './storeService';
import { canAccessShopAsAdmin, getShopAdminShopIds, isPlatformAdmin, isShopAdmin } from '../utils/permissions';

export interface PurchaseItemInput {
  productId: string;
  quantity: number;
  unitCost: number;
}

export class PurchaseService {
  /**
   * Record a new purchase order / stock-in for a specific shop.
   * Uses LATEST PURCHASE PRICE for inventory valuation (no averaging).
   */
  public static recordPurchase(
    params: {
      shopId?: string;
      storeId?: string;
      supplierName: string;
      date?: string;
      items: PurchaseItemInput[];
      paymentStatus: PaymentStatus;
      notes?: string;
      invoiceNumber?: string;
    },
    currentUser: User
  ): { success: boolean; purchase?: Purchase; error?: string } {
    const platformAdmin = isPlatformAdmin(currentUser);
    const shopAdmin = isShopAdmin(currentUser);
    const managedShopIds = getShopAdminShopIds(currentUser);

    const targetShopId =
      params.shopId ||
      (!platformAdmin && shopAdmin ? managedShopIds[0] : undefined) ||
      db.getShops()[0]?.id ||
      'shop-1';

    // Check role and shop assignment permissions
    if (!platformAdmin) {
      if (shopAdmin) {
        if (!managedShopIds.includes(targetShopId)) {
          return {
            success: false,
            error: 'Permission Denied: You can only record purchases for your managed shop.',
          };
        }
      } else {
        const assigned = currentUser.assignedShopIds || [];
        if (assigned.length > 0 && !assigned.includes(targetShopId)) {
          return {
            success: false,
            error: 'Permission Denied: You are not assigned to record purchases for this shop.',
          };
        }
      }
    }
    const shop = db.getShops().find(s => s.id === targetShopId);
    if (!shop) {
      return { success: false, error: 'Selected shop does not exist.' };
    }

    const targetStore = params.storeId
      ? db.getStores().find(st => st.id === params.storeId)
      : undefined;
    if (params.storeId) {
      if (!targetStore) {
        return { success: false, error: 'Selected destination store does not exist.' };
      }
      if (targetStore.shopId !== targetShopId) {
        return { success: false, error: 'Selected store does not belong to the chosen shop.' };
      }
      if (targetStore.status !== 'ACTIVE') {
        return { success: false, error: `Store '${targetStore.name}' is inactive.` };
      }
    }

    if (!params.items || params.items.length === 0) {
      return { success: false, error: 'Please add at least one product item.' };
    }

    const products = [...db.getProducts()];
    const purchaseId = generateUUID();
    const purchaseNumber = generatePurchaseNumber();
    const purchaseItems: PurchaseItem[] = [];
    let totalAmount = 0;

    for (const itemInput of params.items) {
      const prodIndex = products.findIndex(p => p.id === itemInput.productId);

      if (prodIndex === -1) {
        return { success: false, error: `Product not found (ID: ${itemInput.productId})` };
      }

      const prod = products[prodIndex];

      if (itemInput.quantity <= 0) {
        return {
          success: false,
          error: `Invalid quantity for ${prod.name}. Must be greater than 0.`,
        };
      }

      if (itemInput.unitCost < 0) {
        return {
          success: false,
          error: `Unit cost for ${prod.name} cannot be negative.`,
        };
      }

      const itemTotal = itemInput.quantity * itemInput.unitCost;
      totalAmount += itemTotal;

      purchaseItems.push({
        id: generateUUID(),
        productId: prod.id,
        productName: prod.name,
        quantity: itemInput.quantity,
        unitCost: itemInput.unitCost,
        total: itemTotal,
      });

      // ✅ LATEST PURCHASE PRICE (no averaging) — route to Store Warehouse or Shop Floor
      if (targetStore) {
        const currentStoreStock = prod.storeStock || 0;
        const newStoreStock = currentStoreStock + itemInput.quantity;
        const nextStoreStocks = { ...(prod.storeStocks || {}) };
        const prevSpecificStoreQty =
          nextStoreStocks[targetStore.id] !== undefined
            ? Number(nextStoreStocks[targetStore.id] || 0)
            : currentStoreStock;
        nextStoreStocks[targetStore.id] = prevSpecificStoreQty + itemInput.quantity;

        const nextStoreDetails = {
          ...(prod.storeDetails || {}),
          [targetStore.id]: {
            ...(prod.storeDetails?.[targetStore.id] || {
              storeId: targetStore.id,
              storeName: targetStore.name,
            }),
            storeId: targetStore.id,
            storeName: targetStore.name,
            quantity: nextStoreStocks[targetStore.id],
            unitPurchasePrice: Number(itemInput.unitCost.toFixed(2)),
            unitSellingPrice: prod.sellingPrice || 0,
            lastImportedAt: new Date().toISOString(),
          },
        };

        products[prodIndex] = {
          ...prod,
          storeStock: newStoreStock,
          storeStocks: nextStoreStocks,
          storeDetails: nextStoreDetails,
          purchasePrice: Number(itemInput.unitCost.toFixed(2)),
          updatedAt: new Date().toISOString(),
        };

        const movement = {
          id: generateUUID(),
          shopId: targetShopId,
          shopName: shop.name,
          storeId: targetStore.id,
          productId: prod.id,
          productName: prod.name,
          previousQty: currentStoreStock,
          changeQty: itemInput.quantity,
          newQty: newStoreStock,
          type: 'PURCHASE' as const,
          reason: `PO ${purchaseNumber} to Store '${targetStore.name}' [${shop.name}] from ${
            params.supplierName?.trim() || 'Walk-in Supplier'
          } @ ${itemInput.unitCost}/unit`,
          costValue: itemTotal,
          userId: currentUser.id,
          userName: currentUser.name,
          createdAt: new Date().toISOString(),
        };
        db.saveMovements([movement, ...db.getMovements()]);
      } else {
        const currentStock = prod.currentStock || 0;
        const newStock = currentStock + itemInput.quantity;
        const prevStock = currentStock;
        const synced = StoreService.applyFloorStockDeltaToProduct(prod, newStock);

        products[prodIndex] = {
          ...synced,
          currentStock: newStock,
          purchasePrice: Number(itemInput.unitCost.toFixed(2)), // ✅ Always latest price
          updatedAt: new Date().toISOString(),
        };

        // Record inventory movement with ACTUAL purchase price
        const movement = {
          id: generateUUID(),
          shopId: targetShopId,
          shopName: shop.name,
          productId: prod.id,
          productName: prod.name,
          previousQty: prevStock,
          changeQty: itemInput.quantity,
          newQty: newStock,
          type: 'PURCHASE' as const,
          reason: `PO ${purchaseNumber} from ${
            params.supplierName?.trim() || 'Walk-in Supplier'
          } [${shop.name}] @ ${itemInput.unitCost}/unit`,
          costValue: itemTotal,
          userId: currentUser.id,
          userName: currentUser.name,
          createdAt: new Date().toISOString(),
        };
        db.saveMovements([movement, ...db.getMovements()]);
      }
    }

    // Save updated products with new latest costs
    db.saveProducts(products);

    const finalSupplierName = params.supplierName?.trim() || 'Walk-in Supplier';

    const newPurchase: Purchase = {
      id: purchaseId,
      shopId: targetShopId,
      shopName: shop.name,
      storeId: targetStore?.id,
      storeName: targetStore?.name,
      purchaseNumber,
      supplierName: finalSupplierName,
      date: params.date || new Date().toISOString().slice(0, 10),
      items: purchaseItems,
      totalAmount,
      paymentStatus: params.paymentStatus,
      notes: params.notes?.trim() || undefined,
      invoiceNumber: params.invoiceNumber?.trim() || undefined,
      createdByUserId: currentUser.id,
      createdByName: currentUser.name,
      createdAt: new Date().toISOString(),
    };

    db.savePurchases([newPurchase, ...db.getPurchases()]);

    db.enqueueSync({
      id: generateUUID(),
      operation: 'CREATE_PURCHASE',
      entityType: 'PURCHASE',
      entityId: purchaseId,
      payload: newPurchase,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'RECORD_PURCHASE',
      details: `Recorded purchase ${purchaseNumber} from ${finalSupplierName} for [${shop.name}]`,
      entityType: 'PURCHASE',
      entityId: purchaseId,
      timestamp: new Date().toISOString(),
    });

    return { success: true, purchase: newPurchase };
  }

  public static createPurchase(
    params: {
      shopId?: string;
      storeId?: string;
      supplierName: string;
      date?: string;
      items: PurchaseItemInput[];
      paymentStatus: PaymentStatus;
      notes?: string;
      invoiceNumber?: string;
    },
    currentUser: User
  ) {
    return this.recordPurchase(params, currentUser);
  }

  /**
   * Update an existing purchase.
   * Can update metadata only OR items (which triggers stock recalculation).
   */
  public static updatePurchase(
    purchaseId: string,
    updates: {
      supplierName?: string;
      invoiceNumber?: string;
      paymentStatus?: PaymentStatus;
      notes?: string;
      items?: PurchaseItemInput[];
    },
    currentUser: User
  ): { success: boolean; purchase?: Purchase; error?: string } {
    const purchases = db.getPurchases();
    const index = purchases.findIndex(p => p.id === purchaseId);

    if (index === -1) {
      return { success: false, error: 'Purchase not found.' };
    }

    const current = purchases[index];

    // Check permissions
    const canEdit =
      isPlatformAdmin(currentUser) ||
      canAccessShopAsAdmin(currentUser, current.shopId) ||
      current.createdByUserId === currentUser.id;

    if (!canEdit) {
      return {
        success: false,
        error: 'Permission Denied: You can only update purchases from your managed shop.',
      };
    }

    // If items are being updated, recalculate stock
    if (updates.items && updates.items.length > 0) {
      const products = [...db.getProducts()];

      const isStorePurchase = Boolean(current.storeId);

      // First, reverse the OLD purchase stock (subtract old quantities)
      for (const oldItem of current.items) {
        const prodIndex = products.findIndex(p => p.id === oldItem.productId);
        if (prodIndex !== -1) {
          if (isStorePurchase) {
            products[prodIndex] = {
              ...products[prodIndex],
              storeStock: Math.max(
                0,
                (products[prodIndex].storeStock || 0) - oldItem.quantity
              ),
              updatedAt: new Date().toISOString(),
            };
          } else {
            products[prodIndex] = {
              ...products[prodIndex],
              currentStock: Math.max(
                0,
                (products[prodIndex].currentStock || 0) - oldItem.quantity
              ),
              updatedAt: new Date().toISOString(),
            };
          }
        }
      }

      // Then apply NEW quantities (add new stock with LATEST price)
      const purchaseItems: PurchaseItem[] = [];
      let totalAmount = 0;

      for (const itemInput of updates.items) {
        const prodIndex = products.findIndex(p => p.id === itemInput.productId);
        if (prodIndex === -1) {
          return { success: false, error: `Product not found (ID: ${itemInput.productId})` };
        }

        if (itemInput.quantity <= 0) {
          return { success: false, error: `Invalid quantity. Must be greater than 0.` };
        }

        if (itemInput.unitCost < 0) {
          return { success: false, error: `Unit cost cannot be negative.` };
        }

        const itemTotal = itemInput.quantity * itemInput.unitCost;
        totalAmount += itemTotal;

        purchaseItems.push({
          id: generateUUID(),
          productId: itemInput.productId,
          productName: products[prodIndex].name,
          quantity: itemInput.quantity,
          unitCost: itemInput.unitCost,
          total: itemTotal,
        });

        // ✅ Use LATEST purchase price (no averaging)
        const prevStock = isStorePurchase
          ? products[prodIndex].storeStock || 0
          : products[prodIndex].currentStock || 0;
        const newTotalStock = prevStock + itemInput.quantity;

        // Add new stock with LATEST price
        products[prodIndex] = {
          ...products[prodIndex],
          ...(isStorePurchase
            ? { storeStock: newTotalStock }
            : { currentStock: newTotalStock }),
          purchasePrice: Number(itemInput.unitCost.toFixed(2)), // ✅ Latest price
          updatedAt: new Date().toISOString(),
        };

        // Record inventory movement
        const movement = {
          id: generateUUID(),
          shopId: current.shopId,
          shopName: current.shopName,
          storeId: current.storeId,
          productId: itemInput.productId,
          productName: products[prodIndex].name,
          previousQty: prevStock,
          changeQty: itemInput.quantity,
          newQty: newTotalStock,
          type: 'PURCHASE_EDIT' as const,
          reason: `Corrected PO ${current.purchaseNumber} - quantity adjusted`,
          costValue: itemTotal,
          userId: currentUser.id,
          userName: currentUser.name,
          createdAt: new Date().toISOString(),
        };
        db.saveMovements([movement, ...db.getMovements()]);
      }

      // Save updated products
      db.saveProducts(products);

      // Update purchase
      const updatedPurchase: Purchase = {
        ...current,
        supplierName: updates.supplierName?.trim() || current.supplierName,
        invoiceNumber: updates.invoiceNumber?.trim() || undefined,
        paymentStatus: updates.paymentStatus || current.paymentStatus,
        notes: updates.notes?.trim() || undefined,
        items: purchaseItems,
        totalAmount,
        updatedAt: new Date().toISOString(),
      };

      purchases[index] = updatedPurchase;
      db.savePurchases(purchases);

      // Queue sync
      db.enqueueSync({
        id: generateUUID(),
        operation: 'UPDATE_PURCHASE',
        entityType: 'PURCHASE',
        entityId: purchaseId,
        payload: updatedPurchase,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      });

      // Audit log
      db.addAuditLog({
        id: generateUUID(),
        userId: currentUser.id,
        userName: currentUser.name,
        action: 'UPDATE_PURCHASE_ITEMS',
        details: `Updated purchase items for ${current.purchaseNumber}. Stock recalculated.`,
        entityType: 'PURCHASE',
        entityId: purchaseId,
        timestamp: new Date().toISOString(),
      });

      return { success: true, purchase: updatedPurchase };
    }

    // If only basic info updated (no items)
    const updatedPurchase: Purchase = {
      ...current,
      supplierName: updates.supplierName?.trim() || current.supplierName,
      invoiceNumber: updates.invoiceNumber?.trim() || undefined,
      paymentStatus: updates.paymentStatus || current.paymentStatus,
      notes: updates.notes?.trim() || undefined,
      updatedAt: new Date().toISOString(),
    };

    purchases[index] = updatedPurchase;
    db.savePurchases(purchases);

    db.enqueueSync({
      id: generateUUID(),
      operation: 'UPDATE_PURCHASE',
      entityType: 'PURCHASE',
      entityId: purchaseId,
      payload: updatedPurchase,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'UPDATE_PURCHASE',
      details: `Updated purchase ${current.purchaseNumber} metadata`,
      entityType: 'PURCHASE',
      entityId: purchaseId,
      timestamp: new Date().toISOString(),
    });

    return { success: true, purchase: updatedPurchase };
  }

  /**
   * Void and completely delete a purchase.
   * Reverts all stock quantities previously added by this purchase (shop floor or store warehouse)
   * back to their prior values, logs reversal movements, deletes the purchase record completely,
   * and enqueues a DELETE_PURCHASE sync operation.
   */
  public static voidPurchase(
    purchaseId: string,
    reason: string,
    currentUser: User
  ): { success: boolean; revertedUnits?: number; error?: string } {
    const purchases = db.getPurchases();
    const index = purchases.findIndex(p => p.id === purchaseId);

    if (index === -1) {
      return { success: false, error: 'Purchase not found.' };
    }

    const current = purchases[index];

    // Check permissions (matching updatePurchase)
    const canVoid =
      isPlatformAdmin(currentUser) ||
      canAccessShopAsAdmin(currentUser, current.shopId) ||
      current.createdByUserId === currentUser.id;

    if (!canVoid) {
      return {
        success: false,
        error: 'Permission Denied: You can only void purchases from your managed shop.',
      };
    }

    const trimmedReason = reason?.trim();
    if (!trimmedReason) {
      return { success: false, error: 'Please provide a reason for voiding this purchase.' };
    }

    const nowIso = new Date().toISOString();
    const products = [...db.getProducts()];
    const reversalMovements = [];
    const isStorePurchase = Boolean(current.storeId);
    const resolvedStoreName =
      current.storeName ||
      (current.storeId
        ? db.getStores().find(st => st.id === current.storeId)?.name
        : undefined) ||
      'Store';
    let revertedUnits = 0;

    for (const item of current.items || []) {
      const qty = Number(item.quantity) || 0;
      if (qty <= 0) continue;
      revertedUnits += qty;

      const prodIndex = products.findIndex(p => p.id === item.productId);
      if (prodIndex === -1) continue;

      const prod = products[prodIndex];

      if (isStorePurchase && current.storeId) {
        const prevStoreStock = prod.storeStock || 0;
        const newStoreStock = Math.max(0, prevStoreStock - qty);
        const nextStoreStocks = { ...(prod.storeStocks || {}) };
        const prevSpecificStoreQty =
          nextStoreStocks[current.storeId] !== undefined
            ? Number(nextStoreStocks[current.storeId] || 0)
            : prevStoreStock;
        nextStoreStocks[current.storeId] = Math.max(0, prevSpecificStoreQty - qty);

        const nextStoreDetails = prod.storeDetails ? { ...prod.storeDetails } : undefined;
        if (nextStoreDetails && nextStoreDetails[current.storeId]) {
          nextStoreDetails[current.storeId] = {
            ...nextStoreDetails[current.storeId],
            quantity: nextStoreStocks[current.storeId],
          };
        }

        products[prodIndex] = {
          ...prod,
          storeStock: newStoreStock,
          storeStocks: nextStoreStocks,
          ...(nextStoreDetails ? { storeDetails: nextStoreDetails } : {}),
          updatedAt: nowIso,
        };

        reversalMovements.push({
          id: generateUUID(),
          shopId: current.shopId,
          shopName: current.shopName,
          storeId: current.storeId,
          productId: prod.id,
          productName: prod.name,
          previousQty: prevStoreStock,
          changeQty: -qty,
          newQty: newStoreStock,
          type: 'VOID_RETURN' as const,
          reason: `Voided & deleted PO ${current.purchaseNumber || current.id} from Store '${resolvedStoreName}': ${trimmedReason}`,
          costValue: item.total,
          referenceId: current.id,
          userId: currentUser.id,
          userName: currentUser.name,
          createdAt: nowIso,
        });
      } else {
        const prevStock = prod.currentStock || 0;
        const newStock = Math.max(0, prevStock - qty);
        const synced = StoreService.applyFloorStockDeltaToProduct(prod, newStock);

        products[prodIndex] = {
          ...synced,
          currentStock: newStock,
          updatedAt: nowIso,
        };

        reversalMovements.push({
          id: generateUUID(),
          shopId: current.shopId,
          shopName: current.shopName,
          productId: prod.id,
          productName: prod.name,
          previousQty: prevStock,
          changeQty: -qty,
          newQty: newStock,
          type: 'VOID_RETURN' as const,
          reason: `Voided & deleted PO ${current.purchaseNumber || current.id} (${current.supplierName}): ${trimmedReason}`,
          costValue: item.total,
          referenceId: current.id,
          userId: currentUser.id,
          userName: currentUser.name,
          createdAt: nowIso,
        });
      }
    }

    // Save reverted product quantities & inventory movements
    db.saveProducts(products);
    if (reversalMovements.length > 0) {
      db.saveMovements([...reversalMovements, ...db.getMovements()]);
    }

    // Delete the purchase record completely
    const remainingPurchases = purchases.filter(p => p.id !== purchaseId);
    db.savePurchases(remainingPurchases);

    // Enqueue sync operation so D1 reverts stock and permanently deletes the purchase
    db.enqueueSync({
      id: generateUUID(),
      operation: 'DELETE_PURCHASE',
      entityType: 'PURCHASE',
      entityId: purchaseId,
      payload: {
        id: purchaseId,
        purchaseId,
        purchaseNumber: current.purchaseNumber,
        shopId: current.shopId,
        shopName: current.shopName,
        storeId: current.storeId,
        storeName: current.storeName,
        supplierName: current.supplierName,
        items: current.items,
        reason: trimmedReason,
        voidedByUserId: currentUser.id,
        voidedByName: currentUser.name,
        voidedAt: nowIso,
      },
      status: 'PENDING',
      createdAt: nowIso,
    });

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'VOID_DELETE_PURCHASE',
      details: `Voided and deleted purchase ${current.purchaseNumber || current.id} (${current.supplierName}), reverted ${revertedUnits} units. Reason: ${trimmedReason}`,
      entityType: 'PURCHASE',
      entityId: purchaseId,
      shopId: current.shopId,
      timestamp: nowIso,
    });

    return { success: true, revertedUnits };
  }

  /**
   * Return specific quantities from an existing purchase.
   * Reduces the purchased item quantities & total amount on the purchase,
   * deducts the returned units from Shop Floor or Store Warehouse stock,
   * records a PurchaseReturn entry for the Return List, and syncs the updated purchase.
   */
  public static returnPurchaseItems(
    purchaseId: string,
    returnSelections: { productId: string; itemId?: string; returnQty: number }[],
    reason: string,
    currentUser: User
  ): {
    success: boolean;
    purchaseReturn?: PurchaseReturn;
    updatedPurchase?: Purchase;
    error?: string;
  } {
    const purchases = db.getPurchases();
    const index = purchases.findIndex(p => p.id === purchaseId);

    if (index === -1) {
      return { success: false, error: 'Purchase not found.' };
    }

    const current = purchases[index];

    const canReturn =
      isPlatformAdmin(currentUser) ||
      canAccessShopAsAdmin(currentUser, current.shopId) ||
      current.createdByUserId === currentUser.id;

    if (!canReturn) {
      return {
        success: false,
        error: 'Permission Denied: You can only return purchases from your managed shop.',
      };
    }

    const trimmedReason = reason?.trim();
    if (!trimmedReason) {
      return { success: false, error: 'Please provide a reason for this purchase return.' };
    }

    const validSelections = (returnSelections || []).filter(
      s => Number.isFinite(Number(s.returnQty)) && Number(s.returnQty) > 0
    );

    if (validSelections.length === 0) {
      return { success: false, error: 'Enter a return quantity greater than 0 for at least one product.' };
    }

    const nowIso = new Date().toISOString();
    const dateStamp = nowIso.slice(0, 10).replace(/-/g, '');
    const returnNumber = `PR-${dateStamp}-${Math.floor(1000 + Math.random() * 9000)}`;

    const products = [...db.getProducts()];
    const isStorePurchase = Boolean(current.storeId);
    const resolvedStoreName =
      current.storeName ||
      (current.storeId
        ? db.getStores().find(st => st.id === current.storeId)?.name
        : undefined) ||
      'Store';

    const returnedItems: PurchaseReturnItem[] = [];
    const updatedPurchaseItems: PurchaseItem[] = [];
    const movementsToAdd = [];
    let totalReturnQty = 0;
    let totalReturnAmount = 0;

    for (const item of current.items || []) {
      const sel = validSelections.find(
        s => (s.itemId && s.itemId === item.id) || (!s.itemId && s.productId === item.productId)
      );
      const returnQty = sel ? Number(sel.returnQty) : 0;

      if (returnQty > item.quantity) {
        return {
          success: false,
          error: `Return quantity (${returnQty}) for ${item.productName} cannot exceed purchased quantity (${item.quantity}).`,
        };
      }

      if (returnQty > 0) {
        const remainingQty = Math.max(0, Number((item.quantity - returnQty).toFixed(4)));
        const returnTotal = Number((returnQty * item.unitCost).toFixed(2));
        const remainingTotal = Number((remainingQty * item.unitCost).toFixed(2));

        totalReturnQty += returnQty;
        totalReturnAmount += returnTotal;

        returnedItems.push({
          id: generateUUID(),
          productId: item.productId,
          productName: item.productName,
          originalQty: item.quantity,
          returnQty,
          remainingQty,
          unitCost: item.unitCost,
          returnTotal,
        });

        if (remainingQty > 0) {
          updatedPurchaseItems.push({
            ...item,
            quantity: remainingQty,
            total: remainingTotal,
          });
        }

        // Deduct returned quantity from product stock (Store or Shop Floor)
        const prodIndex = products.findIndex(p => p.id === item.productId);
        if (prodIndex !== -1) {
          const prod = products[prodIndex];

          if (isStorePurchase && current.storeId) {
            const prevStoreStock = prod.storeStock || 0;
            const newStoreStock = Math.max(0, prevStoreStock - returnQty);
            const nextStoreStocks = { ...(prod.storeStocks || {}) };
            const prevSpecificStoreQty =
              nextStoreStocks[current.storeId] !== undefined
                ? Number(nextStoreStocks[current.storeId] || 0)
                : prevStoreStock;
            nextStoreStocks[current.storeId] = Math.max(0, prevSpecificStoreQty - returnQty);

            const nextStoreDetails = prod.storeDetails ? { ...prod.storeDetails } : undefined;
            if (nextStoreDetails && nextStoreDetails[current.storeId]) {
              nextStoreDetails[current.storeId] = {
                ...nextStoreDetails[current.storeId],
                quantity: nextStoreStocks[current.storeId],
              };
            }

            products[prodIndex] = {
              ...prod,
              storeStock: newStoreStock,
              storeStocks: nextStoreStocks,
              ...(nextStoreDetails ? { storeDetails: nextStoreDetails } : {}),
              updatedAt: nowIso,
            };

            movementsToAdd.push({
              id: generateUUID(),
              shopId: current.shopId,
              shopName: current.shopName,
              storeId: current.storeId,
              productId: prod.id,
              productName: prod.name,
              previousQty: prevStoreStock,
              changeQty: -returnQty,
              newQty: newStoreStock,
              type: 'RETURN' as const,
              reason: `Purchase Return ${returnNumber} (PO ${current.purchaseNumber}) from Store '${resolvedStoreName}': ${trimmedReason}`,
              costValue: returnTotal,
              referenceId: current.id,
              userId: currentUser.id,
              userName: currentUser.name,
              createdAt: nowIso,
            });
          } else {
            const prevStock = prod.currentStock || 0;
            const newStock = Math.max(0, prevStock - returnQty);
            const synced = StoreService.applyFloorStockDeltaToProduct(prod, newStock);

            products[prodIndex] = {
              ...synced,
              currentStock: newStock,
              updatedAt: nowIso,
            };

            movementsToAdd.push({
              id: generateUUID(),
              shopId: current.shopId,
              shopName: current.shopName,
              productId: prod.id,
              productName: prod.name,
              previousQty: prevStock,
              changeQty: -returnQty,
              newQty: newStock,
              type: 'RETURN' as const,
              reason: `Purchase Return ${returnNumber} (PO ${current.purchaseNumber} - ${current.supplierName}): ${trimmedReason}`,
              costValue: returnTotal,
              referenceId: current.id,
              userId: currentUser.id,
              userName: currentUser.name,
              createdAt: nowIso,
            });
          }
        }
      } else {
        updatedPurchaseItems.push(item);
      }
    }

    if (returnedItems.length === 0) {
      return { success: false, error: 'No matching purchase items were selected for return.' };
    }

    const newPurchaseTotal = Number(
      updatedPurchaseItems.reduce((sum, i) => sum + i.total, 0).toFixed(2)
    );

    const updatedPurchase: Purchase = {
      ...current,
      items: updatedPurchaseItems,
      totalAmount: newPurchaseTotal,
      updatedAt: nowIso,
    };

    const purchaseReturn: PurchaseReturn = {
      id: generateUUID(),
      returnNumber,
      purchaseId: current.id,
      purchaseNumber: current.purchaseNumber,
      shopId: current.shopId,
      shopName: current.shopName,
      storeId: current.storeId,
      storeName: current.storeId ? resolvedStoreName : undefined,
      supplierName: current.supplierName,
      invoiceNumber: current.invoiceNumber,
      items: returnedItems,
      totalReturnQty,
      totalReturnAmount: Number(totalReturnAmount.toFixed(2)),
      reason: trimmedReason,
      returnedByUserId: currentUser.id,
      returnedByName: currentUser.name,
      createdAt: nowIso,
    };

    // Save products, movements, updated purchase, and purchase return record
    db.saveProducts(products);
    if (movementsToAdd.length > 0) {
      db.saveMovements([...movementsToAdd, ...db.getMovements()]);
    }

    purchases[index] = updatedPurchase;
    db.savePurchases(purchases);
    db.savePurchaseReturns([purchaseReturn, ...db.getPurchaseReturns()]);

    // Sync updated purchase quantities, total amount, and stock to D1
    db.enqueueSync({
      id: generateUUID(),
      operation: 'UPDATE_PURCHASE',
      entityType: 'PURCHASE',
      entityId: purchaseId,
      payload: updatedPurchase,
      status: 'PENDING',
      createdAt: nowIso,
    });

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'PURCHASE_RETURN',
      details: `Returned ${totalReturnQty} unit(s) (${returnNumber}) from PO ${current.purchaseNumber} (${current.supplierName}). Remaining purchase total: ${newPurchaseTotal}. Reason: ${trimmedReason}`,
      entityType: 'PURCHASE',
      entityId: purchaseId,
      shopId: current.shopId,
      timestamp: nowIso,
    });

    return {
      success: true,
      purchaseReturn,
      updatedPurchase,
    };
  }

  /**
   * Get purchase returns filtered by shop and search query.
   */
  public static getPurchaseReturns(
    options?: {
      shopId?: string;
      search?: string;
    },
    currentUser?: User
  ): PurchaseReturn[] {
    let returns = db.getPurchaseReturns();

    if (currentUser && !isPlatformAdmin(currentUser) && isShopAdmin(currentUser)) {
      const managedIds = getShopAdminShopIds(currentUser);
      returns = returns.filter(r => managedIds.includes(r.shopId));
    } else if (currentUser && !isPlatformAdmin(currentUser) && !isShopAdmin(currentUser)) {
      const assigned = currentUser.assignedShopIds || [];
      if (assigned.length > 0) {
        returns = returns.filter(r => assigned.includes(r.shopId));
      }
    }

    if (options?.shopId && options.shopId !== 'ALL') {
      returns = returns.filter(r => r.shopId === options.shopId);
    }

    if (options?.search?.trim()) {
      const q = options.search.trim().toLowerCase();
      returns = returns.filter(
        r =>
          r.returnNumber.toLowerCase().includes(q) ||
          r.purchaseNumber.toLowerCase().includes(q) ||
          r.supplierName.toLowerCase().includes(q) ||
          r.reason.toLowerCase().includes(q) ||
          (r.returnedByName && r.returnedByName.toLowerCase().includes(q)) ||
          (r.items || []).some(i => i.productName.toLowerCase().includes(q))
      );
    }

    return returns;
  }

  /**
   * Get purchases filtered by shop, supplier, date.
   */
  public static getPurchases(
    options?: {
      shopId?: string;
      supplierName?: string;
      search?: string;
      paymentStatus?: PaymentStatus | 'ALL';
      startDate?: string;
      endDate?: string;
    },
    currentUser?: User
  ): Purchase[] {
    let purchases = db.getPurchases();

    if (currentUser && !isPlatformAdmin(currentUser) && isShopAdmin(currentUser)) {
      const managedIds = getShopAdminShopIds(currentUser);
      purchases = purchases.filter(p => managedIds.includes(p.shopId));
    }

    if (options?.shopId && options.shopId !== 'ALL') {
      purchases = purchases.filter(p => p.shopId === options.shopId);
    }

    if (options?.search?.trim()) {
      const q = options.search.trim().toLowerCase();
      purchases = purchases.filter(
        p =>
          p.supplierName.toLowerCase().includes(q) ||
          p.purchaseNumber.toLowerCase().includes(q) ||
          (p.invoiceNumber && p.invoiceNumber.toLowerCase().includes(q)) ||
          (p.shopName && p.shopName.toLowerCase().includes(q))
      );
    }

    if (options?.supplierName) {
      const q = options.supplierName.toLowerCase();
      purchases = purchases.filter(p => p.supplierName.toLowerCase().includes(q));
    }

    if (options?.paymentStatus && options.paymentStatus !== 'ALL') {
      purchases = purchases.filter(p => p.paymentStatus === options.paymentStatus);
    }

    if (options?.startDate) {
      purchases = purchases.filter(p => p.date >= options.startDate!);
    }

    if (options?.endDate) {
      purchases = purchases.filter(p => p.date <= options.endDate!);
    }

    return purchases;
  }
}
