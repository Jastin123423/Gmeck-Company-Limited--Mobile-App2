import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Search,
  X,
  Phone,
  Calendar,
  Package,
  Store,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
  Loader2,
  User as UserIcon,
  Receipt,
  Trash2,
  Clock,
  Tag,
  TrendingUp,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { CustomerRecord, CustomerRecordItem } from '../../types';
import { CloudflareApi } from '../../services/cloudflareApi';
import { db } from '../../db/storage';
import { formatCurrency } from '../../utils/formatters';
import { getShopAdminShopIds, isPlatformAdmin, isShopAdmin } from '../../utils/permissions';

interface LightboxState {
  images: Array<{ url: string; caption?: string }>;
  index: number;
}

const formatDisplayDate = (iso?: string): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('sw-TZ', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const formatDisplayDateTime = (iso?: string): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('sw-TZ', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const normalizePhone = (v: string): string => v.replace(/[\s\-()+]/g, '').toLowerCase();

export const AdminCustomers: React.FC = () => {
  const { currentUser, dbState, addToast } = useApp();
  const [query, setQuery] = useState('');
  const [showRecent, setShowRecent] = useState(false);
  const [remoteRecords, setRemoteRecords] = useState<CustomerRecord[]>([]);
  const [isSearchingRemote, setIsSearchingRemote] = useState(false);
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteRecord, setConfirmDeleteRecord] = useState<CustomerRecord | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const settings = dbState.settings;
  const currency = settings.currencySymbol || 'TSh';
  const platformAdm = isPlatformAdmin(currentUser);
  const shopAdm = isShopAdmin(currentUser);
  const managedShopIds = useMemo(
    () => (shopAdm ? getShopAdminShopIds(currentUser) : []),
    [shopAdm, currentUser]
  );

  // Lookup maps for enriching legacy or synced records with live sale/product details
  const salesById = useMemo(() => {
    const map = new Map<string, (typeof dbState.sales)[number]>();
    for (const s of dbState.sales) {
      map.set(s.id, s);
    }
    return map;
  }, [dbState.sales]);

  const productsById = useMemo(() => {
    const map = new Map<string, (typeof dbState.products)[number]>();
    for (const p of dbState.products) {
      map.set(p.id, p);
    }
    return map;
  }, [dbState.products]);

  const shopsById = useMemo(() => {
    const map = new Map<string, (typeof dbState.shops)[number]>();
    for (const sh of dbState.shops) {
      map.set(sh.id, sh);
    }
    return map;
  }, [dbState.shops]);

  const trimmedQuery = query.trim();
  const isResultsView = trimmedQuery.length > 0 || showRecent;

  // Debounced live remote query from D1 API when searching or showing recent
  useEffect(() => {
    if (!isResultsView) {
      setRemoteRecords([]);
      setIsSearchingRemote(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (!CloudflareApi.isOnline()) return;
      setIsSearchingRemote(true);
      try {
        const fetched = await CloudflareApi.getCustomerRecords(
          trimmedQuery || undefined,
          100
        );
        if (!cancelled && Array.isArray(fetched)) {
          setRemoteRecords(fetched as CustomerRecord[]);
        }
      } catch {
        // Offline or network glitch — fall back seamlessly to local dbState.customerRecords
      } finally {
        if (!cancelled) {
          setIsSearchingRemote(false);
        }
      }
    }, 240);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [trimmedQuery, showRecent, isResultsView]);

  // Keyboard navigation inside photo lightbox
  useEffect(() => {
    if (!lightbox) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLightbox(null);
      } else if (e.key === 'ArrowRight') {
        setLightbox(prev =>
          prev ? { ...prev, index: (prev.index + 1) % prev.images.length } : null
        );
      } else if (e.key === 'ArrowLeft') {
        setLightbox(prev =>
          prev
            ? { ...prev, index: (prev.index - 1 + prev.images.length) % prev.images.length }
            : null
        );
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightbox]);

  // Merge local + remote records, enforce Shop Admin scoping
  const allScopedRecords = useMemo(() => {
    const mergedMap = new Map<string, CustomerRecord>();

    for (const r of dbState.customerRecords || []) {
      if (r && r.id) mergedMap.set(r.id, r);
    }
    for (const r of remoteRecords) {
      if (r && r.id) {
        const existing = mergedMap.get(r.id);
        mergedMap.set(r.id, {
          ...existing,
          ...r,
          items: r.items && r.items.length > 0 ? r.items : existing?.items,
          imageUrls: r.imageUrls && r.imageUrls.length > 0 ? r.imageUrls : existing?.imageUrls || [],
        });
      }
    }

    const list = Array.from(mergedMap.values()).filter(record => {
      if (platformAdm) return true;
      if (shopAdm) {
        const linkedSale = record.saleId ? salesById.get(record.saleId) : undefined;
        const effectiveShopId = record.shopId || linkedSale?.shopId;
        if (!effectiveShopId) return true;
        return managedShopIds.includes(effectiveShopId);
      }
      return false;
    });

    list.sort((a, b) => {
      const timeA = new Date(a.saleDate || a.createdAt || 0).getTime();
      const timeB = new Date(b.saleDate || b.createdAt || 0).getTime();
      return timeB - timeA;
    });

    return list;
  }, [dbState.customerRecords, remoteRecords, platformAdm, shopAdm, managedShopIds, salesById]);

  // Filtered search results (matches customer name or phone number, including digits-only phone match)
  const searchResults = useMemo(() => {
    if (!trimmedQuery) {
      return showRecent ? allScopedRecords.slice(0, 20) : [];
    }
    const qLower = trimmedQuery.toLowerCase();
    const qDigits = normalizePhone(trimmedQuery);

    return allScopedRecords.filter(record => {
      const nameMatch = (record.customerName || '').toLowerCase().includes(qLower);
      const rawPhoneMatch = (record.phoneNumber || '').toLowerCase().includes(qLower);
      const normalizedPhoneMatch =
        qDigits.length >= 3 && normalizePhone(record.phoneNumber || '').includes(qDigits);
      return nameMatch || rawPhoneMatch || normalizedPhoneMatch;
    });
  }, [allScopedRecords, trimmedQuery, showRecent]);

  // Resolve complete single-product sales report items for a customer record
  const resolveRecordItems = (record: CustomerRecord): CustomerRecordItem[] => {
    const linkedSale = record.saleId ? salesById.get(record.saleId) : undefined;

    if (Array.isArray(record.items) && record.items.length > 0) {
      return record.items.map(item => {
        const prod = productsById.get(item.productId);
        const saleLine = linkedSale?.items.find(si => si.productId === item.productId);
        const purchasePrice =
          typeof item.purchasePrice === 'number' && item.purchasePrice > 0
            ? item.purchasePrice
            : typeof saleLine?.purchasePrice === 'number' && saleLine.purchasePrice > 0
              ? saleLine.purchasePrice
              : prod?.purchasePrice || 0;

        return {
          ...item,
          variation: item.variation || prod?.variation,
          sku: item.sku || saleLine?.sku || prod?.sku,
          unit: item.unit || prod?.unit,
          purchasePrice,
          imageUrls: Array.isArray(item.imageUrls) ? item.imageUrls : [],
        };
      });
    }

    if (linkedSale && Array.isArray(linkedSale.items) && linkedSale.items.length > 0) {
      return linkedSale.items.map((saleItem, idx) => {
        const prod = productsById.get(saleItem.productId);
        return {
          productId: saleItem.productId,
          productName: saleItem.productName || prod?.name || 'Bidhaa',
          variation: prod?.variation,
          sku: saleItem.sku || prod?.sku,
          unit: prod?.unit,
          quantity: saleItem.quantity,
          purchasePrice:
            typeof saleItem.purchasePrice === 'number' && saleItem.purchasePrice > 0
              ? saleItem.purchasePrice
              : prod?.purchasePrice || 0,
          unitPrice: saleItem.unitPrice,
          total: saleItem.total,
          imageUrls: idx === 0 ? record.imageUrls || [] : [],
        };
      });
    }

    return [];
  };

  const handleDeleteRecord = async (record: CustomerRecord) => {
    setDeletingId(record.id);
    try {
      if (CloudflareApi.isOnline()) {
        await CloudflareApi.deleteCustomerRecord(record.id);
      }
      const nextLocal = db.getCustomerRecords().filter(r => r.id !== record.id);
      db.saveCustomerRecords(nextLocal);
      setRemoteRecords(prev => prev.filter(r => r.id !== record.id));
      addToast({
        type: 'success',
        title: 'Taarifa Imefutwa',
        description: `Rekodi ya ${record.customerName} imeondolewa.`,
      });
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Imeshindwa Kufuta',
        description: err?.message || 'Hitilafu imetokea wakati wa kufuta taarifa ya mteja.',
      });
    } finally {
      setDeletingId(null);
      setConfirmDeleteRecord(null);
    }
  };

  const handleClearSearch = () => {
    setQuery('');
    setShowRecent(false);
    window.setTimeout(() => searchInputRef.current?.focus(), 40);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) {
      setShowRecent(true);
    }
  };

  const openPhotoLightbox = (
    images: Array<{ url: string; caption?: string }>,
    startIndex: number
  ) => {
    if (images.length === 0) return;
    setLightbox({ images, index: Math.max(0, Math.min(startIndex, images.length - 1)) });
  };

  return (
    <div
      id="admin-customers-page"
      className="flex-1 flex flex-col bg-slate-950 text-slate-100 overflow-y-auto select-text"
    >
      {!isResultsView ? (
        /* ─────────────────────────────────────────────────────────────
           GOOGLE-STYLE CENTERED SEARCH HERO
           ───────────────────────────────────────────────────────────── */
        <div className="flex-1 flex flex-col items-center justify-center px-4 py-12 sm:py-16">
          <div className="w-full max-w-2xl flex flex-col items-center text-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-blue-500/20 border border-emerald-500/30 flex items-center justify-center mb-5 shadow-lg shadow-emerald-950/40">
              <UserIcon className="w-8 h-8 text-emerald-400" />
            </div>

            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
              Taarifa za Wateja
            </h1>
            <p className="mt-2.5 text-sm sm:text-base text-slate-400 max-w-lg">
              Tafuta kwa jina la mteja au namba ya simu ili kuona picha za bidhaa na ripoti kamili ya mauzo.
            </p>

            {/* Google-style Pill Search Bar */}
            <form onSubmit={handleFormSubmit} className="w-full mt-7">
              <div className="relative flex items-center bg-slate-900 border border-slate-700/80 hover:border-slate-600 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/25 rounded-full shadow-2xl shadow-black/40 transition-all px-4 sm:px-5 py-2.5 sm:py-3">
                <Search className="w-5 h-5 text-slate-400 shrink-0 mr-3" />
                <input
                  ref={searchInputRef}
                  id="customer-google-search-input"
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Andika jina la mteja au namba ya simu..."
                  autoComplete="off"
                  autoFocus
                  className="flex-1 bg-transparent text-sm sm:text-base text-white placeholder-slate-500 focus:outline-none min-w-0"
                />
                {query && (
                  <button
                    type="button"
                    onClick={handleClearSearch}
                    aria-label="Futa utafutaji"
                    className="p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition mr-1"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="submit"
                  className="px-4 sm:px-5 py-2 rounded-full bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs sm:text-sm font-semibold transition shrink-0 shadow-md shadow-emerald-900/40"
                >
                  Tafuta
                </button>
              </div>
            </form>

            {/* Subtle Secondary Actions */}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-xs text-slate-400">
              <button
                type="button"
                onClick={() => setShowRecent(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white font-medium transition"
              >
                <Clock className="w-3.5 h-3.5 text-emerald-400" />
                <span>Onyesha Wateja wa Hivi Karibuni ({allScopedRecords.length})</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* ─────────────────────────────────────────────────────────────
           SEARCH RESULTS VIEW WITH STICKY GOOGLE-STYLE TOP BAR
           ───────────────────────────────────────────────────────────── */
        <div className="flex-1 flex flex-col">
          {/* Sticky Top Search Header */}
          <div className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur-md border-b border-slate-800/90 px-4 sm:px-6 py-3.5">
            <div className="max-w-5xl mx-auto flex flex-col sm:flex-row sm:items-center gap-3">
              <button
                type="button"
                onClick={handleClearSearch}
                className="flex items-center gap-2 text-left shrink-0 group"
                title="Rudi ukurasa wa mwanzo wa utafutaji"
              >
                <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center group-hover:bg-emerald-500/25 transition">
                  <UserIcon className="w-4 h-4 text-emerald-400" />
                </div>
                <span className="text-base font-extrabold text-white tracking-tight">
                  Taarifa za Wateja
                </span>
              </button>

              <form onSubmit={handleFormSubmit} className="flex-1 min-w-0">
                <div className="relative flex items-center bg-slate-900 border border-slate-700/80 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20 rounded-full px-4 py-2 transition">
                  <Search className="w-4 h-4 text-slate-400 shrink-0 mr-2.5" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Tafuta kwa jina la mteja au namba ya simu..."
                    autoComplete="off"
                    className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none min-w-0"
                  />
                  {isSearchingRemote && (
                    <Loader2 className="w-4 h-4 text-emerald-400 animate-spin shrink-0 mr-2" />
                  )}
                  {(query || showRecent) && (
                    <button
                      type="button"
                      onClick={handleClearSearch}
                      aria-label="Futa utafutaji"
                      className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </form>
            </div>
          </div>

          {/* Results Body */}
          <div className="max-w-5xl w-full mx-auto px-4 sm:px-6 py-5 space-y-5">
            {/* Result Status Line */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
              <span>
                {trimmedQuery ? (
                  <>
                    Matokeo <strong className="text-white">{searchResults.length}</strong> kwa{' '}
                    <strong className="text-emerald-400">&ldquo;{trimmedQuery}&rdquo;</strong>
                  </>
                ) : (
                  <>
                    Wateja wa hivi karibuni:{' '}
                    <strong className="text-white">{searchResults.length}</strong>
                  </>
                )}
              </span>
              {isSearchingRemote && (
                <span className="inline-flex items-center gap-1.5 text-emerald-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Inatafuta kwenye seva...</span>
                </span>
              )}
            </div>

            {searchResults.length === 0 ? (
              <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-10 text-center">
                <Search className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <h3 className="text-base font-bold text-white">Hakuna taarifa za mteja zilizopatikana</h3>
                <p className="text-xs sm:text-sm text-slate-400 mt-1.5 max-w-md mx-auto">
                  {trimmedQuery
                    ? `Hatukupata mteja mwenye jina au namba ya simu "${trimmedQuery}". Jaribu kuandika sehemu ya jina au tarakimu za simu.`
                    : 'Bado hakuna rekodi za wateja zilizohifadhiwa.'}
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                {searchResults.map(record => {
                  const linkedSale = record.saleId ? salesById.get(record.saleId) : undefined;
                  const resolvedItems = resolveRecordItems(record);
                  const saleDateIso = record.saleDate || linkedSale?.createdAt || record.createdAt;
                  const shopDisplayName =
                    record.shopName ||
                    linkedSale?.shopName ||
                    (record.shopId ? shopsById.get(record.shopId)?.name : undefined);
                  const receiptNum = record.receiptNumber || linkedSale?.receiptNumber;

                  // Gather any order-level photos that are not already shown inside a specific product item
                  const assignedItemPhotoUrls = new Set(
                    resolvedItems.flatMap(it => it.imageUrls || [])
                  );
                  const remainingRecordPhotos = (record.imageUrls || []).filter(
                    url => !assignedItemPhotoUrls.has(url)
                  );

                  // Combined lightbox gallery for the whole customer record
                  const allRecordGallery: Array<{ url: string; caption?: string }> = [];
                  resolvedItems.forEach(it => {
                    (it.imageUrls || []).forEach((url, idx) => {
                      allRecordGallery.push({
                        url,
                        caption: `${record.customerName} • ${it.productName} (Picha ${idx + 1})`,
                      });
                    });
                  });
                  remainingRecordPhotos.forEach((url, idx) => {
                    allRecordGallery.push({
                      url,
                      caption: `${record.customerName} • Picha ya Bidhaa #${idx + 1}`,
                    });
                  });

                  const openUrlInGallery = (url: string) => {
                    const idx = allRecordGallery.findIndex(g => g.url === url);
                    openPhotoLightbox(allRecordGallery, idx >= 0 ? idx : 0);
                  };

                  return (
                    <article
                      key={record.id}
                      className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg shadow-black/25"
                    >
                      {/* Customer Identity Header */}
                      <div className="px-4 sm:px-5 py-4 bg-slate-950/70 border-b border-slate-800 flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
                            <UserIcon className="w-5 h-5 text-emerald-400" />
                          </div>
                          <div className="min-w-0">
                            <h2 className="text-base sm:text-lg font-extrabold text-white truncate">
                              {record.customerName}
                            </h2>
                            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-300">
                              <a
                                href={`tel:${record.phoneNumber}`}
                                className="inline-flex items-center gap-1.5 text-emerald-400 hover:text-emerald-300 font-mono font-semibold"
                              >
                                <Phone className="w-3.5 h-3.5" />
                                <span>{record.phoneNumber}</span>
                              </a>
                              <span className="inline-flex items-center gap-1.5 text-slate-400">
                                <Calendar className="w-3.5 h-3.5 text-sky-400" />
                                <span>{formatDisplayDateTime(saleDateIso)}</span>
                              </span>
                              {shopDisplayName && (
                                <span className="inline-flex items-center gap-1.5 text-slate-400">
                                  <Store className="w-3.5 h-3.5 text-indigo-400" />
                                  <span>{shopDisplayName}</span>
                                </span>
                              )}
                              {receiptNum && (
                                <span className="inline-flex items-center gap-1 text-slate-400 font-mono">
                                  <Receipt className="w-3.5 h-3.5 text-amber-400" />
                                  <span>#{receiptNum}</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-semibold text-slate-300">
                            <ImageIcon className="w-3.5 h-3.5 text-emerald-400" />
                            <span>{allRecordGallery.length} Picha</span>
                          </span>
                          {platformAdm && (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteRecord(record)}
                              disabled={deletingId === record.id}
                              title="Futa rekodi ya mteja"
                              className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/30 transition"
                            >
                              {deletingId === record.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Trash2 className="w-4 h-4" />
                              )}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Single Product Sales Report Section */}
                      <div className="p-4 sm:p-5 space-y-4">
                        {resolvedItems.length > 0 ? (
                          <div className="space-y-3.5">
                            <div className="flex items-center justify-between">
                              <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                                <Package className="w-3.5 h-3.5 text-emerald-400" />
                                <span>
                                  Ripoti ya Mauzo kwa Bidhaa ({resolvedItems.length})
                                </span>
                              </h3>
                            </div>

                            {resolvedItems.map((item, idx) => {
                              const totalBuyingCost = (item.purchasePrice || 0) * (item.quantity || 0);
                              const lineTotal =
                                typeof item.total === 'number' && item.total > 0
                                  ? item.total
                                  : (item.unitPrice || 0) * (item.quantity || 0);
                              const itemPhotos = item.imageUrls || [];

                              return (
                                <div
                                  key={`${record.id}-item-${item.productId}-${idx}`}
                                  className="bg-slate-950 border border-slate-800/90 rounded-xl p-3.5 sm:p-4 space-y-3"
                                >
                                  {/* Product Title Row */}
                                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-800/80">
                                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                                      <span className="w-6 h-6 rounded-lg bg-emerald-500/15 text-emerald-300 text-xs font-bold flex items-center justify-center shrink-0">
                                        {idx + 1}
                                      </span>
                                      <h4 className="text-sm sm:text-base font-bold text-white">
                                        {item.productName}
                                      </h4>
                                      {item.variation && (
                                        <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                                          {item.variation}
                                        </span>
                                      )}
                                      {item.sku && (
                                        <span className="text-[11px] px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400 font-mono">
                                          {item.sku}
                                        </span>
                                      )}
                                    </div>
                                    <span className="text-xs font-mono font-bold text-emerald-400">
                                      Jumla: {formatCurrency(lineTotal, currency)}
                                    </span>
                                  </div>

                                  {/* Single Product Sales Report Metrics Grid */}
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                                    <div className="bg-slate-900/90 border border-slate-800/80 rounded-lg p-2.5">
                                      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                                        <Calendar className="w-3 h-3 text-sky-400" />
                                        <span>Tarehe ya Mauzo</span>
                                      </div>
                                      <div className="mt-1 text-xs sm:text-sm font-bold text-white">
                                        {formatDisplayDate(saleDateIso)}
                                      </div>
                                    </div>

                                    <div className="bg-slate-900/90 border border-slate-800/80 rounded-lg p-2.5">
                                      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                                        <Package className="w-3 h-3 text-indigo-400" />
                                        <span>Idadi (Quantity)</span>
                                      </div>
                                      <div className="mt-1 text-xs sm:text-sm font-bold text-white font-mono">
                                        {item.quantity} {item.unit || 'pcs'}
                                      </div>
                                    </div>

                                    <div className="bg-slate-900/90 border border-slate-800/80 rounded-lg p-2.5">
                                      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                                        <Tag className="w-3 h-3 text-amber-400" />
                                        <span>Bei ya Kununulia</span>
                                      </div>
                                      <div className="mt-1 text-xs sm:text-sm font-bold text-amber-300 font-mono">
                                        {formatCurrency(item.purchasePrice || 0, currency)}
                                      </div>
                                      {item.quantity > 1 && (
                                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                          Jumla: {formatCurrency(totalBuyingCost, currency)}
                                        </div>
                                      )}
                                    </div>

                                    <div className="bg-slate-900/90 border border-slate-800/80 rounded-lg p-2.5">
                                      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                                        <TrendingUp className="w-3 h-3 text-emerald-400" />
                                        <span>Bei ya Kuuza</span>
                                      </div>
                                      <div className="mt-1 text-xs sm:text-sm font-bold text-emerald-400 font-mono">
                                        {formatCurrency(item.unitPrice || 0, currency)}
                                      </div>
                                      {item.quantity > 1 && (
                                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                          Jumla: {formatCurrency(lineTotal, currency)}
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  {/* Per-Product Photos */}
                                  {itemPhotos.length > 0 && (
                                    <div className="pt-1">
                                      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
                                        <ImageIcon className="w-3 h-3 text-emerald-400" />
                                        <span>Picha za Bidhaa ({itemPhotos.length})</span>
                                      </div>
                                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2.5">
                                        {itemPhotos.map((url, pIdx) => (
                                          <button
                                            key={`${url}-${pIdx}`}
                                            type="button"
                                            onClick={() => openUrlInGallery(url)}
                                            className="group relative aspect-square rounded-xl overflow-hidden bg-slate-900 border border-slate-700 hover:border-emerald-400 transition focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                            title="Bonyeza kuona picha kubwa"
                                          >
                                            <img
                                              src={url}
                                              alt={`${item.productName} - Picha ${pIdx + 1}`}
                                              loading="lazy"
                                              className="w-full h-full object-cover group-hover:scale-105 transition duration-200"
                                            />
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          /* Fallback summary when an older record has no linked sale items */
                          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-xs text-slate-400 flex items-center justify-between gap-2">
                            <span>Tarehe ya Kurekodiwa: <strong className="text-slate-200">{formatDisplayDateTime(saleDateIso)}</strong></span>
                            <span className="text-slate-500">Hakuna maelezo ya bidhaa yaliyounganishwa</span>
                          </div>
                        )}

                        {/* Order-level Photos (unassigned to a specific item or legacy records) */}
                        {remainingRecordPhotos.length > 0 && (
                          <div className="pt-1">
                            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
                              <ImageIcon className="w-3.5 h-3.5 text-emerald-400" />
                              <span>
                                Picha za Bidhaa ({remainingRecordPhotos.length})
                              </span>
                            </div>
                            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2.5">
                              {remainingRecordPhotos.map((url, pIdx) => (
                                <button
                                  key={`${url}-${pIdx}`}
                                  type="button"
                                  onClick={() => openUrlInGallery(url)}
                                  className="group relative aspect-square rounded-xl overflow-hidden bg-slate-950 border border-slate-700 hover:border-emerald-400 transition focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                  title="Bonyeza kuona picha kubwa"
                                >
                                  <img
                                    src={url}
                                    alt={`${record.customerName} - Picha ${pIdx + 1}`}
                                    loading="lazy"
                                    className="w-full h-full object-cover group-hover:scale-105 transition duration-200"
                                  />
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Full-Screen Photo Lightbox */}
      {lightbox && lightbox.images[lightbox.index] && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/95 backdrop-blur-sm flex flex-col items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <div
            className="relative max-w-3xl w-full bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 bg-slate-950/90 border-b border-slate-800">
              <div className="text-xs sm:text-sm font-semibold text-white truncate pr-4">
                {lightbox.images[lightbox.index].caption || 'Picha ya Bidhaa'}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs font-mono text-slate-400">
                  {lightbox.index + 1} / {lightbox.images.length}
                </span>
                <button
                  type="button"
                  onClick={() => setLightbox(null)}
                  aria-label="Funga picha"
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="relative bg-black flex items-center justify-center min-h-[300px]">
              <img
                src={lightbox.images[lightbox.index].url}
                alt={lightbox.images[lightbox.index].caption || 'Picha ya bidhaa'}
                className="w-full max-h-[72vh] object-contain"
              />

              {lightbox.images.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setLightbox(prev =>
                        prev
                          ? {
                              ...prev,
                              index: (prev.index - 1 + prev.images.length) % prev.images.length,
                            }
                          : null
                      )
                    }
                    aria-label="Picha iliyotangulia"
                    className="absolute left-3 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-slate-950/80 hover:bg-slate-800 text-white border border-slate-700 transition"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setLightbox(prev =>
                        prev
                          ? { ...prev, index: (prev.index + 1) % prev.images.length }
                          : null
                      )
                    }
                    aria-label="Picha inayofuata"
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-slate-950/80 hover:bg-slate-800 text-white border border-slate-700 transition"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal (Platform Admin only) */}
      {confirmDeleteRecord && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setConfirmDeleteRecord(null)}
        >
          <div
            className="max-w-sm w-full bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-white">Futa Taarifa za Mteja?</h3>
            <p className="text-xs text-slate-400">
              Una uhakika unataka kufuta rekodi ya{' '}
              <strong className="text-white">{confirmDeleteRecord.customerName}</strong> (
              {confirmDeleteRecord.phoneNumber})? Hatua hii haitaathiri ripoti za mauzo.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteRecord(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition"
              >
                Ghairi
              </button>
              <button
                type="button"
                onClick={() => handleDeleteRecord(confirmDeleteRecord)}
                disabled={deletingId === confirmDeleteRecord.id}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white transition flex items-center gap-1.5 disabled:opacity-50"
              >
                {deletingId === confirmDeleteRecord.id && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                )}
                <span>Futa</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
