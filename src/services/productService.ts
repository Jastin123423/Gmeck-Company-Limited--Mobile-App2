import { db } from '../db/storage';
import { Product, ProductImage, ProductStatus, User } from '../types';
import { generateUUID } from '../utils/crypto';
import { normalizeProductImages } from '../utils/imageUtils';
import { CloudflareApi } from './cloudflareApi';
import { canAccessShopAsAdmin, getShopAdminShopIds, isPlatformAdmin, isShopAdmin } from '../utils/permissions';

// Helper to convert base64 to Blob
function base64ToBlob(dataUrl: string, mimeType: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      const base64 = dataUrl.split(',')[1];
      const binary = atob(base64);
      const array = new Uint8Array(binary.length);

      for (let i = 0; i < binary.length; i++) {
        array[i] = binary.charCodeAt(i);
      }

      resolve(new Blob([array], { type: mimeType }));
    } catch (error) {
      reject(error);
    }
  });
}

export class ProductService {
  public static getProducts(options?: {
    shopId?: string;
    categoryId?: string;
    search?: string;
    status?: ProductStatus | 'ALL';
    lowStockOnly?: boolean;
  }): Product[] {
    let products = db.getProducts();

    if (options?.shopId && options.shopId !== 'ALL') {
      products = products.filter(p => p.shopId === options.shopId);
    }

    if (options?.status && options.status !== 'ALL') {
      products = products.filter(p => p.status === options.status);
    }

    if (options?.categoryId && options.categoryId !== 'ALL') {
      products = products.filter(p => p.categoryId === options.categoryId);
    }

    if (options?.search) {
      const q = options.search.toLowerCase().trim();
      products = products.filter(
        p =>
          p.name.toLowerCase().includes(q) ||
          (p.variation || '').toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          p.barcode.toLowerCase().includes(q)
      );
    }

    if (options?.lowStockOnly) {
      products = products.filter(p => p.currentStock <= p.minStock);
    }

    return products;
  }

  public static getProductById(id: string): Product | undefined {
    return db.getProducts().find(p => p.id === id);
  }

  public static getProductByBarcode(barcode: string, shopId?: string): Product | undefined {
    return db.getProducts().find(p => {
      const match = p.barcode === barcode && p.status === 'ACTIVE';
      if (!match) return false;
      if (shopId && shopId !== 'ALL') return p.shopId === shopId;
      return true;
    });
  }

  /**
   * Upload product images to R2 and return updated images with URLs
   */
  private static async uploadImagesToR2(
    images: ProductImage[],
    productId: string
  ): Promise<ProductImage[]> {
    const uploadedImages: ProductImage[] = [];

    for (let i = 0; i < images.length; i++) {
      const img = images[i];

      // Skip if already synced with R2 URL
      if (
        img.syncStatus === 'SYNCED' &&
        (img.dataUrl.includes('m.gmeck.sonkosound.store') ||
          img.dataUrl.includes('m.diocres.jobsreport.online'))
      ) {
        uploadedImages.push(img);
        continue;
      }

      try {
        const online = await CloudflareApi.checkConnection();
        if (!online) {
          uploadedImages.push(img);
          continue;
        }

        const blob = await base64ToBlob(img.dataUrl, img.mimeType);
        const result = await CloudflareApi.uploadImage(blob, 'product', productId, i);

        if (result.success && result.url) {
          uploadedImages.push({
            ...img,
            dataUrl: result.url,
            thumbnailUrl: result.url,
            syncStatus: 'SYNCED',
          });
        } else {
          uploadedImages.push(img);
        }
      } catch (error) {
        console.log(`Image ${i} upload failed, keeping local:`, error);
        uploadedImages.push(img);
      }
    }

    return uploadedImages;
  }

  /**
   * Seller or Admin can create a new product.
   * Associated with the target shop (and optional store / optional 0-qty second location).
   */
  public static async createProduct(
    data: {
      shopId: string;
      storeId?: string;
      secondLocation?: {
        type: 'SHOP_FLOOR' | 'STORE';
        shopId: string;
        storeId?: string;
      };
      name: string;
      variation?: string;
      sku?: string;
      barcode?: string;
      categoryId: string;
      sellingPrice: number;
      purchasePrice?: number;
      currentStock: number;
      minStock?: number;
      unit?: string;
      status?: ProductStatus;
      images?: ProductImage[];
      imageUrl?: string;
    },
    currentUser: User
  ): Promise<{ success: boolean; product?: Product; secondaryProduct?: Product; error?: string }> {
    const checkShopPermission = (shopIdToCheck: string): string | null => {
      if (isPlatformAdmin(currentUser)) return null;
      if (isShopAdmin(currentUser)) {
        const managedIds = getShopAdminShopIds(currentUser);
        if (!managedIds.includes(shopIdToCheck)) {
          return 'Permission Denied: You can only add products to your managed shop.';
        }
      } else {
        const assigned = currentUser.assignedShopIds || [];
        if (assigned.length > 0 && !assigned.includes(shopIdToCheck)) {
          return 'Permission Denied: You are not assigned to this shop.';
        }
      }
      return null;
    };

    // Shop Admins & Sellers can only create products for their allowed shops
    const primaryPermErr = checkShopPermission(data.shopId);
    if (primaryPermErr) {
      return { success: false, error: primaryPermErr };
    }

    if (!data.name?.trim()) {
      return { success: false, error: 'Product name is required.' };
    }

    if (!data.shopId) {
      return { success: false, error: 'Shop assignment is required for the product.' };
    }

    const allShops = db.getShops();
    const allStores = db.getStores();

    const shop = allShops.find(s => s.id === data.shopId);
    if (!shop) {
      return { success: false, error: 'Selected shop does not exist.' };
    }

    const targetStore = data.storeId
      ? allStores.find(st => st.id === data.storeId)
      : undefined;
    if (data.storeId) {
      if (!targetStore) {
        return { success: false, error: 'Selected destination store does not exist.' };
      }
      if (targetStore.shopId !== data.shopId) {
        return { success: false, error: 'Selected store does not belong to this shop.' };
      }
      if (targetStore.status !== 'ACTIVE') {
        return { success: false, error: `Store '${targetStore.name}' is inactive.` };
      }
    }

    const initialQty = Math.max(0, Number(data.currentStock || 0));

    // Validate optional second location (strictly same-shop only & requires 0 quantity)
    let secondStore: typeof targetStore | undefined;
    const rawSecond = data.secondLocation;
    let effectiveSecond: typeof rawSecond | undefined;

    if (rawSecond) {
      if (rawSecond.shopId !== data.shopId) {
        return {
          success: false,
          error:
            'Second location must belong to the same shop. Cross-shop assignment is not allowed.',
        };
      }

      const isSamePrimary =
        (rawSecond.type === 'SHOP_FLOOR' && !data.storeId) ||
        (rawSecond.type === 'STORE' &&
          Boolean(data.storeId) &&
          rawSecond.storeId === data.storeId);

      if (!isSamePrimary) {
        if (initialQty > 0) {
          return {
            success: false,
            error:
              'Only products with 0 quantity qualify to be sent to multiple locations. Set quantity to 0.',
          };
        }

        if (rawSecond.type === 'STORE') {
          if (!rawSecond.storeId) {
            return { success: false, error: 'Please select a valid second location store.' };
          }
          secondStore = allStores.find(st => st.id === rawSecond.storeId);
          if (!secondStore) {
            return { success: false, error: 'Selected second location store does not exist.' };
          }
          if (secondStore.shopId !== data.shopId) {
            return {
              success: false,
              error: 'Second location store must belong to the same shop.',
            };
          }
          if (secondStore.isShopFloor) {
            return {
              success: false,
              error: 'Select the Shop Floor option instead of a floor store entry.',
            };
          }
          if (secondStore.status !== 'ACTIVE') {
            return {
              success: false,
              error: `Second location store '${secondStore.name}' is inactive.`,
            };
          }
        }

        effectiveSecond = rawSecond;
      }
    }

    if (data.sellingPrice === undefined || data.sellingPrice < 0) {
      return { success: false, error: 'Valid selling price is required.' };
    }

    const products = db.getProducts();
    const cleanSku = data.sku?.trim() || `SKU-${Date.now().toString().slice(-6)}`;
    const cleanBarcode =
      data.barcode?.trim() || `${Math.floor(100000000000 + Math.random() * 900000000000)}`;

    // SKU uniqueness within the primary shop
    const duplicateSku = products.find(
      p => p.shopId === data.shopId && p.sku.toLowerCase() === cleanSku.toLowerCase()
    );
    if (duplicateSku) {
      return { success: false, error: `SKU '${cleanSku}' already exists in this shop.` };
    }

    const productId = generateUUID();

    // Normalize images first
    let normalizedImages =
      data.images && data.images.length > 0
        ? normalizeProductImages(data.images.map(img => ({ ...img, productId })))
        : undefined;

    // Upload images to R2
    if (normalizedImages && normalizedImages.length > 0) {
      normalizedImages = await this.uploadImagesToR2(normalizedImages, productId);
    }

    const mainImageUrl =
      normalizedImages && normalizedImages.length > 0
        ? normalizedImages[0].thumbnailUrl || normalizedImages[0].dataUrl
        : data.imageUrl;

    const isSentToStore = Boolean(data.storeId && targetStore);
    const cleanVariation =
      data.variation?.trim() && data.variation.trim().toUpperCase() !== 'DUMMY'
        ? data.variation.trim()
        : undefined;
    const nowIso = new Date().toISOString();

    const storeStocksMap: Record<string, number> = {};
    const storeDetailsMap: Record<
      string,
      {
        storeId: string;
        storeName: string;
        quantity: number;
        unitPurchasePrice: number;
        unitSellingPrice: number;
        lastImportedAt: string;
      }
    > = {};

    let primaryStoreId: string | undefined = isSentToStore ? data.storeId : undefined;
    let assignPrimaryShopFloor = !isSentToStore;

    const addStoreEntry = (st: NonNullable<typeof targetStore>, qty: number) => {
      storeStocksMap[st.id] = qty;
      storeDetailsMap[st.id] = {
        storeId: st.id,
        storeName: st.name,
        quantity: qty,
        unitPurchasePrice: Number(data.purchasePrice || 0),
        unitSellingPrice: Number(data.sellingPrice),
        lastImportedAt: nowIso,
      };
    };

    if (isSentToStore && targetStore) {
      addStoreEntry(targetStore, initialQty);
    }

    // Same-shop second location attaches directly to the same Product record at 0 qty
    const isSameShopSecond = Boolean(effectiveSecond && effectiveSecond.shopId === data.shopId);
    if (isSameShopSecond && effectiveSecond) {
      if (effectiveSecond.type === 'STORE' && secondStore) {
        addStoreEntry(secondStore, 0);
        if (!primaryStoreId) {
          primaryStoreId = secondStore.id;
        }
      } else if (effectiveSecond.type === 'SHOP_FLOOR') {
        assignPrimaryShopFloor = true;
      }
    }

    // Register shop floor store entry if shop has an active floor store record
    if (assignPrimaryShopFloor) {
      const primaryFloorStore = allStores.find(
        st => st.shopId === data.shopId && st.isShopFloor && st.status === 'ACTIVE'
      );
      if (primaryFloorStore && storeStocksMap[primaryFloorStore.id] === undefined) {
        addStoreEntry(primaryFloorStore, isSentToStore ? 0 : initialQty);
      }
    }

    const hasAnyStoreMap = Object.keys(storeStocksMap).length > 0;
    const primaryCustomFields = assignPrimaryShopFloor
      ? { assignedShopFloor: true }
      : undefined;

    const newProduct: Product = {
      id: productId,
      shopId: data.shopId,
      storeId: primaryStoreId,
      name: data.name.trim(),
      ...(cleanVariation ? { variation: cleanVariation } : {}),
      sku: cleanSku,
      barcode: cleanBarcode,
      categoryId: data.categoryId || '',
      sellingPrice: Number(data.sellingPrice),
      purchasePrice: Number(data.purchasePrice || 0),
      currentStock: isSentToStore ? 0 : initialQty,
      storeStock: isSentToStore ? initialQty : 0,
      ...(hasAnyStoreMap ? { storeStocks: storeStocksMap } : {}),
      ...(hasAnyStoreMap ? { storeDetails: storeDetailsMap } : {}),
      ...(primaryCustomFields ? { customFields: primaryCustomFields } : {}),
      minStock: Math.max(0, Number(data.minStock ?? 0)),
      unit: data.unit?.trim() || 'pcs',
      status: data.status || 'ACTIVE',
      images: normalizedImages,
      imageUrl: mainImageUrl,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const updated = [newProduct, ...products];
    db.saveProducts(updated);

    // Record initial inventory movement (shop floor vs store warehouse)
    if (initialQty > 0) {
      db.saveMovements([
        {
          id: generateUUID(),
          shopId: newProduct.shopId,
          shopName: shop.name,
          storeId: isSentToStore ? data.storeId : undefined,
          productId: newProduct.id,
          productName: newProduct.name,
          previousQty: 0,
          changeQty: initialQty,
          newQty: initialQty,
          type: isSentToStore ? 'INITIAL_STOCK' : 'ADJUSTMENT',
          reason: isSentToStore
            ? `Initial stock opening in store '${targetStore!.name}' [${shop.name}] by ${currentUser.name}`
            : `Initial stock opening in ${shop.name} by ${currentUser.name}`,
          userId: currentUser.id,
          userName: currentUser.name,
          createdAt: new Date().toISOString(),
        },
        ...db.getMovements(),
      ]);
    }

    // Sync queue item — push.ts routes currentStock to store_stock when storeId is set
    db.enqueueSync({
      id: generateUUID(),
      operation: 'CREATE_PRODUCT',
      entityType: 'PRODUCT',
      entityId: newProduct.id,
      payload: isSentToStore
        ? {
            ...newProduct,
            storeId: primaryStoreId,
            currentStock: initialQty,
            createdByUserId: currentUser.id,
          }
        : newProduct,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    const secondLocAuditText = effectiveSecond
      ? effectiveSecond.type === 'STORE' && secondStore
        ? ` + 2nd Location Store '${secondStore.name}' [${shop.name}] (0 qty)`
        : ` + 2nd Location Shop Floor [${shop.name}] (0 qty)`
      : '';

    // Audit log
    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'CREATE_PRODUCT',
      details: isSentToStore
        ? `Created product '${newProduct.name}' in [${shop.name}] -> Store '${targetStore!.name}' (SKU: ${newProduct.sku}, Store Stock: ${initialQty})${secondLocAuditText}`
        : `Created product '${newProduct.name}' in [${shop.name}] (SKU: ${newProduct.sku}, Stock: ${newProduct.currentStock})${secondLocAuditText}`,
      entityType: 'PRODUCT',
      entityId: newProduct.id,
      timestamp: new Date().toISOString(),
    });

    return { success: true, product: newProduct };
  }

  /**
   * Admin or Seller with canEditProducts permission can edit existing products.
   */
  public static async updateProduct(
    id: string,
    updates: Partial<Omit<Product, 'id' | 'createdAt'>>,
    currentUser: User
  ): Promise<{ success: boolean; product?: Product; error?: string }> {
    const platformAdmin = isPlatformAdmin(currentUser);
    const shopAdmin = isShopAdmin(currentUser);
    if (!platformAdmin && !shopAdmin && !currentUser.permissions?.canEditProducts) {
      return {
        success: false,
        error: 'Permission Denied: You do not have permission to edit products.',
      };
    }

    const products = db.getProducts();
    const index = products.findIndex(p => p.id === id);
    if (index === -1) {
      return { success: false, error: 'Product not found.' };
    }

    const current = products[index];
    const targetShopId = updates.shopId || current.shopId;

    if (!platformAdmin && shopAdmin) {
      if (!canAccessShopAsAdmin(currentUser, current.shopId) || !canAccessShopAsAdmin(currentUser, targetShopId)) {
        return {
          success: false,
          error: 'Permission Denied: You can only edit products belonging to your managed shop.',
        };
      }
    }

    // If SKU changed, check uniqueness within shop
    if (updates.sku && updates.sku !== current.sku) {
      const dup = products.find(
        p =>
          p.id !== id &&
          p.shopId === targetShopId &&
          p.sku.toLowerCase() === updates.sku!.toLowerCase()
      );
      if (dup) {
        return { success: false, error: `SKU '${updates.sku}' is already assigned in this shop.` };
      }
    }

    let finalImages = updates.images !== undefined ? updates.images : current.images;
    if (finalImages && finalImages.length > 0) {
      finalImages = normalizeProductImages(finalImages.map(img => ({ ...img, productId: id })));
      // Upload images to R2
      finalImages = await this.uploadImagesToR2(finalImages, id);
    } else {
      finalImages = undefined;
    }

    const finalImageUrl =
      finalImages && finalImages.length > 0
        ? finalImages[0].thumbnailUrl || finalImages[0].dataUrl
        : updates.imageUrl !== undefined
        ? updates.imageUrl
        : finalImages
        ? undefined
        : current.imageUrl;

    const updatedProduct: Product = {
      ...current,
      ...updates,
      storeStock: updates.storeStock !== undefined ? updates.storeStock : (current.storeStock ?? 0),
      images: finalImages,
      imageUrl: finalImageUrl,
      updatedAt: new Date().toISOString(),
    };

    products[index] = updatedProduct;
    db.saveProducts(products);

    // Sync queue
    db.enqueueSync({
      id: generateUUID(),
      operation: 'UPDATE_PRODUCT',
      entityType: 'PRODUCT',
      entityId: id,
      payload: updatedProduct,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    // Audit log
    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'UPDATE_PRODUCT',
      details: `Updated product '${updatedProduct.name}' (Price: ${updatedProduct.sellingPrice})`,
      entityType: 'PRODUCT',
      entityId: id,
      timestamp: new Date().toISOString(),
    });

    return { success: true, product: updatedProduct };
  }

  /**
   * Toggle Product Active/Inactive status.
   * Admin or Seller with canEditProducts permission.
   */
  public static toggleProductStatus(
    id: string,
    newStatus: ProductStatus,
    currentUser: User
  ): { success: boolean; error?: string } {
    if (!isPlatformAdmin(currentUser) && !isShopAdmin(currentUser) && !currentUser.permissions?.canEditProducts) {
      return {
        success: false,
        error: 'Permission Denied: You do not have permission to change product status.',
      };
    }

    return this.updateProduct(id, { status: newStatus }, currentUser) as any;
  }

  /**
   * Delete a product permanently.
   * Admin or Seller with canDeleteProducts permission.
   */
  public static deleteProduct(
    productId: string,
    currentUser: User
  ): { success: boolean; error?: string } {
    const platformAdmin = isPlatformAdmin(currentUser);
    const shopAdmin = isShopAdmin(currentUser);
    if (!platformAdmin && !shopAdmin && !currentUser.permissions?.canDeleteProducts) {
      return {
        success: false,
        error: 'Permission Denied: You do not have permission to delete products.',
      };
    }

    const products = db.getProducts();
    const product = products.find(p => p.id === productId);

    if (!product) {
      return { success: false, error: 'Product not found.' };
    }

    if (!platformAdmin && shopAdmin && !canAccessShopAsAdmin(currentUser, product.shopId)) {
      return {
        success: false,
        error: 'Permission Denied: You can only delete products from your managed shop.',
      };
    }

    // Remove product
    const updatedProducts = products.filter(p => p.id !== productId);
    db.saveProducts(updatedProducts);

    // Sync to cloud
    db.enqueueSync({
      id: generateUUID(),
      operation: 'DELETE_PRODUCT',
      entityType: 'PRODUCT',
      entityId: productId,
      payload: { id: productId },
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    });

    // Audit log
    db.addAuditLog({
      id: generateUUID(),
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'DELETE_PRODUCT',
      details: `Deleted product: ${product.name} (${product.sku})`,
      entityType: 'PRODUCT',
      entityId: productId,
      timestamp: new Date().toISOString(),
    });

    return { success: true };
  }
}
