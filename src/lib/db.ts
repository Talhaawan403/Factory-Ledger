import type { Dispatch, Party, AppSettings, Payment, PurchaseOrder, BackupPayload, InventoryLot, Mine, GeneralExpense, GeneralExpenseCategory } from "../types";
import { getTodayDateString } from "../utils/dateUtils";
import { idb, requestPersistentStorage, type SyncConflictRecord } from "./dexieDb";
import { v4 as uuidv4 } from 'uuid';

const SETTINGS_KEY = "app_settings";
const DATA_VERSION_KEY = "coal_ledger_version";
const CURRENT_DATA_VERSION = "2026.10_books_v3";
const TOMBSTONES_KEY = "ledger_tombstones";
const OWNER_UID_KEY = "coal_ledger_owner_uid";
const OWNER_EMAIL_KEY = "coal_ledger_owner_email";

// Legacy localStorage keys used for migration only
const LEGACY_DISPATCHES_KEY = "dispatches";
const LEGACY_PARTIES_KEY = "parties";
const LEGACY_PAYMENTS_KEY = "payments";
const LEGACY_POS_KEY = "purchase_orders";

// Initial empty datasets for production
export const INITIAL_PARTIES: Party[] = [];
export const INITIAL_POS: PurchaseOrder[] = [];
export const INITIAL_DISPATCHES: Dispatch[] = [];
export const INITIAL_PAYMENTS: Payment[] = [];
export const INITIAL_EXPENSES: GeneralExpense[] = [];
export const INITIAL_LOTS: InventoryLot[] = [];
export const INITIAL_MINES: Mine[] = [];

export const INITIAL_SETTINGS: AppSettings = {
  userName: "",
  businessName: "",
  phoneNumber: "",
  logoUrl: "",
  signatureUrl: "",
  theme: "light",
  currency: "PKR (Rs.)",
  numberFormat: "million",
  defaultTaxMethod: "manual",
  taxFormulaSalesPercent: 18,
  taxFormulaIncomePercent: 5,
  accountType: "Commercial Coal Trader",
  companyAddress: "",
  ntnNumber: "",
  appLockEnabled: false,
  pinHash: "",
  pinLength: 5,
  lockTimeout: 0,
};

export type LedgerEntityType = 'dispatch' | 'party' | 'payment' | 'expense' | 'purchase_order' | 'lot' | 'mine' | 'settings' | 'all';
export type LedgerMutationAction = 'create' | 'update' | 'delete' | 'restore';

export interface LedgerMutationDetail {
  entityType: LedgerEntityType;
  id?: string;
  action: LedgerMutationAction;
  timestamp: number;
}

/**
 * Broadcast local ledger changes to active views and background sync manager
 */
export function notifyLedgerMutation(
  entityType: LedgerEntityType,
  id?: string,
  action: LedgerMutationAction = 'update'
) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<LedgerMutationDetail>('ledger_data_changed', {
        detail: {
          entityType,
          id,
          action,
          timestamp: Date.now(),
        },
      })
    );
  }
}

/**
 * Retrieve deletion tombstones to prevent remote cloud syncs from re-introducing deleted items
 */
export function getTombstones(): Record<string, number> {
  try {
    const raw = localStorage.getItem(TOMBSTONES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Record a deleted entity ID with timestamp and prune tombstones older than 60 days
 */
export function recordTombstone(id: string): void {
  try {
    const tombstones = getTombstones();
    tombstones[id] = Date.now();
    const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
    for (const k in tombstones) {
      if (tombstones[k] < cutoff) {
        delete tombstones[k];
      }
    }
    localStorage.setItem(TOMBSTONES_KEY, JSON.stringify(tombstones));
  } catch (err) {
    console.warn('Failed to record deletion tombstone:', err);
  }
}

export interface LedgerOwnerInfo {
  uid: string | null;
  email: string | null;
}

export function getLedgerOwner(): LedgerOwnerInfo {
  try {
    return {
      uid: localStorage.getItem(OWNER_UID_KEY),
      email: localStorage.getItem(OWNER_EMAIL_KEY),
    };
  } catch {
    return { uid: null, email: null };
  }
}

export function setLedgerOwner(uid: string | null, email: string | null): void {
  try {
    if (uid) {
      localStorage.setItem(OWNER_UID_KEY, uid);
    } else {
      localStorage.removeItem(OWNER_UID_KEY);
    }
    if (email) {
      localStorage.setItem(OWNER_EMAIL_KEY, email);
    } else {
      localStorage.removeItem(OWNER_EMAIL_KEY);
    }
  } catch (err) {
    console.warn('Failed to set ledger owner:', err);
  }
}

/**
 * Quick count of all active user records stored in IndexedDB
 */
export async function getLocalRecordCounts(): Promise<{
  parties: number;
  dispatches: number;
  payments: number;
  expenses: number;
  pos: number;
  lots: number;
  mines: number;
  total: number;
}> {
  await ensureInitialized();
  const [parties, dispatches, payments, expenses, pos, lots, mines] = await Promise.all([
    idb.parties.filter((p) => !p.deleted).count(),
    idb.dispatches.filter((d) => !d.deleted).count(),
    idb.payments.filter((p) => !p.deleted).count(),
    idb.expenses.filter((e) => !e.deleted).count(),
    idb.pos.filter((po) => !po.deleted).count(),
    idb.lots.filter((l) => !l.deleted).count(),
    idb.mines.filter((m) => !m.deleted).count(),
  ]);
  const total = parties + dispatches + payments + expenses + pos + lots + mines;
  return { parties, dispatches, payments, expenses, pos, lots, mines, total };
}

/**
 * Synchronous write to localStorage (used for small configs like settings, pin, flags)
 * Throws on quota exhaustion.
 */
export function writeStorageOrThrow(key: string, value: string, backupKey?: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    console.error(`[DB] localStorage quota exceeded or error writing ${key}:`, err);
    throw new Error(`Storage full: Unable to save data for ${key}. Please backup or free device storage.`);
  }

  if (backupKey) {
    try {
      localStorage.setItem(backupKey, value);
    } catch {
      // Best-effort safety backup: ignore quota errors
    }
  }
}

/**
 * Strict numeric parser that guarantees a valid finite number:
 * - Empty string, null, undefined -> fallback (default 0)
 * - NaN, Infinity, -Infinity -> fallback (default 0)
 * - Strips accidental commas or whitespace
 */
export function cleanNumber(val: any, fallback = 0): number {
  if (typeof val === 'number') {
    return isNaN(val) || !isFinite(val) ? fallback : val;
  }
  if (val === null || val === undefined || val === '') {
    return fallback;
  }
  const str = String(val).replace(/,/g, '').trim();
  if (str === '') return fallback;
  const parsed = Number(str);
  return isNaN(parsed) || !isFinite(parsed) ? fallback : parsed;
}

export function sanitizeDispatch(d: Partial<Dispatch>): Dispatch {
  const now = Date.now();
  const isDeleted = Boolean(d.deleted);
  const receivedWeight = cleanNumber(d.labReceivedWeight);
  const status = d.status === 'pending' || d.status === 'settled'
    ? d.status
    : (receivedWeight > 0 ? 'settled' : 'pending');
  return {
    id: d.id || '',
    partyId: d.partyId || '',
    poId: d.poId || undefined,
    date: d.date || getTodayDateString(),
    truckNumber: d.truckNumber || '',
    factoryName: d.factoryName || '',
    targetGcv: cleanNumber(d.targetGcv),
    baseRate: cleanNumber(d.baseRate),
    commissionPerTon: d.commissionPerTon !== undefined ? cleanNumber(d.commissionPerTon) : undefined,
    labActualGcv: cleanNumber(d.labActualGcv),
    labReceivedWeight: receivedWeight,
    labSulphur: cleanNumber(d.labSulphur),
    labAsh: d.labAsh !== undefined ? cleanNumber(d.labAsh) : undefined,
    labVm: d.labVm !== undefined ? cleanNumber(d.labVm) : undefined,
    labMoisture: d.labMoisture !== undefined ? cleanNumber(d.labMoisture) : undefined,
    manualDeduction: d.manualDeduction !== undefined ? cleanNumber(d.manualDeduction) : undefined,
    manualPremium: d.manualPremium !== undefined ? cleanNumber(d.manualPremium) : undefined,
    manualTax: d.manualTax !== undefined ? cleanNumber(d.manualTax) : undefined,
    taxMethod: d.taxMethod || 'manual',
    taxSalesPercent: d.taxSalesPercent !== undefined
      ? cleanNumber(d.taxSalesPercent)
      : (d.taxMethod === 'formula_18_5'
          ? (getCachedSettings()?.taxFormulaSalesPercent ?? 18)
          : undefined),
    taxIncomePercent: d.taxIncomePercent !== undefined
      ? cleanNumber(d.taxIncomePercent)
      : (d.taxMethod === 'formula_18_5'
          ? (getCachedSettings()?.taxFormulaIncomePercent ?? 5)
          : undefined),
    overheads: {
      loading: cleanNumber(d.overheads?.loading),
      freight: cleanNumber(d.overheads?.freight),
      crush: cleanNumber(d.overheads?.crush),
      royalty: cleanNumber(d.overheads?.royalty),
      other: cleanNumber(d.overheads?.other),
    },
    coalInputs: Array.isArray(d.coalInputs)
      ? d.coalInputs.map((ci) => ({
          id: ci.id || '',
          sourceName: ci.sourceName || '',
          weight: cleanNumber(ci.weight),
          purchaseRate: cleanNumber(ci.purchaseRate),
          lotId: ci.lotId || undefined,
          mineId: ci.mineId || undefined,
        }))
      : [],
    gcvAdjustment: d.gcvAdjustment === 'prorata' ? 'prorata' : (d.gcvAdjustment === 'manual' ? 'manual' : undefined),
    gcvAdjustmentRounding: d.gcvAdjustmentRounding === 'rupee' ? 'rupee' : (d.gcvAdjustmentRounding === 'paisa' ? 'paisa' : undefined),
    notes: d.notes || undefined,
    status,
    settledAt: status === 'settled' && d.settledAt !== undefined ? cleanNumber(d.settledAt) : undefined,
    settledDate: status === 'settled' ? (d.settledDate || d.date || getTodayDateString()) : undefined,
    createdAt: cleanNumber(d.createdAt, now),
    updatedAt: cleanNumber(d.updatedAt, cleanNumber(d.createdAt, now)),
    deleted: isDeleted,
    deletedAt: isDeleted ? cleanNumber(d.deletedAt, now) : undefined,
    dirty: d.dirty !== undefined ? Boolean(d.dirty) : true,
  };
}

const GENERAL_EXPENSE_CATEGORIES = new Set<GeneralExpenseCategory>([
  'warehouse_rent',
  'warehouse_labour',
  'utilities',
  'equipment',
  'office',
  'maintenance',
  'transport',
  'other',
]);

export function sanitizeGeneralExpense(e: Partial<GeneralExpense>): GeneralExpense {
  const now = Date.now();
  const isDeleted = Boolean(e.deleted);
  const category = GENERAL_EXPENSE_CATEGORIES.has(e.category as GeneralExpenseCategory)
    ? e.category as GeneralExpenseCategory
    : 'other';
  const paymentMode = e.paymentMode && ['bank', 'cash', 'cheque', 'online'].includes(e.paymentMode)
    ? e.paymentMode
    : undefined;
  return {
    id: e.id || '',
    date: e.date || getTodayDateString(),
    category,
    amount: cleanNumber(e.amount),
    description: (e.description || '').trim(),
    vendor: (e.vendor || '').trim() || undefined,
    paymentMode,
    notes: (e.notes || '').trim() || undefined,
    createdAt: cleanNumber(e.createdAt, now),
    updatedAt: cleanNumber(e.updatedAt, cleanNumber(e.createdAt, now)),
    deleted: isDeleted,
    deletedAt: isDeleted ? cleanNumber(e.deletedAt, now) : undefined,
    dirty: e.dirty !== undefined ? Boolean(e.dirty) : true,
  };
}

export function sanitizePayment(p: Partial<Payment>): Payment {
  const now = Date.now();
  const isDeleted = Boolean(p.deleted);
  return {
    id: p.id || '',
    partyId: p.partyId || '',
    date: p.date || getTodayDateString(),
    amount: cleanNumber(p.amount),
    type: p.type === 'paid' ? 'paid' : 'received',
    mode: p.mode || 'bank',
    referenceNote: p.referenceNote || undefined,
    createdAt: cleanNumber(p.createdAt, now),
    updatedAt: cleanNumber(p.updatedAt, cleanNumber(p.createdAt, now)),
    deleted: isDeleted,
    deletedAt: isDeleted ? cleanNumber(p.deletedAt, now) : undefined,
    dirty: p.dirty !== undefined ? Boolean(p.dirty) : true,
  };
}

export function sanitizeParty(p: Partial<Party>): Party {
  const now = Date.now();
  const isDeleted = Boolean(p.deleted);
  return {
    id: p.id || '',
    name: p.name || '',
    contactPerson: p.contactPerson || '',
    phone: p.phone || '',
    address: p.address || '',
    createdAt: cleanNumber(p.createdAt, now),
    updatedAt: cleanNumber(p.updatedAt, cleanNumber(p.createdAt, now)),
    isArchived: Boolean(p.isArchived),
    deleted: isDeleted,
    deletedAt: isDeleted ? cleanNumber(p.deletedAt, now) : undefined,
    dirty: p.dirty !== undefined ? Boolean(p.dirty) : true,
  };
}

export function sanitizePurchaseOrder(po: Partial<PurchaseOrder>): PurchaseOrder {
  const now = Date.now();
  const isDeleted = Boolean(po.deleted);
  return {
    id: po.id || '',
    partyId: po.partyId || '',
    poNumber: po.poNumber || '',
    targetGcv: cleanNumber(po.targetGcv),
    baseRate: cleanNumber(po.baseRate),
    commissionPerTon: cleanNumber(po.commissionPerTon),
    totalTons: po.totalTons !== undefined ? cleanNumber(po.totalTons) : undefined,
    notes: po.notes || undefined,
    gcvAdjustment: po.gcvAdjustment === 'prorata' ? 'prorata' : 'manual',
    gcvAdjustmentRounding: po.gcvAdjustmentRounding === 'rupee' ? 'rupee' : 'paisa',
    isActive: typeof po.isActive === 'boolean' ? po.isActive : true,
    createdAt: cleanNumber(po.createdAt, now),
    updatedAt: cleanNumber(po.updatedAt, cleanNumber(po.createdAt, now)),
    deleted: isDeleted,
    deletedAt: isDeleted ? cleanNumber(po.deletedAt, now) : undefined,
    dirty: po.dirty !== undefined ? Boolean(po.dirty) : true,
  };
}

export function sanitizeLot(l: Partial<InventoryLot>): InventoryLot {
  const now = Date.now();
  const isDeleted = Boolean(l.deleted);
  const tonnage = l.tonnage !== undefined ? cleanNumber(l.tonnage) : undefined;
  const ratePerTon = l.ratePerTon !== undefined ? cleanNumber(l.ratePerTon) : undefined;
  const billedWeight = tonnage !== undefined ? tonnage : cleanNumber(l.billedWeight);
  const receivedWeight = l.receivedWeight !== undefined ? cleanNumber(l.receivedWeight) : billedWeight;
  const purchaseRate = ratePerTon !== undefined ? ratePerTon : cleanNumber(l.purchaseRate);
  const loadingCost = l.loadingCost !== undefined ? cleanNumber(l.loadingCost) : 0;
  const freightCost = l.freightCost !== undefined ? cleanNumber(l.freightCost) : 0;
  const totalCost = (billedWeight * purchaseRate) + loadingCost + freightCost;
  const totalValue = l.totalValue !== undefined
    ? cleanNumber(l.totalValue)
    : Math.round(totalCost);
  const effectiveWeight = receivedWeight > 0 ? receivedWeight : billedWeight;
  const landedRate = effectiveWeight > 0 ? totalCost / effectiveWeight : purchaseRate;

  return {
    id: l.id || '',
    mineId: l.mineId || undefined,
    mineName: (l.mineName || '').trim() || undefined,
    boughtFrom: (l.boughtFrom || '').trim() || undefined,
    storedAt: (l.storedAt || '').trim() || undefined,
    tonnage: tonnage !== undefined ? Math.round(tonnage * 100) / 100 : undefined,
    ratePerTon: ratePerTon !== undefined ? Math.round(ratePerTon * 100) / 100 : undefined,
    totalValue,
    loadingCost: loadingCost > 0 ? Math.round(loadingCost) : undefined,
    freightCost: freightCost > 0 ? Math.round(freightCost) : undefined,
    usedInDispatchId: l.usedInDispatchId || undefined,
    usedInDispatchTruck: (l.usedInDispatchTruck || '').trim() || undefined,
    usedInPartyName: (l.usedInPartyName || '').trim() || undefined,
    usedInDate: l.usedInDate || undefined,
    supplier: (l.boughtFrom || l.supplier || '').trim(),
    date: l.date || getTodayDateString(),
    billedWeight: Math.round(billedWeight * 100) / 100,
    receivedWeight: Math.round(receivedWeight * 100) / 100,
    purchaseRate: Math.round(purchaseRate * 100) / 100,
    landedRate: Math.round(landedRate * 100) / 100,
    gcv: l.gcv !== undefined && l.gcv !== null ? cleanNumber(l.gcv) : undefined,
    truckNumber: (l.truckNumber || '').trim() || undefined,
    mineSource: (l.mineSource || l.mineName || '').trim() || undefined,
    notes: (l.notes || '').trim() || undefined,
    createdAt: cleanNumber(l.createdAt, now),
    updatedAt: cleanNumber(l.updatedAt, cleanNumber(l.createdAt, now)),
    deleted: isDeleted,
    deletedAt: isDeleted ? cleanNumber(l.deletedAt, now) : undefined,
    dirty: l.dirty !== undefined ? Boolean(l.dirty) : true,
  };
}

export function sanitizeMine(m: Partial<Mine>): Mine {
  const now = Date.now();
  const isDeleted = Boolean(m.deleted);
  return {
    id: m.id || '',
    name: (m.name || '').trim(),
    ratePerTon: cleanNumber(m.ratePerTon),
    location: (m.location || '').trim() || undefined,
    notes: (m.notes || '').trim() || undefined,
    createdAt: cleanNumber(m.createdAt, now),
    updatedAt: cleanNumber(m.updatedAt, cleanNumber(m.createdAt, now)),
    deleted: isDeleted,
    deletedAt: isDeleted ? cleanNumber(m.deletedAt, now) : undefined,
    dirty: m.dirty !== undefined ? Boolean(m.dirty) : true,
  };
}

// One-time initialization and transparent migration from legacy localStorage to IndexedDB
let isInitialized = false;
let initPromise: Promise<void> | null = null;

export async function ensureInitialized(): Promise<void> {
  if (isInitialized) return;
  if (!initPromise) {
    initPromise = (async () => {
      // 1. Request persistent browser storage
      await requestPersistentStorage();

      // 2. Check if IndexedDB is empty but legacy localStorage has data to migrate
      try {
        const idbPartyCount = await idb.parties.count();
        if (idbPartyCount === 0 && typeof localStorage !== 'undefined') {
          const rawParties = localStorage.getItem(LEGACY_PARTIES_KEY);
          const rawDispatches = localStorage.getItem(LEGACY_DISPATCHES_KEY);
          const rawPayments = localStorage.getItem(LEGACY_PAYMENTS_KEY);
          const rawPos = localStorage.getItem(LEGACY_POS_KEY);

          if (rawParties || rawDispatches || rawPayments || rawPos) {
            const parties: Party[] = rawParties ? JSON.parse(rawParties) : [];
            const dispatches: Dispatch[] = rawDispatches ? JSON.parse(rawDispatches) : [];
            const payments: Payment[] = rawPayments ? JSON.parse(rawPayments) : [];
            const pos: PurchaseOrder[] = rawPos ? JSON.parse(rawPos) : [];

            await idb.transaction('rw', [idb.parties, idb.dispatches, idb.payments, idb.pos], async () => {
              if (parties.length > 0) await idb.parties.bulkPut(parties.map(sanitizeParty));
              if (dispatches.length > 0) await idb.dispatches.bulkPut(dispatches.map(sanitizeDispatch));
              if (payments.length > 0) await idb.payments.bulkPut(payments.map(sanitizePayment));
              if (pos.length > 0) await idb.pos.bulkPut(pos.map(sanitizePurchaseOrder));
            });
            console.log(`[DB] Successfully migrated legacy localStorage records into IndexedDB!`);
          }
        }

        // Clean up redundant large backup strings from localStorage to eliminate quota strain
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('coal_ledger_safety_parties_bak');
          localStorage.removeItem('coal_ledger_safety_dispatches_bak');
          localStorage.removeItem('coal_ledger_safety_payments_bak');
          localStorage.removeItem('coal_ledger_safety_pos_bak');
        }
      } catch (err) {
        console.warn('[DB] Migration check notice:', err);
      }

      isInitialized = true;
    })();
  }
  return initPromise;
}

// Backward compatible alias
export const ensureSeeded = ensureInitialized;

// -- Dispatches (IndexedDB) --
export async function getDispatches(): Promise<Dispatch[]> {
  await ensureInitialized();
  const rawList = await idb.dispatches.toArray();
  const activeList = rawList.filter((d) => !d.deleted);
  // Sort by date / createdAt desc
  activeList.sort((a, b) => {
    const timeA = new Date(a.date).getTime() || a.createdAt || 0;
    const timeB = new Date(b.date).getTime() || b.createdAt || 0;
    return timeB - timeA;
  });

  // Freeze legacy tax percents if formula
  return activeList.map((d) => {
    if (d.taxMethod === 'formula_18_5') {
      if (typeof d.taxSalesPercent !== 'number') d.taxSalesPercent = 18;
      if (typeof d.taxIncomePercent !== 'number') d.taxIncomePercent = 5;
    }
    return d;
  });
}

export async function getDispatch(id: string): Promise<Dispatch | null> {
  await ensureInitialized();
  const d = await idb.dispatches.get(id);
  if (!d || d.deleted) return null;
  return d;
}

export async function saveDispatch(dispatch: Dispatch): Promise<void> {
  await ensureInitialized();
  const sanitized = sanitizeDispatch(dispatch);
  const existing = await idb.dispatches.get(sanitized.id);
  const linkedParty = sanitized.partyId ? await idb.parties.get(sanitized.partyId) : undefined;
  const factoryName = sanitized.factoryName.trim() || linkedParty?.name?.trim() || '';
  if (!sanitized.deleted && !factoryName) {
    throw new Error('The selected factory name is missing. Reselect the party before saving this dispatch.');
  }
  const now = Date.now();
  const itemToSave: Dispatch = {
    ...sanitized,
    factoryName,
    createdAt: sanitized.createdAt || now,
    updatedAt: now,
    dirty: true,
  };
  const changedLotIds = new Set<string>();

  await idb.transaction('rw', [idb.dispatches, idb.lots, idb.parties], async () => {
    const allDispatches = await idb.dispatches.toArray();
    const allLots = await idb.lots.toArray();
    const lotById = new Map(allLots.map((lot) => [lot.id, lot]));
    const selectedLotIds = new Set<string>();

    for (const input of sanitized.coalInputs || []) {
      if (input.weight <= 0) {
        throw new Error(`Coal source "${input.sourceName || 'Untitled source'}" must have a positive weight.`);
      }
      if (input.purchaseRate <= 0) {
        throw new Error(`Coal source "${input.sourceName || 'Untitled source'}" must have a positive purchase rate.`);
      }
      if (!input.lotId) continue;

      if (selectedLotIds.has(input.lotId)) {
        throw new Error('The same stock entry cannot be selected more than once in a dispatch.');
      }
      selectedLotIds.add(input.lotId);

      const lot = lotById.get(input.lotId);
      if (!lot || lot.deleted) {
        throw new Error('A selected stock entry no longer exists. Please choose an available entry again.');
      }

      const receivedWeight = cleanNumber(lot.receivedWeight || lot.billedWeight || lot.tonnage);
      const usedByOtherDispatches = allDispatches
        .filter((candidate) => !candidate.deleted && candidate.id !== sanitized.id)
        .reduce(
          (sum, candidate) => sum + (candidate.coalInputs || [])
            .filter((coalInput) => coalInput.lotId === input.lotId)
            .reduce((inputSum, coalInput) => inputSum + cleanNumber(coalInput.weight), 0),
          0
        );
      const availableBeforeThisDispatch = receivedWeight - usedByOtherDispatches;
      const previousInput = existing?.coalInputs?.find((coalInput) => coalInput.lotId === input.lotId);

      if (input.weight > availableBeforeThisDispatch + 0.001) {
        throw new Error(
          `Stock entry "${lot.boughtFrom || lot.supplier || lot.mineName || 'Stock'}" has only ${Math.max(0, availableBeforeThisDispatch).toFixed(2)} tons available for this dispatch.`
        );
      }

      const expectedRate = previousInput
        ? cleanNumber(previousInput.purchaseRate)
        : cleanNumber(lot.landedRate);
      if (Math.abs(input.purchaseRate - expectedRate) > 0.01) {
        throw new Error(
          previousInput
            ? 'The landed-rate snapshot for this stock allocation is locked. Change only the allocated weight or choose another stock entry.'
            : 'The selected stock entry rate has changed. Please select the entry again to use its current landed rate.'
        );
      }
    }

    await idb.dispatches.put(itemToSave);

    // These marker fields are compatibility/display helpers only. A lot may be
    // allocated across several dispatches; coalInputs remain authoritative.
    const activeAfterSave = allDispatches
      .filter((candidate) => !candidate.deleted && candidate.id !== sanitized.id)
      .concat(itemToSave.deleted ? [] : [itemToSave]);
    const parties = await idb.parties.toArray();
    const partyNameById = new Map(parties.map((party) => [party.id, party.name]));
    const affectedLotIds = new Set<string>([
      ...selectedLotIds,
      ...((existing?.coalInputs || []).map((input) => input.lotId).filter(Boolean) as string[]),
    ]);

    for (const lotId of affectedLotIds) {
      const lot = lotById.get(lotId);
      if (!lot || lot.deleted) continue;
      const representative = activeAfterSave
        .filter((candidate) => (candidate.coalInputs || []).some((input) => input.lotId === lotId))
        .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))[0];
      const partyName = representative
        ? partyNameById.get(representative.partyId) || representative.factoryName
        : undefined;

      if (
        lot.usedInDispatchId !== representative?.id ||
        lot.usedInDispatchTruck !== representative?.truckNumber ||
        lot.usedInPartyName !== partyName ||
        lot.usedInDate !== representative?.date
      ) {
        await idb.lots.put({
          ...lot,
          usedInDispatchId: representative?.id,
          usedInDispatchTruck: representative?.truckNumber,
          usedInPartyName: partyName,
          usedInDate: representative?.date,
          updatedAt: now,
          dirty: true,
        });
        changedLotIds.add(lot.id);
      }
    }
  });

  notifyLedgerMutation('dispatch', sanitized.id, existing ? 'update' : 'create');
  changedLotIds.forEach((lotId) => notifyLedgerMutation('lot', lotId, 'update'));
}

export async function deleteDispatch(id: string): Promise<void> {
  await ensureInitialized();
  const existing = await idb.dispatches.get(id);
  const now = Date.now();
  const changedLotIds = new Set<string>();

  await idb.transaction('rw', [idb.dispatches, idb.lots, idb.parties], async () => {
    if (existing) {
      await idb.dispatches.put({
        ...existing,
        deleted: true,
        deletedAt: now,
        updatedAt: now,
        dirty: true,
      });
    } else {
      await idb.dispatches.put({
        id,
        partyId: '',
        date: getTodayDateString(),
        truckNumber: '',
        factoryName: '',
        targetGcv: 0,
        baseRate: 0,
        coalInputs: [],
        overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
        labActualGcv: 0,
        labReceivedWeight: 0,
        labSulphur: 0,
        createdAt: now,
        updatedAt: now,
        deleted: true,
        deletedAt: now,
        dirty: true,
      });
    }

    const [allLots, allDispatches, parties] = await Promise.all([
      idb.lots.toArray(),
      idb.dispatches.toArray(),
      idb.parties.toArray(),
    ]);
    const partyNameById = new Map(parties.map((party) => [party.id, party.name]));
    const affectedLotIds = new Set<string>([
      ...((existing?.coalInputs || []).map((input) => input.lotId).filter(Boolean) as string[]),
      ...allLots.filter((lot) => lot.usedInDispatchId === id).map((lot) => lot.id),
    ]);

    for (const lot of allLots) {
      if (!affectedLotIds.has(lot.id)) continue;
      const representative = allDispatches
        .filter(
          (candidate) =>
            !candidate.deleted &&
            candidate.id !== id &&
            (candidate.coalInputs || []).some((input) => input.lotId === lot.id)
        )
        .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))[0];
      const partyName = representative
        ? partyNameById.get(representative.partyId) || representative.factoryName
        : undefined;

      if (
        lot.usedInDispatchId !== representative?.id ||
        lot.usedInDispatchTruck !== representative?.truckNumber ||
        lot.usedInPartyName !== partyName ||
        lot.usedInDate !== representative?.date
      ) {
        await idb.lots.put({
          ...lot,
          usedInDispatchId: representative?.id,
          usedInDispatchTruck: representative?.truckNumber,
          usedInPartyName: partyName,
          usedInDate: representative?.date,
          updatedAt: now,
          dirty: true,
        });
        changedLotIds.add(lot.id);
      }
    }
  });

  recordTombstone(id);
  notifyLedgerMutation('dispatch', id, 'delete');
  changedLotIds.forEach((lotId) => notifyLedgerMutation('lot', lotId, 'update'));
}

export async function getPartyDispatches(partyId: string): Promise<Dispatch[]> {
  await ensureInitialized();
  const list = await idb.dispatches.where('partyId').equals(partyId).toArray();
  return list.filter((d) => !d.deleted);
}

// -- Parties (IndexedDB) --
export async function getParties(): Promise<Party[]> {
  await ensureInitialized();
  const parties = await idb.parties.toArray();
  const active = parties.filter((p) => !p.deleted);
  active.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return active;
}

export async function getParty(id: string): Promise<Party | null> {
  await ensureInitialized();
  const party = await idb.parties.get(id);
  if (!party || party.deleted) return null;
  return party;
}

export async function saveParty(party: Party): Promise<void> {
  await ensureInitialized();
  const sanitized = sanitizeParty(party);
  const existing = await idb.parties.get(sanitized.id);
  const now = Date.now();
  const itemToSave: Party = {
    ...sanitized,
    createdAt: sanitized.createdAt || now,
    updatedAt: now,
    dirty: true,
  };

  await idb.parties.put(itemToSave);
  notifyLedgerMutation('party', sanitized.id, existing ? 'update' : 'create');
}

export async function deleteParty(id: string): Promise<void> {
  await ensureInitialized();
  const [dispatches, payments, pos] = await Promise.all([
    getPartyDispatches(id),
    getPartyPayments(id),
    getPartyPurchaseOrders(id),
  ]);
  if (dispatches.length > 0 || payments.length > 0 || pos.length > 0) {
    throw new Error(
      `Cannot delete party with existing financial records (${dispatches.length} dispatches, ${payments.length} payments, ${pos.length} purchase orders). Archive the party or delete with records.`
    );
  }
  const existing = await idb.parties.get(id);
  const now = Date.now();
  if (existing) {
    await idb.parties.put({
      ...existing,
      deleted: true,
      deletedAt: now,
      updatedAt: now,
      dirty: true,
    });
  } else {
    await idb.parties.put({
      id,
      name: '',
      contactPerson: '',
      phone: '',
      address: '',
      createdAt: now,
      updatedAt: now,
      deleted: true,
      deletedAt: now,
      dirty: true,
    });
  }
  recordTombstone(id);
  notifyLedgerMutation('party', id, 'delete');
}

export async function archiveParty(id: string, isArchived = true): Promise<void> {
  await ensureInitialized();
  const party = await idb.parties.get(id);
  if (!party) return;
  party.isArchived = isArchived;
  party.updatedAt = Date.now();
  party.dirty = true;
  await idb.parties.put(party);
  notifyLedgerMutation('party', id, 'update');
}

export async function deletePartyWithRecords(id: string): Promise<{
  deletedDispatches: number;
  deletedPayments: number;
  deletedPos: number;
}> {
  await ensureInitialized();
  const [childDispatches, childPayments, childPos] = await Promise.all([
    idb.dispatches.where('partyId').equals(id).toArray(),
    idb.payments.where('partyId').equals(id).toArray(),
    idb.pos.where('partyId').equals(id).toArray(),
  ]);

  const now = Date.now();
  await idb.transaction('rw', [idb.parties, idb.dispatches, idb.payments, idb.pos], async () => {
    const p = await idb.parties.get(id);
    if (p) {
      await idb.parties.put({ ...p, deleted: true, deletedAt: now, updatedAt: now, dirty: true });
    }
    recordTombstone(id);

    for (const d of childDispatches) {
      recordTombstone(d.id);
      await idb.dispatches.put({ ...d, deleted: true, deletedAt: now, updatedAt: now, dirty: true });
    }
    for (const pay of childPayments) {
      recordTombstone(pay.id);
      await idb.payments.put({ ...pay, deleted: true, deletedAt: now, updatedAt: now, dirty: true });
    }
    for (const po of childPos) {
      recordTombstone(po.id);
      await idb.pos.put({ ...po, deleted: true, deletedAt: now, updatedAt: now, dirty: true });
    }
  });

  notifyLedgerMutation('party', id, 'delete');
  if (childDispatches.length > 0) notifyLedgerMutation('dispatch', id, 'delete');
  if (childPayments.length > 0) notifyLedgerMutation('payment', id, 'delete');
  if (childPos.length > 0) notifyLedgerMutation('purchase_order', id, 'delete');

  return {
    deletedDispatches: childDispatches.filter((d) => !d.deleted).length,
    deletedPayments: childPayments.filter((p) => !p.deleted).length,
    deletedPos: childPos.filter((po) => !po.deleted).length,
  };
}

// -- Payments (IndexedDB) --
export async function getPayments(): Promise<Payment[]> {
  await ensureInitialized();
  const payments = await idb.payments.toArray();
  const active = payments.filter((p) => !p.deleted);
  active.sort((a, b) => {
    const timeA = new Date(a.date).getTime() || a.createdAt || 0;
    const timeB = new Date(b.date).getTime() || b.createdAt || 0;
    return timeB - timeA;
  });
  return active;
}

export async function getPayment(id: string): Promise<Payment | null> {
  await ensureInitialized();
  const p = await idb.payments.get(id);
  if (!p || p.deleted) return null;
  return p;
}

export async function getPartyPayments(partyId: string): Promise<Payment[]> {
  await ensureInitialized();
  const list = await idb.payments.where('partyId').equals(partyId).toArray();
  return list.filter((p) => !p.deleted);
}

export async function savePayment(payment: Payment): Promise<void> {
  await ensureInitialized();
  const sanitized = sanitizePayment(payment);
  const existing = await idb.payments.get(sanitized.id);
  const now = Date.now();
  const itemToSave: Payment = {
    ...sanitized,
    createdAt: sanitized.createdAt || now,
    updatedAt: now,
    dirty: true,
  };

  await idb.payments.put(itemToSave);
  notifyLedgerMutation('payment', sanitized.id, existing ? 'update' : 'create');
}

export async function deletePayment(id: string): Promise<void> {
  await ensureInitialized();
  const existing = await idb.payments.get(id);
  const now = Date.now();
  if (existing) {
    await idb.payments.put({
      ...existing,
      deleted: true,
      deletedAt: now,
      updatedAt: now,
      dirty: true,
    });
  } else {
    await idb.payments.put({
      id,
      partyId: '',
      date: getTodayDateString(),
      amount: 0,
      type: 'received',
      mode: 'cash',
      createdAt: now,
      updatedAt: now,
      deleted: true,
      deletedAt: now,
      dirty: true,
    });
  }
  recordTombstone(id);
  notifyLedgerMutation('payment', id, 'delete');
}

// -- Independent warehouse / general expenses (IndexedDB) --
export async function getGeneralExpenses(): Promise<GeneralExpense[]> {
  await ensureInitialized();
  const expenses = await idb.expenses.toArray();
  return expenses
    .filter((expense) => !expense.deleted)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() || (b.createdAt || 0) - (a.createdAt || 0));
}

export async function getGeneralExpense(id: string): Promise<GeneralExpense | null> {
  await ensureInitialized();
  const expense = await idb.expenses.get(id);
  return !expense || expense.deleted ? null : expense;
}

export async function saveGeneralExpense(expense: GeneralExpense): Promise<void> {
  await ensureInitialized();
  const sanitized = sanitizeGeneralExpense(expense);
  if (!sanitized.id) throw new Error('Expense ID is required.');
  if (!sanitized.description) throw new Error('Expense description is required.');
  if (sanitized.amount <= 0) throw new Error('Expense amount must be greater than zero.');

  const existing = await idb.expenses.get(sanitized.id);
  await idb.expenses.put({
    ...sanitized,
    createdAt: existing?.createdAt || sanitized.createdAt || Date.now(),
    updatedAt: Date.now(),
    dirty: true,
  });
  notifyLedgerMutation('expense', sanitized.id, existing ? 'update' : 'create');
}

export async function deleteGeneralExpense(id: string): Promise<void> {
  await ensureInitialized();
  const existing = await idb.expenses.get(id);
  const now = Date.now();
  await idb.expenses.put(existing ? {
    ...existing,
    deleted: true,
    deletedAt: now,
    updatedAt: now,
    dirty: true,
  } : {
    id,
    date: getTodayDateString(),
    category: 'other',
    amount: 0,
    description: '',
    createdAt: now,
    updatedAt: now,
    deleted: true,
    deletedAt: now,
    dirty: true,
  });
  recordTombstone(id);
  notifyLedgerMutation('expense', id, 'delete');
}

// -- Purchase Orders (IndexedDB) --
export async function getPurchaseOrders(): Promise<PurchaseOrder[]> {
  await ensureInitialized();
  const pos = await idb.pos.toArray();
  const active = pos.filter((po) => !po.deleted);
  active.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return active;
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrder | null> {
  await ensureInitialized();
  const po = await idb.pos.get(id);
  if (!po || po.deleted) return null;
  return po;
}

export async function getPartyPurchaseOrders(partyId: string): Promise<PurchaseOrder[]> {
  await ensureInitialized();
  const list = await idb.pos.where('partyId').equals(partyId).toArray();
  return list.filter((po) => !po.deleted);
}

export async function savePurchaseOrder(po: PurchaseOrder): Promise<void> {
  await ensureInitialized();
  const sanitized = sanitizePurchaseOrder(po);
  const existing = await idb.pos.get(sanitized.id);
  const now = Date.now();
  const itemToSave: PurchaseOrder = {
    ...sanitized,
    createdAt: sanitized.createdAt || now,
    updatedAt: now,
    dirty: true,
  };

  await idb.pos.put(itemToSave);
  notifyLedgerMutation('purchase_order', sanitized.id, existing ? 'update' : 'create');
}

export async function deletePurchaseOrder(id: string): Promise<void> {
  await ensureInitialized();
  const existing = await idb.pos.get(id);
  const now = Date.now();
  if (existing) {
    await idb.pos.put({
      ...existing,
      deleted: true,
      deletedAt: now,
      updatedAt: now,
      dirty: true,
    });
  } else {
    await idb.pos.put({
      id,
      partyId: '',
      poNumber: '',
      targetGcv: 0,
      baseRate: 0,
      commissionPerTon: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      deleted: true,
      deletedAt: now,
      dirty: true,
    });
  }
  recordTombstone(id);
  notifyLedgerMutation('purchase_order', id, 'delete');
}

// -- Inventory Lots (IndexedDB) --
export async function getLots(): Promise<InventoryLot[]> {
  await ensureInitialized();
  const lots = await idb.lots.toArray();
  const active = lots.filter((l) => !l.deleted);
  active.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime() || (b.createdAt || 0) - (a.createdAt || 0));
  return active;
}

export async function getLot(id: string): Promise<InventoryLot | null> {
  await ensureInitialized();
  const lot = await idb.lots.get(id);
  if (!lot || lot.deleted) return null;
  return lot;
}

export async function saveLot(lot: InventoryLot): Promise<void> {
  await ensureInitialized();
  const sanitized = sanitizeLot(lot);
  const existing = await idb.lots.get(sanitized.id);
  const now = Date.now();

  if (sanitized.billedWeight <= 0 || sanitized.receivedWeight <= 0) {
    throw new Error('Loaded and received weight must both be greater than zero.');
  }
  if (sanitized.purchaseRate <= 0) {
    throw new Error('Coal rate per ton must be greater than zero.');
  }
  if (cleanNumber(lot.loadingCost) < 0 || cleanNumber(lot.freightCost) < 0) {
    throw new Error('Loading and freight amounts cannot be negative.');
  }

  const itemToSave: InventoryLot = {
    ...sanitized,
    createdAt: sanitized.createdAt || now,
    updatedAt: now,
    dirty: true,
  };

  await idb.transaction('rw', [idb.lots, idb.dispatches], async () => {
    if (existing) {
      const linkedDispatch = await idb.dispatches
        .filter(
          (dispatch) =>
            !dispatch.deleted &&
            (dispatch.coalInputs || []).some((input) => input.lotId === sanitized.id)
        )
        .first();

      if (linkedDispatch) {
        const financialFieldsChanged =
          Math.abs(cleanNumber(existing.billedWeight) - sanitized.billedWeight) > 0.001 ||
          Math.abs(cleanNumber(existing.receivedWeight) - sanitized.receivedWeight) > 0.001 ||
          Math.abs(cleanNumber(existing.purchaseRate) - sanitized.purchaseRate) > 0.001 ||
          Math.abs(cleanNumber(existing.loadingCost) - cleanNumber(sanitized.loadingCost)) > 0.001 ||
          Math.abs(cleanNumber(existing.freightCost) - cleanNumber(sanitized.freightCost)) > 0.001;

        if (financialFieldsChanged) {
          throw new Error(
            `This stock entry is locked by Dispatch #${linkedDispatch.truckNumber || 'N/A'}. Remove or replace it in that dispatch before changing weight or cost.`
          );
        }
      }
    }

    await idb.lots.put(itemToSave);
  });

  notifyLedgerMutation('lot', sanitized.id, existing ? 'update' : 'create');
}

export async function deleteLot(id: string): Promise<void> {
  await ensureInitialized();
  const allDispatches = await idb.dispatches.toArray();
  const linkedDispatches = allDispatches.filter(
    (d) => !d.deleted && (d.coalInputs || []).some((ci) => ci.lotId === id)
  );
  if (linkedDispatches.length > 0) {
    const truck = linkedDispatches[0].truckNumber || 'N/A';
    throw new Error(
      `Cannot delete this stock entry because it is actively used in Dispatch #${truck}. Please remove or replace it in the dispatch first.`
    );
  }

  const existing = await idb.lots.get(id);
  const now = Date.now();
  if (existing) {
    await idb.lots.put({
      ...existing,
      deleted: true,
      deletedAt: now,
      updatedAt: now,
      dirty: true,
    });
  } else {
    await idb.lots.put({
      id,
      supplier: '',
      date: getTodayDateString(),
      billedWeight: 0,
      receivedWeight: 0,
      purchaseRate: 0,
      landedRate: 0,
      createdAt: now,
      updatedAt: now,
      deleted: true,
      deletedAt: now,
      dirty: true,
    });
  }
  recordTombstone(id); // kept for backward-compat with any cloud pull that may re-introduce this lot id
  notifyLedgerMutation('lot', id, 'delete');
}

// -- Mine Ledger Operations --
export async function getMines(): Promise<Mine[]> {
  await ensureInitialized();
  const mines = await idb.mines.toArray();
  const active = mines.filter((m) => !m.deleted);
  active.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return active;
}

export async function getMine(id: string): Promise<Mine | null> {
  await ensureInitialized();
  const mine = await idb.mines.get(id);
  if (!mine || mine.deleted) return null;
  return mine;
}

export async function saveMine(mine: Mine): Promise<void> {
  await ensureInitialized();
  const sanitized = sanitizeMine(mine);
  const existing = await idb.mines.get(sanitized.id);
  const now = Date.now();
  const itemToSave: Mine = {
    ...sanitized,
    createdAt: sanitized.createdAt || now,
    updatedAt: now,
    dirty: true,
  };

  await idb.mines.put(itemToSave);
  notifyLedgerMutation('mine', sanitized.id, existing ? 'update' : 'create');
}

export async function deleteMine(id: string): Promise<void> {
  await ensureInitialized();
  const lots = await getMineLots(id);
  if (lots.length > 0) {
    throw new Error(
      `Cannot delete mine with existing stock entries (${lots.length} entries). Delete the stock entries first.`
    );
  }
  const existing = await idb.mines.get(id);
  const now = Date.now();
  if (existing) {
    await idb.mines.put({
      ...existing,
      deleted: true,
      deletedAt: now,
      updatedAt: now,
      dirty: true,
    });
  } else {
    await idb.mines.put({
      id,
      name: '',
      ratePerTon: 0,
      createdAt: now,
      updatedAt: now,
      deleted: true,
      deletedAt: now,
      dirty: true,
    });
  }
  recordTombstone(id);
  notifyLedgerMutation('mine', id, 'delete');
}

export async function getMineLots(mineId: string): Promise<InventoryLot[]> {
  await ensureInitialized();
  const lots = await idb.lots.where('mineId').equals(mineId).toArray();
  const active = lots.filter((l) => !l.deleted);
  active.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime() || (b.createdAt || 0) - (a.createdAt || 0));
  return active;
}

// -- Settings (Cached Synchronously in localStorage) --
let cachedSettings: AppSettings = INITIAL_SETTINGS;

export function getCachedSettings(): AppSettings {
  if (typeof window !== 'undefined' && (!cachedSettings.updatedAt || cachedSettings === INITIAL_SETTINGS)) {
    const data = localStorage.getItem(SETTINGS_KEY);
    if (data) {
      try {
        const parsed = JSON.parse(data);
        cachedSettings = {
          ...INITIAL_SETTINGS,
          ...parsed,
          numberFormat: parsed.numberFormat || 'million',
          taxFormulaSalesPercent: typeof parsed.taxFormulaSalesPercent === 'number' ? parsed.taxFormulaSalesPercent : 18,
          taxFormulaIncomePercent: typeof parsed.taxFormulaIncomePercent === 'number' ? parsed.taxFormulaIncomePercent : 5,
          appLockEnabled: Boolean(parsed.appLockEnabled),
          pinHash: parsed.pinHash || '',
          pinLength: typeof parsed.pinLength === 'number' ? parsed.pinLength : (parsed.pinHash ? 4 : 5),
          lockTimeout: typeof parsed.lockTimeout === 'number' ? parsed.lockTimeout : 0,
        };
      } catch {}
    }
  }
  return cachedSettings;
}

export async function getSettings(): Promise<AppSettings> {
  const data = typeof localStorage !== 'undefined' ? localStorage.getItem(SETTINGS_KEY) : null;
  if (!data) {
    cachedSettings = INITIAL_SETTINGS;
    return INITIAL_SETTINGS;
  }
  try {
    const parsed = JSON.parse(data);
    const merged: AppSettings = {
      ...INITIAL_SETTINGS,
      ...parsed,
      numberFormat: parsed.numberFormat || 'million',
      taxFormulaSalesPercent: typeof parsed.taxFormulaSalesPercent === 'number' ? parsed.taxFormulaSalesPercent : 18,
      taxFormulaIncomePercent: typeof parsed.taxFormulaIncomePercent === 'number' ? parsed.taxFormulaIncomePercent : 5,
      appLockEnabled: Boolean(parsed.appLockEnabled),
      pinHash: parsed.pinHash || '',
      pinLength: typeof parsed.pinLength === 'number' ? parsed.pinLength : (parsed.pinHash ? 4 : 5),
      lockTimeout: typeof parsed.lockTimeout === 'number' ? parsed.lockTimeout : 0,
    };
    cachedSettings = merged;
    return merged;
  } catch {
    cachedSettings = INITIAL_SETTINGS;
    return INITIAL_SETTINGS;
  }
}

export const DEVICE_SETTINGS_KEYS = ['theme', 'appLockEnabled', 'pinHash', 'pinLength', 'lockTimeout'] as const;

export async function saveSettings(settings: AppSettings): Promise<void> {
  const prev = cachedSettings ?? (typeof localStorage !== 'undefined' && localStorage.getItem(SETTINGS_KEY) ? JSON.parse(localStorage.getItem(SETTINGS_KEY)!) : null);

  const normalized: AppSettings = {
    ...settings,
    numberFormat: settings.numberFormat || 'million',
    taxFormulaSalesPercent: typeof settings.taxFormulaSalesPercent === 'number' ? settings.taxFormulaSalesPercent : 18,
    taxFormulaIncomePercent: typeof settings.taxFormulaIncomePercent === 'number' ? settings.taxFormulaIncomePercent : 5,
    appLockEnabled: Boolean(settings.appLockEnabled),
    pinHash: settings.pinHash || '',
    pinLength: typeof settings.pinLength === 'number' ? settings.pinLength : (settings.pinHash ? 4 : 5),
    lockTimeout: typeof settings.lockTimeout === 'number' ? settings.lockTimeout : 0,
  };

  const sharedChanged = Boolean(
    prev &&
    Object.keys({ ...prev, ...normalized }).some((k) => {
      if ((DEVICE_SETTINGS_KEYS as readonly string[]).includes(k as any) || k === 'updatedAt') {
        return false;
      }
      return JSON.stringify((prev as any)[k]) !== JSON.stringify((normalized as any)[k]);
    })
  );

  const updatedSettings: AppSettings = {
    ...normalized,
    updatedAt: !prev
      ? (settings.updatedAt ?? Date.now())
      : sharedChanged
      ? Date.now()
      : (prev.updatedAt ?? settings.updatedAt ?? Date.now()),
  };
  cachedSettings = updatedSettings;
  writeStorageOrThrow(SETTINGS_KEY, JSON.stringify(updatedSettings));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('app_settings_changed', { detail: updatedSettings }));
  }
  notifyLedgerMutation('settings', undefined, 'update');
}

// -- Backup & Restore helpers --
export type { BackupPayload };


export async function getAllBackupData(): Promise<BackupPayload> {
  await ensureInitialized();
  const [parties, dispatches, payments, expenses, pos, lots, mines, settings] = await Promise.all([
    getParties(),
    getDispatches(),
    getPayments(),
    getGeneralExpenses(),
    getPurchaseOrders(),
    getLots(),
    getMines(),
    getSettings(),
  ]);

  const nowIso = new Date().toISOString();
  return {
    version: CURRENT_DATA_VERSION,
    exportDate: nowIso,
    exportedAt: nowIso,
    createdAt: nowIso,
    parties,
    dispatches,
    payments,
    expenses,
    pos,
    lots,
    mines,
    settings,
  };
}

/**
 * Generate sanitized backup payload for file export / sharing.
 * Exports parties, dispatches, payments, purchase orders, business branding & tax settings,
 * but STRIPS sensitive PIN hash and device lock credentials.
 */
export async function getExportBackupData(): Promise<BackupPayload> {
  const full = await getAllBackupData();
  const sanitizedSettings: AppSettings = {
    ...full.settings,
    appLockEnabled: false,
  };
  delete (sanitizedSettings as any).pinHash;
  delete (sanitizedSettings as any).pinLength;
  delete (sanitizedSettings as any).lockTimeout;

  return {
    ...full,
    settings: sanitizedSettings,
  };
}

/**
 * Issue 11: Retrieve ledger records for cloud synchronization.
 * If onlyDirty is true, only returns records with dirty: true for bandwidth-efficient delta sync.
 * Includes soft-deleted records so deletions propagate to the cloud.
 */
export async function getLedgerForSync(onlyDirty = false): Promise<{
  parties: Party[];
  dispatches: Dispatch[];
  payments: Payment[];
  expenses: GeneralExpense[];
  pos: PurchaseOrder[];
  lots: InventoryLot[];
  mines: Mine[];
  settings: AppSettings;
}> {
  await ensureInitialized();
  const [parties, dispatches, payments, expenses, pos, lots, mines, settings] = await Promise.all([
    idb.parties.toArray(),
    idb.dispatches.toArray(),
    idb.payments.toArray(),
    idb.expenses.toArray(),
    idb.pos.toArray(),
    idb.lots.toArray(),
    idb.mines.toArray(),
    getSettings(),
  ]);

  // Issue 70: Dispatches created by the affected form version could retain a
  // blank factory snapshot even though they still reference a valid party.
  // Firestore intentionally rejects that incomplete accounting record. Repair
  // those local records before selecting the dirty sync batch so existing
  // stuck dispatches recover without requiring the user to edit each one.
  const partyNameById = new Map(
    parties
      .map((party) => [party.id, party.name?.trim()] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
  );
  const repairTimestamp = Date.now();
  const repairedRecords: Dispatch[] = [];
  const syncDispatches = dispatches.map((dispatch) => {
    if (dispatch.factoryName?.trim()) return dispatch;

    const linkedPartyName = dispatch.partyId ? partyNameById.get(dispatch.partyId) : undefined;
    if (!linkedPartyName) return dispatch;

    const repaired: Dispatch = {
      ...dispatch,
      factoryName: linkedPartyName,
      updatedAt: repairTimestamp,
      dirty: true,
    };
    repairedRecords.push(repaired);
    return repaired;
  });

  if (repairedRecords.length > 0) {
    await idb.dispatches.bulkPut(repairedRecords);
  }

  if (onlyDirty) {
    return {
      parties: parties.filter((p) => p.dirty),
      dispatches: syncDispatches.filter((d) => d.dirty),
      payments: payments.filter((p) => p.dirty),
      expenses: expenses.filter((e) => e.dirty),
      pos: pos.filter((po) => po.dirty),
      lots: lots.filter((l) => l.dirty),
      mines: mines.filter((m) => m.dirty),
      settings,
    };
  }

  return { parties, dispatches: syncDispatches, payments, expenses, pos, lots, mines, settings };
}

/**
 * Issue 11 & Issue 31: Marks synced records as clean (dirty: false) in IndexedDB after successful cloud commit.
 * Only clears dirty flag if the record's updatedAt matches the uploaded version, preventing race condition
 * where local edits during an in-flight upload are accidentally marked clean.
 */
export async function markRecordsClean(synced: {
  parties?: Array<{ id: string; updatedAt: number }>;
  dispatches?: Array<{ id: string; updatedAt: number }>;
  payments?: Array<{ id: string; updatedAt: number }>;
  expenses?: Array<{ id: string; updatedAt: number }>;
  pos?: Array<{ id: string; updatedAt: number }>;
  lots?: Array<{ id: string; updatedAt: number }>;
  mines?: Array<{ id: string; updatedAt: number }>;
}): Promise<void> {
  await ensureInitialized();
  await idb.transaction('rw', [idb.parties, idb.dispatches, idb.payments, idb.expenses, idb.pos, idb.lots, idb.mines], async () => {
    const clean = async (table: any, list?: Array<{ id: string; updatedAt: number }>) => {
      for (const { id, updatedAt } of list ?? []) {
        const item = await table.get(id);
        // Only clear if nobody edited it since we uploaded that exact version (Issue 31)
        if (item && item.dirty && item.updatedAt === updatedAt) {
          await table.update(id, { dirty: false });
        }
      }
    };
    await clean(idb.parties, synced.parties);
    await clean(idb.dispatches, synced.dispatches);
    await clean(idb.payments, synced.payments);
    await clean(idb.expenses, synced.expenses);
    await clean(idb.pos, synced.pos);
    await clean(idb.lots, synced.lots);
    await clean(idb.mines, synced.mines);
  });
}

export interface PreRestoreSnapshotMeta {
  timestamp: number;
  dateStr: string;
  dispatchCount: number;
  partyCount: number;
  paymentCount: number;
  expenseCount: number;
  poCount: number;
  lotCount: number;
  mineCount?: number;
}

const PRE_RESTORE_SNAPSHOT_KEY = 'last_pre_restore_snapshot';
const SNAPSHOT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Issue 13 & 24: Retrieve pre-restore snapshot from IndexedDB meta table.
 * Cleans up snapshots older than 7 days to conserve client storage.
 */
export async function getPreRestoreSnapshot(): Promise<BackupPayload | null> {
  await ensureInitialized();
  const record = await idb.meta.get(PRE_RESTORE_SNAPSHOT_KEY);
  if (!record || !record.value) return null;

  if (record.updatedAt && Date.now() - record.updatedAt > SNAPSHOT_LIFETIME_MS) {
    try {
      await idb.meta.delete(PRE_RESTORE_SNAPSHOT_KEY);
    } catch {
      // ignore
    }
    return null;
  }

  return record.value as BackupPayload;
}

/**
 * Issue 24: Extract UI-friendly metadata (counts and formatted date) from pre-restore snapshot.
 */
export async function getPreRestoreSnapshotMeta(): Promise<PreRestoreSnapshotMeta | null> {
  await ensureInitialized();
  const record = await idb.meta.get(PRE_RESTORE_SNAPSHOT_KEY);
  if (!record || !record.value) return null;

  if (record.updatedAt && Date.now() - record.updatedAt > SNAPSHOT_LIFETIME_MS) {
    try {
      await idb.meta.delete(PRE_RESTORE_SNAPSHOT_KEY);
    } catch {
      // ignore
    }
    return null;
  }

  const payload = record.value as BackupPayload;
  const parties = Array.isArray(payload.parties) ? payload.parties.length : 0;
  const dispatches = Array.isArray(payload.dispatches) ? payload.dispatches.length : 0;
  const payments = Array.isArray(payload.payments) ? payload.payments.length : 0;
  const expenses = Array.isArray(payload.expenses) ? payload.expenses.length : 0;
  const pos = Array.isArray(payload.pos) ? payload.pos.length : 0;
  const lots = Array.isArray(payload.lots) ? payload.lots.length : 0;
  const timestamp = typeof record.updatedAt === 'number' ? record.updatedAt : Date.now();

  const dateObj = new Date(timestamp);
  const dateStr = dateObj.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  return {
    timestamp,
    dateStr,
    dispatchCount: dispatches,
    partyCount: parties,
    paymentCount: payments,
    expenseCount: expenses,
    poCount: pos,
    lotCount: lots,
  };
}

/**
 * Issue 13 & 24: Rollback to the pre-restore snapshot if a restore caused issues.
 * Reversible two-way undo: does NOT skip snapshotting, so the pre-rollback state
 * is itself snapshotted before rollback proceeds.
 */
export async function rollbackToPreRestoreSnapshot(): Promise<{
  success: boolean;
  message: string;
  counts?: { parties: number; dispatches: number; payments: number; expenses?: number; pos: number; lots?: number };
}> {
  const snapshot = await getPreRestoreSnapshot();
  if (!snapshot) {
    return { success: false, message: 'No pre-restore snapshot available to rollback.' };
  }
  // Reversible: allow restoreBackup to capture current state into last_pre_restore_snapshot
  return restoreBackup(snapshot, { silent: false, skipSnapshot: false });
}

/**
 * Issue 13: Hardened backup restore:
 * 1. Validates and sanitizes every record BEFORE touching storage.
 * 2. Takes an automatic pre-restore snapshot stored in IndexedDB.
 * 3. Restores records atomically in a Dexie transaction.
 * 4. Verifies post-write counts.
 */
export interface BackupValidationResult {
  valid: boolean;
  error?: string;
  counts?: {
    parties: number;
    dispatches: number;
    payments: number;
    expenses: number;
    pos: number;
    lots: number;
    mines: number;
  };
}

/**
 * Exhaustive structural, relational, and business-value validator for backup payloads.
 * Rejects damaged, malicious, or malformed data before modifying local storage.
 */
export function validateBackupPayload(backup: any): BackupValidationResult {
  const isObject = (value: unknown): value is Record<string, any> =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  const isText = (value: unknown, required = false): value is string =>
    typeof value === 'string' && value.length <= 5000 && (!required || value.trim().length > 0);
  const isNumber = (value: unknown, positive = false): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= (positive ? Number.EPSILON : 0) && value <= 1_000_000_000_000;
  const isEpoch = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
  const isDate = (value: unknown): value is string => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  };
  const fail = (error: string): BackupValidationResult => ({ valid: false, error });

  if (!isObject(backup)) return fail('Backup root must be a valid JSON object.');
  if (!isText(backup.exportDate, true) || Number.isNaN(Date.parse(backup.exportDate))) {
    return fail('Backup is missing a valid export date.');
  }
  if (!isObject(backup.settings)) return fail('Backup settings must be a valid object.');

  const requiredCollections = ['parties', 'dispatches', 'payments', 'pos'] as const;
  for (const key of requiredCollections) {
    if (!Array.isArray(backup[key])) return fail(`Backup is missing the required ${key} collection.`);
  }
  const optionalCollections = ['expenses', 'lots', 'mines'] as const;
  for (const key of optionalCollections) {
    if (backup[key] !== undefined && !Array.isArray(backup[key])) {
      return fail(`${key[0].toUpperCase()}${key.slice(1)} list in backup must be an array.`);
    }
  }

  const parties: any[] = backup.parties;
  const dispatches: any[] = backup.dispatches;
  const payments: any[] = backup.payments;
  const expenses: any[] = backup.expenses ?? [];
  const pos: any[] = backup.pos;
  const lots: any[] = backup.lots ?? [];
  const mines: any[] = backup.mines ?? [];

  const collectIds = (records: any[], label: string): { ids?: Set<string>; error?: string } => {
    const ids = new Set<string>();
    for (let index = 0; index < records.length; index++) {
      const record = records[index];
      if (!isObject(record)) return { error: `${label} at index ${index} is not a valid object.` };
      if (!isText(record.id, true) || record.id !== record.id.trim()) {
        return { error: `${label} at index ${index} has an empty or invalid ID.` };
      }
      if (ids.has(record.id)) return { error: `Duplicate ${label.toLowerCase()} ID "${record.id}" found in backup.` };
      ids.add(record.id);
    }
    return { ids };
  };

  const idResults = {
    parties: collectIds(parties, 'Party'),
    dispatches: collectIds(dispatches, 'Dispatch'),
    payments: collectIds(payments, 'Payment'),
    expenses: collectIds(expenses, 'Expense'),
    pos: collectIds(pos, 'Purchase Order'),
    lots: collectIds(lots, 'Lot'),
    mines: collectIds(mines, 'Mine'),
  };
  for (const result of Object.values(idResults)) {
    if (result.error) return fail(result.error);
  }

  const partyIds = idResults.parties.ids!;
  const dispatchIds = idResults.dispatches.ids!;
  const paymentIds = idResults.payments.ids!;
  const expenseIds = idResults.expenses.ids!;
  const poIds = idResults.pos.ids!;
  const lotIds = idResults.lots.ids!;
  const mineIds = idResults.mines.ids!;
  const activePartyIds = new Set(parties.filter((party) => !party.deleted).map((party) => party.id));

  const validateLifecycle = (record: any, label: string): string | null => {
    if (record.deleted !== undefined && typeof record.deleted !== 'boolean') return `${label} has an invalid deleted flag.`;
    if (record.dirty !== undefined && typeof record.dirty !== 'boolean') return `${label} has an invalid dirty flag.`;
    if (record.deleted) {
      if (!isEpoch(record.deletedAt) || !isEpoch(record.updatedAt)) return `${label} has an invalid deletion timestamp.`;
      return null;
    }
    if (!isEpoch(record.createdAt)) return `${label} has an invalid created timestamp.`;
    if (record.updatedAt !== undefined && !isEpoch(record.updatedAt)) return `${label} has an invalid updated timestamp.`;
    return null;
  };

  for (const party of parties) {
    const label = `Party "${party.id}"`;
    const lifecycleError = validateLifecycle(party, label);
    if (lifecycleError) return fail(lifecycleError);
    if (party.deleted) continue;
    if (!isText(party.name, true)) return fail(`${label} has an empty or invalid name.`);
    for (const field of ['contactPerson', 'phone', 'address'] as const) {
      if (party[field] !== undefined && !isText(party[field])) return fail(`${label} has an invalid ${field}.`);
    }
    if (party.isArchived !== undefined && typeof party.isArchived !== 'boolean') return fail(`${label} has an invalid archive flag.`);
  }

  for (const payment of payments) {
    const label = `Payment "${payment.id}"`;
    const lifecycleError = validateLifecycle(payment, label);
    if (lifecycleError) return fail(lifecycleError);
    if (payment.deleted) continue;
    if (!isNumber(payment.amount, true)) return fail(`${label} must have an amount greater than zero.`);
    if (!isDate(payment.date)) return fail(`${label} has an invalid date "${payment.date}".`);
    if (!isText(payment.partyId, true)) return fail(`${label} is missing a required party reference.`);
    if (!activePartyIds.has(payment.partyId)) return fail(`${label} references non-existent party "${payment.partyId}".`);
    if (!['received', 'paid'].includes(payment.type)) return fail(`${label} has an invalid payment type.`);
    if (!['bank', 'cash', 'cheque', 'online'].includes(payment.mode)) return fail(`${label} has an invalid payment mode.`);
  }

  const overheadFields = ['loading', 'freight', 'crush', 'royalty', 'other'] as const;
  for (const dispatch of dispatches) {
    const label = `Dispatch "${dispatch.id}"`;
    const lifecycleError = validateLifecycle(dispatch, label);
    if (lifecycleError) return fail(lifecycleError);
    if (dispatch.deleted) continue;
    if (!isDate(dispatch.date)) return fail(`${label} has an invalid date "${dispatch.date}".`);
    if (!isText(dispatch.partyId, true) || !activePartyIds.has(dispatch.partyId)) {
      return fail(`${label} references non-existent party "${dispatch.partyId || ''}".`);
    }
    if (!isText(dispatch.factoryName, true)) return fail(`${label} is missing a factory name.`);
    if (!isText(dispatch.truckNumber, true)) return fail(`${label} is missing a truck number.`);
    for (const field of ['targetGcv', 'baseRate', 'labActualGcv', 'labReceivedWeight', 'labSulphur'] as const) {
      if (!isNumber(dispatch[field])) return fail(`${label} has an invalid ${field}.`);
    }
    if (!isObject(dispatch.overheads)) return fail(`${label} has malformed overheads.`);
    for (const field of overheadFields) {
      if (!isNumber(dispatch.overheads[field])) return fail(`${label} has an invalid ${field} overhead.`);
    }
    if (!Array.isArray(dispatch.coalInputs) || dispatch.coalInputs.length > 30) return fail(`${label} has malformed coal recipe inputs.`);
    for (let index = 0; index < dispatch.coalInputs.length; index++) {
      const input = dispatch.coalInputs[index];
      if (!isObject(input) || !isText(input.id, true) || !isText(input.sourceName, true) ||
          !isNumber(input.weight, true) || !isNumber(input.purchaseRate)) {
        return fail(`${label} has an invalid coal input at index ${index}.`);
      }
      if (input.lotId !== undefined && !isText(input.lotId, true)) return fail(`${label} has an invalid lot reference.`);
      if (input.mineId !== undefined && !isText(input.mineId, true)) return fail(`${label} has an invalid mine reference.`);
    }
    if (dispatch.poId !== undefined && !isText(dispatch.poId, true)) return fail(`${label} has an invalid purchase order reference.`);
    if (dispatch.status !== undefined && !['pending', 'settled'].includes(dispatch.status)) return fail(`${label} has an invalid status.`);
    if (dispatch.gcvAdjustment !== undefined && !['manual', 'prorata'].includes(dispatch.gcvAdjustment)) return fail(`${label} has an invalid GCV adjustment mode.`);
    if (dispatch.gcvAdjustmentRounding !== undefined && !['rupee', 'paisa'].includes(dispatch.gcvAdjustmentRounding)) return fail(`${label} has an invalid GCV rounding mode.`);
    if (dispatch.taxMethod !== undefined && !['manual', 'formula_18_5'].includes(dispatch.taxMethod)) return fail(`${label} has an invalid tax method.`);
    if (dispatch.settledAt !== undefined && !isEpoch(dispatch.settledAt)) return fail(`${label} has an invalid settlement timestamp.`);
    if (dispatch.settledDate !== undefined && !isDate(dispatch.settledDate)) return fail(`${label} has an invalid settlement date.`);
    for (const field of ['commissionPerTon', 'manualDeduction', 'manualPremium', 'manualTax', 'taxSalesPercent', 'taxIncomePercent'] as const) {
      if (dispatch[field] !== undefined && !isNumber(dispatch[field])) return fail(`${label} has an invalid ${field}.`);
    }
  }

  for (const expense of expenses) {
    const label = `Expense "${expense.id}"`;
    const lifecycleError = validateLifecycle(expense, label);
    if (lifecycleError) return fail(lifecycleError);
    if (expense.deleted) continue;
    if (!isNumber(expense.amount, true)) return fail(`${label} must have an amount greater than zero.`);
    if (!isText(expense.description, true)) return fail(`${label} is missing a description.`);
    if (!isDate(expense.date)) return fail(`${label} has an invalid date "${expense.date}".`);
    if (!GENERAL_EXPENSE_CATEGORIES.has(expense.category)) return fail(`${label} has an invalid category.`);
    if (expense.paymentMode !== undefined && !['bank', 'cash', 'cheque', 'online'].includes(expense.paymentMode)) {
      return fail(`${label} has an invalid payment mode.`);
    }
  }

  for (const lot of lots) {
    const label = `Lot "${lot.id}"`;
    const lifecycleError = validateLifecycle(lot, label);
    if (lifecycleError) return fail(lifecycleError);
    if (lot.deleted) continue;
    if (!isText(lot.supplier || lot.boughtFrom, true)) return fail(`${label} is missing a supplier.`);
    if (!isDate(lot.date)) return fail(`${label} has an invalid date "${lot.date}".`);
    const billedWeight = lot.billedWeight ?? lot.tonnage;
    const receivedWeight = lot.receivedWeight ?? billedWeight;
    const purchaseRate = lot.purchaseRate ?? lot.ratePerTon;
    if (!isNumber(billedWeight, true) || !isNumber(receivedWeight, true) || !isNumber(purchaseRate, true)) {
      return fail(`${label} must have positive billed weight, received weight, and purchase rate.`);
    }
    if (lot.landedRate !== undefined && !isNumber(lot.landedRate)) return fail(`${label} has an invalid landed rate.`);
    for (const field of ['loadingCost', 'freightCost', 'totalValue', 'tonnage', 'ratePerTon', 'gcv', 'targetGcv'] as const) {
      if (lot[field] !== undefined && !isNumber(lot[field])) return fail(`${label} has an invalid ${field}.`);
    }
    if (lot.mineId !== undefined && !isText(lot.mineId, true)) return fail(`${label} has an invalid mine reference.`);
  }

  for (const mine of mines) {
    const label = `Mine "${mine.id}"`;
    const lifecycleError = validateLifecycle(mine, label);
    if (lifecycleError) return fail(lifecycleError);
    if (mine.deleted) continue;
    if (!isText(mine.name, true)) return fail(`${label} is missing a name.`);
    if (!isNumber(mine.ratePerTon)) return fail(`${label} has an invalid rate per ton.`);
  }

  for (const po of pos) {
    const label = `Purchase Order "${po.id}"`;
    const lifecycleError = validateLifecycle(po, label);
    if (lifecycleError) return fail(lifecycleError);
    if (po.deleted) continue;
    if (!isText(po.partyId, true) || !activePartyIds.has(po.partyId)) return fail(`${label} references non-existent party "${po.partyId || ''}".`);
    if (!isText(po.poNumber, true)) return fail(`${label} is missing a PO number.`);
    for (const field of ['targetGcv', 'baseRate', 'commissionPerTon'] as const) {
      if (!isNumber(po[field])) return fail(`${label} has an invalid ${field}.`);
    }
    if (po.totalTons !== undefined && !isNumber(po.totalTons)) return fail(`${label} has invalid total tons.`);
    if (typeof po.isActive !== 'boolean') return fail(`${label} has an invalid active flag.`);
    if (po.gcvAdjustment !== undefined && !['manual', 'prorata'].includes(po.gcvAdjustment)) return fail(`${label} has an invalid GCV adjustment mode.`);
    if (po.gcvAdjustmentRounding !== undefined && !['rupee', 'paisa'].includes(po.gcvAdjustmentRounding)) return fail(`${label} has an invalid GCV rounding mode.`);
  }

  const settings = backup.settings;
  if (settings.theme !== undefined && !['light', 'dark', 'system'].includes(settings.theme)) return fail('Backup settings contain an invalid theme.');
  if (settings.numberFormat !== undefined && !['lakh', 'million'].includes(settings.numberFormat)) return fail('Backup settings contain an invalid number format.');
  if (settings.defaultTaxMethod !== undefined && !['manual', 'formula_18_5'].includes(settings.defaultTaxMethod)) return fail('Backup settings contain an invalid default tax method.');
  for (const field of ['taxFormulaSalesPercent', 'taxFormulaIncomePercent'] as const) {
    if (settings[field] !== undefined && !isNumber(settings[field])) return fail(`Backup settings contain an invalid ${field}.`);
  }
  if (settings.updatedAt !== undefined && !isEpoch(settings.updatedAt)) return fail('Backup settings contain an invalid updated timestamp.');

  return {
    valid: true,
    counts: {
      parties: partyIds.size,
      dispatches: dispatchIds.size,
      payments: paymentIds.size,
      expenses: expenseIds.size,
      pos: poIds.size,
      lots: lotIds.size,
      mines: mineIds.size,
    },
  };
}

/**
 * Restores all database collections from a JSON backup payload:
 * 1. Deeply validates and sanitizes all incoming records before touching storage.
 * 2. Captures an automatic pre-restore snapshot stored in IndexedDB.
 * 3. Restores records atomically in a Dexie transaction.
 * 4. Verifies actual post-write counts directly from IndexedDB.
 */
export async function restoreBackup(
  backup: Partial<BackupPayload>,
  options?: { silent?: boolean; skipSnapshot?: boolean }
): Promise<{
  success: boolean;
  message: string;
  counts?: { parties: number; dispatches: number; payments: number; expenses: number; pos: number; lots: number; mines: number };
}> {
  await ensureInitialized();

  // 1. Deeply validate payload before touching any table
  const validation = validateBackupPayload(backup);
  if (!validation.valid) {
    return { success: false, message: `Backup validation failed: ${validation.error}` };
  }

  const rawParties = Array.isArray(backup.parties) ? backup.parties : [];
  const rawDispatches = Array.isArray(backup.dispatches) ? backup.dispatches : [];
  const rawPayments = Array.isArray(backup.payments) ? backup.payments : [];
  const rawExpenses = Array.isArray(backup.expenses) ? backup.expenses : [];
  const rawPos = Array.isArray(backup.pos) ? backup.pos : [];
  const rawLots = Array.isArray(backup.lots) ? backup.lots : [];
  const rawMines = Array.isArray(backup.mines) ? backup.mines : [];

  const sanitizedParties = rawParties.map(sanitizeParty);
  const sanitizedDispatches = rawDispatches.map(sanitizeDispatch);
  const sanitizedPayments = rawPayments.map(sanitizePayment);
  const sanitizedExpenses = rawExpenses.map(sanitizeGeneralExpense);
  const sanitizedPos = rawPos.map(sanitizePurchaseOrder);
  const sanitizedLots = rawLots.map(sanitizeLot);
  const sanitizedMines = rawMines.map(sanitizeMine);

  // 2. Take automatic pre-restore snapshot and store in IndexedDB
  if (!options?.skipSnapshot) {
    try {
      const currentBackup = await getAllBackupData();
      await idb.meta.put({
        key: 'last_pre_restore_snapshot',
        value: currentBackup,
        updatedAt: Date.now(),
      });
    } catch (snapErr) {
      console.error('[DB] Could not capture required pre-restore snapshot:', snapErr);
      return {
        success: false,
        message: 'Restore stopped because a safety snapshot could not be created. Existing data was not changed.',
      };
    }
  }

  const rawSettings = backup.settings as AppSettings;
  const currentSettings = getCachedSettings();
  const settings: AppSettings = {
    ...INITIAL_SETTINGS,
    ...rawSettings,
    appLockEnabled: currentSettings.appLockEnabled ?? false,
    pinHash: currentSettings.pinHash ?? '',
    pinLength: currentSettings.pinLength ?? 5,
    lockTimeout: currentSettings.lockTimeout ?? 0,
  };
  const previousSettingsRaw = typeof localStorage !== 'undefined' ? localStorage.getItem(SETTINGS_KEY) : null;
  const previousVersionRaw = typeof localStorage !== 'undefined' ? localStorage.getItem(DATA_VERSION_KEY) : null;
  const restoreLocalStorageValue = (key: string, previousValue: string | null) => {
    if (typeof localStorage === 'undefined') return;
    if (previousValue === null) localStorage.removeItem(key);
    else localStorage.setItem(key, previousValue);
  };

  // Stage the small localStorage writes first. If either fails, IndexedDB is untouched.
  try {
    writeStorageOrThrow(SETTINGS_KEY, JSON.stringify(settings));
    writeStorageOrThrow(DATA_VERSION_KEY, CURRENT_DATA_VERSION);

    let actualCounts: { parties: number; dispatches: number; payments: number; expenses: number; pos: number; lots: number; mines: number } | undefined;
    await idb.transaction('rw', [idb.parties, idb.dispatches, idb.payments, idb.expenses, idb.pos, idb.lots, idb.mines], async () => {
      await idb.parties.clear();
      await idb.dispatches.clear();
      await idb.payments.clear();
      await idb.expenses.clear();
      await idb.pos.clear();
      await idb.lots.clear();
      await idb.mines.clear();

      if (sanitizedParties.length > 0) await idb.parties.bulkPut(sanitizedParties);
      if (sanitizedDispatches.length > 0) await idb.dispatches.bulkPut(sanitizedDispatches);
      if (sanitizedPayments.length > 0) await idb.payments.bulkPut(sanitizedPayments);
      if (sanitizedExpenses.length > 0) await idb.expenses.bulkPut(sanitizedExpenses);
      if (sanitizedPos.length > 0) await idb.pos.bulkPut(sanitizedPos);
      if (sanitizedLots.length > 0) await idb.lots.bulkPut(sanitizedLots);
      if (sanitizedMines.length > 0) await idb.mines.bulkPut(sanitizedMines);

      // Verify inside the transaction so any mismatch aborts and rolls back all tables.
      actualCounts = {
        parties: await idb.parties.count(),
        dispatches: await idb.dispatches.count(),
        payments: await idb.payments.count(),
        expenses: await idb.expenses.count(),
        pos: await idb.pos.count(),
        lots: await idb.lots.count(),
        mines: await idb.mines.count(),
      };

      if (
        actualCounts.parties !== sanitizedParties.length ||
        actualCounts.dispatches !== sanitizedDispatches.length ||
        actualCounts.payments !== sanitizedPayments.length ||
        actualCounts.expenses !== sanitizedExpenses.length ||
        actualCounts.pos !== sanitizedPos.length ||
        actualCounts.lots !== sanitizedLots.length ||
        actualCounts.mines !== sanitizedMines.length
      ) {
        throw new Error('Database post-write verification mismatch: actual counts in storage do not match input records.');
      }
    });

    if (!actualCounts) throw new Error('Database post-write verification did not complete.');
    cachedSettings = settings;

    if (!options?.silent) {
      notifyLedgerMutation('all', undefined, 'restore');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('app_settings_changed', { detail: settings }));
      }
    }

    return {
      success: true,
      message: 'Backup restored successfully!',
      counts: actualCounts,
    };
  } catch (err: any) {
    try {
      restoreLocalStorageValue(SETTINGS_KEY, previousSettingsRaw);
      restoreLocalStorageValue(DATA_VERSION_KEY, previousVersionRaw);
      cachedSettings = currentSettings;
    } catch (rollbackErr) {
      console.error('[DB] Failed to roll back staged settings after restore error:', rollbackErr);
    }
    console.error('[DB] Restore error:', err);
    return { success: false, message: err?.message || 'Failed to restore backup' };
  }
}

export async function clearAllData(options?: { resetSettings?: boolean; resetOwner?: boolean }): Promise<void> {
  await ensureInitialized();
  await idb.transaction('rw', [idb.parties, idb.dispatches, idb.payments, idb.expenses, idb.pos, idb.lots, idb.mines, idb.conflicts], async () => {
    await idb.parties.clear();
    await idb.dispatches.clear();
    await idb.payments.clear();
    await idb.expenses.clear();
    await idb.pos.clear();
    await idb.lots.clear();
    await idb.mines.clear();
    await idb.conflicts.clear();
  });

  if (typeof localStorage !== 'undefined') {
    writeStorageOrThrow(TOMBSTONES_KEY, JSON.stringify({}));
    writeStorageOrThrow(DATA_VERSION_KEY, CURRENT_DATA_VERSION);
    if (options?.resetSettings) {
      writeStorageOrThrow(SETTINGS_KEY, JSON.stringify(INITIAL_SETTINGS));
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('app_settings_changed', { detail: INITIAL_SETTINGS }));
      }
    }
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('sync_conflict_archive_changed'));

  if (options?.resetOwner) {
    setLedgerOwner(null, null);
  }
  notifyLedgerMutation('all', undefined, 'delete');
}

export type ConflictAuditEntry = SyncConflictRecord;

const STORAGE_KEY_CONFLICT_AUDIT = 'coal_sync_conflicts';

async function migrateLegacyConflictHistory(): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  const raw = localStorage.getItem(STORAGE_KEY_CONFLICT_AUDIT);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const migrated = parsed
        .filter((entry) => entry && typeof entry === 'object' && entry.id && entry.entityId)
        .map((entry): ConflictAuditEntry => ({
          id: String(entry.id),
          collection: String(entry.collection || 'records'),
          entityId: String(entry.entityId),
          localUpdatedAt: cleanNumber(entry.localUpdatedAt),
          cloudUpdatedAt: cleanNumber(entry.cloudUpdatedAt),
          winner: entry.winner === 'local' ? 'local' : 'cloud',
          timestamp: cleanNumber(entry.timestamp, Date.now()),
          losingSnapshot: entry.losingSnapshot ?? null,
          winningSnapshot: entry.winningSnapshot ?? null,
          conflictType: entry.conflictType === 'delete-vs-edit' || entry.conflictType === 'equal-timestamp'
            ? entry.conflictType
            : 'update-vs-update',
        }));
      if (migrated.length > 0) await idb.conflicts.bulkPut(migrated);
    }
    localStorage.removeItem(STORAGE_KEY_CONFLICT_AUDIT);
  } catch (err) {
    console.warn('[SyncAudit] Failed to migrate legacy conflict history:', err);
  }
}

export async function getSyncConflictHistory(): Promise<ConflictAuditEntry[]> {
  await ensureInitialized();
  await migrateLegacyConflictHistory();
  return idb.conflicts.orderBy('timestamp').reverse().limit(200).toArray();
}

export async function recordSyncConflicts(entries: ConflictAuditEntry[]): Promise<void> {
  if (!entries || entries.length === 0) return;
  await ensureInitialized();
  await migrateLegacyConflictHistory();
  await idb.transaction('rw', idb.conflicts, async () => {
    await idb.conflicts.bulkPut(entries);
    const staleIds = await idb.conflicts.orderBy('timestamp').reverse().offset(200).primaryKeys();
    if (staleIds.length > 0) await idb.conflicts.bulkDelete(staleIds);
  });
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('sync_conflict_archive_changed'));
}

export async function clearSyncConflictHistory(): Promise<void> {
  await ensureInitialized();
  await idb.conflicts.clear();
  if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY_CONFLICT_AUDIT);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('sync_conflict_archive_changed'));
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function snapshotRecord<T>(record: T): T {
  return JSON.parse(JSON.stringify(record)) as T;
}

/**
 * Helper to reconcile a single entity collection between local and remote datasets:
 * - Honors soft deletes (deleted: true, deletedAt) across both local and remote.
 * - Compares deletion timestamps vs edit timestamps (newer edit can undelete).
 * - Honors tombstones for backward compatibility.
 * - Uses immutable record ID as key (Issue 12).
 * - Records non-silent conflict audit entries with snapshots when timestamps differ.
 */
function mergeCollection<T extends { id: string; updatedAt?: number; createdAt?: number; deleted?: boolean; deletedAt?: number }>(
  localList: T[] = [],
  cloudList: T[] = [],
  tombstones: Record<string, number> = {},
  collectionName: string = 'records',
  conflicts: ConflictAuditEntry[] = []
): { mergedList: T[]; localChanges: boolean; cloudChanges: boolean } {
  let localChanges = false;
  let cloudChanges = false;
  const itemMap = new Map<string, T>();
  const addConflict = (
    localRecord: T,
    cloudRecord: T,
    winner: 'cloud' | 'local',
    conflictType: ConflictAuditEntry['conflictType'],
  ) => {
    const localTime = localRecord.updatedAt || localRecord.deletedAt || localRecord.createdAt || 0;
    const cloudTime = cloudRecord.updatedAt || cloudRecord.deletedAt || cloudRecord.createdAt || 0;
    conflicts.push({
      id: uuidv4(),
      collection: collectionName,
      entityId: localRecord.id || cloudRecord.id,
      localUpdatedAt: localTime,
      cloudUpdatedAt: cloudTime,
      winner,
      timestamp: Date.now(),
      losingSnapshot: snapshotRecord(winner === 'cloud' ? localRecord : cloudRecord),
      winningSnapshot: snapshotRecord(winner === 'cloud' ? cloudRecord : localRecord),
      conflictType,
    });
  };

  for (const item of localList) {
    const isDeleted = Boolean(item.deleted);
    const tombstoneTime = tombstones[item.id];
    if (isDeleted || (tombstoneTime && tombstoneTime >= (item.updatedAt || item.createdAt || 0))) {
      continue;
    }
    itemMap.set(item.id, item);
  }

  for (const cItem of cloudList) {
    const tombstoneTime = tombstones[cItem.id];
    const cloudTime = cItem.updatedAt || cItem.createdAt || 0;
    const isCloudDeleted = Boolean(cItem.deleted);
    const cloudDeleteTime = isCloudDeleted ? (cItem.deletedAt || cloudTime) : 0;

    if (tombstoneTime && tombstoneTime >= cloudTime) {
      itemMap.delete(cItem.id);
      cloudChanges = true;
      if (!isCloudDeleted) {
        addConflict(
          { id: cItem.id, deleted: true, deletedAt: tombstoneTime, updatedAt: tombstoneTime } as T,
          cItem,
          'local',
          'delete-vs-edit',
        );
      }
      continue;
    }

    const localItem = localList.find((l) => l.id === cItem.id);
    const isLocalDeleted = Boolean(localItem?.deleted);
    const localDeleteTime = isLocalDeleted ? (localItem?.deletedAt || localItem?.updatedAt || 0) : 0;

    if (isCloudDeleted) {
      if (localItem && !isLocalDeleted) {
        const localTime = localItem.updatedAt || localItem.createdAt || 0;
        if (cloudDeleteTime >= localTime) {
          itemMap.delete(cItem.id);
          localChanges = true;
          addConflict(localItem, cItem, 'cloud', 'delete-vs-edit');
        } else {
          cloudChanges = true;
          addConflict(localItem, cItem, 'local', 'delete-vs-edit');
        }
      }
      continue;
    }

    if (isLocalDeleted) {
      if (cloudTime > localDeleteTime) {
        itemMap.set(cItem.id, cItem);
        localChanges = true;
        addConflict(localItem!, cItem, 'cloud', 'delete-vs-edit');
      } else {
        itemMap.delete(cItem.id);
        cloudChanges = true;
        addConflict(localItem!, cItem, 'local', 'delete-vs-edit');
      }
      continue;
    }

    const existing = itemMap.get(cItem.id);
    if (!existing) {
      itemMap.set(cItem.id, cItem);
      localChanges = true;
    } else {
      const localTime = existing.updatedAt || existing.createdAt || 0;
      if (cloudTime > localTime) {
        itemMap.set(cItem.id, cItem);
        localChanges = true;
        addConflict(existing, cItem, 'cloud', 'update-vs-update');
      } else if (localTime > cloudTime) {
        cloudChanges = true;
        addConflict(existing, cItem, 'local', 'update-vs-update');
      } else if (stableSerialize(existing) !== stableSerialize(cItem)) {
        // Equal timestamps with different content must converge deterministically.
        // Preserve both versions and use local as the explicit winner.
        cloudChanges = true;
        addConflict(existing, cItem, 'local', 'equal-timestamp');
      }
    }
  }

  return {
    mergedList: Array.from(itemMap.values()),
    localChanges,
    cloudChanges,
  };
}

/**
 * Robust two-way merge between local and remote datasets:
 * - Issue 12: Uses immutable record ID as unique key (NO name-based party merge).
 * - Issue 11: Reconciles soft deletes (deleted: true) and tombstones bidirectionally.
 * - Uses timestamps (updatedAt / createdAt) to resolve conflicts (Last Write Wins).
 * - Surfaces all resolved conflicts in audit log to eliminate silent financial overwrite.
 */
export function mergeLedgerData(
  local: BackupPayload,
  cloud: BackupPayload,
  tombstones: Record<string, number> = {}
): {
  merged: BackupPayload;
  hasLocalChanges: boolean;
  hasCloudChanges: boolean;
  conflicts: ConflictAuditEntry[];
} {
  const conflicts: ConflictAuditEntry[] = [];

  // 1. Parties
  const partiesRes = mergeCollection(local.parties || [], cloud.parties || [], tombstones, 'parties', conflicts);

  // 2. Dispatches
  const dispatchesRes = mergeCollection(local.dispatches || [], cloud.dispatches || [], tombstones, 'dispatches', conflicts);

  // 3. Payments
  const paymentsRes = mergeCollection(local.payments || [], cloud.payments || [], tombstones, 'payments', conflicts);

  // 4. Independent warehouse / general expenses
  const expensesRes = mergeCollection(local.expenses || [], cloud.expenses || [], tombstones, 'expenses', conflicts);

  // 5. Purchase Orders
  const posRes = mergeCollection(local.pos || [], cloud.pos || [], tombstones, 'pos', conflicts);

  // 6. Lots
  const lotsRes = mergeCollection(local.lots || [], cloud.lots || [], tombstones, 'lots', conflicts);

  // 7. Mines
  const minesRes = mergeCollection(local.mines || [], cloud.mines || [], tombstones, 'mines', conflicts);

  let hasLocalChanges =
    partiesRes.localChanges ||
    dispatchesRes.localChanges ||
    paymentsRes.localChanges ||
    expensesRes.localChanges ||
    posRes.localChanges ||
    lotsRes.localChanges ||
    minesRes.localChanges;

  let hasCloudChanges =
    partiesRes.cloudChanges ||
    dispatchesRes.cloudChanges ||
    paymentsRes.cloudChanges ||
    expensesRes.cloudChanges ||
    posRes.cloudChanges ||
    lotsRes.cloudChanges ||
    minesRes.cloudChanges;

  // 8. Settings
  let mergedSettings = { ...local.settings };
  const cloudSettings = cloud.settings;
  if (cloudSettings) {
    const localHasInfo = Boolean(local.settings?.businessName || local.settings?.userName);
    const cloudHasInfo = Boolean(cloudSettings.businessName || cloudSettings.userName);
    const localTime = local.settings?.updatedAt || 0;
    const cloudTime = cloudSettings.updatedAt || 0;

    if (!localHasInfo && cloudHasInfo) {
      mergedSettings = { ...cloudSettings };
      hasLocalChanges = true;
    } else if (cloudTime > localTime) {
      mergedSettings = { ...cloudSettings };
      hasLocalChanges = true;
    } else if (localTime > cloudTime) {
      hasCloudChanges = true;
    }
  }

  // Always protect current device security credentials and local theme preference during merge
  mergedSettings = {
    ...mergedSettings,
    theme: local.settings?.theme ?? 'light',
    appLockEnabled: local.settings?.appLockEnabled ?? false,
    pinHash: local.settings?.pinHash ?? '',
    pinLength: local.settings?.pinLength ?? 5,
    lockTimeout: local.settings?.lockTimeout ?? 0,
  };

  const merged: BackupPayload = {
    version: CURRENT_DATA_VERSION,
    exportDate: new Date().toISOString(),
    parties: partiesRes.mergedList,
    dispatches: dispatchesRes.mergedList,
    payments: paymentsRes.mergedList,
    expenses: expensesRes.mergedList,
    pos: posRes.mergedList,
    lots: lotsRes.mergedList,
    mines: minesRes.mergedList,
    settings: mergedSettings,
  };

  return { merged, hasLocalChanges, hasCloudChanges, conflicts };
}
