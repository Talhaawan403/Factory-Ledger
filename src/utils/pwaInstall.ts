export type ManualInstallPlatform = 'ios' | 'mac-safari' | 'mobile-browser' | 'desktop-browser';

export interface NavigatorInstallInfo {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  standalone?: boolean;
}

export function isStandaloneWebApp(
  displayModeStandalone: boolean,
  navigatorStandalone = false,
): boolean {
  return displayModeStandalone || navigatorStandalone;
}

export function getManualInstallPlatform(info: NavigatorInstallInfo): ManualInstallPlatform {
  const userAgent = info.userAgent || '';
  const platform = info.platform || '';
  const isIPadDesktopMode = platform === 'MacIntel' && (info.maxTouchPoints || 0) > 1;
  const isIOS = /iPad|iPhone|iPod/i.test(userAgent) || isIPadDesktopMode;
  if (isIOS) return 'ios';

  const isMac = /Macintosh|Mac OS X/i.test(userAgent) || platform.startsWith('Mac');
  const isSafari = /Safari/i.test(userAgent) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/i.test(userAgent);
  if (isMac && isSafari) return 'mac-safari';

  const isMobile = /Android|Mobile|Tablet/i.test(userAgent) || (info.maxTouchPoints || 0) > 1;
  return isMobile ? 'mobile-browser' : 'desktop-browser';
}

export function isInstallPromptDeferred(dismissedAt: string | null, now = Date.now()): boolean {
  if (!dismissedAt) return false;
  const timestamp = Number(dismissedAt);
  if (!Number.isFinite(timestamp)) return false;
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  return now - timestamp < sevenDays;
}
