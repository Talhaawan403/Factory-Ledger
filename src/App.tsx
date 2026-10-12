import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';

const Summary = lazy(() => import('./pages/Summary'));
const PartiesList = lazy(() => import('./pages/PartiesList'));
const PartyLedger = lazy(() => import('./pages/PartyLedger'));
const DispatchForm = lazy(() => import('./pages/DispatchForm'));
const AllEntries = lazy(() => import('./pages/AllEntries'));
const Inventory = lazy(() => import('./pages/Inventory'));
const MineLedger = lazy(() => import('./pages/MineLedger'));
const Settings = lazy(() => import('./pages/Settings'));
const NotFound = lazy(() => import('./pages/NotFound'));

function RouteLoadingFallback() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '50vh', color: 'var(--label-secondary)', fontSize: 14 }}>
      Loading…
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteLoadingFallback />}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Summary />} />
            <Route path="parties" element={<PartiesList />} />
            <Route path="parties/:partyId" element={<PartyLedger />} />
            <Route path="parties/:partyId/dispatch/:dispatchId" element={<DispatchForm />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="inventory/:mineId" element={<MineLedger />} />
            <Route path="entries" element={<AllEntries />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
