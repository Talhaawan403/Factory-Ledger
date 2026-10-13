import { useEffect, useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Download, MoreVertical, Share, SquarePlus, X } from 'lucide-react';
import {
  getManualInstallPlatform,
  isStandaloneWebApp,
  type ManualInstallPlatform,
} from '../utils/pwaInstall';

const SESSION_DISMISSED_KEY = 'factory_ledger_install_dismissed_session';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms?: Array<string>;
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [showManualGuide, setShowManualGuide] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  const manualPlatform = useMemo<ManualInstallPlatform>(() => getManualInstallPlatform({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  }), []);

  useEffect(() => {
    // Native app via Capacitor already runs as standalone APK/IPA
    if (Capacitor.isNativePlatform()) return;

    // Detect if already installed/running in standalone display mode
    const nav = navigator as Navigator & { standalone?: boolean };
    const alreadyInstalled = isStandaloneWebApp(
      window.matchMedia('(display-mode: standalone)').matches,
      nav.standalone === true,
    );
    if (alreadyInstalled) return;

    // Check if dismissed in this browser session
    const isSessionDismissed = sessionStorage.getItem(SESSION_DISMISSED_KEY) === 'true';

    // Handle standard browser install prompt event (Android Chrome, Edge, PC Chrome on HTTPS/localhost)
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      if (!isSessionDismissed) {
        setIsVisible(true);
      }
    };

    // When app gets installed
    const handleInstalled = () => {
      setDeferredPrompt(null);
      setIsVisible(false);
      setShowManualGuide(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);

    // On mobile devices or browsers where beforeinstallprompt may not fire immediately
    // (such as iOS Safari, or local dev HTTP testing), display the banner after a gentle delay.
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (!isSessionDismissed) {
      timer = setTimeout(() => {
        setIsVisible(true);
      }, 1200);
    }

    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const handleDismiss = () => {
    try {
      sessionStorage.setItem(SESSION_DISMISSED_KEY, 'true');
    } catch {
      // Graceful fallback
    }
    setIsVisible(false);
    setShowManualGuide(false);
  };

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      setIsInstalling(true);
      try {
        await deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          setIsVisible(false);
        }
        setDeferredPrompt(null);
      } finally {
        setIsInstalling(false);
      }
      return;
    }

    // If native prompt is not available (iOS Safari, or local HTTP dev), show step-by-step instructions
    setShowManualGuide(true);
  };

  if (!isVisible) return null;

  const isIOS = manualPlatform === 'ios';

  return (
    <>
      <aside
        className="pwa-install-banner animate-slide-up"
        role="region"
        aria-label="Add to Home Screen"
      >
        <div className="pwa-install-banner-left">
          <div className="pwa-install-banner-icon" aria-hidden="true">
            <Download size={22} strokeWidth={2.4} />
          </div>
          <div className="pwa-install-banner-text">
            <div className="pwa-install-banner-title">Add to Home Screen</div>
            <div className="pwa-install-banner-subtitle">Install app for full-screen &amp; offline access</div>
          </div>
        </div>

        <div className="pwa-install-banner-actions">
          <button
            type="button"
            className="pwa-install-btn-dismiss"
            onClick={handleDismiss}
            aria-label="Dismiss installation prompt"
          >
            <X size={18} strokeWidth={2.2} />
          </button>
          <button
            type="button"
            className="pwa-install-btn-primary"
            onClick={() => void handleInstallClick()}
            disabled={isInstalling}
          >
            {isInstalling ? 'Installing…' : 'Install'}
          </button>
        </div>
      </aside>

      {showManualGuide && (
        <div className="ios-modal-backdrop pwa-install-backdrop" role="presentation" onClick={handleDismiss}>
          <section
            className="ios-bottom-sheet pwa-install-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pwa-guide-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ios-sheet-handle" />
            <div className="pwa-install-header">
              <img src="/pwa-icon-192.png" alt="" className="pwa-install-app-icon" />
              <button
                type="button"
                className="pwa-install-close"
                onClick={handleDismiss}
                aria-label="Close"
              >
                <X size={18} strokeWidth={2.4} />
              </button>
            </div>

            <div className="pwa-install-content">
              <h2 id="pwa-guide-title">Install Factory Ledger</h2>
              <p>Install this web app to your Home Screen to launch in full screen without the browser address bar.</p>

              <ol className="pwa-install-steps">
                {isIOS ? (
                  <>
                    <li>
                      <span><Share size={19} /></span>
                      <div>Tap the <strong>Share</strong> button in the Safari toolbar.</div>
                    </li>
                    <li>
                      <span><SquarePlus size={19} /></span>
                      <div>Select <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.</div>
                    </li>
                  </>
                ) : (
                  <>
                    <li>
                      <span><MoreVertical size={19} /></span>
                      <div>Tap the <strong>three dots</strong> menu in your browser&apos;s top-right corner.</div>
                    </li>
                    <li>
                      <span><Download size={19} /></span>
                      <div>Select <strong>Install app</strong> (or <strong>Add to Home screen</strong>).</div>
                    </li>
                  </>
                )}
              </ol>

              <div className="pwa-install-note">
                Tip: On production HTTPS domains (such as Vercel), your mobile browser will trigger the 1-tap installation dialog automatically.
              </div>

              <button
                type="button"
                className="pwa-install-primary"
                onClick={handleDismiss}
              >
                Got It
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
