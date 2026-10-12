import { useEffect, useRef } from 'react';
import type { LedgerMutationDetail } from '../lib/db';

/**
 * Re-fetch data whenever any local change or cloud sync restore event occurs
 */
export function useLedgerListener(callback: (detail?: LedgerMutationDetail) => void) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<LedgerMutationDetail>).detail;
      savedCallback.current(detail);
    };

    window.addEventListener('ledger_data_changed', handler);
    return () => {
      window.removeEventListener('ledger_data_changed', handler);
    };
  }, []);
}
