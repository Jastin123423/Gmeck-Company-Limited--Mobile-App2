import React, { useState, useEffect } from 'react';
import {
  Home,
  ShoppingCart,
  Package,
  Receipt,
  History,
  Users,
  TrendingDown,
  Truck,
  BarChart3,
  Database,
  Settings,
  Boxes,
  Store,
  FileText,
  Bell,
  X,
  Shield,
  LogOut,
  RefreshCw,
  WifiOff,
  ChevronRight,
  ChevronDown,
  Car,
  Warehouse,
  ArrowRightLeft,
  ClipboardList,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { NotificationService } from '../../services/notificationService';
import { DebtService } from '../../services/debtService';
import {
  getAdminManagedShops,
  getEffectiveSellerPermissions,
  getShopAdminShopIds,
  isPlatformAdmin,
  isShopAdmin,
} from '../../utils/permissions';

interface MobileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

interface NavChildItem {
  id: 'stores' | 'inventory' | 'transfer' | 'list';
  label: string;
  icon: React.ElementType;
  iconColor: string;
  badge?: number | string;
}

interface NavItem {
  id: string;
  label: string;
  subtitle?: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  badge?: number | string;
  badgeColor?: 'red' | 'amber' | 'blue';
  category: 'core' | 'operations' | 'management' | 'system';
  requiresPermission?: keyof import('../../types').SellerPermissions;
  requiresAnyPermission?: (keyof import('../../types').SellerPermissions)[];
  children?: NavChildItem[];
}

export const MobileDrawer: React.FC<MobileDrawerProps> = ({ isOpen, onClose }) => {
  const {
    currentUser,
    activeTab,
    setActiveTab,
    storesSubTab,
    openStoresSubTab,
    sellerColor,
    dbState,
    logout,
    syncStatus,
    triggerSync,
    selectedShopId,
    setSelectedShopId,
    availableShops,
    currentShop,
  } = useApp();

  const [isStoresExpanded, setIsStoresExpanded] = useState<boolean>(activeTab === 'stores');

  useEffect(() => {
    if (activeTab === 'stores') {
      setIsStoresExpanded(true);
    }
  }, [activeTab]);

  if (!isOpen || !currentUser) return null;

  const isPlatformAdm = isPlatformAdmin(currentUser);
  const isShopAdm = isShopAdmin(currentUser);
  const showAdminMenu = isPlatformAdm || isShopAdm;
  const isSeller = currentUser.role === 'SELLER';
  const managedShopIds = getShopAdminShopIds(currentUser);
  const assignedShopIds = currentUser.assignedShopIds || [];
  const scopedShopIds = isPlatformAdm
    ? null
    : isShopAdm
    ? managedShopIds
    : assignedShopIds;
  const managedShops = getAdminManagedShops(currentUser, dbState.shops || []);

  // Count low-stock items within accessible shop scope
  const lowStockCount = (dbState.products || []).filter(
    p =>
      p.status === 'ACTIVE' &&
      p.currentStock <= p.minStock &&
      (!scopedShopIds || scopedShopIds.length === 0 || scopedShopIds.includes(p.shopId))
  ).length;

  // Count unread notifications
  const unreadNotifsCount = NotificationService.getUnreadCount(currentUser);

  // Count pending/overdue debts within user scope
  const debts = DebtService.getAllDebts(currentUser);
  const overdueDebtsCount = debts.filter(d => d.status === 'OVERDUE').length;

  // Count accessible stores and stock transfers
  const accessibleStoresCount = (dbState.stores || []).filter(
    st => isPlatformAdm || managedShopIds.includes(st.shopId)
  ).length;
  const accessibleTransfersCount = (dbState.stockTransfers || []).filter(
    t => isPlatformAdm || managedShopIds.includes(t.shopId)
  ).length;

  const sellerPermissions = getEffectiveSellerPermissions(currentUser);

  const hasPermission = (perm: keyof import('../../types').SellerPermissions): boolean => {
    if (showAdminMenu) return true;
    return !!sellerPermissions[perm];
  };

  const hasAnyPermission = (
    perms: (keyof import('../../types').SellerPermissions)[]
  ): boolean => {
    if (showAdminMenu) return true;
    return perms.some(perm => !!sellerPermissions[perm]);
  };

  const sellerNav: NavItem[] = [
    {
      id: 'dashboard',
      label: 'Home',
      icon: Home,
      iconColor: 'text-sky-400',
      iconBg: 'bg-sky-500/15',
      category: 'core',
    },
    {
      id: 'new_sale',
      label: 'Sales (POS)',
      icon: ShoppingCart,
      iconColor: 'text-emerald-400',
      iconBg: 'bg-emerald-500/15',
      category: 'core',
    },
    {
      id: 'products',
      label: 'Products and Categories',
      icon: Package,
      iconColor: 'text-violet-400',
      iconBg: 'bg-violet-500/15',
      badge: lowStockCount > 0 ? lowStockCount : undefined,
      category: 'operations',
    },
    {
      id: 'purchases',
      label: 'Purchases',
      icon: Truck,
      iconColor: 'text-orange-400',
      iconBg: 'bg-orange-500/15',
      category: 'operations',
    },
    {
      id: 'my_sales',
      label: 'My Sales History',
      icon: History,
      iconColor: 'text-indigo-400',
      iconBg: 'bg-indigo-500/15',
      category: 'operations',
    },
    {
      id: 'debts',
      label: 'Daftari la Madeni',
      subtitle: 'Debt Management',
      icon: FileText,
      iconColor: 'text-yellow-400',
      iconBg: 'bg-yellow-500/15',
      badge:
        overdueDebtsCount > 0
          ? `${overdueDebtsCount} Overdue`
          : debts.filter(d => d.status !== 'PAID').length || undefined,
      badgeColor: overdueDebtsCount > 0 ? 'red' : 'amber',
      category: 'management',
    },
    {
      id: 'notifications',
      label: 'Notification Center',
      icon: Bell,
      iconColor: 'text-pink-400',
      iconBg: 'bg-pink-500/15',
      badge: unreadNotifsCount > 0 ? unreadNotifsCount : undefined,
      badgeColor: 'red',
      category: 'management',
    },
    {
      id: 'receipts',
      label: 'Receipts',
      icon: Receipt,
      iconColor: 'text-teal-400',
      iconBg: 'bg-teal-500/15',
      category: 'management',
    },

    // Permission-gated admin modules granted to seller
    {
      id: 'sales',
      label: 'Sales Reports',
      icon: History,
      iconColor: 'text-indigo-400',
      iconBg: 'bg-indigo-500/15',
      category: 'management',
      requiresAnyPermission: ['canEditSales', 'canDeleteSales'],
    },
    {
      id: 'inventory',
      label: 'Stock & Inventory',
      icon: Boxes,
      iconColor: 'text-teal-400',
      iconBg: 'bg-teal-500/15',
      badge: lowStockCount > 0 ? `${lowStockCount} Low` : undefined,
      category: 'management',
      requiresPermission: 'canManageInventory',
    },
    {
      id: 'expenses',
      label: 'Expenses',
      icon: TrendingDown,
      iconColor: 'text-rose-400',
      iconBg: 'bg-rose-500/15',
      category: 'management',
      requiresAnyPermission: ['canViewExpenses', 'canRecordExpenses'],
    },
    {
      id: 'reports',
      label: 'Ripoti za Kifedha',
      subtitle: 'Reports & Analytics',
      icon: BarChart3,
      iconColor: 'text-fuchsia-400',
      iconBg: 'bg-fuchsia-500/15',
      category: 'management',
      requiresPermission: 'canViewReports',
    },
    {
      id: 'shops',
      label: 'Shops and Business Unit',
      icon: Store,
      iconColor: 'text-amber-400',
      iconBg: 'bg-amber-500/15',
      badge: (dbState.shops || []).length,
      category: 'management',
      requiresPermission: 'canManageShops',
    },
    {
      id: 'sellers',
      label: 'User Management',
      icon: Users,
      iconColor: 'text-blue-400',
      iconBg: 'bg-blue-500/15',
      category: 'management',
      requiresPermission: 'canManageSellers',
    },
    {
      id: 'settings',
      label: 'Account Settings',
      icon: Settings,
      iconColor: 'text-sky-300',
      iconBg: 'bg-sky-500/15',
      category: 'system',
    },
  ];

  const adminNav: NavItem[] = [
    {
      id: 'dashboard',
      label: 'Home',
      icon: Home,
      iconColor: 'text-sky-400',
      iconBg: 'bg-sky-500/15',
      category: 'core',
    },
    {
      id: 'new_sale',
      label: 'Sales (POS)',
      icon: ShoppingCart,
      iconColor: 'text-emerald-400',
      iconBg: 'bg-emerald-500/15',
      category: 'core',
    },
    {
      id: 'shops',
      label: 'Shops and Business Unit',
      icon: Store,
      iconColor: 'text-amber-400',
      iconBg: 'bg-amber-500/15',
      badge: managedShops.length,
      category: 'core',
    },
    {
      id: 'sales',
      label: 'Sales Reports',
      icon: History,
      iconColor: 'text-indigo-400',
      iconBg: 'bg-indigo-500/15',
      category: 'operations',
    },
    {
      id: 'products',
      label: 'Products and Categories',
      icon: Package,
      iconColor: 'text-violet-400',
      iconBg: 'bg-violet-500/15',
      category: 'operations',
    },
    {
      id: 'stores',
      label: 'Stores and Transfer',
      icon: Car,
      iconColor: 'text-cyan-400',
      iconBg: 'bg-cyan-500/15',
      badge: accessibleStoresCount || undefined,
      badgeColor: 'blue',
      category: 'operations',
      children: [
        {
          id: 'stores',
          label: 'Stores',
          icon: Warehouse,
          iconColor: 'text-cyan-400',
          badge: accessibleStoresCount || undefined,
        },
        {
          id: 'inventory',
          label: 'Inventory',
          icon: Package,
          iconColor: 'text-blue-400',
        },
        {
          id: 'transfer',
          label: 'Transfer Stock',
          icon: ArrowRightLeft,
          iconColor: 'text-indigo-400',
        },
        {
          id: 'list',
          label: 'List',
          icon: ClipboardList,
          iconColor: 'text-emerald-400',
          badge: accessibleTransfersCount || undefined,
        },
      ],
    },
    {
      id: 'inventory',
      label: 'Stock & Inventory',
      icon: Boxes,
      iconColor: 'text-teal-400',
      iconBg: 'bg-teal-500/15',
      badge: lowStockCount > 0 ? `${lowStockCount} Low` : undefined,
      category: 'operations',
    },
    {
      id: 'purchases',
      label: 'Purchases',
      icon: Truck,
      iconColor: 'text-orange-400',
      iconBg: 'bg-orange-500/15',
      category: 'operations',
    },
    {
      id: 'expenses',
      label: 'Expenses',
      icon: TrendingDown,
      iconColor: 'text-rose-400',
      iconBg: 'bg-rose-500/15',
      category: 'operations',
    },
    {
      id: 'debts',
      label: 'Daftari la Madeni',
      subtitle: 'Debt Management',
      icon: FileText,
      iconColor: 'text-yellow-400',
      iconBg: 'bg-yellow-500/15',
      badge: overdueDebtsCount > 0 ? `${overdueDebtsCount} Overdue` : undefined,
      badgeColor: 'red',
      category: 'management',
    },
    {
      id: 'reports',
      label: 'Ripoti na Uchambuzi',
      subtitle: 'Reports & Analytics',
      icon: BarChart3,
      iconColor: 'text-fuchsia-400',
      iconBg: 'bg-fuchsia-500/15',
      category: 'management',
    },
    {
      id: 'sellers',
      label: 'User Management',
      icon: Users,
      iconColor: 'text-blue-400',
      iconBg: 'bg-blue-500/15',
      category: 'management',
    },
    {
      id: 'notifications',
      label: 'Notification Center',
      icon: Bell,
      iconColor: 'text-pink-400',
      iconBg: 'bg-pink-500/15',
      badge: unreadNotifsCount > 0 ? unreadNotifsCount : undefined,
      badgeColor: 'red',
      category: 'management',
    },
    {
      id: 'data_management',
      label: 'Shop Import & Export',
      icon: Database,
      iconColor: 'text-lime-400',
      iconBg: 'bg-lime-500/15',
      category: 'system',
    },
    {
      id: 'settings',
      label: 'Account Settings',
      icon: Settings,
      iconColor: 'text-sky-300',
      iconBg: 'bg-sky-500/15',
      category: 'system',
    },
  ];

  const items = (showAdminMenu ? adminNav : sellerNav).filter(item => {
    if (item.requiresPermission) {
      return hasPermission(item.requiresPermission);
    }
    if (item.requiresAnyPermission) {
      return hasAnyPermission(item.requiresAnyPermission);
    }
    return true;
  });

  const handleNavClick = (tabId: string) => {
    setActiveTab(tabId);
    onClose();
  };

  const handleStoresChildClick = (childId: 'stores' | 'inventory' | 'transfer' | 'list') => {
    openStoresSubTab(childId);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex lg:hidden animate-in fade-in duration-200">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer Panel */}
      <div className="relative w-[88vw] max-w-[360px] bg-slate-900 border-r border-slate-800 h-full flex flex-col justify-between shadow-2xl z-10 overflow-hidden">
        {/* Drawer Header */}
        <div className="p-4 border-b border-slate-800 bg-slate-950/80 safe-top">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white shadow-md"
                style={{ backgroundColor: isSeller ? sellerColor.primary : '#2563eb' }}
              >
                {showAdminMenu ? (
                  <Shield className="w-5 h-5" />
                ) : (
                  currentUser.name.charAt(0).toUpperCase()
                )}
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-white truncate">{currentUser.name}</h3>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                    isPlatformAdm
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : isShopAdm
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                  }`}
                >
                  {isPlatformAdm ? 'Administrator' : isShopAdm ? 'Shop Admin' : 'Seller'}
                </span>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Shop Switcher inside Drawer for Mobile */}
          <div className="mt-2 p-2.5 rounded-xl bg-slate-900 border border-slate-800">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
                <Store className="w-3.5 h-3.5 text-amber-400" />
                <span>Selected Shop Unit</span>
              </span>
              {currentShop && (
                <span className="text-[10px] text-emerald-400 font-mono">Active</span>
              )}
            </div>

            {(() => {
              const sellerPersonalTabs = [
                'new_sale',
                'my_sales',
                'receipts',
                'settings',
                'notifications',
              ];
              const inAdminScopedTab =
                isShopAdm && !isPlatformAdm && !sellerPersonalTabs.includes(activeTab);

              if (isPlatformAdm || (inAdminScopedTab && managedShops.length > 1)) {
                return (
                  <select
                    id="drawer-admin-shop-select"
                    value={selectedShopId}
                    onChange={e => {
                      setSelectedShopId(e.target.value);
                    }}
                    className="w-full bg-slate-950 text-xs text-white font-medium py-2 px-2.5 rounded-lg border border-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="ALL">
                      {isPlatformAdm ? '🏢 All Shops (Overview)' : '🏢 All Managed Shops'}
                    </option>
                    {(isPlatformAdm ? availableShops : managedShops).map(sh => (
                      <option key={sh.id} value={sh.id}>
                        {sh.status === 'INACTIVE'
                          ? `🚫 ${sh.name} (Inactive)`
                          : `🏪 ${sh.name}`}
                      </option>
                    ))}
                  </select>
                );
              }

              if (inAdminScopedTab) {
                return managedShops.length === 1 ? (
                  <div className="text-xs font-semibold text-emerald-300 py-1 px-1">
                    🏪 {managedShops[0].name}
                  </div>
                ) : (
                  <div className="text-xs text-rose-400 py-1">⚠️ No Managed Shops</div>
                );
              }

              if (availableShops.length > 1) {
                return (
                  <select
                    id="drawer-seller-shop-select"
                    value={selectedShopId}
                    onChange={e => {
                      setSelectedShopId(e.target.value);
                    }}
                    className="w-full bg-slate-950 text-xs text-blue-300 font-medium py-2 px-2.5 rounded-lg border border-blue-700/60 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {availableShops.map(sh => (
                      <option key={sh.id} value={sh.id}>
                        🏪 {sh.name}
                      </option>
                    ))}
                  </select>
                );
              }

              if (availableShops.length === 1) {
                return (
                  <div className="text-xs font-semibold text-blue-300 py-1 px-1">
                    🏪 {availableShops[0].name}
                  </div>
                );
              }

              return <div className="text-xs text-rose-400 py-1">⚠️ No Assigned Shops</div>;
            })()}
          </div>
        </div>

        {/* Navigation Items List */}
        <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
          {items.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            const hasChildren = Boolean(item.children && item.children.length > 0);

            if (hasChildren && item.children) {
              return (
                <div key={item.id} className="space-y-1">
                  <button
                    type="button"
                    id={`drawer-nav-${item.id}`}
                    onClick={() => setIsStoresExpanded(prev => !prev)}
                    aria-expanded={isStoresExpanded}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left font-medium transition-all duration-200 ${
                      isActive
                        ? 'bg-cyan-600/20 text-white border border-cyan-500/40 shadow-sm'
                        : isStoresExpanded
                        ? 'bg-slate-800/80 text-white'
                        : 'text-slate-200 hover:text-white hover:bg-slate-800/70'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1 pr-2">
                      <div
                        className={`p-2 rounded-lg shrink-0 transition-transform duration-200 ${
                          isActive
                            ? 'bg-cyan-500/25 text-cyan-300'
                            : `${item.iconBg} ${item.iconColor}`
                        }`}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[16px] leading-snug font-semibold truncate">
                          {item.label}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {item.badge !== undefined && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                          {item.badge}
                        </span>
                      )}
                      <ChevronDown
                        className={`w-4 h-4 transition-transform duration-300 ease-out ${
                          isStoresExpanded ? 'rotate-180 text-cyan-400' : 'text-slate-500'
                        }`}
                      />
                    </div>
                  </button>

                  {/* Smooth Collapsible Dropdown */}
                  <div
                    className={`grid transition-all duration-300 ease-out ${
                      isStoresExpanded
                        ? 'grid-rows-[1fr] opacity-100 translate-y-0'
                        : 'grid-rows-[0fr] opacity-0 -translate-y-1 pointer-events-none'
                    }`}
                  >
                    <div className="overflow-hidden">
                      <div className="ml-5 pl-3 py-1 space-y-1 border-l-2 border-cyan-500/30">
                        {item.children.map(child => {
                          const ChildIcon = child.icon;
                          const isChildActive =
                            activeTab === 'stores' &&
                            (storesSubTab === child.id ||
                              (child.id === 'list' && storesSubTab === 'transfer_view'));

                          return (
                            <button
                              key={child.id}
                              type="button"
                              id={`drawer-nav-stores-${child.id}`}
                              onClick={() => handleStoresChildClick(child.id)}
                              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left transition-all duration-200 ${
                                isChildActive
                                  ? 'bg-blue-600 text-white shadow-md font-semibold'
                                  : 'text-slate-300 hover:text-white hover:bg-slate-800/70 font-medium'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                <ChildIcon
                                  className={`w-4 h-4 shrink-0 ${
                                    isChildActive ? 'text-white' : child.iconColor
                                  }`}
                                />
                                <span className="text-[14px] truncate">{child.label}</span>
                              </div>
                              {child.badge !== undefined && (
                                <span
                                  className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                                    isChildActive
                                      ? 'bg-white/25 text-white'
                                      : 'bg-slate-800 text-slate-300 border border-slate-700'
                                  }`}
                                >
                                  {child.badge}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <button
                key={item.id}
                id={`drawer-nav-${item.id}`}
                onClick={() => handleNavClick(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left font-medium transition-all ${
                  isActive
                    ? 'text-white shadow-md'
                    : 'text-slate-200 hover:text-white hover:bg-slate-800/70'
                }`}
                style={{
                  backgroundColor: isActive
                    ? isSeller
                      ? sellerColor.primary
                      : '#2563eb'
                    : undefined,
                }}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1 pr-2">
                  <div
                    className={`p-2 rounded-lg shrink-0 ${
                      isActive ? 'bg-white/20 text-white' : `${item.iconBg} ${item.iconColor}`
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[16px] leading-snug font-semibold truncate">
                      {item.label}
                    </div>
                    {item.subtitle && (
                      <div
                        className={`text-[12px] leading-snug font-normal truncate ${
                          isActive ? 'text-white/85' : 'text-slate-400'
                        }`}
                      >
                        {item.subtitle}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {item.badge !== undefined && (
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                        isActive
                          ? 'bg-white/30 text-white'
                          : item.badgeColor === 'red'
                          ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                          : item.badgeColor === 'blue'
                          ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                          : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                  <ChevronRight
                    className={`w-3.5 h-3.5 ${isActive ? 'text-white/70' : 'text-slate-600'}`}
                  />
                </div>
              </button>
            );
          })}
        </nav>

        {/* Drawer Footer with Sync, Offline & Logout */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/90 safe-bottom space-y-2">
          {/* Sync status */}
          <div className="flex items-center justify-between text-xs px-1">
            <div className="flex items-center gap-1.5">
              <WifiOff className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-[11px] text-slate-300 font-medium">Offline Engine Ready</span>
            </div>
            <button
              onClick={triggerSync}
              className="text-[11px] text-blue-400 hover:text-blue-300 font-semibold flex items-center gap-1"
            >
              <RefreshCw
                className={`w-3 h-3 ${syncStatus.state === 'SYNCING' ? 'animate-spin' : ''}`}
              />
              <span>Sync</span>
            </button>
          </div>

          {/* Logout button */}
          <button
            onClick={() => {
              onClose();
              logout();
            }}
            className="w-full py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-rose-950/50 hover:text-rose-300 text-slate-300 border border-slate-700 text-xs font-semibold flex items-center justify-center gap-2 transition"
          >
            <LogOut className="w-4 h-4" />
            <span>Switch User / Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
};
