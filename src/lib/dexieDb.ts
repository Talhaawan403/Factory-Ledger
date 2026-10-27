import Dexie, { type Table } from 'dexie';
import type { Dispatch, Party, Payment, PurchaseOrder, InventoryLot, Mine, GeneralExpense } from '../types';

export interface ImageRecord {
  key: string;
  dataUrl: string;
  updatedAt: number;
}

export interface MetaRecord {
  key: string;
  value: any;
  updatedAt: number;
}

export interface SyncConflictRecord {
  id: string;
  collection: string;
  entityId: string;
  localUpdatedAt: number;
  cloudUpdatedAt: number;
  winner: 'cloud' | 'local';
  timestamp: number;
  losingSnapshot: unknown;
  winningSnapshot: unknown;
  conflictType: 'update-vs-update' | 'delete-vs-edit' | 'equal-timestamp';
}

export class FactoryLedgerDB extends Dexie {
  parties!: Table<Party, string>;
  dispatches!: Table<Dispatch, string>;
  payments!: Table<Payment, string>;
  expenses!: Table<GeneralExpense, string>;
  pos!: Table<PurchaseOrder, string>;
  mines!: Table<Mine, string>;
  lots!: Table<InventoryLot, string>;
  images!: Table<ImageRecord, string>;
  meta!: Table<MetaRecord, string>;
  conflicts!: Table<SyncConflictRecord, string>;

  constructor() {
    super('FactoryLedgerDB');
    this.version(1).stores({
      parties: 'id, name, updatedAt, isArchived, deleted',
      dispatches: 'id, partyId, date, updatedAt, dirty, deleted',
      payments: 'id, partyId, date, updatedAt, dirty, deleted',
      pos: 'id, partyId, updatedAt, dirty, deleted',
      images: 'key',
      meta: 'key',
    });
    this.version(2).stores({
      lots: 'id, supplier, date, updatedAt, dirty, deleted',
    });
    this.version(3).stores({
      mines: 'id, name, updatedAt, dirty, deleted',
      lots: 'id, mineId, supplier, date, updatedAt, dirty, deleted',
    });
    this.version(4).stores({
      expenses: 'id, date, category, updatedAt, dirty, deleted',
    });
    this.version(5).stores({
      conflicts: 'id, collection, entityId, timestamp, winner, conflictType',
    });

    // Auto-Sanitizer Hook: Block NaN, Infinity, and non-numeric corruption across all entity tables
    const entityTables: Table<any, any>[] = [
      this.parties,
      this.dispatches,
      this.payments,
      this.expenses,
      this.pos,
      this.mines,
      this.lots,
    ];

    entityTables.forEach((table) => {
      table.hook('creating', (_primKey, obj) => {
        const sanitized = deepSanitizeNumbers(obj);
        Object.assign(obj, sanitized);
      });
      table.hook('updating', (modifications) => {
        return deepSanitizeNumbers(modifications);
      });
    });
  }
}

/**
 * Recursively scans and sanitizes all numbers in an object:
 * Replaces NaN, Infinity, -Infinity, and numeric-looking strings ('NaN', 'Infinity')
 * with 0, ensuring corrupt numbers can NEVER enter IndexedDB.
 */
export function deepSanitizeNumbers<T>(val: T): T {
  if (typeof val === 'number') {
    return (isNaN(val) || !isFinite(val) ? 0 : val) as unknown as T;
  }
  if (typeof val === 'string') {
    const lower = val.trim().toLowerCase();
    if (lower === 'nan' || lower === 'infinity' || lower === '-infinity') {
      return 0 as unknown as T;
    }
    return val;
  }
  if (!val || typeof val !== 'object') {
    return val;
  }
  if (Array.isArray(val)) {
    return val.map((item) => deepSanitizeNumbers(item)) as unknown as T;
  }
  const result: Record<string, any> = {};
  for (const k of Object.keys(val)) {
    result[k] = deepSanitizeNumbers((val as Record<string, any>)[k]);
  }
  return result as T;
}

export const idb = new FactoryLedgerDB();

// Persistent-storage permission is an optional resilience enhancement. It must
// never prevent the ledger itself from opening if a browser or WebView leaves
// the permission request pending.
const PERSISTENCE_REQUEST_TIMEOUT_MS = 3_000;

/**
 * Request persistent browser/device storage to prevent eviction under OS disk pressure.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const persistenceRequest = navigator.storage.persist();
      const timeout = new Promise<boolean>((resolve) => {
        timeoutId = setTimeout(() => resolve(false), PERSISTENCE_REQUEST_TIMEOUT_MS);
      });
      const persisted = await Promise.race([persistenceRequest, timeout]);
      console.log(`[Storage] Persistent storage granted: ${persisted}`);
      return persisted;
    } catch (err) {
      console.warn('[Storage] Could not request persistent storage:', err);
      return false;
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }
  return false;
}
