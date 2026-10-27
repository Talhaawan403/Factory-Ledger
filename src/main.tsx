import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import { syncManager } from './lib/syncManager'

import { registerSW } from 'virtual:pwa-register'

syncManager.init();
registerSW({ immediate: true });


// Expose test data seeding for ADB, DevTools, and CLI
(window as any).seedTestData = async (options?: { reload?: boolean; clearBeforeSeed?: boolean }) => {
  const { seedTestData } = await import('./lib/devSeed');
  return seedTestData(options);
};
(window as any).clearAllData = async (options?: { reload?: boolean }) => {
  const { clearAllData } = await import('./lib/devSeed');
  return clearAllData(options);
};

// Check if devSeed was requested via URL query or pending intent flag
if (
  (typeof window !== 'undefined' && window.location.search.includes('devSeed=true')) ||
  (window as any).__pendingDevSeed
) {
  delete (window as any).__pendingDevSeed;
  (window as any).seedTestData({ reload: true, clearBeforeSeed: true });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

