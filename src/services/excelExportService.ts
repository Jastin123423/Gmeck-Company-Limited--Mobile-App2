// src/services/excelExportService.ts
import * as XLSX from 'xlsx';
import { Capacitor } from '@capacitor/core';
import { db } from '../db/storage';
import { BusinessSettings, Product, Store } from '../types';
import { saveFileCrossPlatform } from '../utils/nativeDownload';
import type { InventoryExportMeta, InventoryExportRow } from '../utils/pdfExport';

function writeWorkbookCrossPlatform(wb: XLSX.WorkBook, fileName: string): void {
  if (Capacitor.isNativePlatform()) {
    const base64Data = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' }) as string;
    void saveFileCrossPlatform({
      fileName,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64Data,
      openAfterSave: true,
    });
    return;
  }
  XLSX.writeFile(wb, fileName);
}

async function writeWorkbookCrossPlatformAsync(
  wb: XLSX.WorkBook,
  fileName: string
): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    const base64Data = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' }) as string;
    const res = await saveFileCrossPlatform({
      fileName,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64Data,
      openAfterSave: true,
    });
    return res.ok;
  }
  XLSX.writeFile(wb, fileName);
  return true;
}

export interface ExcelExportResult {
  success: boolean;
  fileName: string;
  rowCount?: number;
  error?: string;
}

// These 4 headers match ExcelImportService 4-column import headers exactly
const IMPORT_HEADERS = ['Product Name', 'Buying Price', 'Selling Price', 'Quantity'];

function todayStamp(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function slugifyFileName(name: string): string {
  const cleaned = String(name || 'store')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'store';
}

function autoColWidths(rows: any[][]): { wch: number }[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, idx) => {
      const len = String(cell ?? '').length;
      widths[idx] = Math.max(widths[idx] || 0, len);
    });
  }
  return widths.map(w => ({ wch: Math.min(w + 2, 45) }));
}

function productToRow(p: Product, quantityOverride?: number): (string | number)[] {
  const displayName = p.variation ? `${p.name} (${p.variation})` : p.name || '';
  return [
    displayName,
    p.purchasePrice ?? 0,
    p.sellingPrice ?? 0,
    quantityOverride !== undefined ? quantityOverride : (p.currentStock ?? 0),
  ];
}

export function resolveProductQtyInStore(
  product: Product,
  store: Store,
  allStoresInShop: Store[]
): number {
  if (product.storeStocks && product.storeStocks[store.id] !== undefined) {
    return Number(product.storeStocks[store.id] || 0);
  }
  if (store.isShopFloor) {
    return Number(product.currentStock || 0);
  }
  const shopWarehouseStores = allStoresInShop
    .filter(s => s.shopId === product.shopId && !s.isShopFloor)
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'ACTIVE' ? -1 : 1;
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });

  const shopWarehouseIds = new Set(shopWarehouseStores.map(s => s.id));
  const mappedWarehouseSum = Object.entries(product.storeStocks || {}).reduce(
    (sum, [sid, qty]) => (shopWarehouseIds.has(sid) ? sum + Math.max(0, Number(qty || 0)) : sum),
    0
  );

  if (mappedWarehouseSum === 0 && Number(product.storeStock || 0) > 0) {
    if (product.storeId && shopWarehouseIds.has(product.storeId)) {
      return product.storeId === store.id ? Number(product.storeStock || 0) : 0;
    }
    if (shopWarehouseStores[0]?.id === store.id) {
      return Number(product.storeStock || 0);
    }
  }
  return 0;
}

export function resolveProductTotalTrackedUnits(
  product: Product,
  allStoresInShop: Store[]
): number {
  if (product.storeStocks && Object.keys(product.storeStocks).length > 0) {
    const mappedStores = Object.entries(product.storeStocks);
    const mappedTotal = mappedStores.reduce((s, [, qty]) => s + Number(qty || 0), 0);
    const hasFloorMapped = mappedStores.some(
      ([sid]) => allStoresInShop.find(st => st.id === sid)?.isShopFloor
    );
    return hasFloorMapped ? mappedTotal : mappedTotal + Number(product.currentStock || 0);
  }
  return Number(product.currentStock || 0) + Number(product.storeStock || 0);
}

export class ExcelExportService {
  public static exportAllProducts(shopId: string): ExcelExportResult {
    try {
      if (!shopId) {
        return { success: false, fileName: '', error: 'Shop ID is required.' };
      }

      const all = db.getProducts();
      const filtered = all.filter(p => p.shopId === shopId && p.status !== 'INACTIVE');

      if (filtered.length === 0) {
        return { success: false, fileName: '', error: 'No products found for this shop.' };
      }

      const aoa: any[][] = [IMPORT_HEADERS, ...filtered.map(p => productToRow(p))];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = autoColWidths(aoa);

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Products');

      const fileName = `products_${todayStamp()}.xlsx`;
      writeWorkbookCrossPlatform(wb, fileName);

      return { success: true, fileName, rowCount: filtered.length };
    } catch (err: any) {
      return { success: false, fileName: '', error: err.message || 'Export failed.' };
    }
  }

  public static buildStoreProductsAoa(
    store: Store,
    products?: Product[],
    allStores?: Store[]
  ): any[][] {
    const storeList = allStores ?? db.getStores();
    const storesInShop = storeList.filter(s => s.shopId === store.shopId);
    const sourceProducts =
      products ??
      db
        .getProducts()
        .filter(p => {
          if (p.shopId !== store.shopId || p.status === 'INACTIVE') return false;
          const qty = resolveProductQtyInStore(p, store, storesInShop);
          return qty > 0 || Boolean(p.storeDetails?.[store.id]);
        });

    const rows = sourceProducts.map(p =>
      productToRow(p, resolveProductQtyInStore(p, store, storesInShop))
    );
    return [IMPORT_HEADERS, ...rows];
  }

  public static exportStoreProducts(
    store: Store,
    products?: Product[]
  ): ExcelExportResult {
    try {
      if (!store || !store.id) {
        return { success: false, fileName: '', error: 'Store is required.' };
      }

      const aoa = this.buildStoreProductsAoa(store, products);
      const rowCount = aoa.length - 1;

      if (rowCount === 0) {
        return {
          success: false,
          fileName: '',
          error: `No stocked products found in "${store.name}".`,
        };
      }

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = autoColWidths(aoa);

      const wb = XLSX.utils.book_new();
      const safeSheetName = (store.name || 'Store').replace(/[\\/?*[\]:]/g, '').slice(0, 31) || 'Store';
      XLSX.utils.book_append_sheet(wb, ws, safeSheetName);

      const fileName = `${slugifyFileName(store.name)}_products_${todayStamp()}.xlsx`;
      writeWorkbookCrossPlatform(wb, fileName);

      return { success: true, fileName, rowCount };
    } catch (err: any) {
      return { success: false, fileName: '', error: err.message || 'Store export failed.' };
    }
  }

  public static exportCombinedStoresProducts(
    stores: Store[],
    products: Product[]
  ): ExcelExportResult {
    try {
      const activeProducts = products.filter(p => p.status !== 'INACTIVE');
      if (activeProducts.length === 0) {
        return { success: false, fileName: '', error: 'No products found to export.' };
      }

      const rows = activeProducts.map(p => {
        const shopStores = stores.filter(s => s.shopId === p.shopId);
        return productToRow(p, resolveProductTotalTrackedUnits(p, shopStores));
      });
      const aoa: any[][] = [IMPORT_HEADERS, ...rows];

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = autoColWidths(aoa);

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'All Stores Inventory');

      const fileName = `all_stores_products_${todayStamp()}.xlsx`;
      writeWorkbookCrossPlatform(wb, fileName);

      return { success: true, fileName, rowCount: rows.length };
    } catch (err: any) {
      return { success: false, fileName: '', error: err.message || 'Export failed.' };
    }
  }

  public static async exportInventoryReport(
    rows: InventoryExportRow[],
    settings: BusinessSettings,
    meta: InventoryExportMeta
  ): Promise<ExcelExportResult> {
    try {
      if (!rows || rows.length === 0) {
        return {
          success: false,
          fileName: '',
          error: 'No inventory items available to export for this selection.',
        };
      }

      const biz = settings?.businessName || 'Inventory Report';
      const currency = settings?.currencySymbol || 'TSh';
      const generatedAt = new Date().toLocaleString();

      const scopeTitle =
        meta.scope === 'SHOP'
          ? 'Shop Inventory Report'
          : meta.scope === 'STORE'
            ? 'Store Inventory Report'
            : meta.scope === 'MIXED'
              ? 'Filtered Inventory Report (Shop & Store)'
              : 'All Inventory Report (Shop + Store)';

      const scopeSheetName =
        meta.scope === 'SHOP'
          ? 'Shop Inventory'
          : meta.scope === 'STORE'
            ? 'Store Inventory'
            : meta.scope === 'MIXED'
              ? 'Filtered Inventory'
              : 'All Inventory';

      const scopeSlug =
        meta.scope === 'SHOP'
          ? 'shop'
          : meta.scope === 'STORE'
            ? 'store'
            : meta.scope === 'MIXED'
              ? 'filtered'
              : 'all';

      const totalShopQty = rows.reduce((s, r) => s + Number(r.shopQty || 0), 0);
      const totalStoreQty = rows.reduce((s, r) => s + Number(r.storeQty || 0), 0);
      const totalActiveQty = rows.reduce((s, r) => s + Number(r.activeQty || 0), 0);
      const totalBuyValue = Number(
        rows.reduce((s, r) => s + Number(r.buyValue || 0), 0).toFixed(2)
      );
      const totalSellValue = Number(
        rows.reduce((s, r) => s + Number(r.sellValue || 0), 0).toFixed(2)
      );
      const totalPotentialProfit = Number((totalSellValue - totalBuyValue).toFixed(2));
      const lowStockCount = rows.filter(r => r.status === 'LOW STOCK').length;
      const outOfStockCount = rows.filter(r => r.status === 'OUT OF STOCK').length;

      let headers: string[];
      let dataRows: (string | number)[][];
      let totalRow: (string | number)[];

      if (meta.scope === 'SHOP') {
        headers = [
          '#',
          'Shop',
          'Product Name',
          'Variation',
          'SKU',
          'Unit',
          'Shop Qty',
          'Min Stock',
          `Buying Price (${currency})`,
          `Selling Price (${currency})`,
          `Total Buy Value (${currency})`,
          `Total Selling Value (${currency})`,
          `Potential Profit (${currency})`,
          'Status',
        ];
        dataRows = rows.map((r, idx) => [
          idx + 1,
          r.shopName,
          r.productName,
          r.variation || '',
          r.sku || '',
          r.unit || 'pcs',
          Number(r.shopQty || 0),
          Number(r.minStock || 0),
          Number(r.purchasePrice || 0),
          Number(r.sellingPrice || 0),
          Number(r.buyValue || 0),
          Number(r.sellValue || 0),
          Number(r.potentialProfit || 0),
          r.status,
        ]);
        totalRow = [
          '',
          'TOTAL',
          `${rows.length} product(s)`,
          '',
          '',
          '',
          totalActiveQty,
          '',
          '',
          '',
          totalBuyValue,
          totalSellValue,
          totalPotentialProfit,
          '',
        ];
      } else if (meta.scope === 'STORE') {
        headers = [
          '#',
          'Shop',
          'Product Name',
          'Variation',
          'SKU',
          'Unit',
          'Store Qty',
          'Warehouse Breakdown',
          `Buying Price (${currency})`,
          `Selling Price (${currency})`,
          `Total Buy Value (${currency})`,
          `Total Selling Value (${currency})`,
          `Potential Profit (${currency})`,
          'Status',
        ];
        dataRows = rows.map((r, idx) => [
          idx + 1,
          r.shopName,
          r.productName,
          r.variation || '',
          r.sku || '',
          r.unit || 'pcs',
          Number(r.storeQty || 0),
          r.storeBreakdown || 'Store Stock',
          Number(r.purchasePrice || 0),
          Number(r.sellingPrice || 0),
          Number(r.buyValue || 0),
          Number(r.sellValue || 0),
          Number(r.potentialProfit || 0),
          r.status,
        ]);
        totalRow = [
          '',
          'TOTAL',
          `${rows.length} product(s)`,
          '',
          '',
          '',
          totalActiveQty,
          '',
          '',
          '',
          totalBuyValue,
          totalSellValue,
          totalPotentialProfit,
          '',
        ];
      } else {
        const isMixed = meta.scope === 'MIXED';
        headers = [
          '#',
          'Shop',
          ...(isMixed ? ['Scope'] : []),
          'Product Name',
          'Variation',
          'SKU',
          'Unit',
          'Shop Qty',
          'Store Qty',
          isMixed ? 'Active Qty' : 'Total Qty',
          'Min Stock',
          `Buying Price (${currency})`,
          `Selling Price (${currency})`,
          `Total Buy Value (${currency})`,
          `Total Selling Value (${currency})`,
          `Potential Profit (${currency})`,
          'Warehouse Breakdown',
          'Status',
        ];
        dataRows = rows.map((r, idx) => [
          idx + 1,
          r.shopName,
          ...(isMixed ? [r.rowScope] : []),
          r.productName,
          r.variation || '',
          r.sku || '',
          r.unit || 'pcs',
          Number(r.shopQty || 0),
          Number(r.storeQty || 0),
          Number(r.activeQty || 0),
          Number(r.minStock || 0),
          Number(r.purchasePrice || 0),
          Number(r.sellingPrice || 0),
          Number(r.buyValue || 0),
          Number(r.sellValue || 0),
          Number(r.potentialProfit || 0),
          r.storeBreakdown || '',
          r.status,
        ]);
        totalRow = [
          '',
          'TOTAL',
          ...(isMixed ? [''] : []),
          `${rows.length} product(s)`,
          '',
          '',
          '',
          totalShopQty,
          totalStoreQty,
          totalActiveQty,
          '',
          '',
          '',
          totalBuyValue,
          totalSellValue,
          totalPotentialProfit,
          '',
          '',
        ];
      }

      const mainAoa: (string | number)[][] = [
        [biz, '', scopeTitle],
        ['Shop Scope', meta.shopLabel, 'Generated', generatedAt],
        [],
        headers,
        ...dataRows,
        [],
        totalRow,
      ];

      const wsMain = XLSX.utils.aoa_to_sheet(mainAoa);
      wsMain['!cols'] = autoColWidths([headers, ...dataRows, totalRow]);

      const summaryAoa: (string | number)[][] = [
        ['Inventory Export Summary', ''],
        ['Business Name', biz],
        ['Report Type', scopeTitle],
        ['Shop Selection', meta.shopLabel],
        ['Search Filter', meta.searchQuery?.trim() || 'None'],
        ['Low Stock Filter', meta.lowStockOnly ? 'Yes (Low Stock Only)' : 'No (All)'],
        ['Currency', currency],
        ['Generated At', generatedAt],
        [],
        ['Metric', 'Value'],
        ['Total SKUs Exported', rows.length],
        ...(meta.scope === 'SHOP'
          ? [['Total Shop Units', totalActiveQty]]
          : meta.scope === 'STORE'
            ? [['Total Store Units', totalActiveQty]]
            : [
                ['Total Shop Units', totalShopQty],
                ['Total Store Units', totalStoreQty],
                ['Total Active Units', totalActiveQty],
              ]),
        [`Total Buy Value (${currency})`, totalBuyValue],
        [`Total Selling Value (${currency})`, totalSellValue],
        [`Potential Profit (${currency})`, totalPotentialProfit],
        ['Low Stock SKUs', lowStockCount],
        ['Out of Stock SKUs', outOfStockCount],
      ];

      const wsSummary = XLSX.utils.aoa_to_sheet(summaryAoa);
      wsSummary['!cols'] = autoColWidths(summaryAoa);

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, wsMain, scopeSheetName);
      XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

      const fileName = `inventory_${scopeSlug}_${slugifyFileName(meta.shopLabel)}_${todayStamp()}.xlsx`;
      const saved = await writeWorkbookCrossPlatformAsync(wb, fileName);

      if (!saved) {
        return {
          success: false,
          fileName,
          error: 'Could not save Excel file on this device.',
        };
      }

      return { success: true, fileName, rowCount: rows.length };
    } catch (err: any) {
      return {
        success: false,
        fileName: '',
        error: err?.message || 'Inventory Excel export failed.',
      };
    }
  }
}
