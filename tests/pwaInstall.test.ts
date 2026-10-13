import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  getManualInstallPlatform,
  isInstallPromptDeferred,
  isStandaloneWebApp,
} from '../src/utils/pwaInstall';

describe('installable web app configuration', () => {
  it('ships a standalone manifest with required installation icons', () => {
    const manifest = JSON.parse(fs.readFileSync('public/manifest.webmanifest', 'utf8')) as {
      display: string;
      start_url: string;
      icons: Array<{ sizes: string }>;
    };

    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(['192x192', '512x512']);
    expect(manifest.icons.every((icon: any) => icon.purpose === 'any maskable')).toBe(true);
    expect(fs.existsSync('public/sw.js')).toBe(true);
    expect(fs.existsSync('public/pwa-icon-192.png')).toBe(true);
    expect(fs.existsSync('public/pwa-icon-512.png')).toBe(true);

    const vercelConfig = JSON.parse(fs.readFileSync('vercel.json', 'utf8')) as {
      rewrites: Array<{ source: string; destination: string }>;
    };
    expect(vercelConfig.rewrites).toContainEqual({ source: '/(.*)', destination: '/index.html' });
  });

  it('recognizes both standards-based and iOS standalone launches', () => {
    expect(isStandaloneWebApp(true, false)).toBe(true);
    expect(isStandaloneWebApp(false, true)).toBe(true);
    expect(isStandaloneWebApp(false, false)).toBe(false);
  });

  it('provides the correct manual installation guidance', () => {
    expect(getManualInstallPlatform({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1',
      platform: 'iPhone',
      maxTouchPoints: 5,
    })).toBe('ios');

    expect(getManualInstallPlatform({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 0,
    })).toBe('mac-safari');

    expect(getManualInstallPlatform({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/143.0',
      platform: 'Linux x86_64',
      maxTouchPoints: 0,
    })).toBe('desktop-browser');
  });

  it('does not repeatedly show a dismissed prompt for seven days', () => {
    const now = Date.UTC(2026, 9, 13);
    expect(isInstallPromptDeferred(String(now - 6 * 24 * 60 * 60 * 1000), now)).toBe(true);
    expect(isInstallPromptDeferred(String(now - 8 * 24 * 60 * 60 * 1000), now)).toBe(false);
    expect(isInstallPromptDeferred('invalid', now)).toBe(false);
  });
});
