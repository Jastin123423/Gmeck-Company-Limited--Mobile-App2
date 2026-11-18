import React, { useState, useMemo } from 'react';
import {
  FileText,
  Printer,
  Calendar,
  Download,
  Users,
  Package,
  Store,
  Search,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Scale,
  Coins,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  ProfitLossPeriod,
  ReportService,
} from '../../services/reportService';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import {
  getAdminManagedShops,
  hasAdminAccess,
  isPlatformAdmin,
  isShopAdmin,
} from '../../utils/permissions';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type ReportPeriod = 'today' | 'week' | 'month' | 'year' | 'custom';

interface DeviationRow {
  saleId: string;
  receiptNumber: string;
  createdAt: string;
  shopId: string;
  shopName: string;
  sellerId: string;
  sellerName: string;
  productId: string;
  productName: string;
  sku: string;
  referencePrice: number;
  soldPrice: number;
  purchasePrice: number;
  quantity: number;
  diff: number;
  totalImpact: number;
  direction: 'ABOVE' | 'BELOW';
  usedSnapshot: boolean;
  belowCost: boolean;
  costLoss: number;
}

type DeviationDirection = 'ALL' | 'ABOVE' | 'BELOW' | 'BELOW_COST';

function computeRange(period: ReportPeriod, customFrom: string, customTo: string) {
  const now = new Date();
  if (period === 'today') {
    const d = now.toISOString().slice(0, 10);
    return { from: d, to: d };
  }
  if (period === 'week') {
    const past = new Date(now.getTime() - 7 * 86400000);
    return { from: past.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
  }
  if (period === 'month') {
    const past = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: past.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
  }
  if (period === 'year') {
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    return { from: startOfYear.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
  }
  return { from: customFrom || undefined, to: customTo || undefined };
}

// ─────────────────────────────────────────────────────────────
// Mobile Section Header
// ─────────────────────────────────────────────────────────────
const MobileSectionHeader: React.FC<{
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  period: ReportPeriod;
  onPeriodChange: (p: ReportPeriod) => void;
  customStart: string;
  customEnd: string;
  onCustomStartChange: (v: string) => void;
  onCustomEndChange: (v: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  actions?: React.ReactNode;
  accent?: 'blue' | 'rose' | 'purple' | 'amber';
}> = ({
  title, subtitle, icon, period, onPeriodChange,
  customStart, customEnd, onCustomStartChange, onCustomEndChange,
  collapsed, onToggleCollapsed, actions, accent = 'blue',
}) => {
  const accents: Record<string, string> = {
    blue: 'from-blue-950/20 via-slate-900 to-slate-900',
    rose: 'from-rose-950/20 via-slate-900 to-slate-900',
    purple: 'from-purple-950/20 via-slate-900 to-slate-900',
    amber: 'from-amber-950/20 via-slate-900 to-slate-900',
  };
  const pillActive: Record<string, string> = {
    blue: 'bg-blue-600 text-white shadow-sm',
    rose: 'bg-rose-600 text-white shadow-sm',
    purple: 'bg-purple-600 text-white shadow-sm',
    amber: 'bg-amber-600 text-white shadow-sm',
  };

  return (
    <div className={`border-b border-slate-800 bg-gradient-to-r ${accents[accent]} p-3.5 space-y-3`}>
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="flex items-start gap-2.5 flex-1 min-w-0 text-left active:opacity-80"
        >
          <span className="text-slate-500 mt-0.5 shrink-0">
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </span>
          {icon && <span className="shrink-0 mt-0.5">{icon}</span>}
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-white leading-tight">{title}</span>
            {subtitle && (
              <span className="block text-[11px] text-slate-400 mt-0.5 leading-tight">{subtitle}</span>
            )}
          </span>
        </button>
        {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
      </div>

      {!collapsed && (
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-[11px] font-semibold">
          {[
            { id: 'today', label: 'Day' },
            { id: 'week', label: 'Week' },
            { id: 'month', label: 'Month' },
            { id: 'year', label: 'Year' },
            { id: 'custom', label: 'Custom' },
          ].map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => onPeriodChange(p.id as ReportPeriod)}
              className={`flex-1 px-2 py-1.5 rounded-lg transition active:scale-95 ${
                period === p.id ? pillActive[accent] : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {period === 'custom' && !collapsed && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] text-slate-500 mb-1">From</label>
            <input
              type="date"
              value={customStart}
              onChange={e => onCustomStartChange(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white"
            />
          </div>
          <div>
            <label className="block text-[10px] text-slate-500 mb-1">To</label>
            <input
              type="date"
              value={customEnd}
              onChange={e => onCustomEndChange(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white"
            />
          </div>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────
export const AdminReports: React.FC = () => {
  const { currentUser, dbState, addToast } = useApp();

  const [incomePeriod, setIncomePeriod] = useState<ReportPeriod>('today');
  const [incomeStart, setIncomeStart] = useState('');
  const [incomeEnd, setIncomeEnd] = useState('');

  const [deviationPeriod, setDeviationPeriod] = useState<ReportPeriod>('today');
  const [deviationStart, setDeviationStart] = useState('');
  const [deviationEnd, setDeviationEnd] = useState('');

  const [shopPeriod, setShopPeriod] = useState<ReportPeriod>('today');
  const [shopStart, setShopStart] = useState('');
  const [shopEnd, setShopEnd] = useState('');

  const [productPeriod, setProductPeriod] = useState<ReportPeriod>('today');
  const [productStart, setProductStart] = useState('');
  const [productEnd, setProductEnd] = useState('');

  const [sellerPeriod, setSellerPeriod] = useState<ReportPeriod>('today');
  const [sellerStart, setSellerStart] = useState('');
  const [sellerEnd, setSellerEnd] = useState('');

  const [pnlPeriod, setPnlPeriod] = useState<ProfitLossPeriod>('day');
  const [pnlStart, setPnlStart] = useState('');
  const [pnlEnd, setPnlEnd] = useState('');
  const [pnlCollapsed, setPnlCollapsed] = useState(false);
  const [pnlSort, setPnlSort] = useState<'NET_DESC' | 'CAPITAL_DESC' | 'LOSS_DESC' | 'NAME_ASC'>('NET_DESC');
  const [pnlOutcomeFilter, setPnlOutcomeFilter] = useState<'ALL' | 'PROFIT' | 'LOSS'>('ALL');

  const [incomeCollapsed, setIncomeCollapsed] = useState(false);
  const [deviationCollapsed, setDeviationCollapsed] = useState(false);
  const [shopsCollapsed, setShopsCollapsed] = useState(false);
  const [productsCollapsed, setProductsCollapsed] = useState(false);
  const [sellersCollapsed, setSellersCollapsed] = useState(false);

  const [shopFilter, setShopFilter] = useState('ALL');
  const [productSearch, setProductSearch] = useState('');
  const [sellerSearch, setSellerSearch] = useState('');
  const [isPrinting, setIsPrinting] = useState(false);
  const [deviationDirection, setDeviationDirection] = useState<DeviationDirection>('ALL');

  if (!currentUser) return null;
  if (!hasAdminAccess(currentUser) && !currentUser.permissions?.canViewReports) return null;

  const platformAdmin = isPlatformAdmin(currentUser);
  const shopAdmin = isShopAdmin(currentUser);
  const settings = dbState.settings;
  const allShops = dbState.shops || [];
  const shops = platformAdmin
    ? allShops
    : shopAdmin
      ? getAdminManagedShops(currentUser, allShops)
      : allShops.filter((s: any) => (currentUser.assignedShopIds || []).includes(s.id));
  const visibleShopIdSet = new Set(shops.map((s: any) => s.id));
  const products = (dbState.products || []).filter(
    (p: any) => platformAdmin || (!!p.shopId && visibleShopIdSet.has(p.shopId))
  );

  const effectiveShopFilter = useMemo(() => {
    if (platformAdmin) return shopFilter;
    if (shopAdmin) {
      if (shops.length <= 1) return shops[0]?.id || 'ALL';
      if (shopFilter === 'ALL' || shops.some((s: any) => s.id === shopFilter)) {
        return shopFilter;
      }
      return 'ALL';
    }
    if (shopFilter === 'ALL' || shops.some((s: any) => s.id === shopFilter)) {
      return shopFilter;
    }
    return shops[0]?.id || 'ALL';
  }, [platformAdmin, shopAdmin, shops, shopFilter]);

  const incomeRange = useMemo(() => computeRange(incomePeriod, incomeStart, incomeEnd), [incomePeriod, incomeStart, incomeEnd]);
  const deviationRange = useMemo(() => computeRange(deviationPeriod, deviationStart, deviationEnd), [deviationPeriod, deviationStart, deviationEnd]);
  const shopRange = useMemo(() => computeRange(shopPeriod, shopStart, shopEnd), [shopPeriod, shopStart, shopEnd]);
  const productRange = useMemo(() => computeRange(productPeriod, productStart, productEnd), [productPeriod, productStart, productEnd]);
  const sellerRange = useMemo(() => computeRange(sellerPeriod, sellerStart, sellerEnd), [sellerPeriod, sellerStart, sellerEnd]);
  const pnlRange = useMemo(
    () => ReportService.computeProfitLossDateRange(pnlPeriod, pnlStart, pnlEnd),
    [pnlPeriod, pnlStart, pnlEnd]
  );

  const incomeSummary = useMemo(() => ReportService.getFinancialSummary(incomeRange, { shopId: effectiveShopFilter }, currentUser) || {}, [incomeRange, currentUser, dbState, effectiveShopFilter]);
  const shopSummary = useMemo(() => ReportService.getFinancialSummary(shopRange, { shopId: effectiveShopFilter }, currentUser) || {}, [shopRange, currentUser, dbState, effectiveShopFilter]);
  const productSummary = useMemo(() => ReportService.getFinancialSummary(productRange, { shopId: effectiveShopFilter }, currentUser) || {}, [productRange, currentUser, dbState, effectiveShopFilter]);
  const sellerSummary = useMemo(() => ReportService.getFinancialSummary(sellerRange, { shopId: effectiveShopFilter }, currentUser) || {}, [sellerRange, currentUser, dbState, effectiveShopFilter]);
  const deviationSummary = useMemo(() => ReportService.getFinancialSummary(deviationRange, { shopId: effectiveShopFilter }, currentUser) || {}, [deviationRange, currentUser, dbState, effectiveShopFilter]);

  // Always show all accessible shops in Shop Profit & Loss so every shop's capital, profit & loss can be compared
  const shopProfitLoss = useMemo(
    () => ReportService.getShopProfitAndLoss(pnlRange, currentUser, { shopId: 'ALL' }),
    [pnlRange, currentUser, dbState]
  );

  const visiblePnlShops = useMemo(() => {
    let list = [...shopProfitLoss.shops];
    if (pnlOutcomeFilter === 'PROFIT') {
      list = list.filter(s => s.netProfit >= 0);
    } else if (pnlOutcomeFilter === 'LOSS') {
      list = list.filter(s => s.netProfit < 0 || s.stockLossValue > 0 || s.belowCostSalesLoss > 0);
    }

    list.sort((a, b) => {
      if (pnlSort === 'CAPITAL_DESC') return b.totalCapital - a.totalCapital || a.shopName.localeCompare(b.shopName);
      if (pnlSort === 'LOSS_DESC') return b.totalLossAndExpenses - a.totalLossAndExpenses || a.netProfit - b.netProfit;
      if (pnlSort === 'NAME_ASC') return a.shopName.localeCompare(b.shopName);
      return b.netProfit - a.netProfit || b.totalCapital - a.totalCapital;
    });
    return list;
  }, [shopProfitLoss.shops, pnlOutcomeFilter, pnlSort]);

  const filteredProducts = useMemo(() => {
    const list = (productSummary as any).topProducts || [];
    if (!productSearch.trim()) return list;
    const q = productSearch.trim().toLowerCase();
    return list.filter((p: any) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
  }, [productSummary, productSearch]);

  const filteredSellers = useMemo(() => {
    const list = (sellerSummary as any).sellerSales || [];
    if (!sellerSearch.trim()) return list;
    const q = sellerSearch.trim().toLowerCase();
    return list.filter((s: any) => s.name.toLowerCase().includes(q));
  }, [sellerSummary, sellerSearch]);

  const selectedShopName =
    effectiveShopFilter === 'ALL'
      ? shopAdmin && !platformAdmin
        ? shops.length === 1
          ? shops[0].name
          : 'All Managed Shops'
        : 'All Shops'
      : shops.find((s: any) => s.id === effectiveShopFilter)?.name || 'Unknown';

  // ─────────────────────────────────────────────────────────────
  // Deviations — snapshot-first, below-cost detection, no silent skips
  // ─────────────────────────────────────────────────────────────
  const allDeviations = useMemo<DeviationRow[]>(() => {
    const sales = (deviationSummary as any).filteredSales || [];
    const productMap = new Map(products.map((p: any) => [p.id, p]));
    const rows: DeviationRow[] = [];

    for (const sale of sales) {
      if (sale.status === 'VOIDED') continue;

      for (const item of sale.items || []) {
        const product: any = productMap.get(item.productId);

        const hasSnapshot =
          item.referencePrice !== undefined &&
          item.referencePrice !== null &&
          item.referencePrice > 0;

        let referencePrice = 0;
        let usedSnapshot = false;

        if (hasSnapshot) {
          referencePrice = item.referencePrice as number;
          usedSnapshot = true;
        } else if (product) {
          referencePrice =
            product.proposedSellingPrice && product.proposedSellingPrice > 0
              ? product.proposedSellingPrice
              : product.sellingPrice || 0;
          usedSnapshot = false;
        }

        const soldPrice = item.unitPrice || 0;
        const purchasePrice = item.purchasePrice || 0;
        const qty = item.quantity || 0;

        const belowCost = purchasePrice > 0 && soldPrice < purchasePrice;
        const costLoss = belowCost
          ? Number(((purchasePrice - soldPrice) * qty).toFixed(2))
          : 0;

        if (referencePrice <= 0 && !belowCost) continue;
        if (referencePrice > 0 && soldPrice === referencePrice && !belowCost) continue;

        const diff = referencePrice > 0 ? Number((soldPrice - referencePrice).toFixed(2)) : 0;
        const totalImpact = referencePrice > 0 ? Number((diff * qty).toFixed(2)) : 0;

        rows.push({
          saleId: sale.id,
          receiptNumber: sale.receiptNumber,
          createdAt: sale.createdAt,
          shopId: sale.shopId,
          shopName: sale.shopName || '',
          sellerId: sale.sellerId,
          sellerName: sale.sellerName,
          productId: item.productId,
          productName: item.productName,
          sku: item.sku || product?.sku || '',
          referencePrice,
          soldPrice,
          purchasePrice,
          quantity: qty,
          diff,
          totalImpact,
          direction: diff > 0 ? 'ABOVE' : 'BELOW',
          usedSnapshot,
          belowCost,
          costLoss,
        });
      }
    }

    rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return rows;
  }, [deviationSummary, products]);

  const deviations = useMemo(() => {
    if (deviationDirection === 'ALL') return allDeviations;
    if (deviationDirection === 'BELOW_COST') return allDeviations.filter(d => d.belowCost);
    if (deviationDirection === 'BELOW') return allDeviations.filter(d => d.direction === 'BELOW' && d.referencePrice > 0);
    return allDeviations.filter(d => d.direction === 'ABOVE' && d.referencePrice > 0);
  }, [allDeviations, deviationDirection]);

  const deviationStats = useMemo(() => {
    const belowRefRows = allDeviations.filter(d => d.direction === 'BELOW' && d.referencePrice > 0);
    const aboveRefRows = allDeviations.filter(d => d.direction === 'ABOVE' && d.referencePrice > 0);
    const belowCostRows = allDeviations.filter(d => d.belowCost);

    const belowImpact = belowRefRows.reduce((s, r) => s + r.totalImpact, 0);
    const aboveImpact = aboveRefRows.reduce((s, r) => s + r.totalImpact, 0);
    const costLoss = belowCostRows.reduce((s, r) => s + r.costLoss, 0);

    return {
      belowCount: belowRefRows.length,
      aboveCount: aboveRefRows.length,
      belowCostCount: belowCostRows.length,
      belowSalesCount: new Set(belowRefRows.map(r => r.saleId)).size,
      aboveSalesCount: new Set(aboveRefRows.map(r => r.saleId)).size,
      belowImpact: Number(belowImpact.toFixed(2)),
      aboveImpact: Number(aboveImpact.toFixed(2)),
      costLoss: Number(costLoss.toFixed(2)),
      netImpact: Number((belowImpact + aboveImpact).toFixed(2)),
    };
  }, [allDeviations]);

  const DEVIATION_DISPLAY_CAP = 100;
  const visibleDeviations = deviations.slice(0, DEVIATION_DISPLAY_CAP);
  const hiddenDeviationCount = Math.max(0, deviations.length - DEVIATION_DISPLAY_CAP);

  // ─────────────────────────────────────────────────────────────
  // Print Main Report
  // ─────────────────────────────────────────────────────────────
  const handlePrintReport = () => {
    setIsPrinting(true);
    const printWindow = window.open('', '_blank', 'width=1400,height=900');
    if (!printWindow) {
      addToast({ type: 'error', title: 'Popup Blocked', description: 'Please allow popups to print.' });
      setIsPrinting(false);
      return;
    }

    const s: any = incomeSummary;
    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Financial Report - ${selectedShopName}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; background: #fff; color: #1e293b; }
          .header { text-align: center; margin-bottom: 20px; border-bottom: 3px double #3b82f6; padding-bottom: 15px; }
          .header h1 { font-size: 22px; color: #1e40af; font-weight: bold; }
          .header .company { font-size: 13px; color: #475569; margin-top: 5px; }
          .header .meta { font-size: 11px; color: #64748b; margin-top: 8px; line-height: 1.5; }
          .header .badge { display: inline-block; background: #dbeafe; color: #1e40af; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; margin-top: 8px; }
          .section-title { font-size: 15px; color: #1e293b; font-weight: bold; margin-bottom: 12px; padding: 8px 12px; background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 0 8px 8px 0; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 16px; }
          thead { background: #1e293b; color: #fff; }
          th { padding: 8px 6px; text-align: left; font-weight: 600; }
          td { padding: 7px 6px; border-bottom: 1px solid #e2e8f0; }
          tr:nth-child(even) { background: #f8fafc; }
          .amount { text-align: right; font-family: 'Courier New', monospace; font-weight: bold; }
          .positive { color: #16a34a; }
          .negative { color: #dc2626; }
          .footer { text-align: center; margin-top: 25px; font-size: 10px; color: #94a3b8; border-top: 2px solid #e2e8f0; padding-top: 12px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${settings.businessName}</h1>
          <div class="company">${settings.tagline || ''}</div>
          <div class="meta">
            <strong>Financial Report</strong><br>
            Period: ${incomeRange.from || 'Beginning'} to ${incomeRange.to || 'Present'}<br>
            Generated: ${new Date().toLocaleString()}
          </div>
          <div class="badge">🏪 ${selectedShopName}</div>
        </div>

        <div class="section-title">📊 Income Statement</div>
        <table>
          <tbody>
            <tr><td><strong>Gross Revenue</strong></td><td class="amount">${settings.currencySymbol} ${(s.totalGrossSales || 0).toLocaleString()}</td></tr>
            <tr><td>Less: COGS</td><td class="amount negative">-${settings.currencySymbol} ${(s.totalCostOfGoods || 0).toLocaleString()}</td></tr>
            <tr><td><strong>Gross Profit</strong></td><td class="amount positive">${settings.currencySymbol} ${(s.totalGrossProfit || 0).toLocaleString()} (${s.profitMarginPercent || 0}%)</td></tr>
            <tr><td>Less: Expenses</td><td class="amount negative">-${settings.currencySymbol} ${(s.totalExpenses || 0).toLocaleString()}</td></tr>
            <tr style="background:#f0fdf4;"><td><strong>NET PROFIT</strong></td><td class="amount ${(s.netProfit || 0) >= 0 ? 'positive' : 'negative'}">${settings.currencySymbol} ${(s.netProfit || 0).toLocaleString()} (${s.netMarginPercent || 0}%)</td></tr>
          </tbody>
        </table>

        <div class="section-title">🏪 Shop Performance</div>
        <table>
          <thead><tr><th>Shop</th><th class="amount">Sales</th><th class="amount">Revenue</th><th class="amount">Profit</th></tr></thead>
          <tbody>
            ${(s.shopSalesBreakdown || []).map((sh: any) => `
              <tr><td>${sh.name}</td><td class="amount">${sh.salesCount}</td><td class="amount">${settings.currencySymbol} ${sh.totalSales.toLocaleString()}</td><td class="amount positive">${settings.currencySymbol} ${sh.grossProfit.toLocaleString()}</td></tr>
            `).join('')}
          </tbody>
        </table>

        <div class="section-title">📦 Product Profitability</div>
        <table>
          <thead><tr><th>Product</th><th>SKU</th><th class="amount">Units</th><th class="amount">Revenue</th><th class="amount">Profit</th></tr></thead>
          <tbody>
            ${(s.topProducts || []).map((p: any) => `
              <tr><td>${p.name}</td><td style="font-family:monospace;">${p.sku}</td><td class="amount">${p.unitsSold}</td><td class="amount">${settings.currencySymbol} ${p.revenue.toLocaleString()}</td><td class="amount positive">${settings.currencySymbol} ${p.profit.toLocaleString()}</td></tr>
            `).join('')}
          </tbody>
        </table>

        <div class="section-title">👥 Seller Performance</div>
        <table>
          <thead><tr><th>Seller</th><th class="amount">Orders</th><th class="amount">Revenue</th><th class="amount">Profit</th></tr></thead>
          <tbody>
            ${(s.sellerSales || []).map((se: any) => `
              <tr><td>${se.name}</td><td class="amount">${se.count}</td><td class="amount">${settings.currencySymbol} ${se.total.toLocaleString()}</td><td class="amount positive">${settings.currencySymbol} ${se.profit.toLocaleString()}</td></tr>
            `).join('')}
          </tbody>
        </table>

        <div class="footer">
          ${settings.businessName} - ${settings.address || ''} | Phone: ${settings.phone || 'N/A'}
        </div>

        <script>window.onload = function() { window.print(); }</script>
      </body>
      </html>
    `;

    printWindow.document.write(printContent);
    printWindow.document.close();
    setTimeout(() => setIsPrinting(false), 2000);
  };

  // ─────────────────────────────────────────────────────────────
  // Print Deviations
  // ─────────────────────────────────────────────────────────────
  const handlePrintDeviations = () => {
    if (deviations.length === 0) {
      addToast({ type: 'info', title: 'No Deviations', description: 'There are no price deviations in the current filter.' });
      return;
    }

    const printWindow = window.open('', '_blank', 'width=1200,height=800');
    if (!printWindow) {
      addToast({ type: 'error', title: 'Popup Blocked', description: 'Please allow popups to print.' });
      return;
    }

    const printContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Price Deviation Audit</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; background: #fff; color: #1e293b; }
          .header { text-align: center; margin-bottom: 20px; border-bottom: 3px double #dc2626; padding-bottom: 15px; }
          .header h1 { font-size: 22px; color: #991b1b; font-weight: bold; }
          .header .meta { font-size: 11px; color: #64748b; margin-top: 8px; line-height: 1.5; }
          .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 20px; }
          .card { padding: 12px; border-radius: 8px; text-align: center; }
          .card.below { background: #fef2f2; border: 2px solid #dc2626; }
          .card.belowcost { background: #fff7ed; border: 2px solid #f97316; }
          .card.above { background: #f0fdf4; border: 2px solid #16a34a; }
          .card .label { font-size: 9px; text-transform: uppercase; color: #64748b; font-weight: 600; }
          .card .value { font-size: 16px; font-weight: bold; margin-top: 4px; }
          table { width: 100%; border-collapse: collapse; font-size: 10px; }
          thead { background: #1e293b; color: #fff; }
          th { padding: 7px 5px; text-align: left; font-weight: 600; }
          td { padding: 6px 5px; border-bottom: 1px solid #e2e8f0; }
          tr.below td { background: #fef2f2; }
          tr.belowcost td { background: #fff7ed; }
          tr.above td { background: #f0fdf4; }
          .amount { text-align: right; font-family: 'Courier New', monospace; font-weight: bold; }
          .diff-below { color: #dc2626; text-align: right; font-weight: bold; }
          .diff-above { color: #16a34a; text-align: right; font-weight: bold; }
          .loss-tag { display:inline-block; background:#f97316; color:#fff; padding:1px 4px; border-radius:3px; font-size:8px; font-weight:bold; margin-left:3px; }
          .est { color:#94a3b8; font-size:8px; font-weight:normal; margin-left:3px; }
          @media (min-width: 640px) { table { font-size: 11px; } }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Price Deviation Audit</h1>
          <div class="meta">
            Shop: ${selectedShopName} | Period: ${deviationRange.from || 'Beginning'} to ${deviationRange.to || 'Present'}<br>
            Direction: ${deviationDirection} | Generated: ${new Date().toLocaleString()}
          </div>
        </div>

        <div class="summary">
          <div class="card below"><div class="label">Below Reference</div><div class="value">${deviationStats.belowCount}</div></div>
          <div class="card belowcost"><div class="label">Below Cost (Loss)</div><div class="value">${deviationStats.belowCostCount}</div></div>
          <div class="card above"><div class="label">Above Reference</div><div class="value">${deviationStats.aboveCount}</div></div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Receipt</th>
              <th>Shop</th>
              <th>Seller</th>
              <th>Product</th>
              <th>SKU</th>
              <th class="amount">Selling Price</th>
              <th class="amount">Sold At</th>
              <th class="amount">Diff</th>
              <th class="amount">Qty</th>
              <th class="amount">Impact</th>
            </tr>
          </thead>
          <tbody>
            ${deviations.map(d => `
              <tr class="${d.belowCost ? 'belowcost' : d.direction === 'BELOW' ? 'below' : 'above'}">
                <td>${formatDateTime(d.createdAt)}</td>
                <td><strong>${d.receiptNumber}</strong></td>
                <td>${d.shopName}</td>
                <td>${d.sellerName}</td>
                <td>${d.productName}${d.belowCost ? '<span class="loss-tag">LOSS</span>' : ''}</td>
                <td style="font-family:monospace;">${d.sku}</td>
                <td class="amount">${d.referencePrice > 0 ? `${settings.currencySymbol} ${d.referencePrice.toLocaleString()}${!d.usedSnapshot ? '<span class="est">*</span>' : ''}` : '—'}</td>
                <td class="amount">${settings.currencySymbol} ${d.soldPrice.toLocaleString()}</td>
                <td class="${d.direction === 'BELOW' ? 'diff-below' : 'diff-above'}">${d.referencePrice > 0 ? `${d.diff > 0 ? '+' : ''}${settings.currencySymbol} ${d.diff.toLocaleString()}` : '—'}</td>
                <td class="amount">${d.quantity}</td>
                <td class="${d.direction === 'BELOW' ? 'diff-below' : 'diff-above'}">${d.referencePrice > 0 ? `${d.totalImpact > 0 ? '+' : ''}${settings.currencySymbol} ${d.totalImpact.toLocaleString()}` : '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <script>window.onload = function() { window.print(); }</script>
      </body>
      </html>
    `;

    printWindow.document.write(printContent);
    printWindow.document.close();
  };

  // ─────────────────────────────────────────────────────────────
  // Export CSVs
  // ─────────────────────────────────────────────────────────────
  const handleExportCSV = () => {
    const s: any = incomeSummary;
    let csv = `Financial Report - ${selectedShopName}\n`;
    csv += `Period: ${incomeRange.from || 'Beginning'} to ${incomeRange.to || 'Present'}\n\n`;
    csv += `SUMMARY\n`;
    csv += `Gross Revenue,${s.totalGrossSales || 0}\n`;
    csv += `Cost of Goods,${s.totalCostOfGoods || 0}\n`;
    csv += `Gross Profit,${s.totalGrossProfit || 0}\n`;
    csv += `Expenses,${s.totalExpenses || 0}\n`;
    csv += `Net Profit,${s.netProfit || 0}\n\n`;

    csv += `SHOP PERFORMANCE\nShop,Sales Count,Total Sales,Gross Profit\n`;
    (s.shopSalesBreakdown || []).forEach((sh: any) => {
      csv += `"${sh.name}",${sh.salesCount},${sh.totalSales},${sh.grossProfit}\n`;
    });
    csv += `\n`;

    csv += `PRODUCT PROFITABILITY\nProduct,SKU,Units,Revenue,Profit\n`;
    (s.topProducts || []).forEach((p: any) => {
      csv += `"${p.name}","${p.sku}",${p.unitsSold},${p.revenue},${p.profit}\n`;
    });
    csv += `\n`;

    csv += `SELLER PERFORMANCE\nSeller,Orders,Total,Profit\n`;
    (s.sellerSales || []).forEach((se: any) => {
      csv += `"${se.name}",${se.count},${se.total},${se.profit}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `financial_report_${selectedShopName.toLowerCase().replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    addToast({ type: 'success', title: 'Report Exported', description: 'CSV report downloaded successfully.' });
  };

  const handleExportDeviationsCSV = () => {
    if (deviations.length === 0) {
      addToast({ type: 'info', title: 'No Deviations', description: 'There are no price deviations in the current filter.' });
      return;
    }

    let csv = `Price Deviation Audit - ${selectedShopName}\n`;
    csv += `Period: ${deviationRange.from || 'Beginning'} to ${deviationRange.to || 'Present'}\n`;
    csv += `Direction: ${deviationDirection}\n\n`;
    csv += `Items Below Reference,${deviationStats.belowCount}\n`;
    csv += `Items Below Cost (Loss),${deviationStats.belowCostCount}\n`;
    csv += `Items Above Reference,${deviationStats.aboveCount}\n`;
    csv += `Below Reference Value,${deviationStats.belowImpact}\n`;
    csv += `Total Cost Loss,${deviationStats.costLoss}\n`;
    csv += `Above Reference Value,${deviationStats.aboveImpact}\n`;
    csv += `Net Impact,${deviationStats.netImpact}\n\n`;
    csv += `Date,Receipt #,Shop,Seller,Product,SKU,Selling Price,Sold At,Purchase Cost,Diff,Qty,Impact,Direction,Below Cost,Reference Source\n`;
    deviations.forEach(d => {
      csv += `"${formatDateTime(d.createdAt)}","${d.receiptNumber}","${d.shopName}","${d.sellerName}","${d.productName}","${d.sku}",${d.referencePrice},${d.soldPrice},${d.purchasePrice},${d.diff},${d.quantity},${d.totalImpact},${d.direction},${d.belowCost ? 'YES' : 'NO'},"${d.usedSnapshot ? 'Snapshot' : 'Current price'}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `price_deviations_${selectedShopName.toLowerCase().replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    addToast({ type: 'success', title: 'Deviations Exported', description: `${deviations.length} deviation(s) saved.` });
  };

  const handleExportShopProfitLossCSV = () => {
    const rows = visiblePnlShops;
    if (rows.length === 0) {
      addToast({ type: 'info', title: 'Nothing to Export', description: 'No shop profit & loss rows match the current filter.' });
      return;
    }

    let csv = `Shop Profit & Loss Statement\n`;
    csv += `Period: ${pnlRange.from || 'Beginning'} to ${pnlRange.to || 'Present'}\n\n`;
    csv += `Shop,Status,SKUs,Total Units,Floor Capital,Store Capital,Product Total Capital,Expected Retail Value,Orders,Revenue,COGS,Gross Profit,Gross Margin %,Operating Expenses,Stock Loss Units,Stock Loss Value,Below-Cost Sales Loss,Net Profit / Loss,Net Margin %,Capital Return %\n`;
    rows.forEach(r => {
      csv += `"${r.shopName.replace(/"/g, '""')}",${r.status},${r.skuCount},${r.totalUnits},${r.floorCapital},${r.storeCapital},${r.totalCapital},${r.expectedRetailValue},${r.salesCount},${r.revenue},${r.costOfGoods},${r.grossProfit},${r.grossMarginPercent}%,${r.expenses},${r.stockLossUnits},${r.stockLossValue},${r.belowCostSalesLoss},${r.netProfit},${r.netMarginPercent}%,${r.capitalReturnPercent}%\n`;
    });

    const t = shopProfitLoss.totals;
    csv += `\nCONSOLIDATED TOTALS,,${t.skuCount},${t.totalUnits},${t.floorCapital},${t.storeCapital},${t.totalCapital},${t.expectedRetailValue},${t.salesCount},${t.revenue},${t.costOfGoods},${t.grossProfit},${t.grossMarginPercent}%,${t.expenses},${t.stockLossUnits},${t.stockLossValue},${t.belowCostSalesLoss},${t.netProfit},${t.netMarginPercent}%,\n`;
    if (shopProfitLoss.generalCompanyExpenses > 0) {
      csv += `Unallocated Company Expenses,,,,,,,,,,,,,,${shopProfitLoss.generalCompanyExpenses}\n`;
      csv += `Consolidated Net After Company Expenses,,,,,,,,,,,,,,,,,${t.netAfterCompanyExpenses}\n`;
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `shop_profit_and_loss_${pnlPeriod}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    addToast({ type: 'success', title: 'P&L Exported', description: `Shop Profit & Loss CSV saved (${rows.length} shop(s)).` });
  };

  const handlePrintShopProfitLoss = () => {
    const rows = visiblePnlShops;
    if (rows.length === 0) {
      addToast({ type: 'info', title: 'Nothing to Print', description: 'No shop profit & loss data available.' });
      return;
    }

    const t = shopProfitLoss.totals;
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Shop Profit &amp; Loss - ${settings.businessName}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 24px; color: #0f172a; background: #fff; font-size: 11px; }
          .header { text-align: center; border-bottom: 3px double #2563eb; padding-bottom: 14px; margin-bottom: 16px; }
          .header h1 { font-size: 20px; color: #1e3a8a; }
          .header .sub { font-size: 12px; color: #475569; margin-top: 4px; }
          .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
          .kpi { border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; background: #f8fafc; }
          .kpi .lbl { font-size: 9px; text-transform: uppercase; color: #64748b; font-weight: 700; }
          .kpi .val { font-size: 14px; font-weight: 800; margin-top: 4px; font-family: monospace; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
          thead { background: #0f172a; color: #fff; }
          th, td { padding: 7px 6px; border-bottom: 1px solid #e2e8f0; text-align: left; }
          th.num, td.num { text-align: right; font-family: monospace; }
          tr:nth-child(even) { background: #f8fafc; }
          tfoot tr { background: #eff6ff; font-weight: 800; border-top: 2px solid #2563eb; }
          .pos { color: #15803d; }
          .neg { color: #b91c1c; }
          .note { font-size: 10px; color: #475569; padding: 8px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${settings.businessName} — Shop Profit &amp; Loss Statement</h1>
          <div class="sub">Period: ${pnlRange.from || 'Beginning'} to ${pnlRange.to || 'Present'} | Generated: ${new Date().toLocaleString()}</div>
        </div>
        <div class="kpis">
          <div class="kpi"><div class="lbl">Product Total Capital</div><div class="val">${settings.currencySymbol} ${t.totalCapital.toLocaleString()}</div></div>
          <div class="kpi"><div class="lbl">Gross Revenue</div><div class="val">${settings.currencySymbol} ${t.revenue.toLocaleString()}</div></div>
          <div class="kpi"><div class="lbl">Expenses &amp; Stock Loss</div><div class="val neg">-${settings.currencySymbol} ${t.totalLossAndExpenses.toLocaleString()}</div></div>
          <div class="kpi"><div class="lbl">Net Profit / (Loss)</div><div class="val ${t.netProfit >= 0 ? 'pos' : 'neg'}">${settings.currencySymbol} ${t.netProfit.toLocaleString()}</div></div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Shop</th>
              <th class="num">Product Capital</th>
              <th class="num">Revenue</th>
              <th class="num">Gross Profit</th>
              <th class="num">Expenses</th>
              <th class="num">Stock Loss</th>
              <th class="num">Net Profit / Loss</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td><strong>${r.shopName}</strong><br/><span style="color:#64748b;font-size:9px;">${r.skuCount} SKUs · ${r.totalUnits.toLocaleString()} units</span></td>
                <td class="num">${settings.currencySymbol} ${r.totalCapital.toLocaleString()}</td>
                <td class="num">${settings.currencySymbol} ${r.revenue.toLocaleString()}</td>
                <td class="num pos">${settings.currencySymbol} ${r.grossProfit.toLocaleString()}</td>
                <td class="num neg">-${settings.currencySymbol} ${r.expenses.toLocaleString()}</td>
                <td class="num neg">-${settings.currencySymbol} ${r.stockLossValue.toLocaleString()}</td>
                <td class="num ${r.netProfit >= 0 ? 'pos' : 'neg'}">${r.netProfit >= 0 ? '+' : ''}${settings.currencySymbol} ${r.netProfit.toLocaleString()}</td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td>TOTAL (${rows.length} shops)</td>
              <td class="num">${settings.currencySymbol} ${t.totalCapital.toLocaleString()}</td>
              <td class="num">${settings.currencySymbol} ${t.revenue.toLocaleString()}</td>
              <td class="num pos">${settings.currencySymbol} ${t.grossProfit.toLocaleString()}</td>
              <td class="num neg">-${settings.currencySymbol} ${t.expenses.toLocaleString()}</td>
              <td class="num neg">-${settings.currencySymbol} ${t.stockLossValue.toLocaleString()}</td>
              <td class="num ${t.netProfit >= 0 ? 'pos' : 'neg'}">${t.netProfit >= 0 ? '+' : ''}${settings.currencySymbol} ${t.netProfit.toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
        ${shopProfitLoss.generalCompanyExpenses > 0 ? `<div class="note">Unallocated Company Expenses: -${settings.currencySymbol} ${shopProfitLoss.generalCompanyExpenses.toLocaleString()} | Net After Company Expenses: ${settings.currencySymbol} ${t.netAfterCompanyExpenses.toLocaleString()}</div>` : ''}
      </body>
      </html>
    `;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc || !iframe.contentWindow) {
      document.body.removeChild(iframe);
      addToast({ type: 'error', title: 'Print Failed', description: 'Unable to initialize print frame.' });
      return;
    }

    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } finally {
        setTimeout(() => {
          if (iframe.parentNode) document.body.removeChild(iframe);
        }, 1500);
      }
    }, 250);
  };

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────
  return (
    <div
      id="admin-reports-view"
      className="flex-1 p-3.5 sm:p-6 bg-slate-950 text-slate-100 overflow-y-auto space-y-4 pb-24 sm:pb-6"
    >
      {/* Global Header */}
      <div className="flex flex-col gap-3 pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">Financial Reports</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Audit store performance, margins, and price deviations
          </p>
        </div>

        {shopAdmin && !platformAdmin && shops.length <= 1 ? (
          <div className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 flex items-center justify-between gap-2">
            <span className="truncate font-medium">🏪 {shops[0]?.name || 'No Managed Shop'}</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold shrink-0">
              Shop Admin Report
            </span>
          </div>
        ) : (
          <select
            value={effectiveShopFilter}
            onChange={e => setShopFilter(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white"
          >
            <option value="ALL">
              🏪 {shopAdmin && !platformAdmin ? 'All Managed Shops' : 'All Shops'}
            </option>
            {shops.map((s: any) => (
              <option key={s.id} value={s.id}>🏪 {s.name}</option>
            ))}
          </select>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCSV}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 text-xs font-semibold transition active:scale-95"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>

          <button
            onClick={handlePrintReport}
            disabled={isPrinting}
            className="flex-1 flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow transition disabled:opacity-50 active:scale-95"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{isPrinting ? 'Printing...' : 'Print'}</span>
          </button>
        </div>
      </div>

      {/* ── INCOME STATEMENT ────────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <MobileSectionHeader
          title="Income Statement"
          subtitle="Revenue, COGS, expenses, net profit"
          icon={<FileText className="w-4 h-4 text-blue-400" />}
          period={incomePeriod}
          onPeriodChange={setIncomePeriod}
          customStart={incomeStart}
          customEnd={incomeEnd}
          onCustomStartChange={setIncomeStart}
          onCustomEndChange={setIncomeEnd}
          collapsed={incomeCollapsed}
          onToggleCollapsed={() => setIncomeCollapsed(v => !v)}
          accent="blue"
        />
        {!incomeCollapsed && (
          <div className="p-4 space-y-2.5 text-xs">
            <div className="flex justify-between py-2 border-b border-slate-800/80">
              <span className="text-slate-300 font-medium">Gross Revenue</span>
              <span className="font-mono font-bold text-white">
                {formatCurrency((incomeSummary as any).totalGrossSales || 0, settings.currencySymbol)}
              </span>
            </div>
            <div className="flex justify-between py-2 border-b border-slate-800/80 text-slate-400">
              <span>Less: COGS</span>
              <span className="font-mono text-rose-400">
                -{formatCurrency((incomeSummary as any).totalCostOfGoods || 0, settings.currencySymbol)}
              </span>
            </div>
            <div className="flex justify-between py-2.5 bg-slate-950/80 px-3 rounded-lg border border-slate-800">
              <div>
                <span className="font-bold text-white">Gross Profit</span>
                <span className="text-[10px] text-emerald-400 block font-mono">
                  {(incomeSummary as any).profitMarginPercent || 0}% Margin
                </span>
              </div>
              <span className="font-mono font-bold text-emerald-400 text-sm">
                {formatCurrency((incomeSummary as any).totalGrossProfit || 0, settings.currencySymbol)}
              </span>
            </div>
            <div className="flex justify-between py-2 border-b border-slate-800/80 text-slate-400">
              <span>Less: Expenses</span>
              <span className="font-mono text-rose-400">
                -{formatCurrency((incomeSummary as any).totalExpenses || 0, settings.currencySymbol)}
              </span>
            </div>
            <div className={`flex justify-between py-2.5 px-3 rounded-lg border ${
              ((incomeSummary as any).netProfit || 0) >= 0
                ? 'bg-emerald-500/10 border-emerald-500/30'
                : 'bg-rose-500/10 border-rose-500/30'
            }`}>
              <div>
                <span className="font-bold text-white">NET PROFIT</span>
                <span className="text-[10px] text-slate-300 block font-mono">
                  {(incomeSummary as any).netMarginPercent || 0}% Net Return
                </span>
              </div>
              <span className={`font-mono font-extrabold text-sm ${
                ((incomeSummary as any).netProfit || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}>
                {formatCurrency((incomeSummary as any).netProfit || 0, settings.currencySymbol)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── SHOP PROFIT & LOSS (CAPITAL, PROFIT & LOSS PER SHOP) ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="border-b border-slate-800 bg-gradient-to-r from-emerald-950/25 via-slate-900 to-slate-900 p-3.5 sm:p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2.5">
            <button
              type="button"
              onClick={() => setPnlCollapsed(v => !v)}
              className="flex items-start gap-2.5 flex-1 min-w-0 text-left active:opacity-80"
            >
              <span className="text-slate-500 mt-0.5 shrink-0">
                {pnlCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </span>
              <span className="p-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 shrink-0">
                <Scale className="w-4 h-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm sm:text-base font-bold text-white leading-tight">
                    Shop Profit &amp; Loss
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-[10px] font-mono">
                    {shopProfitLoss.shops.length} Shop{shopProfitLoss.shops.length === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="block text-[11px] text-slate-400 mt-0.5 leading-tight">
                  All shops with product total capital, revenue, gross profit, expenses &amp; losses
                </span>
              </span>
            </button>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleExportShopProfitLossCSV}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-semibold transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span>CSV</span>
              </button>
              <button
                type="button"
                onClick={handlePrintShopProfitLoss}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold shadow transition"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print P&amp;L</span>
              </button>
            </div>
          </div>

          {!pnlCollapsed && (
            <div className="space-y-2.5">
              {/* Colored Day / Week / Month / Custom Period Filter Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Period:</span>
                  <span className="font-mono text-slate-200">
                    {pnlRange.from && pnlRange.to
                      ? pnlRange.from === pnlRange.to
                        ? pnlRange.from
                        : `${pnlRange.from} → ${pnlRange.to}`
                      : pnlRange.from
                        ? `From ${pnlRange.from}`
                        : pnlRange.to
                          ? `Up to ${pnlRange.to}`
                          : 'All Dates'}
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-1.5 w-full sm:w-auto sm:min-w-[300px]">
                  {(
                    [
                      {
                        id: 'day',
                        label: 'Day',
                        activeClass: 'bg-blue-600 border-blue-500 text-white shadow-md shadow-blue-500/30',
                        idleClass: 'bg-blue-500/10 border-blue-500/30 text-blue-300 hover:bg-blue-500/20',
                      },
                      {
                        id: 'week',
                        label: 'Week',
                        activeClass: 'bg-emerald-600 border-emerald-500 text-white shadow-md shadow-emerald-500/30',
                        idleClass: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20',
                      },
                      {
                        id: 'month',
                        label: 'Month',
                        activeClass: 'bg-violet-600 border-violet-500 text-white shadow-md shadow-violet-500/30',
                        idleClass: 'bg-violet-500/10 border-violet-500/30 text-violet-300 hover:bg-violet-500/20',
                      },
                      {
                        id: 'custom',
                        label: 'Custom',
                        activeClass: 'bg-amber-500 border-amber-400 text-white shadow-md shadow-amber-500/30',
                        idleClass: 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20',
                      },
                    ] as const
                  ).map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPnlPeriod(p.id)}
                      className={`py-1.5 px-2.5 rounded-lg border text-[11px] font-semibold transition active:scale-95 ${
                        pnlPeriod === p.id ? p.activeClass : p.idleClass
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {pnlPeriod === 'custom' && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">From</label>
                    <input
                      type="date"
                      value={pnlStart}
                      onChange={e => setPnlStart(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-400 mb-1">To</label>
                    <input
                      type="date"
                      value={pnlEnd}
                      onChange={e => setPnlEnd(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {!pnlCollapsed && (
          <div className="p-3.5 sm:p-4 space-y-4">
            {/* Consolidated All-Shops P&L Summary KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
              <div className="p-3 rounded-xl bg-slate-950/80 border border-purple-500/30">
                <div className="flex items-center justify-between text-[10px] font-semibold text-purple-300 uppercase tracking-wider">
                  <span>Product Total Capital</span>
                  <Coins className="w-3.5 h-3.5 text-purple-400" />
                </div>
                <div className="text-sm sm:text-base font-bold text-white font-mono tabular-nums mt-1 truncate">
                  {formatCurrency(shopProfitLoss.totals.totalCapital, settings.currencySymbol)}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
                  {shopProfitLoss.totals.skuCount.toLocaleString()} SKUs ·{' '}
                  {shopProfitLoss.totals.totalUnits.toLocaleString()} units
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-950/80 border border-blue-500/30">
                <div className="flex items-center justify-between text-[10px] font-semibold text-blue-300 uppercase tracking-wider">
                  <span>Sales Revenue</span>
                  <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
                </div>
                <div className="text-sm sm:text-base font-bold text-white font-mono tabular-nums mt-1 truncate">
                  {formatCurrency(shopProfitLoss.totals.revenue, settings.currencySymbol)}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
                  {shopProfitLoss.totals.salesCount} orders · COGS{' '}
                  {formatCurrency(shopProfitLoss.totals.costOfGoods, settings.currencySymbol)}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-950/80 border border-rose-500/30">
                <div className="flex items-center justify-between text-[10px] font-semibold text-rose-300 uppercase tracking-wider">
                  <span>Expenses &amp; Losses</span>
                  <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
                </div>
                <div className="text-sm sm:text-base font-bold text-rose-300 font-mono tabular-nums mt-1 truncate">
                  -{formatCurrency(shopProfitLoss.totals.totalLossAndExpenses, settings.currencySymbol)}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 font-mono truncate">
                  Exp {formatCurrency(shopProfitLoss.totals.expenses, settings.currencySymbol)} · Stock Loss{' '}
                  {formatCurrency(shopProfitLoss.totals.stockLossValue, settings.currencySymbol)}
                </div>
              </div>

              <div
                className={`p-3 rounded-xl border ${
                  shopProfitLoss.totals.netProfit >= 0
                    ? 'bg-emerald-950/25 border-emerald-500/40'
                    : 'bg-rose-950/25 border-rose-500/40'
                }`}
              >
                <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-300">
                  <span>Net Profit / (Loss)</span>
                  <Scale
                    className={`w-3.5 h-3.5 ${
                      shopProfitLoss.totals.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  />
                </div>
                <div
                  className={`text-sm sm:text-base font-extrabold font-mono tabular-nums mt-1 truncate ${
                    shopProfitLoss.totals.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {shopProfitLoss.totals.netProfit >= 0 ? '+' : ''}
                  {formatCurrency(shopProfitLoss.totals.netProfit, settings.currencySymbol)}
                </div>
                <div className="text-[10px] text-slate-300 mt-0.5 font-mono">
                  Gross: {formatCurrency(shopProfitLoss.totals.grossProfit, settings.currencySymbol)} (
                  {shopProfitLoss.totals.netMarginPercent}% net)
                </div>
              </div>
            </div>

            {/* Filter & Sort Controls */}
            {shopProfitLoss.shops.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
                  {[
                    { id: 'ALL', label: `All Shops (${shopProfitLoss.shops.length})` },
                    {
                      id: 'PROFIT',
                      label: `Profit (${shopProfitLoss.shops.filter(s => s.netProfit >= 0).length})`,
                    },
                    {
                      id: 'LOSS',
                      label: `Loss (${
                        shopProfitLoss.shops.filter(
                          s => s.netProfit < 0 || s.stockLossValue > 0 || s.belowCostSalesLoss > 0
                        ).length
                      })`,
                    },
                  ].map(pill => (
                    <button
                      key={pill.id}
                      type="button"
                      onClick={() => setPnlOutcomeFilter(pill.id as 'ALL' | 'PROFIT' | 'LOSS')}
                      className={`px-2.5 py-1 rounded-md font-semibold transition ${
                        pnlOutcomeFilter === pill.id
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {pill.label}
                    </button>
                  ))}
                </div>

                <select
                  value={pnlSort}
                  onChange={e => setPnlSort(e.target.value as any)}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="NET_DESC">Sort: Highest Net Profit</option>
                  <option value="CAPITAL_DESC">Sort: Highest Product Capital</option>
                  <option value="LOSS_DESC">Sort: Highest Expenses &amp; Losses</option>
                  <option value="NAME_ASC">Sort: Shop Name (A–Z)</option>
                </select>
              </div>
            )}

            {visiblePnlShops.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500 bg-slate-950/50 rounded-xl border border-slate-800">
                No shops match this Profit &amp; Loss filter.
              </div>
            ) : (
              <>
                {/* Desktop Professional Financial P&L Statement Table */}
                <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/60">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-950 text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-800">
                        <th className="py-3 px-3.5 text-left font-semibold">Shop</th>
                        <th className="py-3 px-3 text-right font-semibold">Product Total Capital</th>
                        <th className="py-3 px-3 text-right font-semibold">Revenue &amp; COGS</th>
                        <th className="py-3 px-3 text-right font-semibold">Gross Profit</th>
                        <th className="py-3 px-3 text-right font-semibold">Expenses &amp; Losses</th>
                        <th className="py-3 px-3.5 text-right font-semibold">Net Profit / (Loss)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80">
                      {visiblePnlShops.map(row => {
                        const isProfit = row.netProfit >= 0;
                        const isHighlighted = effectiveShopFilter === row.shopId;
                        return (
                          <tr
                            key={row.shopId}
                            className={`transition ${
                              isHighlighted ? 'bg-blue-950/20' : 'hover:bg-slate-900/60'
                            }`}
                          >
                            <td className="py-3 px-3.5 align-top">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-white">🏪 {row.shopName}</span>
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${
                                    row.netProfit > 0
                                      ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                                      : row.netProfit < 0
                                        ? 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                                        : 'bg-slate-800 border-slate-700 text-slate-400'
                                  }`}
                                >
                                  {row.netProfit > 0 ? 'Profit' : row.netProfit < 0 ? 'Loss' : 'Even'}
                                </span>
                                {isHighlighted && (
                                  <span className="px-1.5 py-0.5 rounded bg-blue-500/20 border border-blue-500/30 text-blue-300 text-[9px] font-semibold">
                                    Selected
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-slate-400 mt-1 font-mono">
                                {row.skuCount} SKUs · {row.totalUnits.toLocaleString()} units (Floor{' '}
                                {row.floorUnits.toLocaleString()} / Store {row.storeUnits.toLocaleString()})
                              </div>
                            </td>

                            <td className="py-3 px-3 text-right align-top font-mono tabular-nums">
                              <div className="font-bold text-purple-300">
                                {formatCurrency(row.totalCapital, settings.currencySymbol)}
                              </div>
                              <div className="text-[10px] text-slate-500 mt-0.5">
                                Floor {formatCurrency(row.floorCapital, settings.currencySymbol)} · Store{' '}
                                {formatCurrency(row.storeCapital, settings.currencySymbol)}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                Retail: {formatCurrency(row.expectedRetailValue, settings.currencySymbol)}
                              </div>
                            </td>

                            <td className="py-3 px-3 text-right align-top font-mono tabular-nums">
                              <div className="font-semibold text-white">
                                {formatCurrency(row.revenue, settings.currencySymbol)}
                              </div>
                              <div className="text-[10px] text-slate-400 mt-0.5">
                                {row.salesCount} sale{row.salesCount === 1 ? '' : 's'}
                              </div>
                              <div className="text-[10px] text-slate-500">
                                COGS: -{formatCurrency(row.costOfGoods, settings.currencySymbol)}
                              </div>
                            </td>

                            <td className="py-3 px-3 text-right align-top font-mono tabular-nums">
                              <div
                                className={`font-bold ${
                                  row.grossProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                                }`}
                              >
                                {row.grossProfit >= 0 ? '+' : ''}
                                {formatCurrency(row.grossProfit, settings.currencySymbol)}
                              </div>
                              <div className="text-[10px] text-slate-400 mt-0.5">
                                {row.grossMarginPercent}% margin
                              </div>
                            </td>

                            <td className="py-3 px-3 text-right align-top font-mono tabular-nums">
                              <div className="font-semibold text-rose-300">
                                -{formatCurrency(row.totalLossAndExpenses, settings.currencySymbol)}
                              </div>
                              <div className="text-[10px] text-slate-400 mt-0.5">
                                Exp: {formatCurrency(row.expenses, settings.currencySymbol)}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                Stock Loss: {formatCurrency(row.stockLossValue, settings.currencySymbol)}
                                {row.stockLossUnits > 0 ? ` (${row.stockLossUnits}u)` : ''}
                              </div>
                              {row.belowCostSalesLoss > 0 && (
                                <div className="text-[10px] text-amber-400 mt-0.5">
                                  Below-cost: {formatCurrency(row.belowCostSalesLoss, settings.currencySymbol)}
                                </div>
                              )}
                            </td>

                            <td className="py-3 px-3.5 text-right align-top font-mono tabular-nums">
                              <div
                                className={`text-sm font-extrabold ${
                                  isProfit ? 'text-emerald-400' : 'text-rose-400'
                                }`}
                              >
                                {isProfit ? '+' : ''}
                                {formatCurrency(row.netProfit, settings.currencySymbol)}
                              </div>
                              <div className="text-[10px] text-slate-400 mt-0.5">
                                {row.netMarginPercent}% net margin
                              </div>
                              <div className="text-[10px] text-slate-500">
                                {row.capitalReturnPercent >= 0 ? '+' : ''}
                                {row.capitalReturnPercent}% ROI on cap
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-900/90 border-t-2 border-slate-700 font-mono tabular-nums text-xs">
                        <td className="py-3 px-3.5 font-bold text-white font-sans">
                          CONSOLIDATED TOTAL ({visiblePnlShops.length} shop{visiblePnlShops.length === 1 ? '' : 's'})
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-purple-300">
                          {formatCurrency(
                            visiblePnlShops.reduce((s, r) => s + r.totalCapital, 0),
                            settings.currencySymbol
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-white">
                          {formatCurrency(
                            visiblePnlShops.reduce((s, r) => s + r.revenue, 0),
                            settings.currencySymbol
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-emerald-400">
                          {formatCurrency(
                            visiblePnlShops.reduce((s, r) => s + r.grossProfit, 0),
                            settings.currencySymbol
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-rose-300">
                          -
                          {formatCurrency(
                            visiblePnlShops.reduce((s, r) => s + r.totalLossAndExpenses, 0),
                            settings.currencySymbol
                          )}
                        </td>
                        <td
                          className={`py-3 px-3.5 text-right font-extrabold ${
                            visiblePnlShops.reduce((s, r) => s + r.netProfit, 0) >= 0
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                          }`}
                        >
                          {visiblePnlShops.reduce((s, r) => s + r.netProfit, 0) >= 0 ? '+' : ''}
                          {formatCurrency(
                            visiblePnlShops.reduce((s, r) => s + r.netProfit, 0),
                            settings.currencySymbol
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Mobile Executive P&L Cards */}
                <div className="md:hidden space-y-2.5">
                  {visiblePnlShops.map(row => {
                    const isProfit = row.netProfit >= 0;
                    return (
                      <div
                        key={row.shopId}
                        className={`rounded-xl border p-3.5 space-y-3 text-xs ${
                          isProfit
                            ? 'bg-slate-950/70 border-slate-800'
                            : 'bg-rose-950/15 border-rose-800/40'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2 pb-2 border-b border-slate-800/80">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <h4 className="font-bold text-white text-sm truncate">
                                🏪 {row.shopName}
                              </h4>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${
                                  row.netProfit > 0
                                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                                    : row.netProfit < 0
                                      ? 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                                      : 'bg-slate-800 border-slate-700 text-slate-400'
                                }`}
                              >
                                {row.netProfit > 0 ? 'Profit' : row.netProfit < 0 ? 'Loss' : 'Even'}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                              {row.skuCount} SKUs · {row.totalUnits.toLocaleString()} units
                            </p>
                          </div>

                          <div className="text-right shrink-0 font-mono tabular-nums">
                            <div className="text-[10px] text-slate-400">Net P&amp;L</div>
                            <div
                              className={`text-sm font-extrabold ${
                                isProfit ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {isProfit ? '+' : ''}
                              {formatCurrency(row.netProfit, settings.currencySymbol)}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 font-mono tabular-nums">
                          <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2">
                            <span className="text-[10px] text-slate-400 font-sans block">
                              Product Capital
                            </span>
                            <span className="font-bold text-purple-300 text-xs">
                              {formatCurrency(row.totalCapital, settings.currencySymbol)}
                            </span>
                            <span className="text-[9px] text-slate-500 block mt-0.5">
                              Floor {formatCurrency(row.floorCapital, settings.currencySymbol)} · Store{' '}
                              {formatCurrency(row.storeCapital, settings.currencySymbol)}
                            </span>
                          </div>

                          <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2">
                            <span className="text-[10px] text-slate-400 font-sans block">
                              Revenue ({row.salesCount} sales)
                            </span>
                            <span className="font-bold text-white text-xs">
                              {formatCurrency(row.revenue, settings.currencySymbol)}
                            </span>
                            <span className="text-[9px] text-slate-500 block mt-0.5">
                              COGS: {formatCurrency(row.costOfGoods, settings.currencySymbol)}
                            </span>
                          </div>

                          <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2">
                            <span className="text-[10px] text-slate-400 font-sans block">
                              Gross Profit
                            </span>
                            <span
                              className={`font-bold text-xs ${
                                row.grossProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {row.grossProfit >= 0 ? '+' : ''}
                              {formatCurrency(row.grossProfit, settings.currencySymbol)}
                            </span>
                            <span className="text-[9px] text-slate-500 block mt-0.5">
                              Margin: {row.grossMarginPercent}%
                            </span>
                          </div>

                          <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-2">
                            <span className="text-[10px] text-slate-400 font-sans block">
                              Expenses &amp; Losses
                            </span>
                            <span className="font-bold text-rose-300 text-xs">
                              -{formatCurrency(row.totalLossAndExpenses, settings.currencySymbol)}
                            </span>
                            <span className="text-[9px] text-slate-500 block mt-0.5">
                              Exp {formatCurrency(row.expenses, settings.currencySymbol)} · Loss{' '}
                              {formatCurrency(row.stockLossValue, settings.currencySymbol)}
                            </span>
                          </div>
                        </div>

                        {row.belowCostSalesLoss > 0 && (
                          <div className="px-2.5 py-1.5 rounded-lg bg-amber-950/30 border border-amber-500/30 text-[10px] text-amber-300 font-mono">
                            Below-cost sales loss: -
                            {formatCurrency(row.belowCostSalesLoss, settings.currencySymbol)} (included in Gross Profit)
                          </div>
                        )}

                        <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 font-mono">
                          <span>Net Margin: {row.netMarginPercent}%</span>
                          <span>
                            Capital ROI: {row.capitalReturnPercent >= 0 ? '+' : ''}
                            {row.capitalReturnPercent}%
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {shopProfitLoss.generalCompanyExpenses > 0 && (
              <div className="p-3 rounded-xl bg-amber-950/20 border border-amber-500/30 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="text-amber-200">
                  <strong className="font-semibold">Unallocated General Company Expenses:</strong>{' '}
                  <span className="font-mono text-rose-300">
                    -{formatCurrency(shopProfitLoss.generalCompanyExpenses, settings.currencySymbol)}
                  </span>
                </div>
                <div className="font-mono text-xs">
                  <span className="text-slate-400 mr-1.5">Company Net:</span>
                  <strong
                    className={
                      shopProfitLoss.totals.netAfterCompanyExpenses >= 0
                        ? 'text-emerald-400'
                        : 'text-rose-400'
                    }
                  >
                    {shopProfitLoss.totals.netAfterCompanyExpenses >= 0 ? '+' : ''}
                    {formatCurrency(
                      shopProfitLoss.totals.netAfterCompanyExpenses,
                      settings.currencySymbol
                    )}
                  </strong>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── PRICE DEVIATION AUDIT ──────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <MobileSectionHeader
          title="Price Deviation Audit"
          subtitle="Sales charged above, below, or at a loss"
          icon={<TrendingDown className="w-4 h-4 text-rose-400" />}
          period={deviationPeriod}
          onPeriodChange={setDeviationPeriod}
          customStart={deviationStart}
          customEnd={deviationEnd}
          onCustomStartChange={setDeviationStart}
          onCustomEndChange={setDeviationEnd}
          collapsed={deviationCollapsed}
          onToggleCollapsed={() => setDeviationCollapsed(v => !v)}
          accent="rose"
          actions={
            allDeviations.length > 0 ? (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleExportDeviationsCSV}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[10px] font-semibold transition"
                >
                  <Download className="w-3 h-3" />
                  <span>Export</span>
                </button>
                <button
                  onClick={handlePrintDeviations}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-semibold shadow transition"
                >
                  <Printer className="w-3 h-3" />
                  <span>Print</span>
                </button>
              </div>
            ) : null
          }
        />
        {!deviationCollapsed && (
          <>
            {allDeviations.length === 0 ? (
              <div className="p-5 text-center">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-medium">
                  <TrendingUp className="w-4 h-4" />
                  <span>All sales match the reference price</span>
                </div>
              </div>
            ) : (
              <div className="p-3.5 space-y-3.5">
                {/* 3 summary cards */}
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-800/40">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-semibold text-rose-300 uppercase tracking-wider">Below Reference</span>
                      <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
                    </div>
                    <div className="text-lg font-bold text-rose-300 font-mono">{deviationStats.belowCount}</div>
                    <div className="text-[10px] text-rose-400/80 mt-0.5">
                      {deviationStats.belowSalesCount} sale{deviationStats.belowSalesCount === 1 ? '' : 's'} · value {formatCurrency(deviationStats.belowImpact, settings.currencySymbol)}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-orange-950/30 border border-orange-800/40">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-semibold text-orange-300 uppercase tracking-wider">Below Cost (Loss)</span>
                      <AlertTriangle className="w-3.5 h-3.5 text-orange-400" />
                    </div>
                    <div className="text-lg font-bold text-orange-300 font-mono">{deviationStats.belowCostCount}</div>
                    <div className="text-[10px] text-orange-400/80 mt-0.5">
                      Real loss: {formatCurrency(deviationStats.costLoss, settings.currencySymbol)}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-800/40">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-semibold text-emerald-300 uppercase tracking-wider">Above Reference</span>
                      <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                    </div>
                    <div className="text-lg font-bold text-emerald-300 font-mono">{deviationStats.aboveCount}</div>
                    <div className="text-[10px] text-emerald-400/80 mt-0.5">
                      {deviationStats.aboveSalesCount} sale{deviationStats.aboveSalesCount === 1 ? '' : 's'} · value {formatCurrency(deviationStats.aboveImpact, settings.currencySymbol)}
                    </div>
                  </div>
                </div>

                {/* Net impact */}
                <div className={`p-3 rounded-xl border flex items-center justify-between ${
                  deviationStats.netImpact >= 0 ? 'bg-emerald-950/20 border-emerald-800/40' : 'bg-rose-950/20 border-rose-800/40'
                }`}>
                  <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Net Impact</span>
                  <span className={`text-base font-bold font-mono ${
                    deviationStats.netImpact >= 0 ? 'text-emerald-300' : 'text-rose-300'
                  }`}>
                    {deviationStats.netImpact > 0 ? '+' : ''}{formatCurrency(deviationStats.netImpact, settings.currencySymbol)}
                  </span>
                </div>

                {/* Direction filter pills */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[10px] font-semibold">
                  <button
                    onClick={() => setDeviationDirection('ALL')}
                    className={`px-2 py-1.5 rounded-md transition ${
                      deviationDirection === 'ALL' ? 'bg-slate-800 text-white' : 'text-slate-400'
                    }`}
                  >
                    All ({allDeviations.length})
                  </button>
                  <button
                    onClick={() => setDeviationDirection('BELOW')}
                    className={`px-2 py-1.5 rounded-md transition ${
                      deviationDirection === 'BELOW' ? 'bg-rose-600 text-white' : 'text-slate-400'
                    }`}
                  >
                    Below ({deviationStats.belowCount})
                  </button>
                  <button
                    onClick={() => setDeviationDirection('BELOW_COST')}
                    className={`px-2 py-1.5 rounded-md transition ${
                      deviationDirection === 'BELOW_COST' ? 'bg-orange-600 text-white' : 'text-slate-400'
                    }`}
                  >
                    Loss ({deviationStats.belowCostCount})
                  </button>
                  <button
                    onClick={() => setDeviationDirection('ABOVE')}
                    className={`px-2 py-1.5 rounded-md transition ${
                      deviationDirection === 'ABOVE' ? 'bg-emerald-600 text-white' : 'text-slate-400'
                    }`}
                  >
                    Above ({deviationStats.aboveCount})
                  </button>
                </div>

                <div className="text-[10px] text-slate-500 font-mono text-center">
                  Showing {visibleDeviations.length} of {deviations.length}
                  {hiddenDeviationCount > 0 && ` · export CSV to see all`}
                </div>

                {/* Deviation cards — NO cost column */}
                <div className="space-y-2">
                  {visibleDeviations.map((d, idx) => {
                    const isBelow = d.direction === 'BELOW';
                    const cardBg = d.belowCost
                      ? 'bg-orange-950/10 border-orange-800/40'
                      : isBelow
                      ? 'bg-rose-950/10 border-rose-800/40'
                      : 'bg-emerald-950/10 border-emerald-800/40';
                    const accentText = d.belowCost
                      ? 'text-orange-300'
                      : isBelow
                      ? 'text-rose-300'
                      : 'text-emerald-300';

                    return (
                      <div key={`${d.saleId}-${d.productId}-${idx}`} className={`rounded-xl p-3 border space-y-2.5 ${cardBg}`}>
                        {/* Product name + LOSS badge + impact */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-sm font-bold text-white truncate">{d.productName}</span>
                              {d.belowCost && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-500/30 text-orange-200 border border-orange-500/50 font-bold">
                                  LOSS
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono mt-0.5">{d.sku}</div>
                          </div>
                          <div className={`shrink-0 text-right ${accentText}`}>
                            <div className="font-mono font-bold text-sm">
                              {d.referencePrice > 0
                                ? `${d.totalImpact > 0 ? '+' : ''}${formatCurrency(d.totalImpact, settings.currencySymbol)}`
                                : `-${formatCurrency(d.costLoss, settings.currencySymbol)}`}
                            </div>
                          </div>
                        </div>

                        {/* 3 columns: Selling Price | Sold At | Qty (NO COST) */}
                        <div className="grid grid-cols-3 gap-2 text-[11px]">
                          <div>
                            <div className="text-slate-500 text-[9px] uppercase tracking-wider mb-0.5">Selling Price</div>
                            <div className="font-mono font-semibold text-slate-200">
                              {d.referencePrice > 0
                                ? `${formatCurrency(d.referencePrice, settings.currencySymbol)}${!d.usedSnapshot ? '*' : ''}`
                                : '—'}
                            </div>
                          </div>
                          <div>
                            <div className="text-slate-500 text-[9px] uppercase tracking-wider mb-0.5">Sold At</div>
                            <div className={`font-mono font-bold ${accentText}`}>
                              {formatCurrency(d.soldPrice, settings.currencySymbol)}
                            </div>
                          </div>
                          <div>
                            <div className="text-slate-500 text-[9px] uppercase tracking-wider mb-0.5">Qty</div>
                            <div className="font-mono font-semibold text-slate-200">{d.quantity}</div>
                          </div>
                        </div>

                        {/* Footer: receipt • seller (BOLD) • date */}
                        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/60 text-[10px]">
                          <span className="font-mono text-slate-400 truncate">{d.receiptNumber}</span>
                          <span className="font-bold text-slate-100 truncate max-w-[140px]" title={d.sellerName}>
                            {d.sellerName}
                          </span>
                          <span className="font-mono text-slate-400 shrink-0">{formatDateTime(d.createdAt).slice(5, 16)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="text-[9px] text-slate-500 text-center italic">
                  * = Selling Price estimated from current product (legacy sale)
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── SHOP PERFORMANCE ─────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <MobileSectionHeader
          title="Shop Performance"
          subtitle="Revenue and profit by shop unit"
          icon={<Store className="w-4 h-4 text-blue-400" />}
          period={shopPeriod}
          onPeriodChange={setShopPeriod}
          customStart={shopStart}
          customEnd={shopEnd}
          onCustomStartChange={setShopStart}
          onCustomEndChange={setShopEnd}
          collapsed={shopsCollapsed}
          onToggleCollapsed={() => setShopsCollapsed(v => !v)}
          accent="blue"
        />
        {!shopsCollapsed && (
          <div className="p-3.5">
            {((shopSummary as any).shopSalesBreakdown || []).length === 0 ? (
              <div className="py-6 text-center text-slate-500 text-xs">No shop data in this period.</div>
            ) : (
              <div className="divide-y divide-slate-800/60">
                {((shopSummary as any).shopSalesBreakdown || []).map((shop: any) => (
                  <div key={shop.id} className="py-2.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-white font-semibold text-xs truncate">🏪 {shop.name}</span>
                      <span className="font-mono font-bold text-emerald-400 text-xs shrink-0">
                        +{formatCurrency(shop.grossProfit, settings.currencySymbol)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>{shop.salesCount} {shop.salesCount === 1 ? 'sale' : 'sales'}</span>
                      <span className="font-mono">{formatCurrency(shop.totalSales, settings.currencySymbol)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── PRODUCT PROFITABILITY ─────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <MobileSectionHeader
          title="Product Profitability"
          subtitle="Revenue and profit per product"
          icon={<Package className="w-4 h-4 text-purple-400" />}
          period={productPeriod}
          onPeriodChange={setProductPeriod}
          customStart={productStart}
          customEnd={productEnd}
          onCustomStartChange={setProductStart}
          onCustomEndChange={setProductEnd}
          collapsed={productsCollapsed}
          onToggleCollapsed={() => setProductsCollapsed(v => !v)}
          accent="purple"
        />
        {!productsCollapsed && (
          <div className="p-3.5 space-y-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={productSearch}
                onChange={e => setProductSearch(e.target.value)}
                placeholder="Filter products..."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-2 text-xs text-white"
              />
            </div>

            {filteredProducts.length === 0 ? (
              <div className="py-6 text-center text-slate-500 text-xs">No products match</div>
            ) : (
              <div className="divide-y divide-slate-800/60">
                {filteredProducts.map((p: any) => (
                  <div key={p.sku} className="py-2.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-white font-medium text-xs truncate">{p.name}</span>
                      <span className="font-mono font-bold text-emerald-400 text-xs shrink-0">
                        +{formatCurrency(p.profit, settings.currencySymbol)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span className="font-mono truncate">{p.sku}</span>
                      <span className="font-mono">
                        {p.unitsSold} × {formatCurrency(p.revenue, settings.currencySymbol)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── SELLER PERFORMANCE ─────────────────────────────── */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <MobileSectionHeader
          title="Seller Performance"
          subtitle="Revenue and profit per seller"
          icon={<Users className="w-4 h-4 text-purple-400" />}
          period={sellerPeriod}
          onPeriodChange={setSellerPeriod}
          customStart={sellerStart}
          customEnd={sellerEnd}
          onCustomStartChange={setSellerStart}
          onCustomEndChange={setSellerEnd}
          collapsed={sellersCollapsed}
          onToggleCollapsed={() => setSellersCollapsed(v => !v)}
          accent="amber"
        />
        {!sellersCollapsed && (
          <div className="p-3.5 space-y-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={sellerSearch}
                onChange={e => setSellerSearch(e.target.value)}
                placeholder="Filter sellers..."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-2 text-xs text-white"
              />
            </div>

            {filteredSellers.length === 0 ? (
              <div className="py-6 text-center text-slate-500 text-xs">No sellers match</div>
            ) : (
              <div className="divide-y divide-slate-800/60">
                {filteredSellers.map((seller: any) => (
                  <div key={seller.name} className="py-2.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-white font-semibold text-xs truncate">{seller.name}</span>
                      <span className="font-mono font-bold text-emerald-400 text-xs shrink-0">
                        +{formatCurrency(seller.profit, settings.currencySymbol)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>{seller.count} {seller.count === 1 ? 'order' : 'orders'}</span>
                      <span className="font-mono">{formatCurrency(seller.total, settings.currencySymbol)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
