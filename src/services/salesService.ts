import { db } from '../db/storage';
import { Sale, SaleItem, PaymentMethod, User, SaleEditRequest } from '../types';
import { generateUUID } from '../utils/crypto';
import { generateReceiptNumber } from '../utils/formatters';
import { NotificationService } from './notificationService';
import { StoreService } from './storeService';
import { canAccessShopAsAdmin, getShopAdminShopIds, hasAdminAccess, isPlatformAdmin, isShopAdmin } from '../utils/permissions';

export interface CartItemInput {
  productId: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
}

export class SalesService {
  /**
   * Complete a new sale transaction for a specific shop.
   */
  public static createSale(
    params: {
      shopId: string;
      items: CartItemInput[];
      paymentMethod: PaymentMethod;
      discount?: number;
      amountReceived: number;
      notes?: string;
      assistantName?: string;
      saleDate?: string; // Optional YYYY-MM-DD local date (defaults to today; allows previous dates)
    },
    currentUser: User
  ): { success: boolean; sale?: Sale; error?: string } {
    if (!params.shopId) {
      return { success: false, error: 'Shop identification is required to process sale.' };
    }

    const shop = db.getShops().find(s => s.id === params.shopId);
    if (!shop) {
      return { success: false, error: 'Selected shop does not exist.' };
    }

    if (shop.status !== 'ACTIVE') {
      return {
        success: false,
        error: `Shop "${shop.name}" is currently inactive. Sales cannot be recorded.`,
      };
    }

    if (!params.items || params.items.length === 0) {
      return { success: false, error: 'Cart is empty. Please add items to complete sale.' };
    }

    const products = db.getProducts();
    const settings = db.getSettings();

    const saleItems: SaleItem[] = [];
    let subtotal = 0;
    let totalCostOfGoods = 0;

    for (const itemInput of params.items) {
      const product = products.find(
        p => p.id === itemInput.productId && p.shopId === params.shopId
      );
      if (!product) {
        return {
          success: false,
          error: `Product not found in ${shop.name} (ID: ${itemInput.productId})`,
        };
      }

      if (product.status !== 'ACTIVE') {
        return { success: false, error: `Product '${product.name}' is inactive and cannot be sold.` };
      }

      if (product.currentStock < itemInput.quantity) {
        return {
          success: false,
          error: `Insufficient stock in ${shop.name} for '${product.name}'. Available: ${product.currentStock} ${product.unit}, Requested: ${itemInput.quantity}`,
        };
      }

      const itemTotal = itemInput.quantity * itemInput.unitPrice - (itemInput.discount || 0);
      subtotal += itemTotal;
      totalCostOfGoods += itemInput.quantity * product.purchasePrice;

      // 🔒 Snapshot the reference price at the exact moment of sale
      const referencePrice =
        product.proposedSellingPrice && product.proposedSellingPrice > 0
          ? product.proposedSellingPrice
          : product.sellingPrice || 0;
      const referenceType: 'PROPOSED' | 'SELLING' =
        product.proposedSellingPrice && product.proposedSellingPrice > 0
          ? 'PROPOSED'
          : 'SELLING';

      saleItems.push({
        id: generateUUID(),
        saleId: '',
        shopId: params.shopId,
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        unitPrice: itemInput.unitPrice,
        purchasePrice: product.purchasePrice,
        quantity: itemInput.quantity,
        discount: itemInput.discount || 0,
        total: Math.max(0, itemTotal),
        referencePrice,
        referenceType,
      });
    }

    const overallDiscount = params.discount || 0;
    const discountedSubtotal = Math.max(0, subtotal - overallDiscount);
    const taxAmount = 0;
    const finalTotal = Number(discountedSubtotal.toFixed(2));
    const safeAmountReceived = Number.isFinite(params.amountReceived) && params.amountReceived >= 0
      ? params.amountReceived
      : finalTotal;

    const change = 0;
    const grossProfit = Number((finalTotal - totalCostOfGoods).toFixed(2));

    const saleId = generateUUID();
    const receiptNumber = generateReceiptNumber();

    saleItems.forEach(item => {
      item.saleId = saleId;
    });

    const now = new Date();
    const todayLocalYMD = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    let saleCreatedAt = now.toISOString();
    let isBackdated = false;
    let backdatedLabel = '';

    if (params.saleDate && /^\d{4}-\d{2}-\d{2}$/.test(params.saleDate.trim())) {
      const requestedYMD = params.saleDate.trim();
      if (requestedYMD > todayLocalYMD) {
        return {
          success: false,
          error: 'Sale date cannot be in the future. Please select today or a previous date.',
        };
      }
      if (requestedYMD < todayLocalYMD) {
        if (!hasAdminAccess(currentUser)) {
          return {
            success: false,
            error: 'Permission Denied: Only Admin can record sales for a previous date.',
          };
        }
        const [y, m, d] = requestedYMD.split('-').map(Number);
        const backdated = new Date(
          y,
          m - 1,
          d,
          now.getHours(),
          now.getMinutes(),
          now.getSeconds(),
          now.getMilliseconds()
        );
        if (!Number.isNaN(backdated.getTime())) {
          saleCreatedAt = backdated.toISOString();
          isBackdated = true;
          backdatedLabel = requestedYMD;
        }
      }
    }

    const newSale: Sale = {
      id: saleId,
      receiptNumber,
      shopId: params.shopId,
      shopName: shop.name,
      sellerId: currentUser.id,
      sellerName: currentUser.name,
      assistantName: params.assistantName?.trim() || undefined,
      subtotal: Number(subtotal.toFixed(2)),
      discount: Number(overallDiscount.toFixed(2)),
      tax: taxAmount,
      total: finalTotal,
      costOfGoods: Number(totalCostOfGoods.toFixed(2)),
      grossProfit,
      paymentMethod: params.paymentMethod,
      amountReceived: Number(safeAmountReceived.toFixed(2)),
      change: Number(change.toFixed(2)),
      status: 'COMPLETED',
      notes: params.notes?.trim(),
      createdAt: saleCreatedAt,
      items: saleItems,
    };

    const updatedProducts = products.map(prod => {
      const soldItem = saleItems.find(
        si => si.productId === prod.id && prod.shopId === params.shopId
      );
      if (soldItem) {
        const nextFloorQty = prod.currentStock - soldItem.quantity;
        const synced = StoreService.applyFloorStockDeltaToProduct(prod, nextFloorQty);
        return {
          ...synced,
          currentStock: nextFloorQty,
          updatedAt: now.toISOString(),
        };
      }
      return prod;
    });
    db.saveProducts(updatedProducts);

    const newMovements = saleItems.map(item => {
      const prod = products.find(p => p.id === item.productId)!;
      return {
        id: generateUUID(),
        shopId: params.shopId,
        shopName: shop.name,
        productId: item.productId,
        productName: item.productName,
        previousQty: prod.currentStock,
        changeQty: -item.quantity,
        newQty: prod.currentStock - item.quantity,
        type: 'SALE' as const,
        reason: isBackdated
          ? `Sale ${receiptNumber} (${currentUser.name}) [${shop.name}] - Backdated ${backdatedLabel}`
          : `Sale ${receiptNumber} (${currentUser.name}) [${shop.name}]`,
        referenceId: saleId,
        userId: currentUser.id,
        userName: currentUser.name,
        createdAt: saleCreatedAt,
      };
    });
    db.saveMovements([...newMovements, ...db.getMovements()]);

    db.saveSales([newSale, ...db.getSales()]);

    db.enqueueSync({
      id: generateUUID(),
      operation: 'CREATE_SALE',
      entityType: 'SALE',
      entityId: saleId,
      payload: newSale,
      status: 'PENDING',
      createdAt: now.toISOString(),
    });

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'CREATE_SALE',
      details: `Completed sale ${receiptNumber} in [${shop.name}] for ${settings.currencySymbol}${finalTotal.toFixed(2)} (${params.paymentMethod})${isBackdated ? ` [Backdated to ${backdatedLabel}]` : ''}`,
      entityType: 'SALE',
      entityId: saleId,
      timestamp: now.toISOString(),
    });

    saleItems.forEach(item => {
      const prod = products.find(p => p.id === item.productId);
      if (prod && prod.purchasePrice > 0 && item.unitPrice < prod.purchasePrice) {
        NotificationService.notifyBelowCostSale(
          prod,
          item.unitPrice,
          currentUser,
          shop.name,
          receiptNumber
        );
      }
    });

    return { success: true, sale: newSale };
  }

  /**
   * Void/Cancel a sale transaction.
   */
  public static voidSale(
    saleId: string,
    voidReason: string,
    currentUser: User
  ): { success: boolean; error?: string } {
    if (!isPlatformAdmin(currentUser) && !isShopAdmin(currentUser)) {
      return { success: false, error: 'Permission Denied: Only Admin can void a sale.' };
    }

    if (!voidReason?.trim()) {
      return { success: false, error: 'A cancellation reason is required to void a sale.' };
    }

    const sales = db.getSales();
    const targetSale = sales.find(s => s.id === saleId);
    if (!targetSale) {
      return { success: false, error: 'Sale record not found.' };
    }

    if (!canAccessShopAsAdmin(currentUser, targetSale.shopId)) {
      return { success: false, error: 'Permission Denied: You can only void sales from your managed shop.' };
    }

    if (targetSale.status === 'VOIDED') {
      return { success: false, error: 'Sale has already been voided.' };
    }

    const products = db.getProducts();
    const returnMovements = [];

    for (const item of targetSale.items) {
      const prodIndex = products.findIndex(
        p => p.id === item.productId && p.shopId === targetSale.shopId
      );
      if (prodIndex !== -1) {
        const prod = products[prodIndex];
        const prevQty = prod.currentStock;
        const newQty = prevQty + item.quantity;

        const synced = StoreService.applyFloorStockDeltaToProduct(prod, newQty);
        products[prodIndex] = {
          ...synced,
          currentStock: newQty,
          updatedAt: new Date().toISOString(),
        };

        returnMovements.push({
          id: generateUUID(),
          shopId: targetSale.shopId,
          shopName: targetSale.shopName,
          productId: prod.id,
          productName: prod.name,
          previousQty: prevQty,
          changeQty: item.quantity,
          newQty,
          type: 'VOID_RETURN' as const,
          reason: `Restocked from voided sale ${targetSale.receiptNumber}: ${voidReason.trim()}`,
          referenceId: saleId,
          userId: currentUser.id,
          userName: currentUser.name,
          createdAt: new Date().toISOString(),
        });
      }
    }

    db.saveProducts(products);
    db.saveMovements([...returnMovements, ...db.getMovements()]);

    targetSale.status = 'VOIDED';
    targetSale.voidReason = voidReason.trim();
    targetSale.voidedAt = new Date().toISOString();
    targetSale.voidedBy = currentUser.name;
    db.saveSales(sales);

    db.enqueueSync({
      id: generateUUID(),
      operation: 'VOID_SALE',
      entityType: 'SALE',
      entityId: saleId,
      payload: { saleId, voidReason, voidedBy: currentUser.name },
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'VOID_SALE',
      details: `Voided sale ${targetSale.receiptNumber} (${voidReason.trim()}) in [${targetSale.shopName || 'Shop'}]. Restored inventory.`,
      entityType: 'SALE',
      entityId: saleId,
      timestamp: new Date().toISOString(),
    });

    return { success: true };
  }

  /**
   * Seller or Admin requests a sale edit
   */
  public static requestSaleEdit(
    saleId: string,
    newItems: CartItemInput[],
    reason: string,
    currentUser: User
  ): { success: boolean; error?: string; requiresApproval?: boolean } {
    const sales = db.getSales();
    const sale = sales.find(s => s.id === saleId);

    if (!sale) {
      return { success: false, error: 'Sale not found.' };
    }

    if (sale.status === 'VOIDED') {
      return { success: false, error: 'Cannot edit a voided sale.' };
    }

    if (!newItems || newItems.length === 0) {
      return { success: false, error: 'Please provide at least one item.' };
    }

    const products = db.getProducts();
    let newSubtotal = 0;
    let newCostOfGoods = 0;

    const newSaleItems: SaleItem[] = newItems.map(itemInput => {
      const product = products.find(p => p.id === itemInput.productId);
      if (!product) {
        throw new Error(`Product not found: ${itemInput.productId}`);
      }

      const itemTotal = itemInput.quantity * itemInput.unitPrice - (itemInput.discount || 0);
      newSubtotal += itemTotal;
      newCostOfGoods += itemInput.quantity * product.purchasePrice;

      // 🔒 Snapshot the reference price at the moment of the edit
      const referencePrice =
        product.proposedSellingPrice && product.proposedSellingPrice > 0
          ? product.proposedSellingPrice
          : product.sellingPrice || 0;
      const referenceType: 'PROPOSED' | 'SELLING' =
        product.proposedSellingPrice && product.proposedSellingPrice > 0
          ? 'PROPOSED'
          : 'SELLING';

      return {
        id: generateUUID(),
        saleId: sale.id,
        shopId: sale.shopId,
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        unitPrice: itemInput.unitPrice,
        purchasePrice: product.purchasePrice,
        quantity: itemInput.quantity,
        discount: itemInput.discount || 0,
        total: Math.max(0, itemTotal),
        referencePrice,
        referenceType,
      };
    });

    const newTotal = Number((newSubtotal - sale.discount).toFixed(2));
    const newGrossProfit = Number((newTotal - newCostOfGoods).toFixed(2));

    if (canAccessShopAsAdmin(currentUser, sale.shopId)) {
      return this.applySaleEdit(
        sale,
        {
          items: newSaleItems,
          subtotal: Number(newSubtotal.toFixed(2)),
          total: newTotal,
          costOfGoods: Number(newCostOfGoods.toFixed(2)),
          grossProfit: newGrossProfit,
          amountReceived: newTotal,
          change: 0,
        },
        currentUser,
        reason
      );
    }

    const editRequest: SaleEditRequest = {
      id: generateUUID(),
      saleId: sale.id,
      requestedByUserId: currentUser.id,
      requestedByName: currentUser.name,
      originalValues: {
        items: sale.items,
        total: sale.total,
        subtotal: sale.subtotal,
        grossProfit: sale.grossProfit,
        costOfGoods: sale.costOfGoods,
        amountReceived: sale.amountReceived,
        change: sale.change,
      },
      newValues: {
        items: newSaleItems,
        total: newTotal,
        subtotal: Number(newSubtotal.toFixed(2)),
        grossProfit: newGrossProfit,
        costOfGoods: Number(newCostOfGoods.toFixed(2)),
        amountReceived: newTotal,
        change: 0,
      },
      reason,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    };

    const editRequests = db.getSaleEditRequests?.() || [];
    db.saveSaleEditRequests?.([editRequest, ...editRequests]);

    db.enqueueSync({
      id: generateUUID(),
      operation: 'CREATE_SALE_EDIT_REQUEST',
      entityType: 'SALE_EDIT_REQUEST',
      entityId: editRequest.id,
      payload: editRequest,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    const recipientIds = db
      .getUsers()
      .filter(
        u =>
          u.status === 'ACTIVE' &&
          (u.role === 'ADMIN' || (isShopAdmin(u, sale.shopId) && (u.assignedShopIds || []).includes(sale.shopId)))
      )
      .map(u => u.id);

    if (recipientIds.length > 0) {
      NotificationService.notifySaleEditRequested(editRequest, recipientIds, sale.shopId, sale.shopName);
    }

    return { success: true, requiresApproval: true };
  }

  /**
   * Apply sale edit (used by admin)
   */
  private static applySaleEdit(
    sale: Sale,
    newValues: {
      items: SaleItem[];
      subtotal: number;
      total: number;
      costOfGoods: number;
      grossProfit: number;
      amountReceived: number;
      change: number;
    },
    currentUser: User,
    reason?: string
  ): { success: boolean; error?: string } {
    const products = db.getProducts();
    const sales = db.getSales();

    const updatedProducts = [...products];
    for (const oldItem of sale.items) {
      const prodIndex = updatedProducts.findIndex(p => p.id === oldItem.productId);
      if (prodIndex !== -1) {
        const nextQty = updatedProducts[prodIndex].currentStock + oldItem.quantity;
        const synced = StoreService.applyFloorStockDeltaToProduct(updatedProducts[prodIndex], nextQty);
        updatedProducts[prodIndex] = {
          ...synced,
          currentStock: nextQty,
          updatedAt: new Date().toISOString(),
        };
      }
    }

    for (const newItem of newValues.items) {
      const prodIndex = updatedProducts.findIndex(p => p.id === newItem.productId);
      if (prodIndex !== -1) {
        const nextQty = updatedProducts[prodIndex].currentStock - newItem.quantity;
        const synced = StoreService.applyFloorStockDeltaToProduct(updatedProducts[prodIndex], nextQty);
        updatedProducts[prodIndex] = {
          ...synced,
          currentStock: nextQty,
          updatedAt: new Date().toISOString(),
        };
      }
    }

    db.saveProducts(updatedProducts);

    const saleIndex = sales.findIndex(s => s.id === sale.id);
    if (saleIndex !== -1) {
      const editNote = `\n[Edited by ${currentUser.name} at ${new Date().toISOString()}${
        reason ? ` - Reason: ${reason}` : ''
      }]`;
      sales[saleIndex] = {
        ...sale,
        items: newValues.items,
        subtotal: newValues.subtotal,
        total: newValues.total,
        costOfGoods: newValues.costOfGoods,
        grossProfit: newValues.grossProfit,
        amountReceived: newValues.amountReceived,
        change: newValues.change,
        notes: (sale.notes || '') + editNote,
      };
      db.saveSales(sales);

      db.enqueueSync({
        id: generateUUID(),
        operation: 'UPDATE_SALE',
        entityType: 'SALE',
        entityId: sale.id,
        payload: sales[saleIndex],
        status: 'PENDING',
        createdAt: new Date().toISOString(),
      });

      db.addAuditLog({
        id: generateUUID(),
        userId: currentUser.id,
        userName: currentUser.name,
        action: 'EDIT_SALE',
        details: `Edited sale ${sale.receiptNumber}${reason ? ` - Reason: ${reason}` : ''}`,
        entityType: 'SALE',
        entityId: sale.id,
        timestamp: new Date().toISOString(),
      });
    }

    return { success: true };
  }

  /**
   * Approve or reject a sale edit request (admin only)
   * FIX: Update request status FIRST, then apply sale edit
   */
  public static reviewSaleEdit(
    requestId: string,
    action: 'APPROVE' | 'REJECT',
    currentUser: User,
    reviewNote?: string
  ): { success: boolean; error?: string } {
    if (!isPlatformAdmin(currentUser) && !isShopAdmin(currentUser)) {
      return { success: false, error: 'Only admin can review sale edits.' };
    }

    const requests = db.getSaleEditRequests?.() || [];
    const request = requests.find(r => r.id === requestId);

    if (!request) {
      return { success: false, error: 'Edit request not found.' };
    }

    const sales = db.getSales();
    const sale = sales.find(s => s.id === request.saleId);

    if (!isPlatformAdmin(currentUser) && (!sale || !isShopAdmin(currentUser, sale.shopId))) {
      return { success: false, error: 'Permission Denied: You can only review edit requests for your managed shop.' };
    }

    if (request.status !== 'PENDING') {
      return { success: false, error: 'Request already reviewed.' };
    }

    const updatedRequests = requests.map(r =>
      r.id === requestId
        ? {
            ...r,
            status: action === 'APPROVE' ? ('APPROVED' as const) : ('REJECTED' as const),
            reviewedByUserId: currentUser.id,
            reviewedByName: currentUser.name,
            reviewNote,
            reviewedAt: new Date().toISOString(),
          }
        : r
    );
    db.saveSaleEditRequests?.(updatedRequests);

    const updatedRequest = updatedRequests.find(r => r.id === requestId);
    db.enqueueSync({
      id: generateUUID(),
      operation: 'REVIEW_SALE_EDIT_REQUEST',
      entityType: 'SALE_EDIT_REQUEST',
      entityId: requestId,
      payload: {
        ...updatedRequest,
        id: requestId,
      },
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    if (action === 'APPROVE') {
      if (!sale) {
        return { success: false, error: 'Sale not found.' };
      }

      const result = this.applySaleEdit(sale, request.newValues, currentUser, request.reason);
      if (!result.success) {
        return result;
      }
    }

    NotificationService.notifySaleEditReviewed(request, action, currentUser.name, reviewNote);

    return { success: true };
  }

  /**
   * Get sale edit requests
   */
  public static getSaleEditRequests(currentUser: User): SaleEditRequest[] {
    const requests = db.getSaleEditRequests?.() || [];

    if (!Array.isArray(requests)) {
      console.warn('getSaleEditRequests: not an array');
      return [];
    }

    if (isPlatformAdmin(currentUser)) {
      return requests;
    }

    if (isShopAdmin(currentUser)) {
      const managedIds = getShopAdminShopIds(currentUser);
      const sales = db.getSales();
      return requests.filter(r => {
        if (r.requestedByUserId === currentUser.id) return true;
        const sale = sales.find(s => s.id === r.saleId);
        return !!sale && managedIds.includes(sale.shopId);
      });
    }

    return requests.filter(r => r.requestedByUserId === currentUser.id);
  }

  /**
   * Query sales.
   */
  public static getSales(
    options: {
      shopId?: string;
      sellerId?: string;
      personalOnly?: boolean;
      search?: string;
      paymentMethod?: PaymentMethod | 'ALL';
      status?: 'ALL' | 'COMPLETED' | 'VOIDED';
      startDate?: string;
      endDate?: string;
    },
    currentUser: User
  ): Sale[] {
    let sales = db.getSales();

    if (!Array.isArray(sales)) {
      console.warn('getSales: db.getSales() returned non-array');
      return [];
    }

    if (options.personalOnly) {
      sales = sales.filter(s => s.sellerId === currentUser.id);
    } else if (isPlatformAdmin(currentUser)) {
      if (options.sellerId && options.sellerId !== 'ALL') {
        sales = sales.filter(s => s.sellerId === options.sellerId);
      }
    } else if (isShopAdmin(currentUser)) {
      const managedIds = getShopAdminShopIds(currentUser);
      sales = sales.filter(s => managedIds.includes(s.shopId));
      if (options.sellerId && options.sellerId !== 'ALL') {
        sales = sales.filter(s => s.sellerId === options.sellerId);
      }
    } else {
      sales = sales.filter(s => s.sellerId === currentUser.id);
    }

    if (options.shopId && options.shopId !== 'ALL') {
      sales = sales.filter(s => s.shopId === options.shopId);
    }

    if (options.status && options.status !== 'ALL') {
      sales = sales.filter(s => s.status === options.status);
    }

    if (options.paymentMethod && options.paymentMethod !== 'ALL') {
      sales = sales.filter(s => s.paymentMethod === options.paymentMethod);
    }

    const rawSearch = (options.search || '').trim();
    const normalizedSearch = rawSearch.toLowerCase();
    const cleanedReceiptQuery = normalizedSearch.replace(/^#/, '').replace(/[\s-]+/g, '');

    if (rawSearch) {
      const productsById = new Map((db.getProducts() || []).map(p => [p.id, p]));
      const shopsById = new Map((db.getShops() || []).map(sh => [sh.id, sh]));

      const tokens = normalizedSearch
        .split(/\s+/)
        .map(t => t.replace(/^#/, '').replace(/,/g, '').trim())
        .filter(Boolean);

      const paymentAliases: Record<string, string> = {
        MOBILE_MONEY: 'mobile money mpesa m-pesa tigopesa tigo pesa airtel halopesa',
        CASH: 'cash pesa taslimu',
        CARD: 'card visa mastercard pos',
        BANK: 'bank transfer crdb nmb',
        OTHER: 'other',
      };

      const buildSaleHaystack = (s: Sale): string => {
        const shopObj = shopsById.get(s.shopId);
        const createdDate = new Date(s.createdAt);
        let dateTokens = s.createdAt || '';
        if (!Number.isNaN(createdDate.getTime())) {
          const y = createdDate.getFullYear();
          const m = String(createdDate.getMonth() + 1).padStart(2, '0');
          const d = String(createdDate.getDate()).padStart(2, '0');
          const shortMonth = createdDate.toLocaleDateString('en-US', { month: 'short' });
          const longMonth = createdDate.toLocaleDateString('en-US', { month: 'long' });
          dateTokens = `${y}-${m}-${d} ${d}/${m}/${y} ${d}-${m}-${y} ${d} ${shortMonth} ${y} ${shortMonth} ${d} ${longMonth} ${createdDate.toLocaleDateString()} ${createdDate.toLocaleTimeString()}`;
        }

        const receiptRaw = s.receiptNumber || '';
        const receiptCompact = receiptRaw.replace(/[\s-]+/g, '');
        const totalNum = Number(s.total || 0);
        const subtotalNum = Number(s.subtotal || 0);
        const receivedNum = Number(s.amountReceived || 0);
        const statusExtra = s.status === 'VOIDED' ? 'voided cancelled canceled' : 'completed paid';

        const itemParts = (s.items || []).map(i => {
          const prod = productsById.get(i.productId);
          return [
            i.productName || '',
            i.sku || '',
            prod?.barcode || '',
            (prod as any)?.variation || '',
            (prod as any)?.brand || '',
            String(i.quantity ?? ''),
            String(i.unitPrice ?? ''),
            String(i.total ?? ''),
          ].join(' ');
        });

        return [
          receiptRaw,
          receiptCompact,
          s.sellerName || '',
          s.assistantName || '',
          s.shopName || '',
          shopObj?.name || '',
          shopObj?.code || '',
          s.paymentMethod || '',
          (s.paymentMethod || '').replace(/_/g, ' '),
          paymentAliases[s.paymentMethod] || '',
          s.status || '',
          statusExtra,
          s.notes || '',
          s.voidReason || '',
          s.voidedBy || '',
          String(totalNum),
          String(Math.round(totalNum)),
          String(subtotalNum),
          String(receivedNum),
          dateTokens,
          ...itemParts,
        ]
          .join(' ')
          .toLowerCase()
          .replace(/,/g, '');
      };

      sales = sales.filter(s => {
        const hay = buildSaleHaystack(s);
        return tokens.every(tok => hay.includes(tok));
      });
    }

    if (options.startDate) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(options.startDate.trim());
      const start = m
        ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0).getTime()
        : new Date(options.startDate).getTime();
      if (!Number.isNaN(start)) {
        sales = sales.filter(s => new Date(s.createdAt).getTime() >= start);
      }
    }

    if (options.endDate) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(options.endDate.trim());
      const end = m
        ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999).getTime()
        : new Date(options.endDate).getTime() + 86399999;
      if (!Number.isNaN(end)) {
        sales = sales.filter(s => new Date(s.createdAt).getTime() <= end);
      }
    }

    return [...sales].sort((a, b) => {
      if (cleanedReceiptQuery) {
        const aRec = (a.receiptNumber || '').toLowerCase().replace(/[\s-]+/g, '');
        const bRec = (b.receiptNumber || '').toLowerCase().replace(/[\s-]+/g, '');
        const aExact = aRec === cleanedReceiptQuery ? 0 : aRec.includes(cleanedReceiptQuery) ? 1 : 2;
        const bExact = bRec === cleanedReceiptQuery ? 0 : bRec.includes(cleanedReceiptQuery) ? 1 : 2;
        if (aExact !== bExact) return aExact - bExact;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }

  public static getSaleByReceipt(receiptNumber: string, currentUser: User): Sale | undefined {
    const sale = db
      .getSales()
      .find(s => s.receiptNumber.toLowerCase() === receiptNumber.toLowerCase());
    if (!sale) return undefined;

    if (
      !isPlatformAdmin(currentUser) &&
      !isShopAdmin(currentUser, sale.shopId) &&
      sale.sellerId !== currentUser.id
    ) {
      return undefined;
    }
    return sale;
  }
}
