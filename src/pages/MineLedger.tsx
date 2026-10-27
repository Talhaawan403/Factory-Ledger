import { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getMine,
  saveMine,
  deleteMine,
  getLots,
  saveLot,
  deleteLot,
  getDispatches,
  getParties,
  getSettings,
  saveSettings,
  getPayments,
  savePayment,
  deletePayment,
  saveParty,
} from '../lib/db';
import type { Mine, InventoryLot, Dispatch, Party, AppSettings, SupplierProfile, Payment } from '../types';
import { calculateLotStock, calculateMineStock, calculateSupplierStock, calculateSupplierFinancials } from '../utils/calculations';
import { getCurrencySymbol, formatAmountNumber } from '../utils/currency';
import { getTodayDateString, formatDisplayDate } from '../utils/dateUtils';
import { playPopSound, playSuccessSound, triggerConfetti } from '../utils/delight';
import { useLedgerListener } from '../hooks/useLedgerListener';
import { v4 as uuidv4 } from 'uuid';
import {
  COAL_ITEM_ID,
  getMaterialById,
  normalizeSuppliers,
  getMaterialBadgeTheme,
} from '../utils/materials';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Edit3,
  Package,
  Truck,
  Check,
  Search,
  X,
  Phone,
  MapPin,
  Banknote,
  Trash2,
  Pickaxe,
  Store,
  Info,
  ShieldCheck,
} from 'lucide-react';
import FloatingField from '../components/FloatingField';
import IOSDatePicker from '../components/IOSDatePicker';
import IOSConfirmModal from '../components/IOSConfirmModal';
import IOSSelect from '../components/IOSSelect';
import DirectMineLedgerInfoModal from '../components/DirectMineLedgerInfoModal';
import DispatchPreviewModal from '../components/DispatchPreviewModal';
import StockPreviewModal from '../components/StockPreviewModal';

export default function MineLedger() {
  const { mineId } = useParams<{ mineId: string }>();
  const navigate = useNavigate();

  const [mine, setMine] = useState<Mine | null>(null);
  const [supplier, setSupplier] = useState<SupplierProfile | null>(null);
  const [lots, setLots] = useState<InventoryLot[]>([]);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [settings, setSettings] = useState<AppSettings | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  // Tab filter: 'all' | 'inflow' | 'outflow' | 'payments'
  const [activeTab, setActiveTab] = useState<'all' | 'inflow' | 'outflow' | 'payments'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Add / Edit Stock Modal state
  const [isAddingStock, setIsAddingStock] = useState(false);
  const [editingLotId, setEditingLotId] = useState<string | null>(null);
  const [stockFormError, setStockFormError] = useState<string | null>(null);
  const [isSavingStock, setIsSavingStock] = useState(false);
  const [bilingualModalData, setBilingualModalData] = useState<{
    isOpen: boolean;
    mineName: string;
    supplierName: string;
  } | null>(null);

  const [stockForm, setStockForm] = useState({
    tonnage: '',
    receivedTonnage: '',
    supplierId: '',
    boughtFrom: '',
    storedAt: '',
    ratePerTon: '',
    purityPercent: '',
    ratePerPurity: '',
    loadingCost: '',
    freightCost: '',
    date: getTodayDateString(),
  });

  // Edit Source (Mine or Supplier) Modal state
  const [isEditingSource, setIsEditingSource] = useState(false);
  const [sourceFormError, setSourceFormError] = useState<string | null>(null);
  const [isSavingSource, setIsSavingSource] = useState(false);
  const [sourceForm, setSourceForm] = useState({
    name: '',
    ratePerTon: '',
    contactPerson: '',
    phone: '',
    location: '',
    notes: '',
  });

  // Delete Lot Confirm state
  const [lotToDelete, setLotToDelete] = useState<InventoryLot | null>(null);
  const [isConfirmingDeleteMine, setIsConfirmingDeleteMine] = useState(false);

  // Add Payment Modal state
  const [isAddingPayment, setIsAddingPayment] = useState(false);
  const [paymentFormError, setPaymentFormError] = useState<string | null>(null);
  const [isSavingPayment, setIsSavingPayment] = useState(false);
  const [paymentToDelete, setPaymentToDelete] = useState<Payment | null>(null);
  const [previewPayment, setPreviewPayment] = useState<Payment | null>(null);
  const [paymentForm, setPaymentForm] = useState({
    date: getTodayDateString(),
    amount: '',
    mode: 'bank' as Payment['mode'],
    referenceNote: '',
  });

  // Preview Dispatch state
  const [previewDispatch, setPreviewDispatch] = useState<Dispatch | null>(null);

  // Preview Stock Inflow state
  const [previewLot, setPreviewLot] = useState<InventoryLot | null>(null);

  // Feedback Toast
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2500);
  };

  const curSym = getCurrencySymbol(settings?.currency);

  const loadData = useCallback(async () => {
    if (!mineId) return;
    const [m, allLots, allDispatches, allParties, s, allPayments] = await Promise.all([
      getMine(mineId),
      getLots(),
      getDispatches(),
      getParties(),
      getSettings(),
      getPayments(),
    ]);

    setDispatches(allDispatches);
    setParties(allParties);
    setSettings(s);

    const supp = normalizeSuppliers(s?.suppliers).find((sp) => sp.id === mineId);
    if (!m && supp) {
      setSupplier(supp);
      setMine(null);
      const suppLots = allLots.filter(
        (l) =>
          !l.deleted &&
          (l.supplierId === supp.id ||
            (!l.supplierId && (l.supplier || l.boughtFrom || '').trim().toLowerCase() === supp.name.trim().toLowerCase()))
      );
      setLots(suppLots);
      const suppPayments = allPayments.filter(
        (p) => !p.deleted && (p.supplierId === supp.id || p.partyId === supp.id || p.partyId === supp.name)
      );
      setPayments(suppPayments);
    } else {
      setMine(m);
      setSupplier(null);
      const mineLots = m
        ? allLots.filter(
            (l) =>
              !l.deleted &&
              (l.mineId === m.id ||
                (!l.mineId && (l.mineSource || l.mineName || '').trim().toLowerCase() === m.name.trim().toLowerCase()))
          )
        : [];
      setLots(mineLots);
      const minePayments = m
        ? allPayments.filter(
            (p) =>
              !p.deleted &&
              (p.mineId === m.id ||
                p.partyId === m.id ||
                p.partyId === m.name ||
                (m.defaultSupplierId && (p.partyId === m.defaultSupplierId || p.supplierId === m.defaultSupplierId)))
          )
        : [];
      setPayments(minePayments);
    }

    setLoading(false);
  }, [mineId]);

  useEffect(() => {
    let active = true;
    if (!mineId) return;
    loadData().then(() => {
      if (!active) return;
    });
    return () => {
      active = false;
    };
  }, [mineId, loadData]);

  useLedgerListener(() => {
    loadData();
  });

  const isSupplier = Boolean(supplier && !mine);
  const sourceName = supplier?.name || mine?.name || 'Stock Source';
  const materialId = supplier?.materialIds?.[0] || COAL_ITEM_ID;
  const materialDef = useMemo(() => getMaterialById(materialId, settings), [materialId, settings]);
  const isPurityPricing = materialDef.pricingModel === 'purity';
  const theme = getMaterialBadgeTheme(materialId);

  const directParty = useMemo(() => {
    if (!mine) return undefined;
    return parties.find(
      (p) =>
        p.type === 'supplier' &&
        (p.id === mine.defaultSupplierId ||
          p.linkedMineId === mine.id ||
          p.name.toLowerCase() === `${mine.name.toLowerCase()} direct ledger`)
    );
  }, [mine, parties]);

  // Stock & Financial Summary
  const stockSummary = useMemo(() => {
    if (supplier) {
      return calculateSupplierStock(supplier, lots, dispatches);
    }
    if (mine) {
      return calculateMineStock(mine, lots, dispatches);
    }
    return null;
  }, [mine, supplier, lots, dispatches]);

  // Accounts Payable Financial Summary
  const financials = useMemo(() => {
    return calculateSupplierFinancials(mineId || sourceName, lots, payments);
  }, [mineId, sourceName, lots, payments]);

  // Outflow Dispatches that consumed material from this source
  const matchedDispatches = useMemo(() => {
    if (!mine && !supplier) return [];
    const lotIds = new Set(lots.filter((lot) => !lot.deleted).map((lot) => lot.id));
    return dispatches
      .filter((d) => !d.deleted)
      .map((d) => {
        const matchingInputs = (d.coalInputs || []).filter((ci) => {
          if (mine) {
            return (
              ci.mineId === mine.id ||
              (Boolean(ci.lotId) && lotIds.has(ci.lotId!)) ||
              (Boolean(ci.sourceName) && ci.sourceName.trim().toLowerCase() === mine.name.trim().toLowerCase())
            );
          }
          if (supplier) {
            return (
              ci.supplierId === supplier.id ||
              (Boolean(ci.lotId) && lotIds.has(ci.lotId!)) ||
              (Boolean(ci.sourceName) && ci.sourceName.trim().toLowerCase() === supplier.name.trim().toLowerCase())
            );
          }
          return false;
        });
        if (matchingInputs.length === 0) return null;
        const totalUsedWeight = matchingInputs.reduce((sum, ci) => sum + (ci.weight || 0), 0);
        return {
          dispatch: d,
          usedWeight: totalUsedWeight,
          cost: Math.round(
            matchingInputs.reduce(
              (sum, ci) => sum + ((ci.weight || 0) * (ci.purchaseRate || 0)),
              0
            )
          ),
        };
      })
      .filter(Boolean) as Array<{ dispatch: Dispatch; usedWeight: number; cost: number }>;
  }, [mine, supplier, lots, dispatches]);

  // Combined activity list (Inflow vs Outflow)
  const activityList = useMemo(() => {
    const list: Array<{
      type: 'inflow' | 'outflow' | 'payment';
      id: string;
      date: string;
      timestamp: number;
      tons: number;
      value: number;
      title: string;
      subtitle: string;
      isUsedInDispatch?: boolean;
      isFullyAllocated?: boolean;
      usedTons?: number;
      remainingTons?: number;
      allocationCount?: number;
      usedDispatchTruck?: string;
      usedPartyName?: string;
      linkedDispatchObj?: Dispatch;
      rawLot?: InventoryLot;
      rawDispatch?: Dispatch;
      rawPayment?: Payment;
    }> = [];

    // Inflows (Lots)
    for (const lot of lots) {
      if (lot.deleted) continue;
      const tons = lot.receivedWeight || lot.billedWeight || lot.tonnage || 0;
      const val = lot.totalValue ?? (tons * (lot.ratePerTon || mine?.ratePerTon || 0));

      const linkedDispatches = dispatches.filter(
        (d) => !d.deleted && (d.coalInputs || []).some((ci) => ci.lotId === lot.id)
      );
      const linkedD = linkedDispatches.find((d) => d.id === lot.usedInDispatchId) || linkedDispatches[0];
      const lotStock = calculateLotStock(lot, dispatches);
      const isUsed = lotStock.usedWeight > 0.001;
      const usedTruck = linkedD?.truckNumber || lot.usedInDispatchTruck;
      const linkedParty = linkedD ? parties.find((p) => p.id === linkedD.partyId) : undefined;
      const usedParty = linkedParty?.name || linkedD?.factoryName || lot.usedInPartyName;

      list.push({
        type: 'inflow',
        id: lot.id,
        date: lot.date || getTodayDateString(),
        timestamp: new Date(lot.date || 0).getTime() || (lot.createdAt || 0),
        tons,
        value: val,
        title: lot.truckNumber ? `Truck ${lot.truckNumber}` : (lot.boughtFrom || lot.supplier ? `Batch: ${lot.boughtFrom || lot.supplier}` : 'Stock Inflow'),
        subtitle: lot.boughtFrom || lot.supplier
          ? `Bought from: ${lot.boughtFrom || lot.supplier}${lot.storedAt ? ` · ${lot.storedAt}` : ''}`
          : (lot.storedAt ? `Stored at: ${lot.storedAt}` : 'Direct Mine batch'),
        isUsedInDispatch: isUsed,
        isFullyAllocated: isUsed && lotStock.remainingWeight <= 0.001,
        usedTons: lotStock.usedWeight,
        remainingTons: lotStock.remainingWeight,
        allocationCount: linkedDispatches.length,
        usedDispatchTruck: usedTruck,
        usedPartyName: usedParty,
        linkedDispatchObj: linkedD,
        rawLot: lot,
      });
    }

    // Outflows (Dispatches)
    for (const item of matchedDispatches) {
      const d = item.dispatch;
      const party = parties.find((p) => p.id === d.partyId);
      const partyName = party?.name || d.factoryName || 'Factory Client';
      list.push({
        type: 'outflow',
        id: d.id,
        date: d.date || getTodayDateString(),
        timestamp: new Date(d.date || 0).getTime() || (d.createdAt || 0),
        tons: item.usedWeight,
        value: item.cost,
        title: `Dispatched: ${d.truckNumber || 'Truck'}`,
        subtitle: partyName,
        rawDispatch: d,
      });
    }

    // Payments (Cash/Bank Paid to Supplier/Mine)
    for (const p of payments) {
      if (p.deleted) continue;
      list.push({
        type: 'payment',
        id: p.id,
        date: p.date || getTodayDateString(),
        timestamp: new Date(p.date || 0).getTime() || (p.createdAt || 0),
        tons: 0,
        value: p.amount,
        title: `Payment: ${p.mode ? p.mode.toUpperCase() : 'BANK'}`,
        subtitle: p.referenceNote ? `Ref: ${p.referenceNote}` : `Payment to ${sourceName}`,
        rawPayment: p,
      });
    }

    list.sort((a, b) => b.timestamp - a.timestamp);

    let filtered = list;
    if (activeTab === 'inflow') {
      filtered = list.filter((i) => i.type === 'inflow');
    } else if (activeTab === 'outflow') {
      filtered = list.filter((i) => i.type === 'outflow');
    } else if (activeTab === 'payments') {
      filtered = list.filter((i) => i.type === 'payment');
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.subtitle.toLowerCase().includes(q) ||
          i.date.includes(q)
      );
    }

    return filtered;
  }, [lots, matchedDispatches, payments, mine, supplier, parties, dispatches, activeTab, searchQuery, sourceName]);

  // Live Auto-Calculation for Add/Edit Stock Sheet
  const parsedTonnage = parseFloat(stockForm.tonnage) || 0;
  const parsedReceivedTonnage = parseFloat(stockForm.receivedTonnage) || 0;
  const parsedPurity = parseFloat(stockForm.purityPercent) || 0;
  const parsedRatePerPurity = parseFloat(stockForm.ratePerPurity) || 0;

  // Base rate per ton: if purity-based, auto-calculate if fields entered
  const computedPurityRate = parsedPurity > 0 && parsedRatePerPurity > 0 ? parsedPurity * parsedRatePerPurity : 0;
  const parsedBaseRate = parseFloat(stockForm.ratePerTon) || computedPurityRate || (mine?.ratePerTon || 0);

  const parsedLoading = parseFloat(stockForm.loadingCost) || 0;
  const parsedFare = parseFloat(stockForm.freightCost) || 0;

  const liveBaseCost = Math.round(parsedTonnage * parsedBaseRate);
  const liveTotalValue = Math.round(liveBaseCost + parsedLoading + parsedFare);
  const effectiveWeight = parsedReceivedTonnage > 0 ? parsedReceivedTonnage : parsedTonnage;
  const liveLandedRate = effectiveWeight > 0 ? Math.round((liveTotalValue / effectiveWeight) * 100) / 100 : parsedBaseRate;

  // Open Add Stock Modal
  const handleOpenAddStock = () => {
    playPopSound();
    setEditingLotId(null);
    setStockFormError(null);

    const initialSupplierId = isSupplier
      ? (supplier?.id || '')
      : (directParty ? directParty.id : '__auto_direct__');
    const initialBoughtFrom = isSupplier
      ? (supplier?.name || '')
      : (directParty ? directParty.name : (mine ? `${mine.name} Direct Ledger` : ''));

    setStockForm({
      tonnage: '',
      receivedTonnage: '',
      supplierId: initialSupplierId,
      boughtFrom: initialBoughtFrom,
      storedAt: mine?.location || supplier?.address || '',
      ratePerTon: mine ? String(mine.ratePerTon || '') : '',
      purityPercent: isPurityPricing ? '30' : '',
      ratePerPurity: isPurityPricing ? String(materialDef.defaultRate || 116) : '',
      loadingCost: '',
      freightCost: '',
      date: getTodayDateString(),
    });
    setIsAddingStock(true);
  };

  // Open Edit Stock Modal
  const handleOpenEditStock = (lot: InventoryLot) => {
    playPopSound();
    setEditingLotId(lot.id);
    setStockFormError(null);

    const matchingParty = parties.find(
      (p) =>
        (lot.supplierId && p.id === lot.supplierId) ||
        (p.name.toLowerCase() === (lot.supplier || lot.boughtFrom || '').toLowerCase())
    );

    setStockForm({
      tonnage: String(lot.billedWeight || lot.tonnage || ''),
      receivedTonnage: String(lot.receivedWeight || ''),
      supplierId: lot.supplierId || (matchingParty ? matchingParty.id : ''),
      boughtFrom: lot.boughtFrom || lot.supplier || (matchingParty ? matchingParty.name : ''),
      storedAt: lot.storedAt || '',
      ratePerTon: String(lot.purchaseRate || lot.ratePerTon || ''),
      purityPercent: '',
      ratePerPurity: '',
      loadingCost: lot.loadingCost ? String(lot.loadingCost) : '',
      freightCost: lot.freightCost ? String(lot.freightCost) : '',
      date: lot.date || getTodayDateString(),
    });
    setIsAddingStock(true);
  };

  // Submit Add / Edit Stock Voucher
  const handleSaveStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!mine && !supplier) || isSavingStock) return;

    if (!Number.isFinite(parsedTonnage) || parsedTonnage <= 0) {
      setStockFormError('Please enter a valid positive loaded tonnage.');
      return;
    }
    if (stockForm.receivedTonnage.trim() && (!Number.isFinite(parsedReceivedTonnage) || parsedReceivedTonnage <= 0)) {
      setStockFormError('Received quantity must be greater than zero.');
      return;
    }
    if (!Number.isFinite(parsedBaseRate) || parsedBaseRate <= 0) {
      setStockFormError(`Rate per ton must be greater than zero.`);
      return;
    }
    if (!Number.isFinite(parsedLoading) || !Number.isFinite(parsedFare) || parsedLoading < 0 || parsedFare < 0) {
      setStockFormError('Loading and freight amounts cannot be negative.');
      return;
    }

    try {
      setIsSavingStock(true);
      setStockFormError(null);
      const now = Date.now();
      const existingLot = editingLotId ? lots.find((l) => l.id === editingLotId) : undefined;

      let resolvedSupplierId: string | undefined = undefined;
      let finalBoughtFrom = stockForm.boughtFrom.trim();

      if (supplier) {
        resolvedSupplierId = supplier.id;
        finalBoughtFrom = supplier.name;
      } else if (mine) {
        // Find existing direct supplier party
        let currentDirect = parties.find(
          (p) =>
            p.type === 'supplier' &&
            (p.id === mine.defaultSupplierId ||
              p.linkedMineId === mine.id ||
              p.name.toLowerCase() === `${mine.name.toLowerCase()} direct ledger`)
        );

        if (
          stockForm.supplierId === '__auto_direct__' ||
          (!stockForm.supplierId &&
            (!finalBoughtFrom || finalBoughtFrom.toLowerCase().includes('direct ledger')))
        ) {
          // Direct mine path
          if (!currentDirect) {
            // Auto-create new direct mine party!
            const directPartyName = `${mine.name} Direct Ledger`;
            const newParty: Party = {
              id: uuidv4(),
              name: directPartyName,
              type: 'supplier',
              contactPerson: 'Mine Owner',
              phone: mine.phone || '',
              address: mine.location || '',
              notes: `Direct ledger for ${mine.name} mine owner purchases and payments.`,
              isDirectMine: true,
              linkedMineId: mine.id,
              materialIds: [materialDef.id],
              createdAt: now,
              updatedAt: now,
            };
            await saveParty(newParty);
            resolvedSupplierId = newParty.id;
            finalBoughtFrom = directPartyName;

            const updatedMine: Mine = {
              ...mine,
              defaultSupplierId: newParty.id,
              updatedAt: now,
            };
            await saveMine(updatedMine);
            setMine(updatedMine);

            // Trigger bilingual modal
            setBilingualModalData({
              isOpen: true,
              mineName: mine.name,
              supplierName: directPartyName,
            });
          } else {
            resolvedSupplierId = currentDirect.id;
            finalBoughtFrom = currentDirect.name;
            if (mine.defaultSupplierId !== currentDirect.id) {
              const updatedMine: Mine = { ...mine, defaultSupplierId: currentDirect.id, updatedAt: now };
              await saveMine(updatedMine);
              setMine(updatedMine);
            }
          }
        } else if (stockForm.supplierId) {
          const selectedParty = parties.find((p) => p.id === stockForm.supplierId);
          if (selectedParty) {
            resolvedSupplierId = selectedParty.id;
            finalBoughtFrom = selectedParty.name;
          } else {
            finalBoughtFrom = stockForm.boughtFrom.trim() || 'Stock Batch';
          }
        } else {
          // Custom name entered without ID
          finalBoughtFrom = stockForm.boughtFrom.trim() || `${mine.name} Direct Ledger`;
          const matchingParty = parties.find(
            (p) => p.type === 'supplier' && p.name.toLowerCase() === finalBoughtFrom.toLowerCase()
          );
          if (matchingParty) {
            resolvedSupplierId = matchingParty.id;
          }
        }
      }

      const lotToSave: InventoryLot = {
        ...(existingLot || {}),
        id: editingLotId || uuidv4(),
        mineId: mine ? mine.id : undefined,
        mineName: mine ? mine.name : undefined,
        supplierId: resolvedSupplierId,
        supplier: finalBoughtFrom,
        boughtFrom: finalBoughtFrom,
        itemId: materialDef.id,
        itemName: materialDef.name,
        storedAt: stockForm.storedAt.trim() || undefined,
        tonnage: parsedTonnage,
        billedWeight: parsedTonnage,
        receivedWeight: parsedReceivedTonnage > 0 ? parsedReceivedTonnage : parsedTonnage,
        ratePerTon: parsedBaseRate,
        purchaseRate: parsedBaseRate,
        loadingCost: parsedLoading > 0 ? parsedLoading : undefined,
        freightCost: parsedFare > 0 ? parsedFare : undefined,
        totalValue: liveTotalValue,
        landedRate: liveLandedRate,
        date: stockForm.date || getTodayDateString(),
        mineSource: mine ? mine.name : undefined,
        createdAt: existingLot?.createdAt || now,
        updatedAt: now,
      };

      await saveLot(lotToSave);
      playSuccessSound();
      triggerConfetti();
      setIsAddingStock(false);
      showToast(editingLotId ? 'Stock voucher updated' : 'Stock voucher saved');
      await loadData();
    } catch (err: any) {
      setStockFormError(err?.message || 'Failed to save stock voucher.');
    } finally {
      setIsSavingStock(false);
    }
  };

  // Open Edit Source Modal
  const handleOpenEditSource = () => {
    playPopSound();
    setSourceFormError(null);
    if (supplier) {
      setSourceForm({
        name: supplier.name,
        ratePerTon: '',
        contactPerson: supplier.contactPerson || '',
        phone: supplier.phone || '',
        location: supplier.address || '',
        notes: '',
      });
    } else if (mine) {
      setSourceForm({
        name: mine.name,
        ratePerTon: String(mine.ratePerTon || ''),
        contactPerson: '',
        phone: mine.phone || '',
        location: mine.location || '',
        notes: mine.notes || '',
      });
    }
    setIsEditingSource(true);
  };

  // Submit Edit Source
  const handleSaveSource = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = sourceForm.name.trim();
    if (!name) {
      setSourceFormError('Please enter a name.');
      return;
    }

    try {
      setIsSavingSource(true);
      setSourceFormError(null);

      if (supplier) {
        const currentSuppliers = normalizeSuppliers(settings?.suppliers);
        const updated = currentSuppliers.map((s) =>
          s.id === supplier.id
            ? {
                ...s,
                name,
                contactPerson: sourceForm.contactPerson.trim() || undefined,
                phone: sourceForm.phone.trim() || undefined,
                address: sourceForm.location.trim() || undefined,
              }
            : s
        );
        const updatedSettings: AppSettings = {
          ...(settings || ({} as AppSettings)),
          suppliers: updated,
          userName: settings?.userName || '',
          businessName: settings?.businessName || '',
          phoneNumber: settings?.phoneNumber || '',
          logoUrl: settings?.logoUrl || '',
          theme: settings?.theme || 'system',
        };
        await saveSettings(updatedSettings);
      } else if (mine) {
        const rate = parseFloat(sourceForm.ratePerTon) || 0;
        await saveMine({
          ...mine,
          name,
          ratePerTon: rate,
          location: sourceForm.location.trim() || undefined,
          notes: sourceForm.notes.trim() || undefined,
          phone: sourceForm.phone.trim() || undefined,
          updatedAt: Date.now(),
        });
      }

      playSuccessSound();
      setIsEditingSource(false);
      showToast('Source updated successfully');
      await loadData();
    } catch (err: any) {
      setSourceFormError(err?.message || 'Failed to update source.');
    } finally {
      setIsSavingSource(false);
    }
  };

  // Delete Stock Entry
  const handleDeleteStock = async () => {
    if (!lotToDelete) return;
    try {
      await deleteLot(lotToDelete.id);
      playPopSound();
      setLotToDelete(null);
      if (previewLot?.id === lotToDelete.id) {
        setPreviewLot(null);
      }
      showToast('Stock entry removed');
      await loadData();
    } catch (err: any) {
      setLotToDelete(null);
      showToast(err?.message || 'Could not delete entry.');
    }
  };

  // Open Add Payment Modal
  const handleOpenAddPayment = () => {
    playPopSound();
    setPaymentFormError(null);
    setPaymentForm({
      date: getTodayDateString(),
      amount: '',
      mode: 'bank',
      referenceNote: '',
    });
    setIsAddingPayment(true);
  };

  // Submit Add Payment Voucher
  const handleSavePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!mine && !supplier) || isSavingPayment) return;
    const parsedAmt = parseFloat(paymentForm.amount);
    if (!Number.isFinite(parsedAmt) || parsedAmt <= 0) {
      setPaymentFormError('Please enter a valid payment amount greater than zero.');
      return;
    }
    try {
      setIsSavingPayment(true);
      setPaymentFormError(null);
      const now = Date.now();

      let targetPartyId = supplier ? supplier.id : (mine ? mine.id : sourceName);
      let targetSupplierId = supplier?.id;

      if (mine) {
        let currentDirect = parties.find(
          (p) =>
            p.type === 'supplier' &&
            (p.id === mine.defaultSupplierId ||
              p.linkedMineId === mine.id ||
              p.name.toLowerCase() === `${mine.name.toLowerCase()} direct ledger`)
        );

        if (!currentDirect && !mine.defaultSupplierId) {
          const directPartyName = `${mine.name} Direct Ledger`;
          currentDirect = {
            id: uuidv4(),
            name: directPartyName,
            type: 'supplier',
            contactPerson: 'Mine Owner',
            phone: mine.phone || '',
            address: mine.location || '',
            notes: `Direct ledger for ${mine.name} mine owner purchases and payments.`,
            isDirectMine: true,
            linkedMineId: mine.id,
            materialIds: [materialDef.id],
            createdAt: now,
            updatedAt: now,
          };
          await saveParty(currentDirect);
          const updatedMine = { ...mine, defaultSupplierId: currentDirect.id, updatedAt: now };
          await saveMine(updatedMine);
          setMine(updatedMine);

          setBilingualModalData({
            isOpen: true,
            mineName: mine.name,
            supplierName: directPartyName,
          });
        }

        if (currentDirect) {
          targetPartyId = currentDirect.id;
          targetSupplierId = currentDirect.id;
        }
      }

      const newPayment: Payment = {
        id: uuidv4(),
        partyId: targetPartyId,
        supplierId: targetSupplierId,
        mineId: mine?.id,
        type: 'paid',
        amount: parsedAmt,
        date: paymentForm.date || getTodayDateString(),
        mode: paymentForm.mode as any,
        referenceNote: paymentForm.referenceNote.trim() || undefined,
        createdAt: now,
        updatedAt: now,
      };
      await savePayment(newPayment);
      playSuccessSound();
      triggerConfetti();
      setIsAddingPayment(false);
      showToast('Payment voucher saved');
      await loadData();
    } catch (err: any) {
      setPaymentFormError(err?.message || 'Failed to save payment.');
    } finally {
      setIsSavingPayment(false);
    }
  };

  // Delete Payment Voucher
  const handleDeletePayment = async () => {
    if (!paymentToDelete) return;
    try {
      await deletePayment(paymentToDelete.id);
      playPopSound();
      setPaymentToDelete(null);
      if (previewPayment?.id === paymentToDelete.id) {
        setPreviewPayment(null);
      }
      showToast('Payment voucher removed');
      await loadData();
    } catch (err: any) {
      setPaymentToDelete(null);
      showToast(err?.message || 'Could not delete payment.');
    }
  };

  if (loading) {
    return (
      <div className="ios-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ color: 'var(--label-secondary)', fontSize: 15 }}>Loading Ledger…</div>
      </div>
    );
  }

  if (!mine && !supplier) {
    return (
      <div className="ios-page" style={{ padding: 24, textAlign: 'center' }}>
        <h2>Stock Source Not Found</h2>
        <button
          onClick={() => navigate('/inventory')}
          style={{
            marginTop: 16,
            padding: '10px 20px',
            borderRadius: 12,
            background: 'var(--ios-blue)',
            color: '#fff',
            border: 'none',
            fontSize: 15,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Return to Inventory
        </button>
      </div>
    );
  }

  return (
    <div className="ios-page" style={{ paddingBottom: 120 }}>
      {/* Toast Notification */}
      {toastMsg && (
        <div className="ios-toast-banner">
          <Check style={{ width: 16, height: 16, color: 'var(--ios-green)' }} strokeWidth={3} />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* ── Top Navigation Bar ── */}
      <div className="ios-navbar">
        <div className="ios-navbar-top-row">
          <button
            type="button"
            onClick={() => {
              playPopSound();
              navigate('/inventory');
            }}
            className="ios-back-button"
            title="Back to Inventory"
          >
            <ChevronLeft style={{ width: 22, height: 22 }} strokeWidth={2.6} />
            <span>Inventory</span>
          </button>

          <div className="ios-navbar-title-inline">{sourceName}</div>

          <button
            type="button"
            className="ios-nav-action"
            title="Edit Source"
            onClick={handleOpenEditSource}
          >
            <Edit3 style={{ width: 20, height: 20 }} strokeWidth={2.2} />
          </button>
        </div>
      </div>

      {/* ── Profile Header ── */}
      <div style={{ padding: '16px 20px', display: 'flex', gap: 16, alignItems: 'center' }}>
        <div
          style={{
            width: 58,
            height: 58,
            borderRadius: 16,
            background: theme.bg,
            border: `1px solid ${theme.border}`,
            color: theme.color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 800,
            fontSize: 22,
            flexShrink: 0,
          }}
        >
          {sourceName.slice(0, 2).toUpperCase()}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--label-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {sourceName}
            </h1>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 6,
                background: theme.bg,
                color: theme.color,
                border: `0.5px solid ${theme.border}`,
                textTransform: 'uppercase',
              }}
            >
              {materialDef.name}
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 7px',
                borderRadius: 6,
                background: 'var(--fill-tertiary)',
                color: 'var(--label-secondary)',
              }}
            >
              {isSupplier ? 'Supplier' : 'Mine'}
            </span>
            {directParty && (
              <span
                onClick={() => navigate(`/parties/${directParty.id}`)}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 6,
                  background: 'rgba(0, 122, 255, 0.12)',
                  color: '#007AFF',
                  border: '1px solid rgba(0, 122, 255, 0.28)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  cursor: 'pointer',
                }}
                title="Open Direct Supplier Ledger in Parties"
              >
                <Pickaxe size={10} />
                <span>{directParty.name}</span>
                <ChevronRight size={10} />
              </span>
            )}
          </div>

          <div style={{ fontSize: 13, color: 'var(--label-secondary)', marginTop: 3, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {supplier?.phone && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Phone size={12} /> {supplier.phone}
              </span>
            )}
            {(mine?.location || supplier?.address) && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <MapPin size={12} /> {mine?.location || supplier?.address}
              </span>
            )}
            {mine?.ratePerTon ? (
              <span>Rate: {curSym} {formatAmountNumber(mine.ratePerTon, settings)}/t</span>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── Hero Stock Card (Available Weight & Value) ── */}
      {stockSummary && (
        <div style={{ padding: '0 16px 14px' }}>
          <div
            style={{
              background: 'var(--bg-card)',
              borderRadius: 20,
              padding: '16px 18px',
              border: '0.5px solid var(--separator)',
              boxShadow: 'var(--shadow-card)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--label-secondary)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  Current Available Stock
                </span>
                <div
                  style={{
                    fontSize: 32,
                    fontWeight: 800,
                    color: stockSummary.isOverdrawn ? 'var(--ios-red)' : 'var(--label-primary)',
                    lineHeight: 1.15,
                    marginTop: 2,
                  }}
                  className="tabular-nums"
                >
                  {stockSummary.remainingTons.toFixed(1)}{' '}
                  <span style={{ fontSize: 16, fontWeight: 500, color: 'var(--label-secondary)' }}>tons</span>
                </div>
              </div>

              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '4px 10px',
                  borderRadius: 8,
                  background: stockSummary.isOverdrawn
                    ? 'rgba(255, 59, 48, 0.15)'
                    : stockSummary.remainingTons <= 0
                      ? 'var(--fill-tertiary)'
                      : stockSummary.remainingTons < 20
                        ? 'rgba(255, 149, 0, 0.15)'
                        : 'rgba(52, 199, 89, 0.15)',
                  color: stockSummary.isOverdrawn
                    ? 'var(--ios-red)'
                    : stockSummary.remainingTons <= 0
                      ? 'var(--label-secondary)'
                      : stockSummary.remainingTons < 20
                        ? 'var(--ios-orange)'
                        : 'var(--ios-green)',
                }}
              >
                {stockSummary.isOverdrawn
                  ? 'Overdrawn'
                  : stockSummary.remainingTons <= 0
                    ? 'Exhausted'
                    : stockSummary.remainingTons < 20
                      ? 'Low Stock'
                      : 'In Stock'}
              </span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 12,
                marginTop: 14,
                paddingTop: 12,
                borderTop: '0.5px solid var(--separator)',
              }}
            >
              <div>
                <div style={{ fontSize: 11, color: 'var(--label-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>
                  Stock Value
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ios-green)', marginTop: 2 }} className="tabular-nums">
                  {curSym} {formatAmountNumber(stockSummary.remainingValue, settings)}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 11, color: 'var(--label-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>
                  Deliveries & Dispatches
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--label-primary)', marginTop: 2 }}>
                  {stockSummary.entriesCount} in · {stockSummary.dispatchesCount} out
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Financial Balance Card (Accounts Payable) ── */}
      <div style={{ padding: '0 16px 14px' }}>
        <div
          style={{
            background: 'var(--bg-card)',
            borderRadius: 20,
            padding: '16px 18px',
            border: '0.5px solid var(--separator)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--label-secondary)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                Accounts Payable Balance
              </span>
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 800,
                  color: financials.outstandingBalance > 0
                    ? 'var(--ios-red)'
                    : financials.outstandingBalance < 0
                      ? 'var(--ios-green)'
                      : 'var(--label-primary)',
                  lineHeight: 1.15,
                  marginTop: 2,
                }}
                className="tabular-nums"
              >
                {curSym} {formatAmountNumber(Math.abs(financials.outstandingBalance), settings)}
              </div>
            </div>

            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: '4px 10px',
                borderRadius: 8,
                background: financials.outstandingBalance > 0
                  ? 'rgba(255, 59, 48, 0.15)'
                  : financials.outstandingBalance < 0
                    ? 'rgba(52, 199, 89, 0.15)'
                    : 'var(--fill-tertiary)',
                color: financials.outstandingBalance > 0
                  ? 'var(--ios-red)'
                  : financials.outstandingBalance < 0
                    ? 'var(--ios-green)'
                    : 'var(--label-secondary)',
              }}
            >
              {financials.outstandingBalance > 0
                ? 'Payable to Supplier'
                : financials.outstandingBalance < 0
                  ? 'Advance Paid'
                  : 'Settled'}
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
              marginTop: 14,
              paddingTop: 12,
              borderTop: '0.5px solid var(--separator)',
            }}
          >
            <div>
              <div style={{ fontSize: 11, color: 'var(--label-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>
                Purchases Billed
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--label-primary)', marginTop: 2 }} className="tabular-nums">
                {curSym} {formatAmountNumber(financials.totalBilled, settings)}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11, color: 'var(--label-secondary)', textTransform: 'uppercase', fontWeight: 600 }}>
                Payments Paid
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ios-green)', marginTop: 2 }} className="tabular-nums">
                {curSym} {formatAmountNumber(financials.totalPaid, settings)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Action Buttons: Add Stock Voucher + Record Payment ── */}
      <div style={{ padding: '0 16px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <button
          onClick={handleOpenAddStock}
          style={{
            height: 48,
            borderRadius: 14,
            background: 'var(--ios-blue)',
            color: 'white',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
          }}
          className="ios-btn-primary"
        >
          <Plus size={18} strokeWidth={2.6} />
          <span>Add Delivery</span>
        </button>

        <button
          onClick={handleOpenAddPayment}
          style={{
            height: 48,
            borderRadius: 14,
            background: 'var(--ios-green)',
            color: 'white',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
          }}
          className="ios-btn-primary"
        >
          <Banknote size={18} strokeWidth={2.4} />
          <span>Pay Supplier</span>
        </button>
      </div>

      {/* ── Activity Tabs (All | Inflow | Outflow | Payments) ── */}
      <div style={{ padding: '0 16px 12px' }}>
        <div style={{ display: 'flex', background: 'var(--fill-tertiary)', borderRadius: 10, padding: 3, gap: 2 }}>
          <button
            type="button"
            onClick={() => {
              playPopSound();
              setActiveTab('all');
            }}
            style={{
              flex: 1,
              padding: '7px 4px',
              borderRadius: 8,
              border: 'none',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              background: activeTab === 'all' ? 'var(--bg-card)' : 'transparent',
              color: activeTab === 'all' ? 'var(--label-primary)' : 'var(--label-secondary)',
              boxShadow: activeTab === 'all' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}
          >
            All ({activityList.length})
          </button>
          <button
            type="button"
            onClick={() => {
              playPopSound();
              setActiveTab('inflow');
            }}
            style={{
              flex: 1,
              padding: '7px 4px',
              borderRadius: 8,
              border: 'none',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              background: activeTab === 'inflow' ? 'var(--bg-card)' : 'transparent',
              color: activeTab === 'inflow' ? 'var(--label-primary)' : 'var(--label-secondary)',
              boxShadow: activeTab === 'inflow' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}
          >
            Inflow ({lots.filter((l) => !l.deleted).length})
          </button>
          <button
            type="button"
            onClick={() => {
              playPopSound();
              setActiveTab('outflow');
            }}
            style={{
              flex: 1,
              padding: '7px 4px',
              borderRadius: 8,
              border: 'none',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              background: activeTab === 'outflow' ? 'var(--bg-card)' : 'transparent',
              color: activeTab === 'outflow' ? 'var(--label-primary)' : 'var(--label-secondary)',
              boxShadow: activeTab === 'outflow' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}
          >
            Outflow ({matchedDispatches.length})
          </button>
          <button
            type="button"
            onClick={() => {
              playPopSound();
              setActiveTab('payments');
            }}
            style={{
              flex: 1,
              padding: '7px 4px',
              borderRadius: 8,
              border: 'none',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              background: activeTab === 'payments' ? 'var(--bg-card)' : 'transparent',
              color: activeTab === 'payments' ? 'var(--label-primary)' : 'var(--label-secondary)',
              boxShadow: activeTab === 'payments' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}
          >
            Payments ({payments.filter((p) => !p.deleted).length})
          </button>
        </div>
      </div>

      {/* ── Search Bar ── */}
      <div className="ios-search-container" style={{ padding: '0 16px 12px' }}>
        <div
          className="ios-search-bar"
          style={{
            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.06)',
            border: '1px solid var(--border-glass)',
            background: 'var(--fill-tertiary)',
            height: 38,
          }}
        >
          <Search size={16} style={{ color: 'var(--label-tertiary)' }} />
          <input
            type="text"
            placeholder="Search deliveries, dispatches, trucks…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="ios-search-input"
            style={{ fontSize: 13 }}
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery('');
                playPopSound();
              }}
              style={{
                background: 'var(--fill-primary)',
                border: 'none',
                borderRadius: '50%',
                width: 18,
                height: 18,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--label-secondary)',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              <X size={11} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>

      {/* ── Activity Items List ── */}
      <div style={{ padding: '0 16px' }}>
        {activityList.length === 0 ? (
          <div
            style={{
              padding: '40px 16px',
              textAlign: 'center',
              background: 'var(--bg-card)',
              borderRadius: 16,
              border: '0.5px solid var(--separator)',
            }}
          >
            <Package size={36} style={{ opacity: 0.35, margin: '0 auto 8px' }} />
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--label-primary)' }}>No Activity Recorded</div>
            <div style={{ fontSize: 13, color: 'var(--label-secondary)', marginTop: 4 }}>
              Tap "+ Add Stock Voucher" above to record received {materialDef.name}.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {activityList.map((item) => {
              const isInflow = item.type === 'inflow';
              const isPayment = item.type === 'payment';

              return (
                <div
                  key={`${item.type}-${item.id}`}
                  onClick={() => {
                    playPopSound();
                    if (isInflow && item.rawLot) {
                      setPreviewLot(item.rawLot);
                    } else if (item.type === 'outflow' && item.rawDispatch) {
                      setPreviewDispatch(item.rawDispatch);
                    } else if (isPayment && item.rawPayment) {
                      setPreviewPayment(item.rawPayment);
                    }
                  }}
                  style={{
                    background: 'var(--bg-card)',
                    borderRadius: 14,
                    border: '0.5px solid var(--separator)',
                    padding: '12px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    boxShadow: 'var(--shadow-card)',
                  }}
                  className="hover-bg"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1, marginRight: 8 }}>
                    <div
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 10,
                        background: isPayment
                          ? 'rgba(52, 199, 89, 0.15)'
                          : isInflow
                            ? 'rgba(52, 199, 89, 0.12)'
                            : 'rgba(0, 122, 255, 0.12)',
                        color: isPayment || isInflow ? 'var(--ios-green)' : 'var(--ios-blue)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {isPayment ? <Banknote size={18} /> : isInflow ? <Package size={18} /> : <Truck size={18} />}
                    </div>

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--label-primary)' }}>
                          {item.title}
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '1px 5px',
                            borderRadius: 4,
                            background: isPayment
                              ? 'rgba(52, 199, 89, 0.15)'
                              : isInflow
                                ? 'rgba(52, 199, 89, 0.12)'
                                : 'rgba(0, 122, 255, 0.12)',
                            color: isPayment || isInflow ? 'var(--ios-green)' : 'var(--ios-blue)',
                          }}
                        >
                          {isPayment ? 'PAYMENT' : isInflow ? 'INFLOW' : 'OUTFLOW'}
                        </span>
                      </div>

                      <div style={{ fontSize: 12, color: 'var(--label-secondary)', marginTop: 2 }}>
                        {formatDisplayDate(item.date)} · {item.subtitle}
                      </div>

                      {isInflow && item.remainingTons !== undefined && (
                        <div style={{ fontSize: 11, color: 'var(--label-tertiary)', marginTop: 1 }}>
                          Remaining: <strong>{item.remainingTons.toFixed(2)}t</strong>
                          {item.isFullyAllocated ? ' · Fully allocated' : ''}
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div>
                      {isPayment ? (
                        <div
                          style={{
                            fontSize: 15,
                            fontWeight: 700,
                            color: 'var(--ios-green)',
                          }}
                          className="tabular-nums"
                        >
                          −{curSym} {formatAmountNumber(item.value, settings)}
                        </div>
                      ) : (
                        <>
                          <div
                            style={{
                              fontSize: 15,
                              fontWeight: 700,
                              color: isInflow ? 'var(--ios-green)' : 'var(--label-primary)',
                            }}
                            className="tabular-nums"
                          >
                            {isInflow ? '+' : '−'}{item.tons.toFixed(1)}t
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--label-secondary)', marginTop: 1 }} className="tabular-nums">
                            {curSym} {formatAmountNumber(item.value, settings)}
                          </div>
                        </>
                      )}
                    </div>

                    <ChevronRight size={16} style={{ color: 'var(--label-tertiary)' }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Add / Edit Stock Voucher Modal Sheet ── */}
      {isAddingStock && (
        <div
          className="ios-modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
          }}
          onClick={() => setIsAddingStock(false)}
        >
          <div
            className="ios-action-sheet"
            style={{
              width: '100%',
              maxWidth: 580,
              background: 'var(--bg-card)',
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              maxHeight: '92vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 -10px 40px rgba(0,0,0,0.3)',
              overflow: 'hidden',
              animation: 'slideUpSheet 0.25s cubic-bezier(0.1, 0.9, 0.2, 1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Grabber Handle */}
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10, paddingBottom: 6 }}>
              <div style={{ width: 36, height: 5, borderRadius: 3, background: 'var(--label-tertiary)', opacity: 0.4 }} />
            </div>

            {/* Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 16px 12px',
                borderBottom: '0.5px solid var(--separator)',
              }}
            >
              <button
                type="button"
                onClick={() => setIsAddingStock(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--ios-blue)',
                  fontSize: 16,
                  fontWeight: 500,
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                Cancel
              </button>

              <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--label-primary)' }}>
                {editingLotId ? 'Edit Stock Voucher' : `New ${materialDef.name} Delivery`}
              </span>

              <button
                type="button"
                onClick={handleSaveStock}
                disabled={isSavingStock}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--ios-blue)',
                  fontSize: 16,
                  fontWeight: 700,
                  cursor: 'pointer',
                  padding: 0,
                  opacity: isSavingStock ? 0.6 : 1,
                }}
              >
                {isSavingStock ? 'Saving…' : 'Save'}
              </button>
            </div>

            {/* Form Body */}
            <form onSubmit={handleSaveStock} style={{ padding: '16px 16px 36px', overflowY: 'auto' }}>
              {stockFormError && (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: 'rgba(255, 59, 48, 0.1)',
                    border: '0.5px solid rgba(255, 59, 48, 0.3)',
                    color: 'var(--ios-red)',
                    fontSize: 13,
                    marginBottom: 14,
                  }}
                >
                  {stockFormError}
                </div>
              )}

              {/* Date */}
              <div style={{ marginBottom: 12 }}>
                <IOSDatePicker
                  label="Delivery Date"
                  value={stockForm.date}
                  onChange={(d) => setStockForm((prev) => ({ ...prev, date: d }))}
                  floating
                />
              </div>

              {/* Bought From / Supplier Selector */}
              <div style={{ marginBottom: 12 }}>
                {mine ? (
                  <div>
                    <IOSSelect<string>
                      label="Supplier / Bought From"
                      value={
                        stockForm.supplierId === '__auto_direct__'
                          ? '__auto_direct__'
                          : (stockForm.supplierId ||
                            parties.find(
                              (p) =>
                                p.type === 'supplier' &&
                                p.name.toLowerCase() === stockForm.boughtFrom.trim().toLowerCase()
                            )?.id ||
                            (stockForm.boughtFrom ? stockForm.boughtFrom : '__auto_direct__'))
                      }
                      onChange={(val) => {
                        if (val === '__auto_direct__') {
                          setStockForm((prev) => ({
                            ...prev,
                            supplierId: '__auto_direct__',
                            boughtFrom: `${mine.name} Direct Ledger`,
                          }));
                        } else {
                          const chosenParty = parties.find((p) => p.id === val);
                          if (chosenParty) {
                            setStockForm((prev) => ({
                              ...prev,
                              supplierId: chosenParty.id,
                              boughtFrom: chosenParty.name,
                            }));
                          } else {
                            setStockForm((prev) => ({
                              ...prev,
                              supplierId: '',
                              boughtFrom: val,
                            }));
                          }
                        }
                      }}
                      options={[
                        {
                          value: directParty ? directParty.id : '__auto_direct__',
                          label: `${mine.name} Direct Ledger (Mine Owner)`,
                          subtitle: directParty
                            ? 'Linked Direct Mine Supplier'
                            : 'Auto-creates a linked Supplier in Parties',
                          icon: <Pickaxe size={16} color="var(--ios-blue)" />,
                          badge: directParty ? 'Direct Mine' : 'Auto-Create',
                        },
                        ...parties
                          .filter((p) => p.type === 'supplier' && !p.isArchived && p.id !== directParty?.id)
                          .map((p) => ({
                            value: p.id,
                            label: p.name,
                            subtitle: p.phone || p.address || 'Saved Supplier',
                            icon: <Store size={16} color="#FF9500" />,
                            badge: 'Supplier',
                          })),
                      ]}
                      searchable={true}
                      searchPlaceholder="Search suppliers or add custom..."
                      allowCustomOption={true}
                      createOptionLabel={(q) => `Use custom: "${q}"`}
                      createOptionSubtitle={() => 'Custom supplier name for this lot'}
                      onCreateOption={(customName) => {
                        setStockForm((prev) => ({
                          ...prev,
                          supplierId: '',
                          boughtFrom: customName.trim(),
                        }));
                      }}
                      floating
                    />
                    <div
                      style={{
                        fontSize: 11.5,
                        color: 'var(--label-secondary)',
                        marginTop: 4,
                        paddingLeft: 4,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <Info size={12} color="var(--ios-blue)" />
                      <span>
                        {stockForm.supplierId === '__auto_direct__' ||
                        (!stockForm.supplierId &&
                          (!stockForm.boughtFrom || stockForm.boughtFrom.includes('Direct Ledger')))
                          ? `Direct purchases will automatically reflect in "${mine.name} Direct Ledger".`
                          : `Inflow will be tracked under "${stockForm.boughtFrom || 'Selected Supplier'}".`}
                      </span>
                    </div>
                  </div>
                ) : (
                  <FloatingField
                    label="Bought From / Seller"
                    value={stockForm.boughtFrom}
                    onChange={(v) => setStockForm((prev) => ({ ...prev, boughtFrom: v }))}
                    placeholder={sourceName}
                    required
                  />
                )}
              </div>

              {/* Weights */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <FloatingField
                  label="Loaded / Billed Weight"
                  type="number"
                  step="0.01"
                  value={stockForm.tonnage}
                  onChange={(v) => setStockForm((prev) => ({ ...prev, tonnage: v }))}
                  placeholder="30.0"
                  suffix="tons"
                  required
                />
                <FloatingField
                  label="Received Yard Weight"
                  type="number"
                  step="0.01"
                  value={stockForm.receivedTonnage}
                  onChange={(v) => setStockForm((prev) => ({ ...prev, receivedTonnage: v }))}
                  placeholder={stockForm.tonnage || '29.5'}
                  suffix="tons"
                />
              </div>

              {/* Rate per ton / Purity */}
              {isPurityPricing ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                  <FloatingField
                    label="Purity %"
                    type="number"
                    step="0.01"
                    value={stockForm.purityPercent}
                    onChange={(v) => {
                      const p = parseFloat(v) || 0;
                      const r = parseFloat(stockForm.ratePerPurity) || 0;
                      const calculatedRate = p > 0 && r > 0 ? (p * r).toFixed(0) : '';
                      setStockForm((prev) => ({ ...prev, purityPercent: v, ratePerTon: calculatedRate }));
                    }}
                    placeholder="30"
                    suffix="%"
                  />
                  <FloatingField
                    label="Rate per % Purity"
                    type="number"
                    step="0.01"
                    value={stockForm.ratePerPurity}
                    onChange={(v) => {
                      const r = parseFloat(v) || 0;
                      const p = parseFloat(stockForm.purityPercent) || 0;
                      const calculatedRate = p > 0 && r > 0 ? (p * r).toFixed(0) : '';
                      setStockForm((prev) => ({ ...prev, ratePerPurity: v, ratePerTon: calculatedRate }));
                    }}
                    placeholder="116"
                    suffix={`${curSym}/unit`}
                  />
                </div>
              ) : null}

              <div style={{ marginBottom: 12 }}>
                <FloatingField
                  label="Purchase Rate per Ton"
                  type="number"
                  step="0.01"
                  value={stockForm.ratePerTon}
                  onChange={(v) => setStockForm((prev) => ({ ...prev, ratePerTon: v }))}
                  placeholder="18500"
                  suffix={`${curSym}/t`}
                  required
                  helperText={
                    isPurityPricing && parsedPurity > 0 && parsedRatePerPurity > 0
                      ? `${curSym} ${parsedRatePerPurity} × ${parsedPurity}% = ${curSym} ${(parsedPurity * parsedRatePerPurity).toFixed(2)}/t`
                      : undefined
                  }
                />
              </div>

              {/* Overheads (Loading & Freight) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <FloatingField
                  label="Loading Fare"
                  type="number"
                  value={stockForm.loadingCost}
                  onChange={(v) => setStockForm((prev) => ({ ...prev, loadingCost: v }))}
                  placeholder="0"
                  suffix={curSym}
                />
                <FloatingField
                  label="Freight Fare"
                  type="number"
                  value={stockForm.freightCost}
                  onChange={(v) => setStockForm((prev) => ({ ...prev, freightCost: v }))}
                  placeholder="0"
                  suffix={curSym}
                />
              </div>

              <div style={{ marginBottom: 14 }}>
                <FloatingField
                  label="Stored Yard Location"
                  value={stockForm.storedAt}
                  onChange={(v) => setStockForm((prev) => ({ ...prev, storedAt: v }))}
                  placeholder="e.g. Yard Bin #3"
                />
              </div>

              {/* Live Landed Cost Summary Banner */}
              <div
                style={{
                  background: 'var(--fill-tertiary)',
                  borderRadius: 12,
                  padding: '12px 14px',
                  border: '0.5px solid var(--separator)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ color: 'var(--label-secondary)' }}>Calculated Total Capital:</span>
                  <strong className="tabular-nums">{curSym} {formatAmountNumber(liveTotalValue, settings)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 4 }}>
                  <span style={{ color: 'var(--label-secondary)' }}>Effective Landed Rate:</span>
                  <strong style={{ color: 'var(--ios-blue)' }} className="tabular-nums">
                    {curSym} {formatAmountNumber(liveLandedRate, settings)}/ton
                  </strong>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Edit Source (Mine or Supplier) Modal Sheet ── */}
      {isEditingSource && (
        <div
          className="ios-modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
          }}
          onClick={() => setIsEditingSource(false)}
        >
          <div
            className="ios-action-sheet"
            style={{
              width: '100%',
              maxWidth: 580,
              background: 'var(--bg-card)',
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 -10px 40px rgba(0,0,0,0.3)',
              overflow: 'hidden',
              animation: 'slideUpSheet 0.25s cubic-bezier(0.1, 0.9, 0.2, 1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Grabber Handle */}
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10, paddingBottom: 6 }}>
              <div style={{ width: 36, height: 5, borderRadius: 3, background: 'var(--label-tertiary)', opacity: 0.4 }} />
            </div>

            {/* Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 16px 12px',
                borderBottom: '0.5px solid var(--separator)',
              }}
            >
              <button
                type="button"
                onClick={() => setIsEditingSource(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--ios-blue)',
                  fontSize: 16,
                  fontWeight: 500,
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                Cancel
              </button>

              <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--label-primary)' }}>
                {isSupplier ? 'Edit Supplier' : 'Edit Mine'}
              </span>

              <button
                type="button"
                onClick={handleSaveSource}
                disabled={isSavingSource}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--ios-blue)',
                  fontSize: 16,
                  fontWeight: 700,
                  cursor: 'pointer',
                  padding: 0,
                  opacity: isSavingSource ? 0.6 : 1,
                }}
              >
                {isSavingSource ? 'Saving…' : 'Save'}
              </button>
            </div>

            {/* Body */}
            <form onSubmit={handleSaveSource} style={{ padding: '16px 16px 36px', overflowY: 'auto' }}>
              {sourceFormError && (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: 'rgba(255, 59, 48, 0.1)',
                    border: '0.5px solid rgba(255, 59, 48, 0.3)',
                    color: 'var(--ios-red)',
                    fontSize: 13,
                    marginBottom: 14,
                  }}
                >
                  {sourceFormError}
                </div>
              )}

              <div style={{ marginBottom: 12 }}>
                <FloatingField
                  label={isSupplier ? 'Supplier Name' : 'Mine Name'}
                  value={sourceForm.name}
                  onChange={(v) => setSourceForm((prev) => ({ ...prev, name: v }))}
                  required
                />
              </div>

              {!isSupplier && (
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--label-secondary)',
                    marginTop: -4,
                    marginBottom: 14,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 10px',
                    borderRadius: 8,
                    background: 'rgba(0, 122, 255, 0.08)',
                    border: '1px solid rgba(0, 122, 255, 0.18)',
                  }}
                >
                  <ShieldCheck size={14} color="var(--ios-blue)" style={{ flexShrink: 0 }} />
                  <span>Renaming updates its Direct Ledger and all stock vouchers automatically.</span>
                </div>
              )}

              {isSupplier ? (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                    <FloatingField
                      label="Contact Person"
                      value={sourceForm.contactPerson}
                      onChange={(v) => setSourceForm((prev) => ({ ...prev, contactPerson: v }))}
                    />
                    <FloatingField
                      label="Phone Number"
                      type="tel"
                      value={sourceForm.phone}
                      onChange={(v) => setSourceForm((prev) => ({ ...prev, phone: v }))}
                    />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <FloatingField
                      label="Address"
                      value={sourceForm.location}
                      onChange={(v) => setSourceForm((prev) => ({ ...prev, location: v }))}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div style={{ marginBottom: 12 }}>
                    <FloatingField
                      label="Standard Rate per Ton"
                      type="number"
                      value={sourceForm.ratePerTon}
                      onChange={(v) => setSourceForm((prev) => ({ ...prev, ratePerTon: v }))}
                      suffix={`${curSym}/t`}
                    />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                    <FloatingField
                      label="Contact / Phone"
                      type="tel"
                      value={sourceForm.phone}
                      onChange={(v) => setSourceForm((prev) => ({ ...prev, phone: v }))}
                      placeholder="e.g. 0300-1234567"
                    />
                    <FloatingField
                      label="Location / Pit"
                      value={sourceForm.location}
                      onChange={(v) => setSourceForm((prev) => ({ ...prev, location: v }))}
                      placeholder="e.g. Duki Pit 4"
                    />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <FloatingField
                      label="Notes / Description"
                      value={sourceForm.notes}
                      onChange={(v) => setSourceForm((prev) => ({ ...prev, notes: v }))}
                      placeholder="Optional notes"
                    />
                  </div>

                  {mine && (
                    <div style={{ marginTop: 20, paddingTop: 14, borderTop: '0.5px solid var(--separator)' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setIsEditingSource(false);
                          setIsConfirmingDeleteMine(true);
                        }}
                        style={{
                          width: '100%',
                          padding: '12px',
                          borderRadius: 12,
                          background: 'rgba(255, 59, 48, 0.1)',
                          border: '1px solid rgba(255, 59, 48, 0.25)',
                          color: 'var(--ios-red)',
                          fontSize: 15,
                          fontWeight: 600,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 8,
                          cursor: 'pointer',
                        }}
                      >
                        <Trash2 size={16} />
                        <span>Delete Mine</span>
                      </button>
                    </div>
                  )}
                </>
              )}
            </form>
          </div>
        </div>
      )}

      {/* ── Confirm Delete Stock Lot Modal ── */}
      <IOSConfirmModal
        isOpen={Boolean(lotToDelete)}
        title="Delete Stock Entry?"
        message={`Are you sure you want to delete this stock voucher (${lotToDelete?.billedWeight || 0} tons)? This cannot be undone.`}
        confirmText="Delete Voucher"
        destructive
        onConfirm={handleDeleteStock}
        onCancel={() => setLotToDelete(null)}
      />

      {/* ── Dispatch Preview Modal ── */}
      <DispatchPreviewModal
        dispatch={previewDispatch}
        onClose={() => setPreviewDispatch(null)}
      />

      {/* ── Stock Lot Preview Modal ── */}
      {previewLot && (
        <StockPreviewModal
          lot={previewLot}
          mine={mine}
          settings={settings}
          onClose={() => setPreviewLot(null)}
          onEdit={(l) => {
            setPreviewLot(null);
            handleOpenEditStock(l);
          }}
          onDelete={(l) => {
            setPreviewLot(null);
            setLotToDelete(l);
          }}
        />
      )}

      {/* ── Add Payment Modal Sheet ── */}
      {isAddingPayment && (
        <div
          className="ios-modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
          }}
          onClick={() => setIsAddingPayment(false)}
        >
          <div
            className="ios-action-sheet"
            style={{
              width: '100%',
              maxWidth: 580,
              background: 'var(--bg-card)',
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              maxHeight: '92vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 -10px 40px rgba(0,0,0,0.3)',
              overflow: 'hidden',
              animation: 'slideUpSheet 0.25s cubic-bezier(0.1, 0.9, 0.2, 1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Grabber Handle */}
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10, paddingBottom: 6 }}>
              <div style={{ width: 36, height: 5, borderRadius: 3, background: 'var(--label-tertiary)', opacity: 0.4 }} />
            </div>

            {/* Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 16px 12px',
                borderBottom: '0.5px solid var(--separator)',
              }}
            >
              <button
                type="button"
                onClick={() => setIsAddingPayment(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--ios-blue)',
                  fontSize: 16,
                  fontWeight: 500,
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                Cancel
              </button>

              <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--label-primary)' }}>
                Pay Supplier
              </span>

              <button
                type="button"
                onClick={handleSavePayment}
                disabled={isSavingPayment}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--ios-green)',
                  fontSize: 16,
                  fontWeight: 700,
                  cursor: 'pointer',
                  padding: 0,
                  opacity: isSavingPayment ? 0.6 : 1,
                }}
              >
                {isSavingPayment ? 'Saving…' : 'Record'}
              </button>
            </div>

            {/* Body */}
            <form onSubmit={handleSavePayment} style={{ padding: '16px 16px 36px', overflowY: 'auto' }}>
              {paymentFormError && (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: 'rgba(255, 59, 48, 0.1)',
                    border: '0.5px solid rgba(255, 59, 48, 0.3)',
                    color: 'var(--ios-red)',
                    fontSize: 13,
                    marginBottom: 14,
                  }}
                >
                  {paymentFormError}
                </div>
              )}

              <div style={{ marginBottom: 12 }}>
                <IOSDatePicker
                  label="Payment Date"
                  value={paymentForm.date}
                  onChange={(d) => setPaymentForm((prev) => ({ ...prev, date: d }))}
                  floating
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <FloatingField
                  label="Amount Paid"
                  type="number"
                  step="any"
                  value={paymentForm.amount}
                  onChange={(v) => setPaymentForm((prev) => ({ ...prev, amount: v }))}
                  placeholder="50000"
                  suffix={curSym}
                  required
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-secondary)', marginBottom: 6, display: 'block' }}>
                  Payment Method
                </label>
                <div style={{ display: 'flex', background: 'var(--fill-tertiary)', borderRadius: 10, padding: 3, gap: 2 }}>
                  {(['bank', 'cash', 'cheque', 'online'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPaymentForm((prev) => ({ ...prev, mode: m }))}
                      style={{
                        flex: 1,
                        padding: '7px 4px',
                        borderRadius: 8,
                        border: 'none',
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: 'pointer',
                        textTransform: 'capitalize',
                        background: paymentForm.mode === m ? 'var(--bg-card)' : 'transparent',
                        color: paymentForm.mode === m ? 'var(--label-primary)' : 'var(--label-secondary)',
                        boxShadow: paymentForm.mode === m ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                      }}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <FloatingField
                  label="Reference / Check # / Notes"
                  value={paymentForm.referenceNote || ''}
                  onChange={(v) => setPaymentForm((prev) => ({ ...prev, referenceNote: v }))}
                  placeholder="e.g. Bank Transfer #98234 or Paid via Cash"
                />
              </div>

              <div
                style={{
                  background: 'var(--fill-tertiary)',
                  borderRadius: 12,
                  padding: '12px 14px',
                  border: '0.5px solid var(--separator)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ color: 'var(--label-secondary)' }}>Current Balance Owed:</span>
                  <strong style={{ color: financials.outstandingBalance > 0 ? 'var(--ios-red)' : 'var(--ios-green)' }} className="tabular-nums">
                    {curSym} {formatAmountNumber(financials.outstandingBalance, settings)}
                  </strong>
                </div>
                {parseFloat(paymentForm.amount) > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 4 }}>
                    <span style={{ color: 'var(--label-secondary)' }}>Remaining After Payment:</span>
                    <strong style={{ color: 'var(--ios-blue)' }} className="tabular-nums">
                      {curSym} {formatAmountNumber(Math.max(0, financials.outstandingBalance - (parseFloat(paymentForm.amount) || 0)), settings)}
                    </strong>
                  </div>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Payment Preview Sheet ── */}
      {previewPayment && (
        <div
          className="ios-modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
          }}
          onClick={() => setPreviewPayment(null)}
        >
          <div
            className="ios-action-sheet"
            style={{
              width: '100%',
              maxWidth: 580,
              background: 'var(--bg-card)',
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 -10px 40px rgba(0,0,0,0.3)',
              overflow: 'hidden',
              animation: 'slideUpSheet 0.25s cubic-bezier(0.1, 0.9, 0.2, 1)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10, paddingBottom: 6 }}>
              <div style={{ width: 36, height: 5, borderRadius: 3, background: 'var(--label-tertiary)', opacity: 0.4 }} />
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 16px 12px',
                borderBottom: '0.5px solid var(--separator)',
              }}
            >
              <button
                type="button"
                onClick={() => setPreviewPayment(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--ios-blue)',
                  fontSize: 16,
                  fontWeight: 500,
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                Close
              </button>

              <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--label-primary)' }}>
                Payment Voucher
              </span>

              <button
                type="button"
                onClick={() => {
                  const toDel = previewPayment;
                  setPreviewPayment(null);
                  setPaymentToDelete(toDel);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--ios-red)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                <Trash2 size={16} />
                <span>Delete</span>
              </button>
            </div>

            <div style={{ padding: '20px 20px 36px', overflowY: 'auto' }}>
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--label-secondary)', textTransform: 'uppercase' }}>
                  Amount Paid
                </div>
                <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--ios-green)', marginTop: 4 }} className="tabular-nums">
                  {curSym} {formatAmountNumber(previewPayment.amount, settings)}
                </div>
                <div style={{ fontSize: 13, color: 'var(--label-secondary)', marginTop: 4 }}>
                  Paid to {sourceName}
                </div>
              </div>

              <div
                style={{
                  background: 'var(--fill-tertiary)',
                  borderRadius: 14,
                  padding: '12px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  border: '0.5px solid var(--separator)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                  <span style={{ color: 'var(--label-secondary)' }}>Payment Date:</span>
                  <strong>{formatDisplayDate(previewPayment.date)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                  <span style={{ color: 'var(--label-secondary)' }}>Payment Mode:</span>
                  <strong style={{ textTransform: 'uppercase' }}>{previewPayment.mode || 'BANK'}</strong>
                </div>
                {previewPayment.referenceNote && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                    <span style={{ color: 'var(--label-secondary)' }}>Reference / Notes:</span>
                    <strong style={{ maxWidth: '60%', textAlign: 'right' }}>{previewPayment.referenceNote}</strong>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm Delete Payment Modal ── */}
      <IOSConfirmModal
        isOpen={Boolean(paymentToDelete)}
        title="Delete Payment Voucher?"
        message={`Are you sure you want to delete this payment voucher of ${curSym} ${paymentToDelete ? formatAmountNumber(paymentToDelete.amount, settings) : 0}? This cannot be undone.`}
        confirmText="Delete Payment"
        destructive
        onConfirm={handleDeletePayment}
        onCancel={() => setPaymentToDelete(null)}
      />

      {/* ── Confirm Delete Mine Modal ── */}
      <IOSConfirmModal
        isOpen={isConfirmingDeleteMine}
        title={
          lots.filter((l) => !l.deleted).length > 0
            ? `Cannot Delete ${mine?.name || 'Mine'}`
            : `Delete ${mine?.name || 'Mine'}?`
        }
        message={
          lots.filter((l) => !l.deleted).length > 0
            ? `This mine has ${lots.filter((l) => !l.deleted).length} active stock vouchers recorded. To delete this mine, you must delete all its stock vouchers first.`
            : `Are you sure you want to delete this mine? Its linked Direct Ledger supplier account will be cleanly archived or removed.`
        }
        confirmText={lots.filter((l) => !l.deleted).length > 0 ? 'Got it' : 'Delete Mine'}
        cancelText="Cancel"
        singleButton={lots.filter((l) => !l.deleted).length > 0}
        destructive={lots.filter((l) => !l.deleted).length === 0}
        icon={lots.filter((l) => !l.deleted).length > 0 ? 'warning' : 'trash'}
        onConfirm={async () => {
          if (lots.filter((l) => !l.deleted).length > 0) {
            setIsConfirmingDeleteMine(false);
            return;
          }
          if (!mine) return;
          try {
            await deleteMine(mine.id);
            playPopSound();
            showToast('Mine deleted');
            navigate('/inventory');
          } catch (err: any) {
            showToast(err?.message || 'Could not delete mine');
          } finally {
            setIsConfirmingDeleteMine(false);
          }
        }}
        onCancel={() => setIsConfirmingDeleteMine(false)}
      />

      {/* ── Direct Mine Ledger Info Modal (Bilingual) ── */}
      {bilingualModalData && (
        <DirectMineLedgerInfoModal
          isOpen={bilingualModalData.isOpen}
          onClose={() => setBilingualModalData(null)}
          mineName={bilingualModalData.mineName}
          supplierName={bilingualModalData.supplierName}
        />
      )}
    </div>
  );
}
