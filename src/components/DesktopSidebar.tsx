import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Building2,
  Package,
  FileSpreadsheet,
  Settings as SettingsIcon,
  RefreshCw,
  Check,
  CircleAlert,
  CloudOff,
  Sun,
  Moon,
  PanelLeft,
  PanelsTopLeft,
} from 'lucide-react';
import type { AppSettings } from '../types';
import { useSyncStatus } from '../lib/syncManager';
import { playPopSound } from '../utils/delight';
import { saveSettings } from '../lib/db';

interface DesktopSidebarProps {
  settings: AppSettings | null;
  performSync: () => Promise<void>;
  isSyncing: boolean;
  desktopMode: 'sidebar' | 'topbar';
  onDesktopModeChange: (mode: 'sidebar' | 'topbar') => void;
}

export default function DesktopSidebar({
  settings,
  performSync,
  isSyncing,
  desktopMode,
  onDesktopModeChange,
}: DesktopSidebarProps) {
  const location = useLocation();
  const sync = useSyncStatus();

  const isSummary = location.pathname === '/';
  const isParties = location.pathname.startsWith('/parties') && !location.pathname.includes('/dispatch');
  const isInventory = location.pathname.startsWith('/inventory');
  const isEntries = location.pathname === '/entries' || location.pathname.includes('/dispatch');
  const isSettings = location.pathname === '/settings';

  const navItems = [
    { to: '/', label: 'Summary', icon: LayoutDashboard, active: isSummary, end: true },
    { to: '/parties', label: 'Parties', icon: Building2, active: isParties },
    { to: '/inventory', label: 'Inventory', icon: Package, active: isInventory },
    { to: '/entries', label: 'All Entries', icon: FileSpreadsheet, active: isEntries },
    { to: '/settings', label: 'Settings', icon: SettingsIcon, active: isSettings },
  ];

  const handleToggleTheme = async () => {
    if (!settings) return;
    const isDark = document.documentElement.classList.contains('dark');
    const newTheme = isDark ? 'light' : 'dark';
    const updated = { ...settings, theme: newTheme as 'light' | 'dark' };
    await saveSettings(updated);
    playPopSound();
  };

  const isDark = document.documentElement.classList.contains('dark') || settings?.theme === 'dark';
  const currentlySyncing = isSyncing || sync.status === 'syncing';

  return (
    <aside className="desktop-sidebar" aria-label="Desktop Navigation">
      {/* ── Brand Header ── */}
      <div className="desktop-sidebar-header">
        <div className="desktop-sidebar-logo">
          <img
            src={settings?.logoUrl?.trim() || '/pwa-icon-192.png'}
            alt={settings?.businessName || 'App Logo'}
            className="desktop-logo-img"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = '/pwa-icon-192.png';
            }}
          />
        </div>
        <div className="desktop-sidebar-titles">
          <div className="desktop-sidebar-title">
            {settings?.businessName || 'Factory Ledger'}
          </div>
        </div>
      </div>

      {/* ── Main Nav Links ── */}
      <div className="desktop-sidebar-nav">
        <div className="desktop-sidebar-section-label">WORKSPACE</div>
        <div className="desktop-sidebar-items">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => playPopSound()}
                className={`desktop-nav-item ${item.active ? 'active' : ''}`}
              >
                <div className="desktop-nav-icon-wrap">
                  <Icon size={18} strokeWidth={item.active ? 2.4 : 1.8} />
                </div>
                <span className="desktop-nav-label">{item.label}</span>
                {item.active && <span className="desktop-nav-indicator" />}
              </NavLink>
            );
          })}
        </div>
      </div>

      {/* ── Cloud Sync Card ── */}
      <div className="desktop-sidebar-sync-card">
        <div className="desktop-sync-status-row">
          <div className="desktop-sync-icon-wrap">
            {currentlySyncing ? (
              <RefreshCw className="desktop-spin" size={15} style={{ color: 'var(--ios-blue)' }} />
            ) : !sync.isOnline ? (
              <CloudOff size={15} style={{ color: 'var(--ios-amber)' }} />
            ) : sync.currentUser ? (
              <Check size={16} strokeWidth={3} style={{ color: 'var(--ios-green)' }} />
            ) : (
              <CircleAlert size={15} style={{ color: 'var(--ios-blue)' }} />
            )}
          </div>
          <div className="desktop-sync-info">
            <div className="desktop-sync-title">
              {currentlySyncing
                ? 'Syncing ledgers…'
                : !sync.isOnline
                  ? 'Offline Mode'
                  : sync.currentUser
                    ? 'Cloud Synced'
                    : 'Local Device'}
            </div>
            <div className="desktop-sync-subtitle" title={sync.currentUser?.email || ''}>
              {currentlySyncing
                ? 'Reconciling changes'
                : !sync.isOnline
                  ? 'Changes saved locally'
                  : sync.currentUser
                    ? sync.currentUser.email || 'Google Account Active'
                    : 'Sign in via Settings'}
            </div>
          </div>
        </div>

        <button
          type="button"
          disabled={currentlySyncing}
          onClick={() => {
            void performSync();
          }}
          className="desktop-sync-btn"
        >
          <RefreshCw
            size={13}
            className={currentlySyncing ? 'desktop-spin' : ''}
            strokeWidth={2.2}
          />
          <span>{currentlySyncing ? 'Syncing…' : 'Sync Now'}</span>
        </button>
      </div>

      {/* ── Footer / Theme & Mode Indicator ── */}
      <div className="desktop-sidebar-footer">
        {/* Quick Theme Toggle Button */}
        <button
          type="button"
          onClick={handleToggleTheme}
          className="desktop-footer-btn"
          title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {isDark ? <Sun size={15} /> : <Moon size={15} />}
          <span>{isDark ? 'Light Mode' : 'Dark Mode'}</span>
        </button>

        {/* Layout Option Toggle Pill */}
        <div className="desktop-layout-toggle-pill w-full justify-center">
          <button
            type="button"
            onClick={() => onDesktopModeChange('sidebar')}
            className={`desktop-toggle-opt ${desktopMode === 'sidebar' ? 'active' : ''}`}
            title="Option A: macOS Sidebar"
          >
            <PanelLeft size={13} />
            <span>Sidebar</span>
          </button>
          <button
            type="button"
            onClick={() => onDesktopModeChange('topbar')}
            className={`desktop-toggle-opt ${desktopMode === 'topbar' ? 'active' : ''}`}
            title="Option B: Top Navigation SaaS"
          >
            <PanelsTopLeft size={13} />
            <span>Top Bar</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
