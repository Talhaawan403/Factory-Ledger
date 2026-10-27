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

interface DesktopTopNavProps {
  settings: AppSettings | null;
  performSync: () => Promise<void>;
  isSyncing: boolean;
  desktopMode: 'sidebar' | 'topbar';
  onDesktopModeChange: (mode: 'sidebar' | 'topbar') => void;
}

export default function DesktopTopNav({
  settings,
  performSync,
  isSyncing,
  desktopMode,
  onDesktopModeChange,
}: DesktopTopNavProps) {
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
    <header className="desktop-topbar" aria-label="Desktop Top Navigation">
      <div className="desktop-topbar-inner">
        {/* ── Brand Logo & Title ── */}
        <div className="desktop-topbar-left">
          <div className="desktop-topbar-logo">
            <img
              src={settings?.logoUrl?.trim() || '/pwa-icon-192.png'}
              alt={settings?.businessName || 'App Logo'}
              className="desktop-logo-img"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = '/pwa-icon-192.png';
              }}
            />
          </div>
          <div className="desktop-topbar-brand">
            <span className="desktop-topbar-title">
              {settings?.businessName || 'Factory Ledger'}
            </span>

          </div>
        </div>

        {/* ── Center Navigation Tabs ── */}
        <nav className="desktop-topbar-center" aria-label="Primary Navigation">
          <div className="desktop-topbar-nav-pill-group">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={() => playPopSound()}
                  className={`desktop-topbar-tab ${item.active ? 'active' : ''}`}
                >
                  <Icon size={16} strokeWidth={item.active ? 2.3 : 1.8} />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </div>
        </nav>

        {/* ── Right Actions (Sync, Theme, Layout Switcher) ── */}
        <div className="desktop-topbar-right">
          {/* Cloud Sync Status & Quick Sync Button */}
          <div className="desktop-topbar-sync">
            <div className="desktop-topbar-sync-status">
              {currentlySyncing ? (
                <RefreshCw className="desktop-spin" size={13} style={{ color: 'var(--ios-blue)' }} />
              ) : !sync.isOnline ? (
                <CloudOff size={13} style={{ color: 'var(--ios-amber)' }} />
              ) : sync.currentUser ? (
                <Check size={14} strokeWidth={3} style={{ color: 'var(--ios-green)' }} />
              ) : (
                <CircleAlert size={13} style={{ color: 'var(--ios-blue)' }} />
              )}
              <span className="desktop-topbar-sync-text">
                {currentlySyncing
                  ? 'Syncing…'
                  : !sync.isOnline
                    ? 'Offline'
                    : sync.currentUser
                      ? 'Synced'
                      : 'Local'}
              </span>
            </div>

            <button
              type="button"
              disabled={currentlySyncing}
              onClick={() => {
                void performSync();
              }}
              title="Sync All Ledgers With Cloud"
              className="desktop-topbar-sync-btn"
            >
              <RefreshCw
                size={12}
                className={currentlySyncing ? 'desktop-spin' : ''}
                strokeWidth={2.4}
              />
              <span>Sync</span>
            </button>
          </div>

          {/* Theme Switcher Button */}
          <button
            type="button"
            onClick={handleToggleTheme}
            className="desktop-topbar-icon-btn"
            title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {isDark ? <Sun size={15} /> : <Moon size={15} />}
          </button>

          {/* Layout Mode Switcher (Option A vs Option B) */}
          <div className="desktop-layout-toggle-pill" title="Toggle Desktop Layout Option">
            <button
              type="button"
              onClick={() => onDesktopModeChange('sidebar')}
              className={`desktop-toggle-opt ${desktopMode === 'sidebar' ? 'active' : ''}`}
              title="Option A: Left macOS Sidebar"
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
      </div>
    </header>
  );
}
