import React from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  History,
  Menu,
  Boxes,
  Palette,
  TrendingDown,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { getShopAdminShopIds, hasAdminAccess, isPlatformAdmin, isShopAdmin } from '../../utils/permissions';

interface MobileBottomNavProps {
  onOpenMenu: () => void;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({ onOpenMenu }) => {
  const { currentUser, activeTab, setActiveTab, openExpensesSubTab, sellerColor, dbState } = useApp();

  if (!currentUser) return null;

  const isSeller = !hasAdminAccess(currentUser);
  const isSellerRole = currentUser.role === 'SELLER';
  const sellerCanAddExpenses = Boolean(currentUser.permissions?.canRecordExpenses);

  // Regular Seller: show POS, Expenses (only when granted), Color Settings, and Menu
  if (isSeller) {
    return (
      <nav
        id="mobile-bottom-navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-900/95 backdrop-blur-md border-t border-slate-800 safe-bottom px-3 py-1 select-none shadow-2xl"
      >
        <div className="flex items-center justify-around">
          <button
            id="mobile-pos-center-btn"
            onClick={() => setActiveTab('new_sale')}
            className={`flex-1 flex flex-col items-center justify-center py-1.5 px-2 rounded-xl font-medium transition ${
              activeTab === 'new_sale'
                ? 'text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            style={activeTab === 'new_sale' ? { color: sellerColor.primary } : undefined}
          >
            <ShoppingCart
              className={`w-5 h-5 mb-1 ${activeTab === 'new_sale' ? 'scale-110' : ''} transition-transform`}
            />
            <span className="text-[10px] font-semibold tracking-tight leading-none">POS</span>
          </button>

          {sellerCanAddExpenses && (
            <button
              id="mobile-seller-expenses-btn"
              onClick={() => openExpensesSubTab('add')}
              className={`flex-1 flex flex-col items-center justify-center py-1.5 px-2 rounded-xl font-medium transition ${
                activeTab === 'expenses'
                  ? 'text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              style={activeTab === 'expenses' ? { color: sellerColor.primary } : undefined}
            >
              <TrendingDown
                className={`w-5 h-5 mb-1 ${activeTab === 'expenses' ? 'scale-110' : ''} transition-transform`}
              />
              <span className="text-[10px] font-semibold tracking-tight leading-none">Expenses</span>
            </button>
          )}

          <button
            id="mobile-seller-settings-btn"
            onClick={() => setActiveTab('settings')}
            className={`flex-1 flex flex-col items-center justify-center py-1.5 px-2 rounded-xl font-medium transition ${
              activeTab === 'settings'
                ? 'text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
            style={activeTab === 'settings' ? { color: sellerColor.primary } : undefined}
          >
            <Palette
              className={`w-5 h-5 mb-1 ${activeTab === 'settings' ? 'scale-110' : ''} transition-transform`}
            />
            <span className="text-[10px] font-semibold tracking-tight leading-none">Settings</span>
          </button>

          <button
            id="mobile-more-menu-btn"
            onClick={onOpenMenu}
            className="flex-1 flex flex-col items-center justify-center py-1.5 px-2 rounded-xl font-medium transition text-slate-400 hover:text-slate-200"
          >
            <Menu className="w-5 h-5 mb-1" />
            <span className="text-[10px] tracking-tight leading-none">Menu</span>
          </button>
        </div>
      </nav>
    );
  }

  const scopedShopIds = isPlatformAdmin(currentUser)
    ? null
    : isShopAdmin(currentUser)
    ? getShopAdminShopIds(currentUser)
    : currentUser.assignedShopIds || [];

  // Count low-stock items within accessible shops
  const lowStockCount = (dbState.products || []).filter(
    p =>
      p.status === 'ACTIVE' &&
      p.currentStock <= p.minStock &&
      (!scopedShopIds || scopedShopIds.length === 0 || scopedShopIds.includes(p.shopId))
  ).length;

  const isMoreActive = [
    'shops',
    'stores',
    'sellers',
    'purchases',
    'expenses',
    'reports',
    'debts',
    'notifications',
    'data_management',
    'settings',
  ].includes(activeTab);

  return (
    <nav
      id="mobile-bottom-navigation"
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-900/95 backdrop-blur-md border-t border-slate-800 safe-bottom px-2 py-1 select-none shadow-2xl"
    >
      <div className="flex items-center justify-around">
        {/* Tab 1: Dashboard */}
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`flex-1 flex flex-col items-center justify-center py-1.5 px-1 rounded-xl font-medium transition ${
            activeTab === 'dashboard'
              ? 'text-blue-400'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <LayoutDashboard className={`w-5 h-5 mb-1 ${activeTab === 'dashboard' ? 'scale-110' : ''} transition-transform`} />
          <span className="text-[10px] tracking-tight leading-none">Home</span>
        </button>

        {/* Tab 2: Sales */}
        <button
          onClick={() => setActiveTab('sales')}
          className={`flex-1 flex flex-col items-center justify-center py-1.5 px-1 rounded-xl font-medium transition ${
            activeTab === 'sales'
              ? 'text-blue-400'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <History className={`w-5 h-5 mb-1 ${activeTab === 'sales' ? 'scale-110' : ''} transition-transform`} />
          <span className="text-[10px] tracking-tight leading-none">Sales</span>
        </button>

        {/* Tab 3: CENTER POS ACTION BUTTON (Elevated) */}
        <div className="flex-1 flex items-center justify-center px-1 -mt-4">
          <button
            id="mobile-pos-center-btn"
            onClick={() => setActiveTab('new_sale')}
            className={`w-13 h-13 rounded-full flex flex-col items-center justify-center text-white shadow-xl shadow-blue-500/25 ring-4 ring-slate-950 transition-all active:scale-95 ${
              activeTab === 'new_sale' ? 'scale-105 ring-blue-500/40' : ''
            }`}
            style={{
              backgroundColor: isSellerRole ? sellerColor.primary : '#2563eb',
            }}
          >
            <ShoppingCart className="w-6 h-6" />
            <span className="text-[9px] font-bold uppercase tracking-tighter mt-0.5">POS</span>
          </button>
        </div>

        {/* Tab 4: Stock */}
        <button
          onClick={() => setActiveTab('products')}
          className={`flex-1 relative flex flex-col items-center justify-center py-1.5 px-1 rounded-xl font-medium transition ${
            ['products', 'inventory'].includes(activeTab)
              ? 'text-blue-400'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <div className="relative">
            <Boxes className={`w-5 h-5 mb-1 ${['products', 'inventory'].includes(activeTab) ? 'scale-110' : ''} transition-transform`} />
            {lowStockCount > 0 && (
              <span className="absolute -top-1 -right-2 w-2 h-2 rounded-full bg-amber-500 ring-2 ring-slate-900" />
            )}
          </div>
          <span className="text-[10px] tracking-tight leading-none">Stock</span>
        </button>

        {/* Tab 5: More (Menu Drawer trigger) */}
        <button
          id="mobile-more-menu-btn"
          onClick={onOpenMenu}
          className={`flex-1 flex flex-col items-center justify-center py-1.5 px-1 rounded-xl font-medium transition ${
            isMoreActive
              ? 'text-blue-400'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Menu className="w-5 h-5 mb-1" />
          <span className="text-[10px] tracking-tight leading-none">Menu</span>
        </button>
      </div>
    </nav>
  );
};
