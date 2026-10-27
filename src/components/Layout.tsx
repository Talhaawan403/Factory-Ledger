import { useCallback, useEffect, useState, useRef, type CSSProperties } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { getSettings } from '../lib/db';
import type { AppSettings } from '../types';
import { useRefraction } from '../hooks/useRefraction';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { App as CapApp } from '@capacitor/app';
import { playPopSound, playSuccessSound } from '../utils/delight';
import {
  LayoutDashboard,
  Building2,
  Package,
  FileSpreadsheet,
  Settings as SettingsIcon,
  Check,
  RefreshCw,
  CircleAlert
} from 'lucide-react';
import IOSAppLockScreen from './IOSAppLockScreen';
import PWAInstallPrompt from './PWAInstallPrompt';
import DesktopSidebar from './DesktopSidebar';
import DesktopTopNav from './DesktopTopNav';
import { recordActivity, evaluateLockOnResume, purgeRemovedRecoveryKeyArtifacts } from '../utils/securityLock';
import { syncManager } from '../lib/syncManager';
import {
  PULL_TO_SYNC_HOLD_DISTANCE,
  calculatePullToSyncDistance,
  getPullToSyncProgress,
  shouldTriggerPullToSync,
} from '../utils/pullToSync';
import { getWebShellMode } from '../utils/webShell';

const ACCENT_PRESETS = [
  { id: 'blue', label: 'Sapphire', color: '#007AFF', className: '' },
  { id: 'emerald', label: 'Emerald', color: '#10B981', className: 'theme-emerald' },
  { id: 'violet', label: 'Violet', color: '#8B5CF6', className: 'theme-violet' },
  { id: 'amber', label: 'Amber', color: '#F59E0B', className: 'theme-amber' },
  { id: 'crimson', label: 'Ruby', color: '#F43F5E', className: 'theme-crimson' }
];

const GLASS_RADIUS = 28; // single source of truth: used by CSS and by the refraction map
type PullSyncPhase = 'idle' | 'pulling' | 'ready' | 'syncing' | 'success' | 'error';
type ToastTone = 'success' | 'info' | 'error';

export default function Layout() {
  const isNative = Capacitor.isNativePlatform();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [activeAccent] = useState(() => localStorage.getItem('coal_accent_theme') || 'blue');
  const [toastNotice, setToastNotice] = useState<{ message: string; tone: ToastTone } | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [pullPhase, setPullPhase] = useState<PullSyncPhase>('idle');
  const [desktopMode, setDesktopMode] = useState<'sidebar' | 'topbar'>(() => {
    return (localStorage.getItem('desktop_layout_mode') as 'sidebar' | 'topbar') || 'topbar';
  });

  const handleDesktopModeChange = (mode: 'sidebar' | 'topbar') => {
    setDesktopMode(mode);
    localStorage.setItem('desktop_layout_mode', mode);
    playPopSound();
  };
  const liquidGlass = true;
  const navRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<HTMLElement>(null);
  const pullDistanceRef = useRef(0);
  const pullPhaseRef = useRef<PullSyncPhase>('idle');
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pullResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useRefraction(navRef, liquidGlass, {
    radius: GLASS_RADIUS,
    bezel: 14,
    maxShift: 10,
    blur: 6,
    saturate: 1.65,
  });

  const showToast = useCallback((message: string, tone: ToastTone = 'success') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastNotice({ message, tone });
    toastTimerRef.current = setTimeout(() => {
      setToastNotice(null);
      toastTimerRef.current = null;
    }, 2800);
  }, []);

  const updatePullVisual = useCallback((distance: number, phase: PullSyncPhase) => {
    pullDistanceRef.current = distance;
    pullPhaseRef.current = phase;
    setPullDistance(distance);
    setPullPhase(phase);
  }, []);

  const resetPullVisual = useCallback((delayMs = 0) => {
    if (pullResetTimerRef.current) clearTimeout(pullResetTimerRef.current);
    const reset = () => {
      updatePullVisual(0, 'idle');
      pullResetTimerRef.current = null;
    };
    if (delayMs > 0) {
      pullResetTimerRef.current = setTimeout(reset, delayMs);
    } else {
      reset();
    }
  }, [updatePullVisual]);

  const performPullSync = useCallback(async () => {
    const latestState = syncManager.getState();
    if (latestState.status === 'syncing') {
      showToast('A cloud sync is already in progress', 'info');
      resetPullVisual();
      return;
    }
    if (!latestState.currentUser) {
      updatePullVisual(PULL_TO_SYNC_HOLD_DISTANCE, 'error');
      showToast('Sign in with Google from Settings to sync', 'info');
      resetPullVisual(800);
      return;
    }
    if (!latestState.isOnline) {
      updatePullVisual(PULL_TO_SYNC_HOLD_DISTANCE, 'error');
      showToast('You are offline. Changes remain safely on this device.', 'info');
      resetPullVisual(800);
      return;
    }

    if (pullResetTimerRef.current) clearTimeout(pullResetTimerRef.current);
    updatePullVisual(PULL_TO_SYNC_HOLD_DISTANCE, 'syncing');
    playPopSound();

    try {
      await syncManager.reconcileWithCloud(latestState.currentUser.uid);
      const completedState = syncManager.getState();
      if (completedState.status === 'synced') {
        updatePullVisual(PULL_TO_SYNC_HOLD_DISTANCE, 'success');
        playSuccessSound();
        showToast('All ledgers synchronized with Firebase Cloud', 'success');
        resetPullVisual(650);
      } else {
        updatePullVisual(PULL_TO_SYNC_HOLD_DISTANCE, 'error');
        showToast(completedState.lastError || 'Cloud sync could not be completed', 'error');
        resetPullVisual(900);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Cloud sync could not be completed';
      updatePullVisual(PULL_TO_SYNC_HOLD_DISTANCE, 'error');
      showToast(message, 'error');
      resetPullVisual(900);
    }
  }, [resetPullVisual, showToast, updatePullVisual]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    let gesture: { startX: number; startY: number; direction: 'pending' | 'vertical' } | null = null;

    const handleTouchStart = (event: TouchEvent) => {
      if (
        event.touches.length !== 1 ||
        viewport.scrollTop > 0 ||
        pullPhaseRef.current !== 'idle' ||
        document.querySelector('.ios-modal-backdrop')
      ) {
        gesture = null;
        return;
      }

      gesture = {
        startX: event.touches[0].clientX,
        startY: event.touches[0].clientY,
        direction: 'pending',
      };
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!gesture || event.touches.length !== 1) return;

      const deltaX = event.touches[0].clientX - gesture.startX;
      const deltaY = event.touches[0].clientY - gesture.startY;
      if (gesture.direction === 'pending') {
        if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 6) return;
        if (Math.abs(deltaX) > Math.abs(deltaY) || deltaY <= 0) {
          gesture = null;
          resetPullVisual();
          return;
        }
        gesture.direction = 'vertical';
      }

      if (deltaY <= 0 || viewport.scrollTop > 0) {
        gesture = null;
        resetPullVisual();
        return;
      }

      event.preventDefault();
      const distance = calculatePullToSyncDistance(deltaY);
      updatePullVisual(distance, shouldTriggerPullToSync(distance) ? 'ready' : 'pulling');
    };

    const finishGesture = (cancelled: boolean) => {
      if (!gesture) return;
      const shouldSync = !cancelled && shouldTriggerPullToSync(pullDistanceRef.current);
      gesture = null;
      if (shouldSync) {
        void performPullSync();
      } else {
        resetPullVisual();
      }
    };

    const handleTouchEnd = () => finishGesture(false);
    const handleTouchCancel = () => finishGesture(true);

    viewport.addEventListener('touchstart', handleTouchStart, { passive: true });
    viewport.addEventListener('touchmove', handleTouchMove, { passive: false });
    viewport.addEventListener('touchend', handleTouchEnd, { passive: true });
    viewport.addEventListener('touchcancel', handleTouchCancel, { passive: true });

    return () => {
      viewport.removeEventListener('touchstart', handleTouchStart);
      viewport.removeEventListener('touchmove', handleTouchMove);
      viewport.removeEventListener('touchend', handleTouchEnd);
      viewport.removeEventListener('touchcancel', handleTouchCancel);
    };
  }, [performPullSync, resetPullVisual, updatePullVisual]);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    if (pullResetTimerRef.current) clearTimeout(pullResetTimerRef.current);
  }, []);

  const location = useLocation();
  const navigate = useNavigate();
  const pathnameRef = useRef(location.pathname);

  // Keep pathnameRef continuously up to date
  useEffect(() => {
    pathnameRef.current = location.pathname;
  }, [location.pathname]);

  // Handle Android hardware back button
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let lastBackPressTime = 0;

    const listenerPromise = CapApp.addListener('backButton', () => {
      // 1. If any modal sheet / backdrop is open, dismiss the top-most modal
      const backdrops = document.querySelectorAll<HTMLElement>('.ios-modal-backdrop');
      if (backdrops.length > 0) {
        const topBackdrop = backdrops[backdrops.length - 1];
        topBackdrop.click();
        return;
      }

      const currentPath = pathnameRef.current;

      // 2. If inside a nested dispatch form (/parties/:partyId/dispatch/:dispatchId)
      if (currentPath.includes('/dispatch/')) {
        const parentPartyPath = currentPath.split('/dispatch/')[0];
        navigate(parentPartyPath);
        return;
      }

      // 3. If inside a party ledger (/parties/:partyId)
      if (currentPath.startsWith('/parties/') && currentPath !== '/parties') {
        navigate('/parties');
        return;
      }

      // If inside a mine ledger (/inventory/:mineId)
      if (currentPath.startsWith('/inventory/') && currentPath !== '/inventory') {
        navigate('/inventory');
        return;
      }

      // 4. If on a secondary tab (/parties, /inventory, /entries, /settings)
      if (currentPath !== '/') {
        navigate('/');
        return;
      }

      // 5. At root home summary ('/') - require double press within 2s to exit
      const now = Date.now();
      if (now - lastBackPressTime < 2000) {
        CapApp.exitApp();
      } else {
        lastBackPressTime = now;
        showToast('Press back again to exit', 'info');
      }
    });

    return () => {
      listenerPromise.then(handle => handle.remove()).catch(() => { });
    };
  }, [navigate, showToast]);

  // Load settings & sync with updates
  useEffect(() => {
    getSettings().then(setSettings);

    const onSettingsChanged = (e: Event) => {
      const customEvent = e as CustomEvent<AppSettings>;
      if (customEvent.detail) {
        setSettings(customEvent.detail);
      } else {
        getSettings().then(setSettings);
      }
    };

    window.addEventListener('app_settings_changed', onSettingsChanged);
    return () => {
      window.removeEventListener('app_settings_changed', onSettingsChanged);
    };
  }, [location.pathname]);

  // Security Lock & Biometrics Lifecycle Management
  useEffect(() => {
    purgeRemovedRecoveryKeyArtifacts();
    evaluateLockOnResume();

    const handleTouchOrKey = (e?: Event) => {
      recordActivity();
      if (e instanceof KeyboardEvent && e.key === 'Escape') {
        const backdrops = document.querySelectorAll<HTMLElement>('.ios-modal-backdrop');
        if (backdrops.length > 0) {
          const topBackdrop = backdrops[backdrops.length - 1];
          topBackdrop.click();
        }
      }
    };
    window.addEventListener('touchstart', handleTouchOrKey, { passive: true });
    window.addEventListener('mousedown', handleTouchOrKey, { passive: true });
    window.addEventListener('keydown', handleTouchOrKey, { passive: true });

    const handleVisibility = () => {
      if (document.hidden) {
        recordActivity();
      } else {
        evaluateLockOnResume();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    let appStateHandle: any = null;
    let appUrlHandle: any = null;
    if (Capacitor.isNativePlatform()) {
      CapApp.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) {
          recordActivity();
        } else {
          evaluateLockOnResume();
        }
      }).then(handle => {
        appStateHandle = handle;
      });

      CapApp.addListener('appUrlOpen', async (data) => {
        if (import.meta.env.DEV && data.url && (data.url.includes('seed') || data.url.includes('devSeed'))) {
          if (typeof (window as any).seedTestData === 'function') {
            await (window as any).seedTestData({ reload: true, clearBeforeSeed: true });
          }
        }
      }).then(handle => {
        appUrlHandle = handle;
      });
    }

    return () => {
      window.removeEventListener('touchstart', handleTouchOrKey);
      window.removeEventListener('mousedown', handleTouchOrKey);
      window.removeEventListener('keydown', handleTouchOrKey);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (appStateHandle) appStateHandle.remove();
      if (appUrlHandle) appUrlHandle.remove();
    };
  }, []);

  // Apply theme accent class to root
  useEffect(() => {
    ACCENT_PRESETS.forEach(p => {
      if (p.className) document.documentElement.classList.remove(p.className);
    });
    const match = ACCENT_PRESETS.find(p => p.id === activeAccent);
    if (match?.className) {
      document.documentElement.classList.add(match.className);
    }
  }, [activeAccent]);

  // Handle dark mode class and native status bar styling with system theme support
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = () => {
      const mode = settings?.theme || 'light';
      const isDark = mode === 'system' ? mediaQuery.matches : mode === 'dark';
      if (isDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }

      if (Capacitor.isNativePlatform()) {
        StatusBar.show().catch(() => {});
        StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
        StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light }).catch(() => {});
      }
    };

    applyTheme();

    const handleMediaChange = () => {
      if (settings?.theme === 'system') {
        applyTheme();
      }
    };

    mediaQuery.addEventListener('change', handleMediaChange);

    return () => {
      mediaQuery.removeEventListener('change', handleMediaChange);
    };
  }, [settings?.theme]);

  // Active 5-Tab detection
  const isSummary = location.pathname === '/';
  const isParties = location.pathname.startsWith('/parties') && !location.pathname.includes('/dispatch');
  const isInventory = location.pathname.startsWith('/inventory');
  const isEntries = location.pathname === '/entries' || location.pathname.includes('/dispatch');
  const isSettings = location.pathname === '/settings';
  const activeTabIndex = isSummary ? 0 : isParties ? 1 : isInventory ? 2 : isEntries ? 3 : 4;
  const pullProgress = getPullToSyncProgress(pullDistance);
  const pullLabel = pullPhase === 'ready'
    ? 'Release to sync'
    : pullPhase === 'syncing'
      ? 'Syncing ledgers…'
      : pullPhase === 'success'
        ? 'Synced'
        : pullPhase === 'error'
          ? 'Sync unavailable'
          : 'Pull to sync';
  const shellMode = getWebShellMode(isNative);

  return (
    <div className={`device-stage ${shellMode.isEdgeToEdge ? 'fullscreen-mode' : ''} desktop-mode-${desktopMode}`}>
      {!isNative && desktopMode === 'sidebar' && (
        <DesktopSidebar
          settings={settings}
          performSync={performPullSync}
          isSyncing={pullPhase === 'syncing'}
          desktopMode={desktopMode}
          onDesktopModeChange={handleDesktopModeChange}
        />
      )}
      <div className={`iphone-frame ${shellMode.isEdgeToEdge ? 'fullscreen-mode' : ''}`}>
        {!isNative && desktopMode === 'topbar' && (
          <DesktopTopNav
            settings={settings}
            performSync={performPullSync}
            isSyncing={pullPhase === 'syncing'}
            desktopMode={desktopMode}
            onDesktopModeChange={handleDesktopModeChange}
          />
        )}


        {/* ── Toast Notification (Issue 28f: Full screen mobile width + centered) ── */}
        {toastNotice && (
          <div className={`ios-toast-banner is-${toastNotice.tone}`} role="status">
            {toastNotice.tone === 'error' ? (
              <CircleAlert style={{ width: 17, height: 17, color: 'var(--ios-red)' }} strokeWidth={2.5} />
            ) : toastNotice.tone === 'info' ? (
              <RefreshCw style={{ width: 16, height: 16, color: 'var(--ios-blue)' }} strokeWidth={2.5} />
            ) : (
              <Check style={{ width: 16, height: 16, color: 'var(--ios-green)' }} strokeWidth={3} />
            )}
            <span>{toastNotice.message}</span>
          </div>
        )}

        {/* ── Main Scrollable iOS Viewport ── */}
        <main
          ref={viewportRef}
          className={`ios-viewport pb-32 pull-sync-${pullPhase}`}
          style={{
            '--pull-sync-offset': `${pullDistance}px`,
            '--pull-sync-progress': pullProgress,
          } as CSSProperties}
        >
          <div
            className={`ios-pull-sync-indicator is-${pullPhase}`}
            role="status"
            aria-live="polite"
            aria-hidden={pullPhase === 'idle'}
          >
            <span className="ios-pull-sync-icon" aria-hidden="true">
              {pullPhase === 'success' ? (
                <Check strokeWidth={2.8} />
              ) : pullPhase === 'error' ? (
                <CircleAlert strokeWidth={2.4} />
              ) : (
                <RefreshCw strokeWidth={2.4} />
              )}
            </span>
            <span>{pullLabel}</span>
          </div>
          <div className="ios-pull-sync-content">
            <div className="ios-status-bar-spacer" aria-hidden="true" />
            <div className="desktop-canvas">
              <Outlet context={{ settings }} />
            </div>
          </div>
        </main>

        {/* ── Apple iOS Liquid Glass Bottom Tab Bar ── */}
        <nav
          ref={navRef}
          aria-label="Main Navigation"
          className={`ios-tabbar${liquidGlass ? ' glass' : ''}`}
          style={{
            '--glass-radius': `${GLASS_RADIUS}px`,
            '--active-tab-shift': `${activeTabIndex * 100}%`,
          } as CSSProperties}
        >
          <span className="ios-tab-liquid-selection" aria-hidden="true" />
          {/* Tab 1: Summary */}
          <NavLink
            to="/"
            onClick={() => playPopSound()}
            className={`ios-tab-item ${isSummary ? 'active' : ''}`}
            end
          >
            <div className="ios-tab-pill">
              <LayoutDashboard
                className="ios-tab-icon"
                strokeWidth={isSummary ? 2.4 : 1.7}
              />
            </div>
            <span className="ios-tab-label">Summary</span>
          </NavLink>

          {/* Tab 2: Parties */}
          <NavLink
            to="/parties"
            onClick={() => playPopSound()}
            className={`ios-tab-item ${isParties ? 'active' : ''}`}
          >
            <div className="ios-tab-pill">
              <Building2
                className="ios-tab-icon"
                strokeWidth={isParties ? 2.4 : 1.7}
              />
            </div>
            <span className="ios-tab-label">Parties</span>
          </NavLink>

          {/* Tab 3: Inventory */}
          <NavLink
            to="/inventory"
            onClick={() => playPopSound()}
            className={`ios-tab-item ${isInventory ? 'active' : ''}`}
          >
            <div className="ios-tab-pill">
              <Package
                className="ios-tab-icon"
                strokeWidth={isInventory ? 2.4 : 1.7}
              />
            </div>
            <span className="ios-tab-label">Inventory</span>
          </NavLink>

          {/* Tab 4: All Entries */}
          <NavLink
            to="/entries"
            onClick={() => playPopSound()}
            className={`ios-tab-item ${isEntries ? 'active' : ''}`}
          >
            <div className="ios-tab-pill">
              <FileSpreadsheet
                className="ios-tab-icon"
                strokeWidth={isEntries ? 2.4 : 1.7}
              />
            </div>
            <span className="ios-tab-label">All Entries</span>
          </NavLink>

          {/* Tab 4: Settings */}
          <NavLink
            to="/settings"
            onClick={() => playPopSound()}
            className={`ios-tab-item ${isSettings ? 'active' : ''}`}
          >
            <div className="ios-tab-pill">
              <SettingsIcon
                className="ios-tab-icon"
                strokeWidth={isSettings ? 2.4 : 1.7}
              />
            </div>
            <span className="ios-tab-label">Settings</span>
          </NavLink>
        </nav>

        {/* Global Security Passcode & Biometric Lock Screen */}
        <IOSAppLockScreen />

        {/* Web-only installation guidance; hidden in Capacitor and standalone mode. */}
        <PWAInstallPrompt />
      </div>
    </div>
  );
}
