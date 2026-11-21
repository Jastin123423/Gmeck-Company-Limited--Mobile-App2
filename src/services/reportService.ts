import { db } from '../db/storage';
import { User, Sale } from '../types';
import { getShopAdminShopIds, isPlatformAdmin, isShopAdmin } from '../utils/permissions';

export class ReportService {
  public static getSellerDashboardSummary(sellerId: string, shopId?: string) {
    let sales = (db.getSales() || []).filter(s => s.sellerId === sellerId && s.status === 'COMPLETED');

    if (shopId && shopId !== 'ALL') {
      sales = sales.filter(s => s.shopId === shopId);
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const todaySales = sales.filter(s => s.createdAt && s.createdAt.slice(0, 10) === todayStr);

    const todayRevenue = todaySales.reduce((sum, s) => sum + (s.total || 0), 0);
    const todaySalesCount = todaySales.length;
    const todayItemsCount = todaySales.reduce(
      (sum, s) => sum + (s.items || []).reduce((iSum, item) => iSum + (item.quantity || 0), 0),
      0
    );

    const allTimeRevenue = sales.reduce((sum, s) => sum + (s.total || 0), 0);
    const allTimeSalesCount = sales.length;
    const recentSales = [...sales]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);

    return {
      todayRevenue,
      todaySalesCount,
      todayItemsCount,
      allTimeRevenue,
      allTimeSalesCount,
      recentSales,
    };
  }

  public static getFinancialSummary(
    dateRange: { from?: string; to?: string },
    optionsOrUser: { shopId?: string; sellerId?: string } | User,
    maybeUser?: User
  ) {
    let currentUser: User;
    let options: { shopId?: string; sellerId?: string } = {};

    if ('role' in optionsOrUser) {
      currentUser = optionsOrUser as User;
    } else {
      options = optionsOrUser;
      currentUser = maybeUser as User;
    }

    // FIX: Allow Admin OR Seller with canViewReports permission
    if (!currentUser) {
      throw new Error('Permission Denied: User not found.');
    }

    const platformAdmin = isPlatformAdmin(currentUser);
    const shopAdmin = isShopAdmin(currentUser);
    const managedShopIds = getShopAdminShopIds(currentUser);

    if (!platformAdmin && !shopAdmin && !currentUser.permissions?.canViewReports) {
      throw new Error(
        'Permission Denied: Financial reporting is restricted to Administrators.'
      );
    }

    const allSales = (db.getSales() || []).filter(s => s.status === 'COMPLETED');
    const allExpenses = db.getExpenses() || [];
    const allShops = db.getShops() || [];
    const shops = !platformAdmin && shopAdmin ? allShops.filter(s => managedShopIds.includes(s.id)) : allShops;
    const products = db.getProducts() || [];

    // Filter by shop if specified
    let filteredSales = allSales;
    let filteredExpenses = allExpenses;

    if (!platformAdmin && shopAdmin) {
      filteredSales = filteredSales.filter(s => managedShopIds.includes(s.shopId));
      filteredExpenses = filteredExpenses.filter(e => !!e.shopId && managedShopIds.includes(e.shopId));
    }

    if (options.shopId && options.shopId !== 'ALL') {
      if (!platformAdmin && shopAdmin && !managedShopIds.includes(options.shopId)) {
        filteredSales = [];
        filteredExpenses = [];
      } else {
        filteredSales = filteredSales.filter(s => s.shopId === options.shopId);
        filteredExpenses = filteredExpenses.filter(e => e.shopId === options.shopId);
      }
    }

    if (options.sellerId && options.sellerId !== 'ALL') {
      filteredSales = filteredSales.filter(s => s.sellerId === options.sellerId);
    }

    // If seller (not admin/shop-admin) without full access, only show their own sales
    if (!platformAdmin && !shopAdmin && !currentUser.permissions?.canViewReports) {
      filteredSales = filteredSales.filter(s => s.sellerId === currentUser.id);
    }

    // Filter by date range if specified (strict local day boundaries)
    if (dateRange.from || dateRange.to) {
      filteredSales = filteredSales.filter(s =>
        this.isDateInLocalRange(s.createdAt, dateRange.from, dateRange.to)
      );
      filteredExpenses = filteredExpenses.filter(e =>
        this.isDateInLocalRange(e.date || e.createdAt, dateRange.from, dateRange.to)
      );
    }

    const totalGrossSales = filteredSales.reduce((sum, s) => sum + (s.total || 0), 0);
    const totalCostOfGoods = filteredSales.reduce((sum, s) => sum + (s.costOfGoods || 0), 0);
    const totalGrossProfit = filteredSales.reduce((sum, s) => sum + (s.grossProfit || 0), 0);
    const totalExpenses = filteredExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
    const netProfit = totalGrossProfit - totalExpenses;
    const profitMarginPercent = totalGrossSales > 0 ? (totalGrossProfit / totalGrossSales) * 100 : 0;
    const netMarginPercent = totalGrossSales > 0 ? (netProfit / totalGrossSales) * 100 : 0;

    // Sales by Shop breakdown
    const shopSalesBreakdown: Record<
      string,
      {
        id: string;
        name: string;
        salesCount: number;
        totalSales: number;
        grossProfit: number;
        expenseTotal: number;
      }
    > = {};
    shops.forEach(sh => {
      shopSalesBreakdown[sh.id] = {
        id: sh.id,
        name: sh.name,
        salesCount: 0,
        totalSales: 0,
        grossProfit: 0,
        expenseTotal: 0,
      };
    });

    filteredSales.forEach(s => {
      const shopKey = s.shopId || shops[0]?.id || 'shop-1';
      if (!shopSalesBreakdown[shopKey]) {
        const found = shops.find(x => x.id === shopKey);
        shopSalesBreakdown[shopKey] = {
          id: shopKey,
          name: found ? found.name : 'Other Shop',
          salesCount: 0,
          totalSales: 0,
          grossProfit: 0,
          expenseTotal: 0,
        };
      }
      shopSalesBreakdown[shopKey].salesCount += 1;
      shopSalesBreakdown[shopKey].totalSales += s.total || 0;
      shopSalesBreakdown[shopKey].grossProfit += s.grossProfit || 0;
    });

    filteredExpenses.forEach(e => {
      if (e.shopId && shopSalesBreakdown[e.shopId]) {
        shopSalesBreakdown[e.shopId].expenseTotal += e.amount || 0;
      }
    });

    // Top Selling Products in filtered set
    const productStats: Record<
      string,
      {
        id: string;
        name: string;
        sku: string;
        unitsSold: number;
        quantity: number;
        revenue: number;
        profit: number;
      }
    > = {};
    filteredSales.forEach(sale => {
      (sale.items || []).forEach(item => {
        const prod = products.find(p => p.id === item.productId);
        const sku = prod?.sku || item.productId;
        if (!productStats[item.productId]) {
          productStats[item.productId] = {
            id: item.productId,
            name: item.productName || prod?.name || 'Product',
            sku: sku,
            unitsSold: 0,
            quantity: 0,
            revenue: 0,
            profit: 0,
          };
        }
        const itemProfit = (item.total || 0) - (item.purchasePrice || 0) * (item.quantity || 1);
        productStats[item.productId].unitsSold += item.quantity || 1;
        productStats[item.productId].quantity += item.quantity || 1;
        productStats[item.productId].revenue += item.total || 0;
        productStats[item.productId].profit += itemProfit;
      });
    });

    const topSellingProducts = Object.values(productStats)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    const topProducts = topSellingProducts;

    // Sales by Payment Method
    const paymentMethodBreakdown: Record<
      string,
      { method: string; count: number; total: number }
    > = {};
    filteredSales.forEach(sale => {
      const pm = sale.paymentMethod || 'CASH';
      if (!paymentMethodBreakdown[pm]) {
        paymentMethodBreakdown[pm] = {
          method: pm,
          count: 0,
          total: 0,
        };
      }
      paymentMethodBreakdown[pm].count += 1;
      paymentMethodBreakdown[pm].total += sale.total || 0;
    });

    // Sales Performance by Cashier/Seller
    const sellerPerformanceMap: Record<
      string,
      { id: string; name: string; count: number; total: number; profit: number }
    > = {};
    filteredSales.forEach(sale => {
      const sId = sale.sellerId || 'unknown';
      const sName = sale.sellerName || 'Cashier';
      if (!sellerPerformanceMap[sId]) {
        sellerPerformanceMap[sId] = {
          id: sId,
          name: sName,
          count: 0,
          total: 0,
          profit: 0,
        };
      }
      sellerPerformanceMap[sId].count += 1;
      sellerPerformanceMap[sId].total += sale.total || 0;
      sellerPerformanceMap[sId].profit += sale.grossProfit || 0;
    });

    const sellerPerformance = Object.values(sellerPerformanceMap);
    const sellerSales = sellerPerformance;

    // Daily Sales Timeline (for charts)
    const dailyMap: Record<
      string,
      { date: string; sales: number; profit: number; expenses: number }
    > = {};
    filteredSales.forEach(sale => {
      const day = sale.createdAt
        ? sale.createdAt.slice(0, 10)
        : new Date().toISOString().slice(0, 10);
      if (!dailyMap[day]) {
        dailyMap[day] = { date: day, sales: 0, profit: 0, expenses: 0 };
      }
      dailyMap[day].sales += sale.total || 0;
      dailyMap[day].profit += sale.grossProfit || 0;
    });

    filteredExpenses.forEach(exp => {
      const day = exp.date ? exp.date.slice(0, 10) : new Date().toISOString().slice(0, 10);
      if (!dailyMap[day]) {
        dailyMap[day] = { date: day, sales: 0, profit: 0, expenses: 0 };
      }
      dailyMap[day].expenses += exp.amount || 0;
    });

    const timeline = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

    return {
      totalGrossSales,
      totalCostOfGoods,
      totalGrossProfit,
      totalExpenses,
      netProfit,
      profitMarginPercent: Number(profitMarginPercent.toFixed(1)),
      netMarginPercent: Number(netMarginPercent.toFixed(1)),
      transactionCount: filteredSales.length,
      filteredSales,
      topSellingProducts,
      topProducts,
      sellerPerformance,
      sellerSales,
      paymentMethodBreakdown: Object.values(paymentMethodBreakdown),
      shopSalesBreakdown: Object.values(shopSalesBreakdown),
      timeline,
    };
  }

  public static computeProfitLossDateRange(
    period: ProfitLossPeriod,
    customFrom?: string,
    customTo?: string,
    now: Date = new Date()
  ): { from?: string; to?: string } {
    const toYMD = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    if (period === 'day') {
      const ymd = toYMD(today);
      return { from: ymd, to: ymd };
    }
    if (period === 'week') {
      const start = new Date(today);
      start.setDate(start.getDate() - 6);
      return { from: toYMD(start), to: toYMD(today) };
    }
    if (period === 'month') {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: toYMD(start), to: toYMD(today) };
    }
    return {
      from: customFrom || undefined,
      to: customTo || undefined,
    };
  }

  public static isDateInLocalRange(
    rawDate: string | undefined,
    fromYMD?: string,
    toYMD?: string
  ): boolean {
    if (!rawDate) return false;

    let ts: number;
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate.trim())) {
      const [y, m, d] = rawDate.trim().split('-').map(Number);
      ts = new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
    } else {
      ts = new Date(rawDate).getTime();
    }
    if (Number.isNaN(ts)) return false;

    if (fromYMD && /^\d{4}-\d{2}-\d{2}$/.test(fromYMD)) {
      const [sy, sm, sd] = fromYMD.split('-').map(Number);
      const startMs = new Date(sy, sm - 1, sd, 0, 0, 0, 0).getTime();
      if (ts < startMs) return false;
    }

    if (toYMD && /^\d{4}-\d{2}-\d{2}$/.test(toYMD)) {
      const [ey, em, ed] = toYMD.split('-').map(Number);
      const endMs = new Date(ey, em - 1, ed, 23, 59, 59, 999).getTime();
      if (ts > endMs) return false;
    }

    return true;
  }

  public static getShopProfitAndLoss(
    dateRange: { from?: string; to?: string },
    currentUser: User,
    options?: {
      shopId?: string;
      overrideData?: {
        shops?: import('../types').Shop[];
        stores?: import('../types').Store[];
        products?: import('../types').Product[];
        sales?: Sale[];
        expenses?: import('../types').Expense[];
        movements?: import('../types').InventoryMovement[];
      };
    }
  ): ShopProfitLossReport {
    if (!currentUser) {
      throw new Error('Permission Denied: User not found.');
    }

    const platformAdmin = isPlatformAdmin(currentUser);
    const shopAdmin = isShopAdmin(currentUser);
    const managedShopIds = getShopAdminShopIds(currentUser);

    if (!platformAdmin && !shopAdmin && !currentUser.permissions?.canViewReports) {
      throw new Error('Permission Denied: Financial reporting is restricted to Administrators.');
    }

    const override = options?.overrideData;
    const allShops = override?.shops ?? (db.getShops() || []);
    const allStores = override?.stores ?? (db.getStores() || []);
    const allProducts = override?.products ?? (db.getProducts() || []);
    const allSales = override?.sales ?? (db.getSales() || []);
    const allExpenses = override?.expenses ?? (db.getExpenses() || []);
    const allMovements = override?.movements ?? (db.getMovements() || []);

    const accessibleShops = platformAdmin
      ? allShops
      : shopAdmin
        ? allShops.filter(s => managedShopIds.includes(s.id))
        : allShops.filter(s => (currentUser.assignedShopIds || []).includes(s.id));

    const targetShops =
      options?.shopId && options.shopId !== 'ALL'
        ? accessibleShops.filter(s => s.id === options.shopId)
        : accessibleShops;

    const targetShopSet = new Set(targetShops.map(s => s.id));
    const productById = new Map(allProducts.map(p => [p.id, p]));

    const warehouseStoreIdsByShop = new Map<string, Set<string>>();
    for (const st of allStores) {
      if (st.isShopFloor) continue;
      let set = warehouseStoreIdsByShop.get(st.shopId);
      if (!set) {
        set = new Set<string>();
        warehouseStoreIdsByShop.set(st.shopId, set);
      }
      set.add(st.id);
    }

    const rowsMap = new Map<string, ShopProfitLossRow>();
    for (const sh of targetShops) {
      rowsMap.set(sh.id, {
        shopId: sh.id,
        shopName: sh.name,
        shopCode: sh.code,
        status: sh.status,
        skuCount: 0,
        floorUnits: 0,
        storeUnits: 0,
        totalUnits: 0,
        floorCapital: 0,
        storeCapital: 0,
        totalCapital: 0,
        expectedRetailValue: 0,
        potentialStockProfit: 0,
        salesCount: 0,
        revenue: 0,
        costOfGoods: 0,
        grossProfit: 0,
        grossMarginPercent: 0,
        expenses: 0,
        stockLossUnits: 0,
        stockLossValue: 0,
        belowCostSalesLoss: 0,
        totalLossAndExpenses: 0,
        netProfit: 0,
        netMarginPercent: 0,
        capitalReturnPercent: 0,
      });
    }

    // 1. Product Total Capital per shop (Floor + Warehouse Store inventory cost)
    for (const prod of allProducts) {
      if (prod.status === 'INACTIVE') continue;
      const row = rowsMap.get(prod.shopId);
      if (!row) continue;

      const buyPrice = Math.max(0, Number(prod.purchasePrice || 0));
      const sellPrice = Math.max(0, Number(prod.sellingPrice || 0));
      const floorUnits = Math.max(0, Number(prod.currentStock || 0));

      const warehouseIds = warehouseStoreIdsByShop.get(prod.shopId);
      let storeUnits = Math.max(0, Number(prod.storeStock || 0));
      if (storeUnits === 0 && prod.storeStocks && warehouseIds) {
        for (const [sid, q] of Object.entries(prod.storeStocks)) {
          if (warehouseIds.has(sid)) {
            storeUnits += Math.max(0, Number(q || 0));
          }
        }
      }

      const floorCapital = floorUnits * buyPrice;
      let storeCapital = storeUnits * buyPrice;
      if (storeCapital === 0 && storeUnits > 0 && prod.storeDetails && warehouseIds) {
        for (const sid of warehouseIds) {
          const detail = prod.storeDetails[sid];
          if (detail?.importedPurchaseValue) {
            storeCapital += Math.max(0, Number(detail.importedPurchaseValue || 0));
          }
        }
      }

      const retail = (floorUnits + storeUnits) * sellPrice;

      row.skuCount += 1;
      row.floorUnits += floorUnits;
      row.storeUnits += storeUnits;
      row.totalUnits += floorUnits + storeUnits;
      row.floorCapital += floorCapital;
      row.storeCapital += storeCapital;
      row.totalCapital += floorCapital + storeCapital;
      row.expectedRetailValue += retail;
    }

    // 2. Sales, COGS, Gross Profit & Below-Cost Loss within period
    for (const sale of allSales) {
      if (sale.status !== 'COMPLETED') continue;
      if (!targetShopSet.has(sale.shopId)) continue;
      if (!this.isDateInLocalRange(sale.createdAt, dateRange.from, dateRange.to)) continue;

      const row = rowsMap.get(sale.shopId);
      if (!row) continue;

      row.salesCount += 1;
      row.revenue += Number(sale.total || 0);
      row.costOfGoods += Number(sale.costOfGoods || 0);
      row.grossProfit += Number(sale.grossProfit || 0);

      for (const item of sale.items || []) {
        const unitCost = Number(item.purchasePrice || 0);
        const unitSold = Number(item.unitPrice || 0);
        const qty = Number(item.quantity || 0);
        if (unitCost > 0 && unitSold < unitCost && qty > 0) {
          row.belowCostSalesLoss += (unitCost - unitSold) * qty;
        }
      }
    }

    // 3. Operating Expenses per shop (+ General Company expenses) within period
    let generalCompanyExpenses = 0;
    for (const exp of allExpenses) {
      if (!this.isDateInLocalRange(exp.date || exp.createdAt, dateRange.from, dateRange.to)) {
        continue;
      }
      const amt = Math.max(0, Number(exp.amount || 0));
      if (!exp.shopId || exp.isCompanyExpense) {
        if (platformAdmin && (!options?.shopId || options.shopId === 'ALL')) {
          generalCompanyExpenses += amt;
        }
        continue;
      }
      const row = rowsMap.get(exp.shopId);
      if (row) {
        row.expenses += amt;
      }
    }

    // 4. Inventory Stock Losses (DAMAGED, BROKEN, EXPIRED, LOST) per shop within period
    const LOSS_MOVEMENT_TYPES = new Set(['DAMAGED', 'BROKEN', 'EXPIRED', 'LOST']);
    for (const m of allMovements) {
      if (!LOSS_MOVEMENT_TYPES.has(m.type)) continue;
      if (!targetShopSet.has(m.shopId)) continue;
      if (!this.isDateInLocalRange(m.createdAt, dateRange.from, dateRange.to)) continue;

      const row = rowsMap.get(m.shopId);
      if (!row) continue;

      const qtyLost = Math.abs(Number(m.changeQty || 0));
      const fallbackCost = (productById.get(m.productId)?.purchasePrice || 0) * qtyLost;
      const lossVal =
        m.costValue !== undefined && m.costValue !== null && Number(m.costValue) > 0
          ? Number(m.costValue)
          : fallbackCost;

      row.stockLossUnits += qtyLost;
      row.stockLossValue += lossVal;
    }

    // 5. Finalize margins, Net Profit / (Loss), and totals
    const shopRows: ShopProfitLossRow[] = [];
    const totals = {
      skuCount: 0,
      totalUnits: 0,
      floorCapital: 0,
      storeCapital: 0,
      totalCapital: 0,
      expectedRetailValue: 0,
      salesCount: 0,
      revenue: 0,
      costOfGoods: 0,
      grossProfit: 0,
      grossMarginPercent: 0,
      expenses: 0,
      stockLossUnits: 0,
      stockLossValue: 0,
      belowCostSalesLoss: 0,
      totalLossAndExpenses: 0,
      netProfit: 0,
      netMarginPercent: 0,
      netAfterCompanyExpenses: 0,
    };

    for (const row of rowsMap.values()) {
      row.floorCapital = Number(row.floorCapital.toFixed(2));
      row.storeCapital = Number(row.storeCapital.toFixed(2));
      row.totalCapital = Number(row.totalCapital.toFixed(2));
      row.expectedRetailValue = Number(row.expectedRetailValue.toFixed(2));
      row.potentialStockProfit = Number((row.expectedRetailValue - row.totalCapital).toFixed(2));
      row.revenue = Number(row.revenue.toFixed(2));
      row.costOfGoods = Number(row.costOfGoods.toFixed(2));
      row.grossProfit = Number(row.grossProfit.toFixed(2));
      row.expenses = Number(row.expenses.toFixed(2));
      row.stockLossValue = Number(row.stockLossValue.toFixed(2));
      row.belowCostSalesLoss = Number(row.belowCostSalesLoss.toFixed(2));
      row.totalLossAndExpenses = Number((row.expenses + row.stockLossValue).toFixed(2));
      row.netProfit = Number((row.grossProfit - row.expenses - row.stockLossValue).toFixed(2));
      row.grossMarginPercent =
        row.revenue > 0 ? Number(((row.grossProfit / row.revenue) * 100).toFixed(1)) : 0;
      row.netMarginPercent =
        row.revenue > 0 ? Number(((row.netProfit / row.revenue) * 100).toFixed(1)) : 0;
      row.capitalReturnPercent =
        row.totalCapital > 0 ? Number(((row.netProfit / row.totalCapital) * 100).toFixed(1)) : 0;

      shopRows.push(row);

      totals.skuCount += row.skuCount;
      totals.totalUnits += row.totalUnits;
      totals.floorCapital += row.floorCapital;
      totals.storeCapital += row.storeCapital;
      totals.totalCapital += row.totalCapital;
      totals.expectedRetailValue += row.expectedRetailValue;
      totals.salesCount += row.salesCount;
      totals.revenue += row.revenue;
      totals.costOfGoods += row.costOfGoods;
      totals.grossProfit += row.grossProfit;
      totals.expenses += row.expenses;
      totals.stockLossUnits += row.stockLossUnits;
      totals.stockLossValue += row.stockLossValue;
      totals.belowCostSalesLoss += row.belowCostSalesLoss;
      totals.totalLossAndExpenses += row.totalLossAndExpenses;
      totals.netProfit += row.netProfit;
    }

    shopRows.sort((a, b) => b.netProfit - a.netProfit || b.totalCapital - a.totalCapital);

    totals.floorCapital = Number(totals.floorCapital.toFixed(2));
    totals.storeCapital = Number(totals.storeCapital.toFixed(2));
    totals.totalCapital = Number(totals.totalCapital.toFixed(2));
    totals.expectedRetailValue = Number(totals.expectedRetailValue.toFixed(2));
    totals.revenue = Number(totals.revenue.toFixed(2));
    totals.costOfGoods = Number(totals.costOfGoods.toFixed(2));
    totals.grossProfit = Number(totals.grossProfit.toFixed(2));
    totals.expenses = Number(totals.expenses.toFixed(2));
    totals.stockLossValue = Number(totals.stockLossValue.toFixed(2));
    totals.belowCostSalesLoss = Number(totals.belowCostSalesLoss.toFixed(2));
    totals.totalLossAndExpenses = Number(totals.totalLossAndExpenses.toFixed(2));
    totals.netProfit = Number(totals.netProfit.toFixed(2));
    totals.grossMarginPercent =
      totals.revenue > 0 ? Number(((totals.grossProfit / totals.revenue) * 100).toFixed(1)) : 0;
    totals.netMarginPercent =
      totals.revenue > 0 ? Number(((totals.netProfit / totals.revenue) * 100).toFixed(1)) : 0;
    totals.netAfterCompanyExpenses = Number((totals.netProfit - generalCompanyExpenses).toFixed(2));

    return {
      from: dateRange.from,
      to: dateRange.to,
      shops: shopRows,
      generalCompanyExpenses: Number(generalCompanyExpenses.toFixed(2)),
      totals,
    };
  }
}

export type ProfitLossPeriod = 'day' | 'week' | 'month' | 'custom';

export interface ShopProfitLossRow {
  shopId: string;
  shopName: string;
  shopCode?: string;
  status: 'ACTIVE' | 'INACTIVE';
  skuCount: number;
  floorUnits: number;
  storeUnits: number;
  totalUnits: number;
  floorCapital: number;
  storeCapital: number;
  totalCapital: number;
  expectedRetailValue: number;
  potentialStockProfit: number;
  salesCount: number;
  revenue: number;
  costOfGoods: number;
  grossProfit: number;
  grossMarginPercent: number;
  expenses: number;
  stockLossUnits: number;
  stockLossValue: number;
  belowCostSalesLoss: number;
  totalLossAndExpenses: number;
  netProfit: number;
  netMarginPercent: number;
  capitalReturnPercent: number;
}

export interface ShopProfitLossReport {
  from?: string;
  to?: string;
  shops: ShopProfitLossRow[];
  generalCompanyExpenses: number;
  totals: {
    skuCount: number;
    totalUnits: number;
    floorCapital: number;
    storeCapital: number;
    totalCapital: number;
    expectedRetailValue: number;
    salesCount: number;
    revenue: number;
    costOfGoods: number;
    grossProfit: number;
    grossMarginPercent: number;
    expenses: number;
    stockLossUnits: number;
    stockLossValue: number;
    belowCostSalesLoss: number;
    totalLossAndExpenses: number;
    netProfit: number;
    netMarginPercent: number;
    netAfterCompanyExpenses: number;
  };
}
