import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import { syncManager } from './lib/syncManager'

syncManager.init();

if (import.meta.env.DEV) {
  import('./lib/devSeed').then(({ seedTestData, clearAllData }) => {
    (window as any).seedTestData = seedTestData;
    (window as any).clearAllData = clearAllData;
    console.log('[Dev] Tip: Type seedTestData() in console to populate test data, or clearAllData() to reset.');
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)


