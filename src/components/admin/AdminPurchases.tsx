import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Plus,
  Trash2,
  Search,
  X,
  Pencil,
  Package,
  Check,
  ChevronDown,
  Loader2,
  Ban,
  RotateCcw,
  ArrowLeft,
  ClipboardList,
  Store,
  Warehouse,
  User as UserIcon,
  Calendar,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { PurchaseIcon } from '../common/PurchaseIcon';
import { PurchaseService } from '../../services/purchaseService';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import type { Purchase } from '../../types';
import {
  getAdminManagedShops,
  hasAdminAccess,
  isPlatformAdmin,
  isShopAdmin,
} from '../../utils/permissions';

const PAGE_SIZE = 15;

interface PurchaseItemInput {
  productId: string;
  quantity: number | string;
  unitCost: number | string;
}

// ─────────────────────────────────────────────────────────────
// Inline ProductSearchSelect — mobile-optimized bottom-sheet
// ─────────────────────────────────────────────────────────────
interface ProductLike {
  id: string;
  name: string;
  sku: string;
  currentStock: number;
  storeStock?: number;
  unit: string;
  purchasePrice?: number;
  sellingPrice?: number;
}

const ProductSearchSelect: React.FC<{
  products: ProductLike[];
  value: string;
  onChange: (productId: string) => void;
  currencySymbol?: string;
  placeholder?: string;
}> = ({ products, value, onChange, currencySymbol = 'TSh', placeholder = 'Search name or SKU...' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedProduct = useMemo(
    () => products.find(p => p.id === value),
    [products, value]
  );

  // Filter — multi-token, name + SKU, capped at 100 for perf
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products.slice(0, 50);
    const tokens = q.split(/\s+/);
    return products
      .filter(p => {
        const hay = `${p.name} ${p.sku}`.toLowerCase();
        return tokens.every(t => hay.includes(t));
      })
      .slice(0, 100);
  }, [products, query]);

  // Autofocus search input on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
    }
  }, [isOpen]);

  // Lock body scroll while sheet is open
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  const handleSelect = (productId: string) => {
    onChange(productId);
    setIsOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="w-full flex items-center justify-between gap-2 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2.5 text-left transition active:bg-slate-800"
      >
        <span className="flex items-center gap-2 min-w-0 flex-1">
          <Package className="w-4 h-4 text-slate-500 shrink-0" />
          {selectedProduct ? (
            <span className="min-w-0">
              <span className="block text-white font-medium truncate leading-tight text-xs">
                {selectedProduct.name}
              </span>
              <span className="block text-[10px] text-slate-500 font-mono leading-tight mt-0.5">
                {selectedProduct.sku} · Floor: {selectedProduct.currentStock}
                {(selectedProduct.storeStock || 0) > 0
                  ? ` · Store: ${selectedProduct.storeStock}`
                  : ''}{' '}
                {selectedProduct.unit}
              </span>
            </span>
          ) : (
            <span className="text-slate-500 truncate text-xs">Select a product...</span>
          )}
        </span>
        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
          <div
            className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm animate-in fade-in"
            onClick={() => setIsOpen(false)}
          />

          <div
            className="
              relative bg-slate-900 border border-slate-800
              rounded-t-2xl sm:rounded-2xl
              w-full sm:max-w-md
              shadow-2xl
              max-h-[85vh] sm:max-h-[80vh]
              flex flex-col
              animate-in fade-in slide-in-from-bottom-4 sm:zoom-in-95
            "
          >
            <div className="sm:hidden flex justify-center pt-2 pb-1">
              <span className="w-10 h-1 rounded-full bg-slate-700" />
            </div>

            <div className="p-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder={placeholder}
                    inputMode="search"
                    autoComplete="off"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-9 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white p-1"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="text-slate-400 hover:text-white p-1.5 rounded-lg shrink-0"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-[10px] text-slate-500 mt-1.5">
                {query
                  ? `${filtered.length} match${filtered.length === 1 ? '' : 'es'}`
                  : `Showing first ${filtered.length} of ${products.length} — type to search`}
              </p>
            </div>

            <div className="overflow-y-auto flex-1 overscroll-contain">
              {filtered.length === 0 ? (
                <div className="p-8 text-center">
                  <Package className="w-9 h-9 mx-auto text-slate-600 mb-2" />
                  <p className="text-sm text-slate-400">No products match "{query}"</p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Try a shorter search or check the SKU
                  </p>
                </div>
              ) : (
                filtered.map(p => {
                  const isSelected = p.id === value;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleSelect(p.id)}
                      className={`w-full text-left px-3 py-3 border-b border-slate-800/60 last:border-b-0 transition active:bg-slate-800/80 ${
                        isSelected ? 'bg-slate-800/40' : 'hover:bg-slate-800/40'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-white truncate">
                              {p.name}
                            </span>
                            {isSelected && (
                              <Check className="w-4 h-4 text-blue-400 shrink-0" />
                            )}
                          </div>
                          <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[11px] text-slate-500 font-mono">
                            <span>{p.sku}</span>
                            <span
                              className={
                                p.currentStock <= 0 ? 'text-rose-400' : 'text-slate-500'
                              }
                            >
                              Floor: {p.currentStock} {p.unit}
                            </span>
                            {(p.storeStock || 0) > 0 && (
                              <span className="text-blue-400">
                                Store: {p.storeStock} {p.unit}
                              </span>
                            )}
                            {p.purchasePrice !== undefined && p.purchasePrice !== null && (
                              <span className="text-amber-400/80">
                                Cost: {formatCurrency(p.purchasePrice, currencySymbol)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            <div className="px-3 py-2 border-t border-slate-800 bg-slate-950/60 text-[10px] text-slate-500 flex items-center justify-between">
              <span>Tap a product to select</span>
              <span>{products.length} products</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// ─────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────
export const AdminPurchases: React.FC = () => {
  const {
    currentUser,
    dbState,
    addToast,
    selectedShopId,
    currentShop,
    purchasesSubTab,
    setPurchasesSubTab,
    purchasesNavTick,
  } = useApp();

  const [isEditMode, setIsEditMode] = useState(false);
  const [editingPurchase, setEditingPurchase] = useState<Purchase | null>(null);
  const [voidingPurchase, setVoidingPurchase] = useState<Purchase | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [isVoiding, setIsVoiding] = useState(false);

  // Purchase Return modal state
  const [returningPurchase, setReturningPurchase] = useState<Purchase | null>(null);
  const [returnQuantities, setReturnQuantities] = useState<Record<string, string>>({});
  const [returnReason, setReturnReason] = useState('');
  const [returnError, setReturnError] = useState('');
  const [isReturning, setIsReturning] = useState(false);

  // List search & pagination
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Return List search, period filter & pagination
  const [returnSearchQuery, setReturnSearchQuery] = useState('');
  const [returnPeriod, setReturnPeriod] = useState<'ALL' | 'TODAY' | 'WEEK' | 'MONTH'>('ALL');
  const [visibleReturnsCount, setVisibleReturnsCount] = useState(PAGE_SIZE);

  // Form state (full-page Add / Edit Purchase)
  const [purchaseShopId, setPurchaseShopId] = useState('');
  const [destinationType, setDestinationType] = useState<'SHOP_FLOOR' | 'STORE'>('SHOP_FLOOR');
  const [purchaseStoreId, setPurchaseStoreId] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<'PAID' | 'PARTIAL' | 'UNPAID'>('PAID');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<PurchaseItemInput[]>([]);
  const [formError, setFormError] = useState('');
  const [purchaseProductSearch, setPurchaseProductSearch] = useState('');
  const [purchaseSearchLimit, setPurchaseSearchLimit] = useState(PAGE_SIZE);
  const purchaseProductSearchRef = useRef<HTMLInputElement>(null);

  if (!currentUser) return null;

  const canRecordPurchase = true;
  const settings = dbState.settings;
  const platformAdmin = isPlatformAdmin(currentUser);
  const shopAdmin = isShopAdmin(currentUser);
  const isSeller = !hasAdminAccess(currentUser);

  const availableShops = platformAdmin
    ? dbState.shops || []
    : shopAdmin
      ? getAdminManagedShops(currentUser, dbState.shops || [])
      : (dbState.shops || []).filter(s => {
          const assigned = currentUser.assignedShopIds || [];
          return assigned.length === 0 || assigned.includes(s.id);
        });
  const visibleShopIdSet = new Set(availableShops.map(s => s.id));
  const visibleProducts = (dbState.products || []).filter(
    p => platformAdmin || (!!p.shopId && visibleShopIdSet.has(p.shopId))
  );

  const shopProducts = visibleProducts.filter(
    p => !purchaseShopId || purchaseShopId === 'ALL' || p.shopId === purchaseShopId
  );

  const purchaseProductPool = shopProducts.length > 0 ? shopProducts : visibleProducts;

  const purchaseSearchResults = useMemo(() => {
    const raw = purchaseProductSearch.trim().toLowerCase();
    if (!raw) return [];
    const tokens = raw.split(/\s+/).filter(Boolean);
    const matches = purchaseProductPool.filter(p => {
      const hay = `${p.name || ''} ${p.sku || ''} ${(p as any).barcode || ''} ${(p as any).variation || ''}`.toLowerCase();
      return tokens.every(tok => hay.includes(tok));
    });
    return matches.sort((a, b) => {
      const aName = (a.name || '').toLowerCase();
      const bName = (b.name || '').toLowerCase();
      const aExact = aName === raw || (a.sku || '').toLowerCase() === raw ? 0 : 1;
      const bExact = bName === raw || (b.sku || '').toLowerCase() === raw ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      const aStarts = aName.startsWith(raw) ? 0 : 1;
      const bStarts = bName.startsWith(raw) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return aName.localeCompare(bName);
    });
  }, [purchaseProductPool, purchaseProductSearch]);

  // ✅ Filter (search) → sort newest first → memo
  const purchases = useMemo(() => {
    const filtered = PurchaseService.getPurchases(
      {
        shopId: isSeller
          ? currentShop?.id || selectedShopId
          : selectedShopId === 'ALL'
          ? undefined
          : selectedShopId,
      },
      currentUser
    ).filter(purchase => {
      if (!searchQuery.trim()) return true;

      const q = searchQuery.trim().toLowerCase();

      if (purchase.supplierName.toLowerCase().includes(q)) return true;
      if (purchase.purchaseNumber.toLowerCase().includes(q)) return true;
      if (purchase.invoiceNumber && purchase.invoiceNumber.toLowerCase().includes(q)) return true;
      if (
        (purchase.items || []).some(
          item =>
            item.productName.toLowerCase().includes(q) ||
            item.productId.toLowerCase().includes(q)
        )
      )
        return true;
      if (purchase.shopName && purchase.shopName.toLowerCase().includes(q)) return true;

      return false;
    });

    // Sort newest first
    return [...filtered].sort((a, b) => {
      const da = new Date(a.createdAt).getTime();
      const db = new Date(b.createdAt).getTime();
      return db - da;
    });
  }, [dbState.purchases, searchQuery, selectedShopId, currentShop, currentUser, isSeller]);

  // Filter purchase returns (Return List)
  const purchaseReturns = useMemo(() => {
    const raw = PurchaseService.getPurchaseReturns(
      {
        shopId: isSeller
          ? currentShop?.id || selectedShopId
          : selectedShopId === 'ALL'
          ? undefined
          : selectedShopId,
        search: returnSearchQuery,
      },
      currentUser
    );

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const weekAgo = startOfToday - 6 * 24 * 60 * 60 * 1000;
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    const periodFiltered = raw.filter(ret => {
      if (returnPeriod === 'ALL') return true;
      const t = new Date(ret.createdAt).getTime();
      if (returnPeriod === 'TODAY') return t >= startOfToday;
      if (returnPeriod === 'WEEK') return t >= weekAgo;
      if (returnPeriod === 'MONTH') return t >= startOfMonth;
      return true;
    });

    return [...periodFiltered].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [
    dbState.purchaseReturns,
    returnSearchQuery,
    returnPeriod,
    selectedShopId,
    currentShop,
    currentUser,
    isSeller,
  ]);

  const returnMetrics = useMemo(() => {
    const totalReturns = purchaseReturns.length;
    const totalUnits = purchaseReturns.reduce((s, r) => s + (r.totalReturnQty || 0), 0);
    const totalValue = purchaseReturns.reduce((s, r) => s + (r.totalReturnAmount || 0), 0);
    return { totalReturns, totalUnits, totalValue };
  }, [purchaseReturns]);

  // Reset pagination on search or shop change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [searchQuery, selectedShopId]);

  useEffect(() => {
    setVisibleReturnsCount(PAGE_SIZE);
  }, [returnSearchQuery, returnPeriod, selectedShopId]);

  // Visible slice
  const visiblePurchases = purchases.slice(0, visibleCount);
  const hasMore = purchases.length > visibleCount;
  const remaining = purchases.length - visibleCount;

  const visibleReturns = purchaseReturns.slice(0, visibleReturnsCount);
  const hasMoreReturns = purchaseReturns.length > visibleReturnsCount;

  const handleSeeMore = () => {
    setIsLoadingMore(true);
    setTimeout(() => {
      setVisibleCount(prev => prev + PAGE_SIZE);
      setIsLoadingMore(false);
    }, 300);
  };

  const handleSeeLess = () => {
    setVisibleCount(PAGE_SIZE);
  };

  const initNewPurchaseForm = () => {
    const targetShop =
      (currentShop?.id && visibleShopIdSet.has(currentShop.id) ? currentShop.id : undefined) ||
      (selectedShopId !== 'ALL' && visibleShopIdSet.has(selectedShopId)
        ? selectedShopId
        : availableShops[0]?.id) ||
      '';
    setPurchaseShopId(targetShop);
    setDestinationType('SHOP_FLOOR');
    const shopStores = (dbState.stores || []).filter(
      st => st.shopId === targetShop && st.status === 'ACTIVE'
    );
    setPurchaseStoreId(shopStores[0]?.id || '');
    setSupplierName('');
    setInvoiceNumber('');
    setPaymentStatus('PAID');
    setNotes('');
    setIsEditMode(false);
    setEditingPurchase(null);

    setItems([]);
    setPurchaseProductSearch('');
    setPurchaseSearchLimit(PAGE_SIZE);
    setFormError('');
  };

  // Initialize fresh Add Purchase form whenever user selects "Add Purchase" from menu
  useEffect(() => {
    if (purchasesSubTab === 'add' && !isEditMode) {
      initNewPurchaseForm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchasesSubTab, purchasesNavTick]);

  // Clicking "Add Purchase" in menu while editing resets to fresh new purchase form
  const prevNavTickRef = useRef(purchasesNavTick);
  useEffect(() => {
    if (prevNavTickRef.current !== purchasesNavTick) {
      prevNavTickRef.current = purchasesNavTick;
      if (purchasesSubTab === 'add') {
        initNewPurchaseForm();
      } else {
        setEditingPurchase(null);
        setIsEditMode(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchasesNavTick, purchasesSubTab]);

  const openNewPurchasePage = () => {
    initNewPurchaseForm();
    setPurchasesSubTab('add');
  };

  const openEditPurchase = (purchase: Purchase) => {
    setEditingPurchase(purchase);
    setIsEditMode(true);
    setPurchaseShopId(purchase.shopId);
    setDestinationType(purchase.storeId ? 'STORE' : 'SHOP_FLOOR');
    setPurchaseStoreId(purchase.storeId || '');
    setSupplierName(purchase.supplierName);
    setInvoiceNumber(purchase.invoiceNumber || '');
    setPaymentStatus(purchase.paymentStatus);
    setNotes(purchase.notes || '');

    setItems(
      (purchase.items || []).map(item => ({
        productId: item.productId,
        quantity: item.quantity.toString(),
        unitCost: item.unitCost.toString(),
      }))
    );

    setPurchaseProductSearch('');
    setPurchaseSearchLimit(PAGE_SIZE);
    setFormError('');
    setPurchasesSubTab('add');
  };

  const handleSelectPurchaseProduct = (product: (typeof visibleProducts)[number]) => {
    setFormError('');
    setItems(prev => {
      const existingIdx = prev.findIndex(i => i.productId === product.id);
      if (existingIdx >= 0) {
        const existing = prev[existingIdx];
        const currentQty = parseFloat(String(existing.quantity)) || 0;
        const nextQty = currentQty > 0 ? currentQty + 1 : 1;
        const updatedItem: PurchaseItemInput = {
          ...existing,
          quantity: String(Number(nextQty.toFixed(3))),
        };
        return [updatedItem, ...prev.filter((_, idx) => idx !== existingIdx)];
      }
      return [
        {
          productId: product.id,
          quantity: '1',
          unitCost:
            product.purchasePrice !== undefined && product.purchasePrice !== null && product.purchasePrice > 0
              ? product.purchasePrice.toString()
              : '',
        },
        ...prev,
      ];
    });
    setPurchaseProductSearch('');
    setPurchaseSearchLimit(PAGE_SIZE);
    window.setTimeout(() => {
      purchaseProductSearchRef.current?.focus();
    }, 30);
  };

  const handlePurchaseSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && purchaseProductSearch.trim()) {
      e.preventDefault();
      const q = purchaseProductSearch.trim().toLowerCase();
      const exact = purchaseSearchResults.find(
        p =>
          (p.sku || '').toLowerCase() === q ||
          ((p as any).barcode || '').toLowerCase() === q ||
          (p.name || '').toLowerCase() === q
      );
      if (exact) {
        handleSelectPurchaseProduct(exact);
      } else if (purchaseSearchResults.length === 1) {
        handleSelectPurchaseProduct(purchaseSearchResults[0]);
      }
    }
  };

  const removeItemRow = (idx: number) => {
    setItems(prev => prev.filter((_, i) => i !== idx));
  };

  const updateItemRow = (idx: number, field: keyof PurchaseItemInput, value: any) => {
    setItems(prev =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        if (field === 'productId') {
          const matched = visibleProducts.find(p => p.id === value);
          return {
            ...item,
            productId: value,
            unitCost:
              matched?.purchasePrice !== undefined && matched?.purchasePrice !== null
                ? matched.purchasePrice.toString()
                : '',
          };
        }
        return { ...item, [field]: value };
      })
    );
  };

  const calculatedTotal = items.reduce((sum, item) => {
    const qty = parseFloat(item.quantity as string) || 0;
    const cost = parseFloat(item.unitCost as string) || 0;
    return sum + qty * cost;
  }, 0);

  const handleSavePurchase = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (items.length === 0) {
      setFormError('Please add at least one line item.');
      return;
    }

    const finalItems = items.map(item => ({
      productId: item.productId,
      quantity: parseFloat(item.quantity as string) || 0,
      unitCost: parseFloat(item.unitCost as string) || 0,
    }));

    for (const item of finalItems) {
      if (item.quantity <= 0) {
        setFormError('Quantity must be greater than 0 for all items.');
        return;
      }
      if (item.unitCost <= 0) {
        setFormError('Unit cost must be greater than 0 for all items.');
        return;
      }
      if (!item.productId) {
        setFormError('Please select a product for all items.');
        return;
      }
    }

    const finalSupplierName = supplierName.trim() || 'Walk-in Supplier';

    if (editingPurchase) {
      const res = PurchaseService.updatePurchase(
        editingPurchase.id,
        {
          supplierName: finalSupplierName,
          invoiceNumber: invoiceNumber.trim() || undefined,
          paymentStatus,
          notes,
          items: finalItems,
        },
        currentUser
      );

      if (res.success) {
        addToast({
          type: 'success',
          title: 'Purchase Updated',
          description: `Purchase ${
            editingPurchase.purchaseNumber || editingPurchase.id
          } updated. Stock recalculated.`,
        });
        setEditingPurchase(null);
        setIsEditMode(false);
        setPurchasesSubTab('list');
      } else {
        setFormError(res.error || 'Failed to update purchase.');
      }
    } else {
      if (destinationType === 'STORE' && !purchaseStoreId) {
        setFormError('Please select a destination store or switch to Direct to Shop Floor.');
        return;
      }

      const res = PurchaseService.createPurchase(
        {
          shopId: purchaseShopId || availableShops[0]?.id || '',
          storeId: destinationType === 'STORE' ? purchaseStoreId : undefined,
          supplierName: finalSupplierName,
          invoiceNumber: invoiceNumber.trim() || undefined,
          items: finalItems,
          paymentStatus,
          notes,
        },
        currentUser
      );

      if (res.success) {
        addToast({
          type: 'success',
          title: 'Purchase Recorded & Stock Ingested',
          description:
            destinationType === 'STORE'
              ? `Order from ${finalSupplierName} recorded and added to Store warehouse stock.`
              : `Order from ${finalSupplierName} recorded. Shop floor inventories were restocked.`,
        });
        setPurchasesSubTab('list');
      } else {
        setFormError(res.error || 'Failed to record purchase.');
      }
    }
  };

  const handleCancelForm = () => {
    setEditingPurchase(null);
    setIsEditMode(false);
    setFormError('');
    setPurchasesSubTab('list');
  };

  // Purchase Return handlers
  const openReturnPurchaseModal = (purchase: Purchase) => {
    setReturningPurchase(purchase);
    const initialMap: Record<string, string> = {};
    (purchase.items || []).forEach(item => {
      initialMap[item.id] = '';
    });
    setReturnQuantities(initialMap);
    setReturnReason('');
    setReturnError('');
  };

  const closeReturnPurchaseModal = () => {
    setReturningPurchase(null);
    setReturnQuantities({});
    setReturnReason('');
    setReturnError('');
  };

  const returnPreview = useMemo(() => {
    if (!returningPurchase) {
      return { totalReturnUnits: 0, totalReturnAmount: 0, updatedPurchaseTotal: 0 };
    }
    let totalReturnUnits = 0;
    let totalReturnAmount = 0;
    for (const item of returningPurchase.items || []) {
      const qty = Math.max(0, parseFloat(returnQuantities[item.id] || '0') || 0);
      const clamped = Math.min(qty, item.quantity);
      if (clamped > 0) {
        totalReturnUnits += clamped;
        totalReturnAmount += clamped * item.unitCost;
      }
    }
    const updatedPurchaseTotal = Math.max(
      0,
      Number((returningPurchase.totalAmount - totalReturnAmount).toFixed(2))
    );
    return {
      totalReturnUnits: Number(totalReturnUnits.toFixed(4)),
      totalReturnAmount: Number(totalReturnAmount.toFixed(2)),
      updatedPurchaseTotal,
    };
  }, [returningPurchase, returnQuantities]);

  const handleExecuteReturn = (e: React.FormEvent) => {
    e.preventDefault();
    if (!returningPurchase) return;
    setReturnError('');

    const selections: { productId: string; itemId: string; returnQty: number }[] = [];
    for (const item of returningPurchase.items || []) {
      const raw = returnQuantities[item.id];
      if (!raw || !raw.trim()) continue;
      const qty = parseFloat(raw);
      if (!Number.isFinite(qty) || qty < 0) {
        setReturnError(`Enter a valid return quantity for ${item.productName}.`);
        return;
      }
      if (qty > item.quantity) {
        setReturnError(
          `Return quantity (${qty}) for ${item.productName} exceeds purchased quantity (${item.quantity}).`
        );
        return;
      }
      if (qty > 0) {
        selections.push({ productId: item.productId, itemId: item.id, returnQty: qty });
      }
    }

    if (selections.length === 0) {
      setReturnError('Enter a return quantity greater than 0 for at least one product.');
      return;
    }

    if (!returnReason.trim()) {
      setReturnError('Please provide a reason for returning these items.');
      return;
    }

    setIsReturning(true);
    const res = PurchaseService.returnPurchaseItems(
      returningPurchase.id,
      selections,
      returnReason,
      currentUser
    );
    setIsReturning(false);

    if (res.success && res.purchaseReturn) {
      addToast({
        type: 'success',
        title: 'Purchase Return Processed',
        description: `Returned ${res.purchaseReturn.totalReturnQty} unit(s) (${formatCurrency(
          res.purchaseReturn.totalReturnAmount,
          settings.currencySymbol
        )}). Stock and purchase total reduced.`,
      });
      closeReturnPurchaseModal();
    } else {
      setReturnError(res.error || 'Could not process purchase return.');
    }
  };

  const openVoidPurchaseModal = (purchase: Purchase) => {
    setVoidingPurchase(purchase);
    setVoidReason('');
  };

  const handleExecuteVoid = () => {
    if (!voidingPurchase) return;
    if (!voidReason.trim()) {
      addToast({
        type: 'warning',
        title: 'Reason Required',
        description: 'Please enter a reason for voiding this purchase.',
      });
      return;
    }

    setIsVoiding(true);
    const res = PurchaseService.voidPurchase(voidingPurchase.id, voidReason, currentUser);
    setIsVoiding(false);

    if (res.success) {
      addToast({
        type: 'success',
        title: 'Purchase Voided & Deleted',
        description: `${voidingPurchase.purchaseNumber || voidingPurchase.supplierName} was deleted and ${res.revertedUnits || 0} unit(s) were reverted from stock.`,
      });
      setVoidingPurchase(null);
      setVoidReason('');
    } else {
      addToast({
        type: 'error',
        title: 'Void Failed',
        description: res.error || 'Could not void this purchase.',
      });
    }
  };

  // ─────────────────────────────────────────────────────────────
  // VIEW 1: FULL-PAGE ADD / EDIT PURCHASE
  // ─────────────────────────────────────────────────────────────
  if (purchasesSubTab === 'add' && canRecordPurchase) {
    const activeShopStores = (dbState.stores || []).filter(
      st => st.shopId === purchaseShopId && st.status === 'ACTIVE'
    );

    return (
      <div
        id="admin-purchases-add-page"
        className="flex-1 p-3.5 sm:p-6 bg-slate-950 text-slate-100 overflow-y-auto pb-24 sm:pb-8"
      >
        <div className="max-w-3xl mx-auto">
          {/* Page Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 pb-4 border-b border-slate-800">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={handleCancelForm}
                className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition shrink-0"
                title="Back to Purchase List"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {isEditMode ? (
                    <Pencil className="w-5 h-5 text-amber-400 shrink-0" />
                  ) : (
                    <PurchaseIcon className="w-5 h-5 text-orange-400 shrink-0" />
                  )}
                  <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight truncate">
                    {editingPurchase
                      ? `Edit Purchase ${editingPurchase.purchaseNumber || ''}`
                      : 'Add Purchase'}
                  </h2>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  {editingPurchase
                    ? 'Correct purchased quantities or costs and recalculate inventory automatically'
                    : 'Record incoming supplier stock and add quantities directly to Shop Floor or Store Warehouse'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleCancelForm}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white text-xs font-semibold transition shrink-0"
            >
              <ClipboardList className="w-3.5 h-3.5 text-orange-400" />
              <span>Purchase List</span>
            </button>
          </div>

          {formError && (
            <div className="mb-4 p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-medium">
              {formError}
            </div>
          )}

          {/* Full-Page Form Card */}
          <form
            onSubmit={handleSavePurchase}
            className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl space-y-5 text-xs"
          >
            {!isEditMode && (
              <div className="space-y-4">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1.5">
                    Target Shop / Unit *
                  </label>
                  <select
                    value={purchaseShopId}
                    onChange={e => {
                      const nextShopId = e.target.value;
                      setPurchaseShopId(nextShopId);
                      setPurchaseProductSearch('');
                      setPurchaseSearchLimit(PAGE_SIZE);
                      const nextStores = (dbState.stores || []).filter(
                        st => st.shopId === nextShopId && st.status === 'ACTIVE'
                      );
                      setPurchaseStoreId(nextStores[0]?.id || '');
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {availableShops.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.code || 'UNIT'})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2.5">
                  <label className="block text-slate-300 font-semibold">Destination *</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => setDestinationType('SHOP_FLOOR')}
                      className={`px-3.5 py-2.5 rounded-xl border text-left font-semibold flex items-center gap-2 transition ${
                        destinationType === 'SHOP_FLOOR'
                          ? 'bg-blue-600/20 border-blue-500 text-blue-300'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Store className="w-4 h-4 shrink-0" />
                      <span>Direct to Shop Floor</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDestinationType('STORE');
                        if (!purchaseStoreId && activeShopStores.length > 0) {
                          setPurchaseStoreId(activeShopStores[0].id);
                        }
                      }}
                      className={`px-3.5 py-2.5 rounded-xl border text-left font-semibold flex items-center gap-2 transition ${
                        destinationType === 'STORE'
                          ? 'bg-blue-600/20 border-blue-500 text-blue-300'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Warehouse className="w-4 h-4 shrink-0" />
                      <span>Send to Store (Warehouse)</span>
                    </button>
                  </div>

                  {destinationType === 'STORE' && (
                    <div className="pt-1">
                      <label className="block text-slate-400 text-[11px] mb-1">
                        Select Store (Warehouse) *
                      </label>
                      {activeShopStores.length > 0 ? (
                        <select
                          value={purchaseStoreId}
                          onChange={e => setPurchaseStoreId(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          <option value="">Select destination store...</option>
                          {activeShopStores.map(st => (
                            <option key={st.id} value={st.id}>
                              {st.name}
                              {st.location ? ` — ${st.location}` : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <p className="text-[11px] text-amber-400 py-1">
                          No active stores exist for this shop yet. Create one in Stores &amp;
                          Transfer or choose Direct to Shop Floor.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-slate-300 font-semibold mb-1.5">
                  Supplier / Vendor (Optional)
                </label>
                <input
                  type="text"
                  value={supplierName}
                  onChange={e => setSupplierName(e.target.value)}
                  placeholder="Leave blank for 'Walk-in Supplier'"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1.5">
                  Vendor Invoice # (Optional)
                </label>
                <input
                  type="text"
                  value={invoiceNumber}
                  onChange={e => setInvoiceNumber(e.target.value)}
                  placeholder="e.g. INV-98442"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Line Items — Quick Search Bar (Tap a Product to Arrange on List, No Add Item Button) */}
            <div className="space-y-3">
              {isEditMode && (
                <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-300 text-[11px]">
                  Changing quantities recalculates stock automatically. Old quantities will be
                  reversed and new ones applied.
                </div>
              )}

              {/* Search Bar + Clear All */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1 min-w-0">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    ref={purchaseProductSearchRef}
                    type="text"
                    value={purchaseProductSearch}
                    inputMode="search"
                    autoComplete="off"
                    onChange={e => {
                      setPurchaseProductSearch(e.target.value);
                      setPurchaseSearchLimit(PAGE_SIZE);
                    }}
                    onKeyDown={handlePurchaseSearchKeyDown}
                    placeholder="Search product name, SKU, or barcode — tap to add..."
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-9 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition"
                  />
                  {purchaseProductSearch && (
                    <button
                      type="button"
                      onClick={() => {
                        setPurchaseProductSearch('');
                        setPurchaseSearchLimit(PAGE_SIZE);
                        purchaseProductSearchRef.current?.focus();
                      }}
                      aria-label="Clear search"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {items.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setItems([]);
                      setFormError('');
                    }}
                    className="shrink-0 px-3 py-2.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 active:bg-rose-500/30 border border-rose-500/30 text-rose-300 text-xs font-semibold whitespace-nowrap transition"
                  >
                    Clear All
                  </button>
                )}
              </div>

              {/* Matching Results Dropdown — shown strictly when user types in search */}
              {purchaseProductSearch.trim() && (
                <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
                  <div className="px-3 py-2 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-slate-400">
                      <strong className="text-white">
                        {purchaseSearchResults.length.toLocaleString()}
                      </strong>{' '}
                      match{purchaseSearchResults.length === 1 ? '' : 'es'} for &ldquo;
                      {purchaseProductSearch.trim()}&rdquo; — tap a product to add
                    </span>
                  </div>

                  {purchaseSearchResults.length === 0 ? (
                    <div className="py-7 px-4 text-center">
                      <Package className="w-8 h-8 mx-auto text-slate-600 mb-1.5" />
                      <p className="text-xs font-medium text-slate-400">
                        No products match &ldquo;{purchaseProductSearch.trim()}&rdquo;
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Try a shorter search or verify the product SKU.
                      </p>
                    </div>
                  ) : (
                    <div className="max-h-72 overflow-y-auto divide-y divide-slate-800/70 overscroll-contain">
                      {purchaseSearchResults.slice(0, purchaseSearchLimit).map(p => {
                        const existingItem = items.find(i => i.productId === p.id);
                        const isAdded = Boolean(existingItem);

                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => handleSelectPurchaseProduct(p)}
                            className={`w-full text-left px-3 py-3 flex items-center justify-between gap-3 transition active:bg-slate-800/80 ${
                              isAdded
                                ? 'bg-blue-950/25 hover:bg-blue-950/40'
                                : 'hover:bg-slate-900/80'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-xs sm:text-sm font-medium text-white truncate">
                                  {p.name}
                                </span>
                                {(p as any).variation && (
                                  <span className="px-1.5 py-0.5 rounded bg-violet-500/15 border border-violet-500/30 text-violet-300 text-[10px]">
                                    {(p as any).variation}
                                  </span>
                                )}
                                {isAdded && (
                                  <span className="px-1.5 py-0.5 rounded bg-blue-500/20 border border-blue-500/30 text-blue-300 text-[10px] font-semibold">
                                    In List ({existingItem?.quantity || 0})
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center flex-wrap gap-x-2.5 gap-y-0.5 mt-1 text-[11px] text-slate-400 font-mono">
                                <span>{p.sku}</span>
                                <span className="text-blue-400">
                                  Shop: {(p.currentStock ?? 0).toLocaleString()} {p.unit}
                                </span>
                                {(p.storeStock ?? 0) > 0 && (
                                  <span className="text-violet-400">
                                    Store: {(p.storeStock ?? 0).toLocaleString()} {p.unit}
                                  </span>
                                )}
                                <span className="text-emerald-400/90">
                                  Buy: {formatCurrency(Number(p.purchasePrice || 0), settings.currencySymbol)}
                                </span>
                              </div>
                            </div>

                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold shrink-0 transition ${
                                isAdded
                                  ? 'bg-blue-600/25 text-blue-200 border border-blue-500/40'
                                  : 'bg-blue-600 text-white shadow-sm'
                              }`}
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>{isAdded ? '+1' : 'Add'}</span>
                            </span>
                          </button>
                        );
                      })}

                      {purchaseSearchResults.length > purchaseSearchLimit && (
                        <button
                          type="button"
                          onClick={() => setPurchaseSearchLimit(prev => prev + PAGE_SIZE)}
                          className="w-full py-2.5 text-center text-xs font-semibold text-blue-400 hover:bg-slate-900 transition"
                        >
                          Show More ({purchaseSearchResults.length - purchaseSearchLimit} remaining)
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Selected Purchase Products List */}
              {items.length === 0 ? (
                <div className="p-6 rounded-xl bg-slate-950/60 border border-dashed border-slate-800 text-center">
                  <Package className="w-7 h-7 mx-auto text-slate-600 mb-1.5" />
                  <p className="text-xs font-medium text-slate-400">No products added yet</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Search above and tap a product to add it to this purchase.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between px-0.5">
                    <span className="text-slate-400 font-bold uppercase tracking-wider text-[11px]">
                      {isEditMode ? 'Purchase Items' : 'Selected Products'} ({items.length})
                    </span>
                  </div>

                  {items.map((item, idx) => {
                    const matchedProduct = visibleProducts.find(p => p.id === item.productId);
                    const qtyVal = parseFloat(item.quantity as string) || 0;
                    const costVal = parseFloat(item.unitCost as string) || 0;
                    const lineTotal = qtyVal * costVal;

                    return (
                      <div
                        key={item.productId || idx}
                        className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                                #{idx + 1}
                              </span>
                              <span className="text-xs sm:text-sm font-semibold text-white truncate">
                                {matchedProduct?.name || 'Unknown Product'}
                              </span>
                              {(matchedProduct as any)?.variation && (
                                <span className="px-1.5 py-0.5 rounded bg-violet-500/15 border border-violet-500/30 text-violet-300 text-[10px]">
                                  {(matchedProduct as any).variation}
                                </span>
                              )}
                            </div>
                            {matchedProduct && (
                              <div className="flex items-center flex-wrap gap-x-2.5 gap-y-0.5 mt-1 text-[10px] text-slate-400 font-mono">
                                <span>{matchedProduct.sku}</span>
                                <span className="text-blue-400">
                                  Shop: {(matchedProduct.currentStock ?? 0).toLocaleString()}{' '}
                                  {matchedProduct.unit}
                                </span>
                                {(matchedProduct.storeStock ?? 0) > 0 && (
                                  <span className="text-violet-400">
                                    Store: {(matchedProduct.storeStock ?? 0).toLocaleString()}{' '}
                                    {matchedProduct.unit}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => removeItemRow(idx)}
                            className="shrink-0 p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition"
                            title="Remove product"
                            aria-label="Remove product"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="grid grid-cols-3 gap-2.5 items-end pt-1 border-t border-slate-900">
                          <div>
                            <label className="block text-slate-400 text-[10px] mb-1">
                              Quantity{matchedProduct?.unit ? ` (${matchedProduct.unit})` : ''}
                            </label>
                            <input
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step="any"
                              value={item.quantity}
                              onChange={e => updateItemRow(idx, 'quantity', e.target.value)}
                              onFocus={e => e.target.select()}
                              placeholder="0"
                              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-white font-mono text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </div>

                          <div>
                            <label className="block text-slate-400 text-[10px] mb-1">
                              Buy Price ({settings.currencySymbol})
                            </label>
                            <input
                              type="number"
                              inputMode="decimal"
                              step="0.01"
                              min="0"
                              value={item.unitCost}
                              onChange={e => updateItemRow(idx, 'unitCost', e.target.value)}
                              onFocus={e => e.target.select()}
                              placeholder="0"
                              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2 text-white font-mono text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </div>

                          <div className="text-right pb-1.5">
                            <label className="block text-slate-500 text-[10px] mb-1">Subtotal</label>
                            <div className="font-mono font-bold text-emerald-400 text-xs sm:text-sm truncate">
                              {formatCurrency(lineTotal, settings.currencySymbol)}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2">
              <div>
                <label className="block text-slate-300 font-semibold mb-1.5">Payment Status</label>
                <select
                  value={paymentStatus}
                  onChange={e => setPaymentStatus(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="PAID">Paid in Full</option>
                  <option value="PARTIAL">Partially Paid</option>
                  <option value="UNPAID">Pending / On Credit</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1.5">Notes</label>
                <input
                  type="text"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="e.g. Delivered by freight truck"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Footer Total & Actions */}
            <div className="pt-4 border-t border-slate-800 space-y-3.5">
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-950 border border-slate-800">
                <div>
                  <span className="text-slate-400 font-medium block">Total Purchase Cost</span>
                  <span className="text-[10px] text-slate-500">
                    {items.reduce((s, i) => s + (parseFloat(i.quantity as string) || 0), 0)} total
                    units across {items.length} item(s)
                  </span>
                </div>
                <span className="text-lg sm:text-xl font-bold font-mono text-white">
                  {formatCurrency(calculatedTotal, settings.currencySymbol)}
                </span>
              </div>

              <div className="flex flex-col sm:flex-row gap-2.5">
                <button
                  type="button"
                  onClick={handleCancelForm}
                  className="sm:w-40 px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold shadow-lg transition flex items-center justify-center gap-2"
                >
                  <Check className="w-4 h-4" />
                  <span>{editingPurchase ? 'Update & Recalculate Stock' : 'Record Purchase & Add Stock'}</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // VIEW 2: PURCHASE RETURN LIST
  // ─────────────────────────────────────────────────────────────
  if (purchasesSubTab === 'returns') {
    return (
      <div
        id="admin-purchase-returns-view"
        className="flex-1 p-3.5 sm:p-6 bg-slate-950 text-slate-100 overflow-y-auto pb-24 sm:pb-6"
      >
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 pb-4 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/25">
                <RotateCcw className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
                  Purchase Return List
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Complete audit trail of returned supplier items, stock deductions, and value
                  adjustments
                </p>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setPurchasesSubTab('list')}
            className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 font-semibold text-xs transition"
          >
            <ClipboardList className="w-4 h-4 text-orange-400" />
            <span>Purchase List</span>
          </button>
        </div>

        {/* Summary KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
            <div className="text-[11px] font-medium text-slate-400 flex items-center justify-between">
              <span>Total Returns</span>
              <RotateCcw className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-xl font-bold font-mono text-white mt-1">
              {returnMetrics.totalReturns}
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
            <div className="text-[11px] font-medium text-slate-400 flex items-center justify-between">
              <span>Units Returned</span>
              <Package className="w-4 h-4 text-orange-400" />
            </div>
            <div className="text-xl font-bold font-mono text-amber-300 mt-1">
              {returnMetrics.totalUnits}
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
            <div className="text-[11px] font-medium text-slate-400 flex items-center justify-between">
              <span>Total Deducted Value</span>
              <PurchaseIcon className="w-4 h-4 text-rose-400" />
            </div>
            <div className="text-xl font-bold font-mono text-rose-400 mt-1">
              {formatCurrency(returnMetrics.totalValue, settings.currencySymbol)}
            </div>
          </div>
        </div>

        {/* Toolbar: Search + Period Filter */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 mb-4 space-y-2.5 text-xs">
          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={returnSearchQuery}
                onChange={e => setReturnSearchQuery(e.target.value)}
                placeholder="Search return #, PO #, supplier, product, reason..."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>

            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 shrink-0">
              {(
                [
                  { id: 'ALL', label: 'All' },
                  { id: 'TODAY', label: 'Today' },
                  { id: 'WEEK', label: 'Week' },
                  { id: 'MONTH', label: 'Month' },
                ] as const
              ).map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setReturnPeriod(p.id)}
                  className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition ${
                    returnPeriod === p.id
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Returns List Container */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          {purchaseReturns.length === 0 ? (
            <div className="py-14 text-center text-slate-500 px-4">
              <RotateCcw className="w-9 h-9 mx-auto mb-2.5 opacity-35 text-amber-400" />
              <p className="text-sm font-semibold text-slate-300">No purchase returns recorded</p>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                Use the Return button on any purchase in Purchase List to return items to a
                supplier and automatically adjust stock and purchase totals.
              </p>
            </div>
          ) : (
            <>
              {/* Mobile Cards (< md) */}
              <div className="md:hidden divide-y divide-slate-800/80">
                {visibleReturns.map(ret => (
                  <div key={ret.id} className="p-3.5 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono text-[11px] font-bold text-amber-300 bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded">
                            {ret.returnNumber}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400">
                            PO: {ret.purchaseNumber}
                          </span>
                        </div>
                        <h4 className="font-bold text-xs text-white truncate mt-1">
                          {ret.supplierName}
                        </h4>
                        <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                          <span className="inline-flex items-center gap-1 font-mono">
                            <Calendar className="w-3 h-3" />
                            {formatDateTime(ret.createdAt)}
                          </span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono font-bold text-rose-400 text-sm">
                          -{formatCurrency(ret.totalReturnAmount, settings.currencySymbol)}
                        </div>
                        <span className="text-[10px] font-bold text-amber-300">
                          -{ret.totalReturnQty} unit{ret.totalReturnQty === 1 ? '' : 's'}
                        </span>
                      </div>
                    </div>

                    {/* Returned items breakdown */}
                    <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-2.5 space-y-1.5">
                      <div className="flex items-center justify-between text-[10px] text-slate-400">
                        <span className="font-semibold uppercase tracking-wider">
                          Returned Items
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded font-semibold ${
                            ret.storeId
                              ? 'bg-indigo-500/15 text-indigo-300'
                              : 'bg-emerald-500/15 text-emerald-300'
                          }`}
                        >
                          {ret.storeId ? `Store: ${ret.storeName || 'Warehouse'}` : 'Shop Floor'}
                        </span>
                      </div>
                      {(ret.items || []).map(item => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between gap-2 text-[11px] pt-1 border-t border-slate-800/60"
                        >
                          <div className="min-w-0">
                            <div className="text-slate-200 font-medium truncate">
                              {item.productName}
                            </div>
                            <div className="text-[10px] text-slate-400 font-mono">
                              Purchased {item.originalQty} → Returned{' '}
                              <span className="text-amber-300 font-bold">{item.returnQty}</span> ·{' '}
                              <span className="text-emerald-400">{item.remainingQty} left</span>
                            </div>
                          </div>
                          <div className="font-mono font-bold text-rose-300 shrink-0">
                            -{formatCurrency(item.returnTotal, settings.currencySymbol)}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Reason & Staff */}
                    <div className="flex items-start justify-between gap-2 text-[11px] bg-amber-500/5 border border-amber-500/20 rounded-lg px-2.5 py-2">
                      <div className="text-slate-300">
                        <span className="text-amber-400 font-semibold">Reason: </span>
                        {ret.reason}
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5">
                      <span className="inline-flex items-center gap-1">
                        <UserIcon className="w-3 h-3 text-slate-500" />
                        Processed by <strong className="text-slate-300">{ret.returnedByName}</strong>
                      </span>
                      {ret.shopName && <span>{ret.shopName}</span>}
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop Table (md+) */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/70 text-slate-400">
                      <th className="py-3 px-4 font-semibold">Return # &amp; Date</th>
                      <th className="py-3 px-4 font-semibold">Supplier &amp; PO #</th>
                      <th className="py-3 px-4 font-semibold">Returned Products</th>
                      <th className="py-3 px-4 font-semibold">Reason</th>
                      <th className="py-3 px-4 font-semibold">Processed By</th>
                      <th className="py-3 px-4 text-right font-semibold">Deducted Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {visibleReturns.map(ret => (
                      <tr key={ret.id} className="hover:bg-slate-800/30 transition align-top">
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <span className="font-mono text-[11px] font-bold text-amber-300 bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded inline-block">
                            {ret.returnNumber}
                          </span>
                          <div className="text-[10px] font-mono text-slate-400 mt-1">
                            {formatDateTime(ret.createdAt)}
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-white">{ret.supplierName}</div>
                          <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                            PO: {ret.purchaseNumber}
                          </div>
                          <span
                            className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                              ret.storeId
                                ? 'bg-indigo-500/15 text-indigo-300'
                                : 'bg-emerald-500/15 text-emerald-300'
                            }`}
                          >
                            {ret.storeId ? `Store: ${ret.storeName || 'Warehouse'}` : 'Shop Floor'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="space-y-1.5 max-w-sm">
                            {(ret.items || []).map(item => (
                              <div
                                key={item.id}
                                className="flex items-center justify-between gap-3 bg-slate-950/70 border border-slate-800/80 rounded-lg px-2.5 py-1.5"
                              >
                                <div className="min-w-0">
                                  <div className="text-slate-200 font-semibold truncate">
                                    {item.productName}
                                  </div>
                                  <div className="text-[10px] font-mono text-slate-400">
                                    Qty: {item.originalQty} →{' '}
                                    <span className="text-amber-300 font-bold">
                                      -{item.returnQty} returned
                                    </span>{' '}
                                    ({item.remainingQty} left) @{' '}
                                    {formatCurrency(item.unitCost, settings.currencySymbol)}
                                  </div>
                                </div>
                                <div className="font-mono text-[11px] font-bold text-rose-300 shrink-0">
                                  -{formatCurrency(item.returnTotal, settings.currencySymbol)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 max-w-xs">
                          <p className="text-slate-300 text-xs leading-relaxed">{ret.reason}</p>
                        </td>
                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="text-slate-200 font-medium">{ret.returnedByName}</div>
                          {ret.shopName && (
                            <div className="text-[10px] text-slate-500 mt-0.5">{ret.shopName}</div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <div className="font-mono font-bold text-rose-400 text-sm">
                            -{formatCurrency(ret.totalReturnAmount, settings.currencySymbol)}
                          </div>
                          <div className="text-[10px] font-semibold text-amber-300 mt-0.5">
                            -{ret.totalReturnQty} unit{ret.totalReturnQty === 1 ? '' : 's'}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {purchaseReturns.length > PAGE_SIZE && (
                <div className="p-3 bg-slate-950/40 border-t border-slate-800/80 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-400">
                    Showing {Math.min(visibleReturnsCount, purchaseReturns.length)} of{' '}
                    {purchaseReturns.length} returns
                  </span>
                  <div className="flex items-center gap-2">
                    {visibleReturnsCount > PAGE_SIZE && (
                      <button
                        type="button"
                        onClick={() => setVisibleReturnsCount(PAGE_SIZE)}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold"
                      >
                        Show Less
                      </button>
                    )}
                    {hasMoreReturns && (
                      <button
                        type="button"
                        onClick={() => setVisibleReturnsCount(prev => prev + PAGE_SIZE)}
                        className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-semibold"
                      >
                        See More
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // VIEW 3: PURCHASE LIST (Default)
  // ─────────────────────────────────────────────────────────────
  return (
    <div
      id="admin-purchases-view"
      className="flex-1 p-3.5 sm:p-6 bg-slate-950 text-slate-100 overflow-y-auto pb-24 sm:pb-6"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
            Purchase List
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            View procurement orders, edit entries, return purchased stock, or void orders
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPurchasesSubTab('returns')}
            className="flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-amber-300 font-semibold text-xs transition"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Return List</span>
            {purchaseReturns.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-bold">
                {purchaseReturns.length}
              </span>
            )}
          </button>

          {canRecordPurchase && (
            <button
              id="new-purchase-btn"
              onClick={openNewPurchasePage}
              className="flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-semibold text-xs shadow-lg transition"
            >
              <Plus className="w-4 h-4" />
              <span>Add Purchase</span>
            </button>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 mb-4 space-y-2.5 text-xs">
        <div className="relative w-full">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search supplier, product, invoice #..."
            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="text-slate-400 font-medium text-right">
          Total: <span className="text-white font-bold">{purchases.length}</span>
        </div>
      </div>

      {/* Purchases: Cards + Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        {purchases.length === 0 ? (
          <div className="py-12 text-center text-slate-500">
            <PurchaseIcon className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-xs">No supplier purchases recorded yet.</p>
          </div>
        ) : (
          <>
            {/* Mobile Cards (< md) */}
            <div className="md:hidden divide-y divide-slate-800/80">
              {visiblePurchases.map(purchase => (
                <div key={purchase.id} className="p-3.5 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h4 className="font-bold text-xs text-white truncate">
                        {purchase.supplierName}
                      </h4>
                      <p className="text-[10px] font-mono text-slate-400">
                        {formatDateTime(purchase.createdAt)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono font-bold text-white text-sm">
                        {formatCurrency(purchase.totalAmount, settings.currencySymbol)}
                      </div>
                      <span
                        className={`px-1.5 py-0.2 rounded text-[9px] font-bold inline-block mt-0.5 ${
                          purchase.paymentStatus === 'PAID'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        {purchase.paymentStatus}
                      </span>
                    </div>
                  </div>

                  <div className="text-xs text-slate-300 bg-slate-950/60 p-2 rounded-lg border border-slate-800 space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400 font-medium">
                        {(purchase.items || []).length} items received
                        {purchase.storeId && (
                          <span className="text-blue-400 ml-1.5">
                            · Store:{' '}
                            {purchase.storeName ||
                              (dbState.stores || []).find(s => s.id === purchase.storeId)?.name ||
                              'Warehouse'}
                          </span>
                        )}
                      </span>
                      {purchase.invoiceNumber && (
                        <span className="font-mono text-slate-400">
                          Inv: {purchase.invoiceNumber}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500 truncate">
                      {(purchase.items || [])
                        .map(i => `${i.quantity}x ${i.productName}`)
                        .join(', ')}
                    </p>
                  </div>

                  {canRecordPurchase && (
                    <div className="flex items-center gap-2 pt-1.5 border-t border-slate-800/60">
                      <button
                        onClick={() => openEditPurchase(purchase)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-slate-800 hover:bg-blue-600 active:bg-blue-700 text-slate-300 hover:text-white transition text-[11px] font-semibold"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        Edit
                      </button>
                      <button
                        onClick={() => openReturnPurchaseModal(purchase)}
                        disabled={(purchase.items || []).length === 0}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-amber-500/10 hover:bg-amber-600 active:bg-amber-700 text-amber-400 hover:text-white border border-amber-500/25 transition text-[11px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Return
                      </button>
                      <button
                        onClick={() => openVoidPurchaseModal(purchase)}
                        className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-rose-500/10 hover:bg-rose-600 active:bg-rose-700 text-rose-400 hover:text-white border border-rose-500/20 transition text-[11px] font-semibold"
                      >
                        <Ban className="w-3.5 h-3.5" />
                        Void
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Tablet / Desktop Table (md+) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400">
                    <th className="py-3 px-4 font-semibold">Date</th>
                    <th className="py-3 px-4 font-semibold">Supplier</th>
                    <th className="py-3 px-4 font-semibold">Invoice #</th>
                    <th className="py-3 px-4 font-semibold">Items</th>
                    <th className="py-3 px-4 font-semibold">Payment</th>
                    <th className="py-3 px-4 text-right font-semibold">Total</th>
                    {canRecordPurchase && (
                      <th className="py-3 px-4 text-right font-semibold">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {visiblePurchases.map(purchase => (
                    <tr key={purchase.id} className="hover:bg-slate-850/60 transition">
                      <td className="py-3.5 px-4 text-slate-400 font-mono">
                        {formatDateTime(purchase.createdAt)}
                      </td>
                      <td className="py-3.5 px-4 font-bold text-white">
                        {purchase.supplierName}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-400">
                        {purchase.invoiceNumber || '—'}
                      </td>
                      <td className="py-3.5 px-4 text-slate-300">
                        <div>
                          {(purchase.items || []).length} items
                          {purchase.storeId && (
                            <span className="text-[11px] text-blue-400 ml-1.5">
                              · Store:{' '}
                              {purchase.storeName ||
                                (dbState.stores || []).find(s => s.id === purchase.storeId)?.name ||
                                'Warehouse'}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500 truncate max-w-xs">
                          {(purchase.items || [])
                            .map(i => `${i.quantity}x ${i.productName}`)
                            .join(', ')}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            purchase.paymentStatus === 'PAID'
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          }`}
                        >
                          {purchase.paymentStatus}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-white text-sm">
                        {formatCurrency(purchase.totalAmount, settings.currencySymbol)}
                      </td>
                      {canRecordPurchase && (
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => openEditPurchase(purchase)}
                              className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium transition inline-flex items-center gap-1"
                            >
                              <Pencil className="w-3 h-3" />
                              Edit
                            </button>
                            <button
                              onClick={() => openReturnPurchaseModal(purchase)}
                              disabled={(purchase.items || []).length === 0}
                              className="px-2.5 py-1.5 rounded bg-amber-500/10 hover:bg-amber-600 text-amber-400 hover:text-white border border-amber-500/25 text-[11px] font-medium transition inline-flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <RotateCcw className="w-3 h-3" />
                              Return
                            </button>
                            <button
                              onClick={() => openVoidPurchaseModal(purchase)}
                              className="px-2.5 py-1.5 rounded bg-rose-500/10 hover:bg-rose-600 text-rose-400 hover:text-white border border-rose-500/20 text-[11px] font-medium transition inline-flex items-center gap-1"
                            >
                              <Ban className="w-3 h-3" />
                              Void
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer */}
            {purchases.length > PAGE_SIZE && (
              <div className="p-3 bg-slate-950/40 border-t border-slate-800/80 space-y-2">
                <div className="text-[10px] text-slate-500 text-center">
                  Showing{' '}
                  <span className="text-slate-300 font-semibold">
                    {Math.min(visibleCount, purchases.length)}
                  </span>{' '}
                  of{' '}
                  <span className="text-slate-300 font-semibold">{purchases.length}</span>{' '}
                  purchase orders
                </div>
                <div className="flex items-center gap-2">
                  {visibleCount > PAGE_SIZE && (
                    <button
                      onClick={handleSeeLess}
                      className="flex-1 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-300 text-[11px] font-semibold transition"
                    >
                      Show Less
                    </button>
                  )}
                  {hasMore && (
                    <button
                      onClick={handleSeeMore}
                      disabled={isLoadingMore}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-[11px] font-semibold shadow transition disabled:opacity-60 disabled:cursor-wait"
                    >
                      {isLoadingMore ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Loading...</span>
                        </>
                      ) : (
                        <>
                          <ChevronDown className="w-3.5 h-3.5" />
                          <span>See More ({Math.min(PAGE_SIZE, remaining)})</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Purchase Return Modal */}
      {returningPurchase && canRecordPurchase && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/80 backdrop-blur-sm sm:p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-2xl max-w-xl w-full p-4 sm:p-6 shadow-2xl max-h-[92vh] overflow-y-auto my-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2 text-amber-400 min-w-0">
                <RotateCcw className="w-5 h-5 shrink-0" />
                <h3 className="text-sm sm:text-base font-bold text-white truncate">
                  Purchase Return — {returningPurchase.purchaseNumber || returningPurchase.supplierName}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeReturnPurchaseModal}
                className="text-slate-400 hover:text-white p-1 shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Purchase Info Summary */}
            <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl text-xs mb-4 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-bold text-white truncate">
                  {returningPurchase.supplierName}
                </div>
                <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                  {formatDateTime(returningPurchase.createdAt)} ·{' '}
                  <span className="text-blue-400">
                    {returningPurchase.storeId
                      ? `Store: ${
                          returningPurchase.storeName ||
                          (dbState.stores || []).find(s => s.id === returningPurchase.storeId)
                            ?.name ||
                          'Warehouse'
                        }`
                      : 'Shop Floor'}
                  </span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[10px] text-slate-400">Current Total</div>
                <div className="font-mono font-bold text-white text-sm">
                  {formatCurrency(returningPurchase.totalAmount, settings.currencySymbol)}
                </div>
              </div>
            </div>

            {returnError && (
              <div className="mb-3 p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-medium">
                {returnError}
              </div>
            )}

            <form onSubmit={handleExecuteReturn} className="space-y-4 text-xs">
              {/* Items to Return */}
              <div>
                <label className="block text-slate-300 font-semibold uppercase tracking-wider text-[11px] mb-2">
                  Enter Quantity to Return
                </label>

                <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
                  {(returningPurchase.items || []).map(item => {
                    const rawVal = returnQuantities[item.id] ?? '';
                    const parsedQty = Math.max(0, parseFloat(rawVal) || 0);
                    const isOver = parsedQty > item.quantity;
                    const clampedQty = Math.min(parsedQty, item.quantity);
                    const remainingQty = Number((item.quantity - clampedQty).toFixed(4));
                    const lineDeduction = clampedQty * item.unitCost;

                    return (
                      <div
                        key={item.id}
                        className={`p-3 rounded-xl bg-slate-950 border transition space-y-2 ${
                          isOver
                            ? 'border-rose-500/60'
                            : clampedQty > 0
                            ? 'border-amber-500/50 bg-amber-500/5'
                            : 'border-slate-800'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-semibold text-white text-xs truncate">
                              {item.productName}
                            </div>
                            <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                              Purchased: <strong className="text-slate-200">{item.quantity}</strong>{' '}
                              × {formatCurrency(item.unitCost, settings.currencySymbol)} ={' '}
                              {formatCurrency(item.total, settings.currencySymbol)}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              setReturnQuantities(prev => ({
                                ...prev,
                                [item.id]: item.quantity.toString(),
                              }))
                            }
                            className="px-2 py-1 rounded bg-slate-800 hover:bg-amber-600/30 text-amber-300 text-[10px] font-semibold shrink-0 transition"
                          >
                            Max ({item.quantity})
                          </button>
                        </div>

                        <div className="flex items-center gap-2.5">
                          <div className="w-28 shrink-0">
                            <label className="block text-[10px] text-slate-500 mb-0.5">
                              Return Qty
                            </label>
                            <input
                              type="number"
                              inputMode="decimal"
                              min="0"
                              max={item.quantity}
                              step="any"
                              value={rawVal}
                              onChange={e =>
                                setReturnQuantities(prev => ({
                                  ...prev,
                                  [item.id]: e.target.value,
                                }))
                              }
                              placeholder="0"
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-white font-mono text-xs text-center focus:outline-none focus:ring-1 focus:ring-amber-500"
                            />
                          </div>

                          <div className="flex-1 flex items-center justify-between bg-slate-900/70 border border-slate-800 rounded-lg px-2.5 py-2 mt-3.5">
                            <span className="text-[11px] font-mono text-slate-300">
                              {item.quantity} →{' '}
                              <strong
                                className={
                                  clampedQty > 0 ? 'text-emerald-400' : 'text-slate-400'
                                }
                              >
                                {remainingQty} left
                              </strong>
                            </span>
                            {clampedQty > 0 && (
                              <span className="text-[11px] font-mono font-bold text-rose-400">
                                -{formatCurrency(lineDeduction, settings.currencySymbol)}
                              </span>
                            )}
                          </div>
                        </div>

                        {isOver && (
                          <p className="text-[10px] text-rose-400">
                            Cannot return more than purchased quantity ({item.quantity}).
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Live Deduction Summary */}
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-amber-200/90">Units to Return:</span>
                  <span className="font-mono font-bold text-amber-300">
                    -{returnPreview.totalReturnUnits}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-amber-200/90">Purchase Price Reduction:</span>
                  <span className="font-mono font-bold text-rose-300">
                    -{formatCurrency(returnPreview.totalReturnAmount, settings.currencySymbol)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs pt-1.5 border-t border-amber-500/20">
                  <span className="text-slate-200 font-semibold">Updated Purchase Total:</span>
                  <span className="font-mono font-bold text-white">
                    {formatCurrency(returningPurchase.totalAmount, settings.currencySymbol)} →{' '}
                    <span className="text-emerald-400">
                      {formatCurrency(
                        returnPreview.updatedPurchaseTotal,
                        settings.currencySymbol
                      )}
                    </span>
                  </span>
                </div>
              </div>

              {/* Reason */}
              <div className="space-y-1.5">
                <label className="block text-slate-300 font-semibold">Return Reason *</label>
                <textarea
                  required
                  rows={3}
                  value={returnReason}
                  onChange={e => setReturnReason(e.target.value)}
                  placeholder="e.g. Damaged items on arrival, wrong item delivered, excess quantity..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={closeReturnPurchaseModal}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isReturning || returnPreview.totalReturnUnits <= 0}
                  className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white text-xs font-bold shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition inline-flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{isReturning ? 'Processing...' : 'Return Now'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Void & Delete Purchase Modal */}
      {voidingPurchase && canRecordPurchase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2 text-rose-400 min-w-0">
                <Ban className="w-5 h-5 shrink-0" />
                <h3 className="text-sm sm:text-base font-bold text-white truncate">
                  Void Purchase {voidingPurchase.purchaseNumber || ''}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setVoidingPurchase(null);
                  setVoidReason('');
                }}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl text-xs mb-3 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-bold text-white truncate">
                  {voidingPurchase.supplierName}
                </div>
                <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                  {formatDateTime(voidingPurchase.createdAt)}
                </div>
              </div>
              <div className="font-mono font-bold text-white text-sm shrink-0">
                {formatCurrency(voidingPurchase.totalAmount, settings.currencySymbol)}
              </div>
            </div>

            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-200 text-xs mb-4 space-y-2">
              <div className="flex items-start gap-2">
                <RotateCcw className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <strong>Automatic Stock Reversal &amp; Permanent Delete:</strong> Voiding will
                  revert{' '}
                  <strong>
                    {(voidingPurchase.items || []).reduce((s, i) => s + (i.quantity || 0), 0)} units
                  </strong>{' '}
                  from{' '}
                  <strong>
                    {voidingPurchase.storeId
                      ? `Store: ${
                          voidingPurchase.storeName ||
                          (dbState.stores || []).find(s => s.id === voidingPurchase.storeId)
                            ?.name ||
                          'Warehouse'
                        }`
                      : 'Shop Floor'}
                  </strong>{' '}
                  back to their previous quantities and permanently delete this purchase record.
                </div>
              </div>

              {(voidingPurchase.items || []).length > 0 && (
                <div className="pt-1.5 border-t border-amber-500/20 max-h-28 overflow-y-auto space-y-1 text-[11px]">
                  {(voidingPurchase.items || []).map(item => (
                    <div key={item.id} className="flex items-center justify-between gap-2">
                      <span className="truncate text-amber-100">{item.productName}</span>
                      <span className="font-mono font-bold text-rose-300 shrink-0">
                        -{item.quantity}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2 text-xs mb-5">
              <label className="block text-slate-300 font-semibold">
                Void / Deletion Reason *
              </label>
              <textarea
                required
                rows={3}
                value={voidReason}
                onChange={e => setVoidReason(e.target.value)}
                placeholder="e.g. Wrong purchase entry, duplicate stock-in, cancelled delivery..."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setVoidingPurchase(null);
                  setVoidReason('');
                }}
                className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteVoid}
                disabled={isVoiding}
                className="px-4 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white text-xs font-bold disabled:opacity-50 transition"
              >
                {isVoiding ? 'Processing...' : 'Confirm Void & Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
