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
  Lock,
  Store,
  FileText,
  Bell,
  Car,
  Warehouse,
  ArrowRightLeft,
  ClipboardList,
  ChevronDown,
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
  icon: React.ElementType;
  iconColor: string;
  badge?: number | string;
  badgeColor?: 'red' | 'amber' | 'blue';
  requiresPermission?: keyof import('../../types').SellerPermissions;
  requiresAnyPermission?: (keyof import('../../types').SellerPermissions)[];
  children?: NavChildItem[];
}

export const Sidebar: React.FC = () => {
  const {
    currentUser,
    activeTab,
    setActiveTab,
    storesSubTab,
    openStoresSubTab,
    sellerColor,
    dbState,
  } = useApp();

  const [isStoresExpanded, setIsStoresExpanded] = useState<boolean>(activeTab === 'stores');

  useEffect(() => {
    if (activeTab === 'stores') {
      setIsStoresExpanded(true);
    }
  }, [activeTab]);

  const isPlatformAdm = isPlatformAdmin(currentUser);
  const isShopAdm = isShopAdmin(currentUser);
  const showAdminMenu = isPlatformAdm || isShopAdm;
  const isSeller = currentUser?.role === 'SELLER';
  const managedShopIds = getShopAdminShopIds(currentUser);
  const assignedShopIds = currentUser?.assignedShopIds || [];
  const scopedShopIds = isPlatformAdm
    ? null
    : isShopAdm
    ? managedShopIds
    : assignedShopIds;
  const managedShops = getAdminManagedShops(currentUser, dbState.shops || []);
  const sellerPermissions = getEffectiveSellerPermissions(currentUser);

  // Check if seller has a specific permission
  const hasPermission = (perm: keyof import('../../types').SellerPermissions): boolean => {
    if (showAdminMenu) return true;
    return !!sellerPermissions[perm];
  };

  // Check if seller has ANY of the given permissions
  const hasAnyPermission = (
    perms: (keyof import('../../types').SellerPermissions)[]
  ): boolean => {
    if (showAdminMenu) return true;
    return perms.some(perm => !!sellerPermissions[perm]);
  };

  // Count low-stock items within user shop scope
  const lowStockCount = (dbState.products || []).filter(
    p =>
      p.status === 'ACTIVE' &&
      p.currentStock <= p.minStock &&
      (!scopedShopIds || scopedShopIds.length === 0 || scopedShopIds.includes(p.shopId))
  ).length;

  // Count unread notifications
  const unreadNotifsCount = NotificationService.getUnreadCount(currentUser);

  // Count pending/overdue debts within user scope
  const debts = DebtService.getAllDebts(currentUser || undefined);
  const overdueDebtsCount = debts.filter(d => d.status === 'OVERDUE').length;

  // Count accessible stores and stock transfers
  const accessibleStoresCount = (dbState.stores || []).filter(
    st => isPlatformAdm || managedShopIds.includes(st.shopId)
  ).length;
  const accessibleTransfersCount = (dbState.stockTransfers || []).filter(
    t => isPlatformAdm || managedShopIds.includes(t.shopId)
  ).length;

  const sellerNav: NavItem[] = [
    { id: 'dashboard', label: 'Home', icon: Home, iconColor: 'text-sky-400' },
    { id: 'new_sale', label: 'Sales (POS)', icon: ShoppingCart, iconColor: 'text-emerald-400' },
    {
      id: 'products',
      label: 'Products and Categories',
      icon: Package,
      iconColor: 'text-violet-400',
      badge: lowStockCount > 0 ? lowStockCount : undefined,
    },
    { id: 'purchases', label: 'Purchases', icon: Truck, iconColor: 'text-orange-400' },
    { id: 'my_sales', label: 'My Sales', icon: History, iconColor: 'text-indigo-400' },
    {
      id: 'debts',
      label: 'Debt Management',
      icon: FileText,
      iconColor: 'text-yellow-400',
      badge:
        overdueDebtsCount > 0
          ? `${overdueDebtsCount} Overdue`
          : debts.filter(d => d.status !== 'PAID').length || undefined,
      badgeColor: overdueDebtsCount > 0 ? 'red' : 'amber',
    },
    {
      id: 'notifications',
      label: 'Notification Center',
      icon: Bell,
      iconColor: 'text-pink-400',
      badge: unreadNotifsCount > 0 ? unreadNotifsCount : undefined,
      badgeColor: 'red',
    },
    { id: 'receipts', label: 'Receipts', icon: Receipt, iconColor: 'text-teal-400' },

    // Permission-gated items
    {
      id: 'sales',
      label: 'Sales Reports',
      icon: History,
      iconColor: 'text-indigo-400',
      requiresAnyPermission: ['canEditSales', 'canDeleteSales'],
    },
    {
      id: 'inventory',
      label: 'Stock & Inventory',
      icon: Boxes,
      iconColor: 'text-teal-400',
      requiresPermission: 'canManageInventory',
    },
    {
      id: 'expenses',
      label: 'Expenses',
      icon: TrendingDown,
      iconColor: 'text-rose-400',
      requiresAnyPermission: ['canViewExpenses', 'canRecordExpenses'],
    },
    {
      id: 'reports',
      label: 'Reports & Analytics',
      icon: BarChart3,
      iconColor: 'text-fuchsia-400',
      requiresPermission: 'canViewReports',
    },
    {
      id: 'shops',
      label: 'Shops and Business Unit',
      icon: Store,
      iconColor: 'text-amber-400',
      requiresPermission: 'canManageShops',
    },
    {
      id: 'sellers',
      label: 'User Management',
      icon: Users,
      iconColor: 'text-blue-400',
      requiresPermission: 'canManageSellers',
    },
    { id: 'settings', label: 'Account Settings', icon: Settings, iconColor: 'text-sky-300' },
  ];

  const adminNav: NavItem[] = [
    { id: 'dashboard', label: 'Home', icon: Home, iconColor: 'text-sky-400' },
    { id: 'new_sale', label: 'Sales (POS)', icon: ShoppingCart, iconColor: 'text-emerald-400' },
    {
      id: 'shops',
      label: 'Shops and Business Unit',
      icon: Store,
      iconColor: 'text-amber-400',
      badge: managedShops.length,
    },
    { id: 'sales', label: 'Sales Reports', icon: History, iconColor: 'text-indigo-400' },
    {
      id: 'products',
      label: 'Products and Categories',
      icon: Package,
      iconColor: 'text-violet-400',
    },
    {
      id: 'stores',
      label: 'Stores and Transfer',
      icon: Car,
      iconColor: 'text-cyan-400',
      badge: accessibleStoresCount || undefined,
      badgeColor: 'blue',
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
      badge: lowStockCount > 0 ? `${lowStockCount} Low` : undefined,
    },
    { id: 'purchases', label: 'Purchases', icon: Truck, iconColor: 'text-orange-400' },
    { id: 'expenses', label: 'Expenses', icon: TrendingDown, iconColor: 'text-rose-400' },
    {
      id: 'debts',
      label: 'Debt Management',
      icon: FileText,
      iconColor: 'text-yellow-400',
      badge: overdueDebtsCount > 0 ? `${overdueDebtsCount} Overdue` : undefined,
      badgeColor: 'red',
    },
    { id: 'reports', label: 'Reports & Analytics', icon: BarChart3, iconColor: 'text-fuchsia-400' },
    { id: 'sellers', label: 'User Management', icon: Users, iconColor: 'text-blue-400' },
    {
      id: 'notifications',
      label: 'Notification Center',
      icon: Bell,
      iconColor: 'text-pink-400',
      badge: unreadNotifsCount > 0 ? unreadNotifsCount : undefined,
      badgeColor: 'red',
    },
    {
      id: 'data_management',
      label: 'Shop Import & Export',
      icon: Database,
      iconColor: 'text-lime-400',
    },
    { id: 'settings', label: 'Account Settings', icon: Settings, iconColor: 'text-sky-300' },
  ];

  // Filter items based on permissions
  const items = (showAdminMenu ? adminNav : sellerNav).filter(item => {
    if (item.requiresPermission) {
      return hasPermission(item.requiresPermission);
    }
    if (item.requiresAnyPermission) {
      return hasAnyPermission(item.requiresAnyPermission);
    }
    return true;
  });

  return (
    <aside
      id="app-sidebar-nav"
      className="hidden lg:flex w-64 bg-slate-900 text-slate-300 border-r border-slate-800 flex-col justify-between shrink-0 select-none overflow-hidden"
    >
      <div className="py-3 flex-1 overflow-y-auto">
        {/* Navigation Category Label */}
        <div className="px-4 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center justify-between">
          <span>
            {isPlatformAdm
              ? 'Admin Control Panel'
              : isShopAdm
              ? 'Shop Admin Panel'
              : 'Seller Terminal'}
          </span>
          {showAdminMenu && <Lock className="w-3 h-3 text-amber-400" />}
        </div>

        {/* Menu Items */}
        <nav className="space-y-1 px-2">
          {items.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            const hasChildren = Boolean(item.children && item.children.length > 0);

            if (hasChildren && item.children) {
              return (
                <div key={item.id} className="space-y-1">
                  <button
                    type="button"
                    id={`nav-${item.id}`}
                    onClick={() => setIsStoresExpanded(prev => !prev)}
                    aria-expanded={isStoresExpanded}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                      isActive
                        ? 'bg-cyan-600/20 text-white border border-cyan-500/35'
                        : isStoresExpanded
                        ? 'bg-slate-800/80 text-white'
                        : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Icon
                        className={`w-4 h-4 shrink-0 ${
                          isActive ? 'text-cyan-300' : item.iconColor
                        }`}
                      />
                      <span className="truncate">{item.label}</span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {item.badge !== undefined && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                          {item.badge}
                        </span>
                      )}
                      <ChevronDown
                        className={`w-3.5 h-3.5 transition-transform duration-300 ease-out ${
                          isStoresExpanded ? 'rotate-180 text-cyan-400' : 'text-slate-500'
                        }`}
                      />
                    </div>
                  </button>

                  {/* Animated Collapsible Submenu */}
                  <div
                    className={`grid transition-all duration-300 ease-out ${
                      isStoresExpanded
                        ? 'grid-rows-[1fr] opacity-100 translate-y-0'
                        : 'grid-rows-[0fr] opacity-0 -translate-y-1 pointer-events-none'
                    }`}
                  >
                    <div className="overflow-hidden">
                      <div className="ml-4 pl-2.5 py-0.5 space-y-0.5 border-l-2 border-cyan-500/30">
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
                              id={`nav-stores-${child.id}`}
                              onClick={() => openStoresSubTab(child.id)}
                              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-all duration-200 ${
                                isChildActive
                                  ? 'bg-blue-600 text-white shadow-sm font-semibold'
                                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60 font-medium'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <ChildIcon
                                  className={`w-3.5 h-3.5 shrink-0 ${
                                    isChildActive ? 'text-white' : child.iconColor
                                  }`}
                                />
                                <span className="truncate">{child.label}</span>
                              </div>
                              {child.badge !== undefined && (
                                <span
                                  className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                                    isChildActive
                                      ? 'bg-white/20 text-white'
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
                id={`nav-${item.id}`}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  isActive
                    ? 'text-white shadow-sm font-semibold'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                }`}
                style={{
                  backgroundColor: isActive
                    ? isSeller
                      ? sellerColor.primary
                      : '#2563eb'
                    : undefined,
                }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Icon
                    className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : item.iconColor}`}
                  />
                  <span className="truncate">{item.label}</span>
                </div>

                {item.badge !== undefined && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold shrink-0 ${
                      isActive
                        ? 'bg-white/20 text-white'
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
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer Info Box */}
      <div className="p-3 border-t border-slate-800 bg-slate-950/40 text-[11px] text-slate-400">
        <div className="flex items-center justify-between mb-1">
          <span className="font-semibold text-slate-300">Local DB Status</span>
          <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            Operational
          </span>
        </div>
        <p className="text-[10px] text-slate-400">
          Transactions stored locally. Safe to operate without internet connection.
        </p>
      </div>
    </aside>
  );
};
