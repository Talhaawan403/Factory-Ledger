import { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getMine,
  saveMine,
  getMineLots,
  saveLot,
  deleteLot,
  getDispatches,
  getParties,
  getSettings,
} from '../lib/db';
import type { Mine, InventoryLot, Dispatch, Party, AppSettings } from '../types';
import { calculateLotStock, calculateMineStock } from '../utils/calculations';
import { getCurrencySymbol, formatAmountNumber } from '../utils/currency';
import { getTodayDateString, formatDisplayDate } from '../utils/dateUtils';
import { playPopSound, playSuccessSound, triggerConfetti } from '../utils/delight';
import { useLedgerListener } from '../hooks/useLedgerListener';
import { v4 as uuidv4 } from 'uuid';
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
  Layers,
  CheckCircle2,
  Lock,
} from 'lucide-react';
import FloatingField from '../components/FloatingField';
import IOSDatePicker from '../components/IOSDatePicker';
import IOSConfirmModal from '../components/IOSConfirmModal';
import DispatchPreviewModal from '../components/DispatchPreviewModal';
import StockPreviewModal from '../components/StockPreviewModal';

export default function MineLedger() {
  const { mineId } = useParams<{ mineId: string }>();
  const navigate = useNavigate();

  const [mine, setMine] = useState<Mine | null>(null);
  const [lots, setLots] = useState<InventoryLot[]>([]);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [settings, setSettings] = useState<AppSettings | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  // Tab filter: 'all' | 'inflow' | 'outflow'
  const [activeTab, setActiveTab] = useState<'all' | 'inflow' | 'outflow'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Add / Edit Stock Modal state
  const [isAddingStock, setIsAddingStock] = useState(false);
  const [editingLotId, setEditingLotId] = useState<string | null>(null);
  const [stockFormError, setStockFormError] = useState<string | null>(null);
  const [isSavingStock, setIsSavingStock] = useState(false);
  const [stockForm, setStockForm] = useState({
    tonnage: '',
    receivedTonnage: '',
    boughtFrom: '',
    storedAt: '',
    ratePerTon: '',
    loadingCost: '',
    freightCost: '',
    date: getTodayDateString(),
  });

  // Edit Mine Modal state
  const [isEditingMine, setIsEditingMine] = useState(false);
  const [mineFormError, setMineFormError] = useState<string | null>(null);
  const [isSavingMine, setIsSavingMine] = useState(false);
  const [mineForm, setMineForm] = useState({
    name: '',
    ratePerTon: '',
    location: '',
    notes: '',
  });

  // Delete Lot Confirm state
  const [lotToDelete, setLotToDelete] = useState<InventoryLot | null>(null);
  const [errorAlert, setErrorAlert] = useState<{ title: string; message: string } | null>(null);

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
    const [m, allLots, allDispatches, allParties, s] = await Promise.all([
      getMine(mineId),
      getMineLots(mineId),
      getDispatches(),
      getParties(),
      getSettings(),
    ]);

    setMine(m);
    setLots(allLots);
    setDispatches(allDispatches);
    setParties(allParties);
    setSettings(s);
    setLoading(false);
  }, [mineId]);

  useEffect(() => {
    let active = true;
    if (!mineId) return;
    Promise.all([
      getMine(mineId),
      getMineLots(mineId),
      getDispatches(),
      getParties(),
      getSettings(),
    ]).then(([m, allLots, allDispatches, allParties, s]) => {
      if (active) {
        setMine(m);
        setLots(allLots);
        setDispatches(allDispatches);
        setParties(allParties);
        setSettings(s);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [mineId]);

  useLedgerListener(() => {
    loadData();
  });

  // Mine Stock & Financial Summary
  const stockSummary = useMemo(() => {
    if (!mine) return null;
    return calculateMineStock(mine, lots, dispatches);
  }, [mine, lots, dispatches]);

  // Outflow Dispatches that consumed coal from this mine
  const matchedDispatches = useMemo(() => {
    if (!mine) return [];
    const mineLotIds = new Set(lots.filter((lot) => !lot.deleted).map((lot) => lot.id));
    return dispatches
      .filter((d) => !d.deleted)
      .map((d) => {
        const matchingInputs = (d.coalInputs || []).filter(
          (ci) =>
            ci.mineId === mine.id ||
            (Boolean(ci.lotId) && mineLotIds.has(ci.lotId!)) ||
            (Boolean(ci.sourceName) && ci.sourceName.trim().toLowerCase() === mine.name.trim().toLowerCase())
        );
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
  }, [mine, lots, dispatches]);

  // Combined activity list
  const activityList = useMemo(() => {
    const list: Array<{
      type: 'inflow' | 'outflow';
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
        title: lot.boughtFrom || lot.supplier ? `Bought from: ${lot.boughtFrom || lot.supplier}` : 'Stock Inflow',
        subtitle: lot.storedAt ? `Stored at: ${lot.storedAt}` : 'Yard stock entry',
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

    // Sort by date descending
    list.sort((a, b) => b.timestamp - a.timestamp);

    // Apply tab filter
    let filtered = list;
    if (activeTab === 'inflow') {
      filtered = list.filter((i) => i.type === 'inflow');
    } else if (activeTab === 'outflow') {
      filtered = list.filter((i) => i.type === 'outflow');
    }

    // Apply search filter
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
  }, [lots, matchedDispatches, mine, parties, dispatches, activeTab, searchQuery]);

  // Live Auto-Calculation for Add/Edit Stock Sheet:
  // coalAmount = loadedTonnage * baseRate
  // totalAmount = coalAmount + loadingAmount + fare
  // effectiveWeight = receivedTonnage > 0 ? receivedTonnage : loadedTonnage
  // landedRate = totalAmount / effectiveWeight
  const parsedTonnage = parseFloat(stockForm.tonnage) || 0;
  const parsedReceivedTonnage = parseFloat(stockForm.receivedTonnage) || 0;
  const parsedBaseRate = parseFloat(stockForm.ratePerTon) || (mine?.ratePerTon || 0);
  const parsedLoading = parseFloat(stockForm.loadingCost) || 0;
  const parsedFare = parseFloat(stockForm.freightCost) || 0;

  const liveBaseCoalCost = Math.round(parsedTonnage * parsedBaseRate);
  const liveTotalValue = Math.round(liveBaseCoalCost + parsedLoading + parsedFare);
  const effectiveWeight = parsedReceivedTonnage > 0 ? parsedReceivedTonnage : parsedTonnage;
  const liveLandedRate = effectiveWeight > 0 ? Math.round((liveTotalValue / effectiveWeight) * 100) / 100 : parsedBaseRate;

  // Linked dispatch for editing notice
  const linkedDispatchesForEditing = useMemo(() => {
    if (!editingLotId) return [];
    return dispatches.filter(
      (candidate) => !candidate.deleted && (candidate.coalInputs || []).some((input) => input.lotId === editingLotId)
    );
  }, [editingLotId, dispatches]);
  const linkedDispatchForEditing = linkedDispatchesForEditing[0] || null;
  const isStockFinanciallyLocked = Boolean(linkedDispatchForEditing);

  // Open Add Stock Modal
  const handleOpenAddStock = () => {
    playPopSound();
    setEditingLotId(null);
    setStockFormError(null);
    setStockForm({
      tonnage: '',
      receivedTonnage: '',
      boughtFrom: '',
      storedAt: mine?.location || '',
      ratePerTon: mine?.ratePerTon ? String(mine.ratePerTon) : '',
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
    setStockForm({
      tonnage: String(lot.billedWeight || lot.tonnage || ''),
      receivedTonnage: lot.receivedWeight && lot.receivedWeight !== lot.billedWeight ? String(lot.receivedWeight) : '',
      boughtFrom: lot.boughtFrom || lot.supplier || '',
      storedAt: lot.storedAt || '',
      ratePerTon: String(lot.purchaseRate || lot.ratePerTon || mine?.ratePerTon || ''),
      loadingCost: lot.loadingCost ? String(lot.loadingCost) : '',
      freightCost: lot.freightCost ? String(lot.freightCost) : '',
      date: lot.date || getTodayDateString(),
    });
    setIsAddingStock(true);
  };

  // Submit Add / Edit Stock
  const handleSaveStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mine || isSavingStock) return;

    const boughtFrom = stockForm.boughtFrom.trim();
    if (!boughtFrom) {
      setStockFormError("Please enter the seller or supplier name in 'Bought From'.");
      return;
    }

    if (!Number.isFinite(parsedTonnage) || parsedTonnage <= 0) {
      setStockFormError('Please enter a valid positive loaded tonnage.');
      return;
    }
    if (stockForm.receivedTonnage.trim() && (!Number.isFinite(parsedReceivedTonnage) || parsedReceivedTonnage <= 0)) {
      setStockFormError('Received quantity must be greater than zero.');
      return;
    }
    if (!Number.isFinite(parsedBaseRate) || parsedBaseRate <= 0) {
      setStockFormError('Coal rate per ton must be greater than zero.');
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

      const lotToSave: InventoryLot = {
        ...(existingLot || {}),
        id: editingLotId || uuidv4(),
        mineId: mine.id,
        mineName: mine.name,
        boughtFrom: boughtFrom,
        supplier: boughtFrom,
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
        mineSource: mine.name,
        createdAt: existingLot?.createdAt || now,
        updatedAt: now,
      };

      const linkedDisp = editingLotId
        ? dispatches.find(
          (d) =>
            !d.deleted &&
            (d.id === existingLot?.usedInDispatchId || (d.coalInputs || []).some((ci) => ci.lotId === editingLotId))
        )
        : undefined;

      await saveLot(lotToSave);
      playSuccessSound();
      triggerConfetti();
      setIsAddingStock(false);
      setEditingLotId(null);
      if (linkedDisp) {
        showToast(`Stock details updated · Dispatch #${linkedDisp.truckNumber || 'receipt'} snapshot preserved`);
      } else {
        showToast(editingLotId ? 'Stock entry updated' : `Added ${parsedTonnage.toFixed(2)} tons stock entry`);
      }
      loadData();
    } catch (err: any) {
      setStockFormError(err?.message || 'Failed to save stock entry.');
    } finally {
      setIsSavingStock(false);
    }
  };

  // Open Edit Mine Modal
  const handleOpenEditMine = () => {
    if (!mine) return;
    playPopSound();
    setMineFormError(null);
    setMineForm({
      name: mine.name,
      ratePerTon: String(mine.ratePerTon),
      location: mine.location || '',
      notes: mine.notes || '',
    });
    setIsEditingMine(true);
  };

  // Save Edit Mine
  const handleSaveMine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mine || isSavingMine) return;

    const name = mineForm.name.trim();
    const rate = parseFloat(mineForm.ratePerTon);
    if (!name) {
      setMineFormError('Please enter the mine name.');
      return;
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      setMineFormError('Please enter a valid rate per ton greater than zero.');
      return;
    }

    try {
      setIsSavingMine(true);
      setMineFormError(null);
      await saveMine({
        ...mine,
        name,
        ratePerTon: rate,
        location: mineForm.location.trim() || undefined,
        notes: mineForm.notes.trim() || undefined,
        updatedAt: Date.now(),
      });
      playSuccessSound();
      setIsEditingMine(false);
      showToast('Mine updated');
      loadData();
    } catch (err: any) {
      setMineFormError(err?.message || 'Failed to update mine.');
    } finally {
      setIsSavingMine(false);
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
      loadData();
    } catch (err: any) {
      setLotToDelete(null);
      setErrorAlert({
        title: 'Cannot Delete Stock Entry',
        message: err?.message || 'Could not delete entry.',
      });
    }
  };

  if (loading) {
    return (
      <div className="ios-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ color: 'var(--label-secondary)', fontSize: 15 }}>Loading Mine Ledger…</div>
      </div>
    );
  }

  if (!mine) {
    return (
      <div className="ios-page" style={{ padding: 24, textAlign: 'center' }}>
        <h2>Mine Not Found</h2>
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

      {/* ── Top Apple iOS Navigation Bar (Matching PartyLedger exactly) ── */}
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
            <span>Mines</span>
          </button>

          <div className="ios-navbar-title-inline">{mine.name}</div>

          <button
            type="button"
            className="ios-nav-action"
            title="Edit Mine"
            onClick={handleOpenEditMine}
          >
            <Edit3 style={{ width: 20, height: 20 }} strokeWidth={2.2} />
          </button>
        </div>
      </div>

      {/* ── Mine Profile Banner (Matching PartyLedger) ── */}
      <div style={{ padding: '16px 20px', display: 'flex', gap: 16, alignItems: 'center' }}>
        <div
          style={{
            width: 58,
            height: 58,
            borderRadius: 16,
            background: 'var(--ios-blue)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontWeight: 800,
            fontSize: 22,
            flexShrink: 0,
          }}
        >
          {mine.name.slice(0, 2).toUpperCase()}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--label-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {mine.name}
          </h1>
          <div style={{ fontSize: 14, color: 'var(--label-secondary)', marginTop: 2, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>{mine.location || 'Mine Yard'}</span>
            <span>·</span>
            <span style={{ color: 'var(--ios-blue)', fontWeight: 600 }}>
              {curSym} {formatAmountNumber(mine.ratePerTon)}/t
            </span>
          </div>
        </div>
      </div>

      {/* ── Overview Statistics Card (Apple Card) ── */}
      {stockSummary && (
        <div style={{ padding: '0 16px', marginBottom: 16 }}>
          <div
            style={{
              background: 'var(--bg-card)',
              borderRadius: 20,
              padding: '18px 20px',
              border: '0.5px solid var(--separator)',
              boxShadow: 'var(--shadow-card)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-secondary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Current Yard Stock
                </div>
                <div
                  style={{
                    fontSize: 34,
                    fontWeight: 800,
                    color: stockSummary.isOverdrawn ? 'var(--ios-red)' : 'var(--label-primary)',
                    marginTop: 2,
                    lineHeight: 1.15,
                  }}
                  className="tabular-nums"
                >
                  {stockSummary.remainingTons.toFixed(2)}{' '}
                  <span style={{ fontSize: 18, fontWeight: 500, color: 'var(--label-secondary)' }}>tons</span>
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--label-secondary)', textTransform: 'uppercase' }}>
                  Est. Valuation
                </div>
                <div
                  style={{
                    fontSize: 20,
                    fontWeight: 700,
                    color: 'var(--ios-green)',
                    marginTop: 4,
                  }}
                  className="tabular-nums"
                >
                  {curSym} {formatAmountNumber(stockSummary.remainingValue, settings)}
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 12,
                paddingTop: 14,
                borderTop: '0.5px solid var(--separator)',
              }}
            >
              <div>
                <div style={{ fontSize: 11, color: 'var(--label-secondary)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>Inflow (Purchased)</span>
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ios-green)', marginTop: 2 }} className="tabular-nums">
                  +{stockSummary.totalInflowTons.toFixed(2)} t
                </div>
                <div style={{ fontSize: 11, color: 'var(--label-tertiary)', marginTop: 1 }} className="tabular-nums">
                  {curSym} {formatAmountNumber(stockSummary.totalInflowValue, settings)}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 11, color: 'var(--label-secondary)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>Outflow (Blended)</span>
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ios-blue)', marginTop: 2 }} className="tabular-nums">
                  -{stockSummary.totalOutflowTons.toFixed(2)} t
                </div>
                <div style={{ fontSize: 11, color: 'var(--label-tertiary)', marginTop: 1 }} className="tabular-nums">
                  {curSym} {formatAmountNumber(stockSummary.totalOutflowValue, settings)}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Single Action Button: + Add Stock ── */}
      <div style={{ padding: '0 16px', marginBottom: 20 }}>
        <button
          type="button"
          onClick={handleOpenAddStock}
          style={{
            width: '100%',
            height: 52,
            borderRadius: 16,
            background: 'var(--ios-blue)',
            color: '#FFFFFF',
            border: 'none',
            fontSize: 17,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            //boxShadow: '0 4px 14px rgba(0, 122, 255, 0.35)',
            cursor: 'pointer',
          }}
          className="ios-btn-primary hover-press"
        >
          <Plus size={20} strokeWidth={2.5} />
          <span>Add Stock</span>
        </button>
      </div>

      {/* ── Segmented Control & Search ── */}
      <div style={{ padding: '0 16px', marginBottom: 12 }}>
        <div
          style={{
            display: 'flex',
            background: 'var(--fill-primary)',
            borderRadius: 10,
            padding: 3,
            marginBottom: 10,
          }}
        >
          <button
            onClick={() => {
              playPopSound();
              setActiveTab('all');
            }}
            style={{
              flex: 1,
              padding: '6px 0',
              borderRadius: 8,
              border: 'none',
              background: activeTab === 'all' ? 'var(--bg-card)' : 'transparent',
              color: activeTab === 'all' ? 'var(--label-primary)' : 'var(--label-tertiary)',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
              boxShadow: activeTab === 'all' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}
          >
            All Activity ({activityList.length})
          </button>

          <button
            onClick={() => {
              playPopSound();
              setActiveTab('inflow');
            }}
            style={{
              flex: 1,
              padding: '6px 0',
              borderRadius: 8,
              border: 'none',
              background: activeTab === 'inflow' ? 'var(--bg-card)' : 'transparent',
              color: activeTab === 'inflow' ? 'var(--label-primary)' : 'var(--label-tertiary)',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
              boxShadow: activeTab === 'inflow' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}
          >
            Stock Inflows ({lots.length})
          </button>

          <button
            onClick={() => {
              playPopSound();
              setActiveTab('outflow');
            }}
            style={{
              flex: 1,
              padding: '6px 0',
              borderRadius: 8,
              border: 'none',
              background: activeTab === 'outflow' ? 'var(--bg-card)' : 'transparent',
              color: activeTab === 'outflow' ? 'var(--label-primary)' : 'var(--label-tertiary)',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
              boxShadow: activeTab === 'outflow' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}
          >
            Dispatched ({matchedDispatches.length})
          </button>
        </div>

        {/* Small Inset Search */}
        <div
          className="ios-search-bar"
          style={{
            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.06)',
            border: '1px solid var(--border-glass)',
            background: 'var(--fill-tertiary)',
            height: 38,
          }}
        >
          <Search size={15} style={{ color: 'var(--label-tertiary)' }} />
          <input
            type="text"
            placeholder="Search activity by supplier, truck, date…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="ios-search-input"
            style={{ fontSize: 14 }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
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

      {/* ── Activity Ledger List ── */}
      <div className="ios-group">
        <div className="ios-card-grouped">
          {activityList.length === 0 ? (
            <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--label-secondary)' }}>
              <Layers style={{ width: 40, height: 40, margin: '0 auto 8px', opacity: 0.35 }} strokeWidth={1.5} />
              <div style={{ fontSize: 16, fontWeight: 600 }}>No Activity Found</div>
              <div style={{ fontSize: 13, marginTop: 4, color: 'var(--label-tertiary)' }}>
                {searchQuery ? `No entries matching "${searchQuery}"` : 'Tap "+ Add Stock" above to record your first stock entry.'}
              </div>
            </div>
          ) : (
            activityList.map((item, index) => {
              const isLast = index === activityList.length - 1;
              const isInflow = item.type === 'inflow';
              const isUsed = item.isUsedInDispatch;

              return (
                <div key={`${item.type}-${item.id}`} style={{ position: 'relative' }}>
                  <div
                    onClick={() => {
                      playPopSound();
                      if (isInflow && item.rawLot) {
                        setPreviewLot(item.rawLot);
                      } else if (!isInflow && item.rawDispatch) {
                        setPreviewDispatch(item.rawDispatch);
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 16px',
                      cursor: 'pointer',
                      transition: 'background 0.15s ease',
                    }}
                    className="ios-list-cell hover-bg"
                  >
                    {/* Left: Indicator Icon & Description */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: 10,
                          background: isInflow
                            ? isUsed
                              ? 'var(--ios-purple)'
                              : 'var(--ios-green)'
                            : 'var(--ios-blue)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          color: isInflow
                            ? isUsed
                              ? 'white'
                              : 'white'
                            : 'white',
                        }}
                      >
                        {isInflow ? (
                          isUsed ? <CheckCircle2 size={18} /> : <Package size={18} />
                        ) : (
                          <Truck size={18} />
                        )}
                      </div>

                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span
                            style={{
                              fontSize: 15,
                              fontWeight: 600,
                              color: 'var(--label-primary)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {item.title}
                          </span>

                          {isInflow && isUsed && (
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                padding: '2px 6px',
                                borderRadius: 6,
                                background: 'var(--ios-purple)',
                                color: 'white',
                              }}
                            >
                              {item.isFullyAllocated ? 'Fully Used' : 'Partially Used'} · {item.usedTons?.toFixed(2)}t used · {Math.max(0, item.remainingTons || 0).toFixed(2)}t left
                            </span>
                          )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12, color: 'var(--label-tertiary)' }}>
                            {formatDisplayDate(item.date)}
                          </span>
                          {item.subtitle && (
                            <span style={{ fontSize: 12, color: 'var(--label-secondary)' }}>
                              · {item.subtitle}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right: Tons, Total Value & Action */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, textAlign: 'right' }}>
                      <div>
                        <div
                          style={{
                            fontSize: 15,
                            fontWeight: 700,
                            color: isInflow ? (isUsed ? 'var(--ios-purple, #af52de)' : 'var(--ios-green)') : 'var(--label-primary)',
                          }}
                          className="tabular-nums"
                        >
                          {isInflow ? `+${item.tons.toFixed(2)} t` : `-${item.tons.toFixed(2)} t`}
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--label-secondary)' }} className="tabular-nums">
                          {curSym} {formatAmountNumber(item.value, settings)}
                        </div>
                      </div>

                      <ChevronRight className="ios-chevron" strokeWidth={2.5} style={{ marginLeft: 6, color: 'var(--label-tertiary)', flexShrink: 0 }} />
                    </div>
                  </div>

                  {!isLast && <div className="ios-separator" style={{ left: 66 }} />}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Add / Edit Stock Modal Sheet (Pop-up matching DispatchForm / DispatchReceipt) ── */}
      {isAddingStock && (
        <>
          <div
            className="ios-modal-backdrop"
            onClick={() => {
              playPopSound();
              setIsAddingStock(false);
            }}
          />
          <div
            className="ios-bottom-sheet"
            style={{
              maxHeight: '90vh',
              zIndex: 99999,
            }}
          >
            <div className="ios-sheet-handle" />

            {/* Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                borderBottom: '0.5px solid var(--separator)',
              }}
            >
              <button
                type="button"
                onClick={() => {
                  playPopSound();
                  setIsAddingStock(false);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--ios-blue)',
                  fontSize: 16,
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                Cancel
              </button>

              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--label-primary)' }}>
                  {editingLotId ? 'Edit Stock Entry' : 'Add Stock Entry'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--label-secondary)' }}>
                  {mine.name} · Default: {curSym} {formatAmountNumber(mine.ratePerTon)}/t
                </div>
              </div>

              <button
                type="button"
                onClick={handleSaveStock}
                disabled={isSavingStock}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--ios-blue)',
                  fontSize: 16,
                  fontWeight: 600,
                  cursor: isSavingStock ? 'wait' : 'pointer',
                  opacity: isSavingStock ? 0.55 : 1,
                  padding: 0,
                }}
              >
                {isSavingStock ? 'Saving…' : 'Save'}
              </button>
            </div>

            {/* Form Body */}
            <form onSubmit={handleSaveStock} style={{ padding: '16px 16px 36px', overflowY: 'auto' }}>
              {/* Linked Dispatch Notice Banner */}
              {linkedDispatchForEditing && (
                <div
                  style={{
                    marginBottom: 16,
                    padding: '10px 14px',
                    borderRadius: 14,
                    background: 'rgba(175, 82, 222, 0.1)',
                    border: '0.5px solid rgba(175, 82, 222, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    fontSize: 12,
                    color: 'var(--ios-purple, #af52de)',
                    fontWeight: 500,
                  }}
                >
                  <Lock size={16} style={{ flexShrink: 0 }} />
                  <div>
                    <span>
                      Allocated across <strong>{linkedDispatchesForEditing.length} {linkedDispatchesForEditing.length === 1 ? 'dispatch' : 'dispatches'}</strong>
                      {linkedDispatchesForEditing.length === 1 ? ` · #${linkedDispatchForEditing.truckNumber}` : ''}.
                    </span>
                    <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>
                      Stock-entry weight, rate, loading, freight, and date are locked so every allocation keeps its original accounting basis.
                    </div>
                  </div>
                </div>
              )}

              {/* Field 1: Bought From (Compulsory) */}
              <div style={{ marginBottom: 12 }}>
                <FloatingField
                  label="Bought From (Supplier / Seller / Pit) *"
                  value={stockForm.boughtFrom}
                  onChange={(val) => setStockForm((prev) => ({ ...prev, boughtFrom: val }))}
                  placeholder="e.g. Talha, Inam Shb, or Contractor Name"
                  autoFocus={!editingLotId}
                />
              </div>

              {/* Field 2 & 3: Loaded Tonnage & Received Quantity */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <FloatingField
                  label="Loaded Tonnage (tons) *"
                  type="number"
                  step="0.01"
                  suffix="tons"
                  value={stockForm.tonnage}
                  onChange={(val) => setStockForm((prev) => ({ ...prev, tonnage: val }))}
                  placeholder="e.g. 10.00"
                  disabled={isStockFinanciallyLocked}
                />

                <FloatingField
                  label="Received Qty"
                  type="number"
                  step="0.01"
                  suffix="tons"
                  value={stockForm.receivedTonnage}
                  onChange={(val) => setStockForm((prev) => ({ ...prev, receivedTonnage: val }))}
                  placeholder="e.g. 9.80"
                  disabled={isStockFinanciallyLocked}
                />
              </div>

              {/* Field 4: Base Rate per Ton */}
              <div style={{ marginBottom: 12 }}>
                <FloatingField
                  label="Coal Rate per Ton (PKR)"
                  type="number"
                  suffix={`${curSym}/t`}
                  value={stockForm.ratePerTon}
                  onChange={(val) => setStockForm((prev) => ({ ...prev, ratePerTon: val }))}
                  placeholder={`Default: ${mine.ratePerTon}`}
                  disabled={isStockFinanciallyLocked}
                />
              </div>

              {/* Field 5 & 6: Loading Amount + Fare / Freight */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <FloatingField
                  label="Loading Amnt"
                  type="number"
                  suffix={curSym}
                  value={stockForm.loadingCost}
                  onChange={(val) => setStockForm((prev) => ({ ...prev, loadingCost: val }))}
                  placeholder="e.g. 5000"
                  disabled={isStockFinanciallyLocked}
                />

                <FloatingField
                  label="Freight"
                  type="number"
                  suffix={curSym}
                  value={stockForm.freightCost}
                  onChange={(val) => setStockForm((prev) => ({ ...prev, freightCost: val }))}
                  placeholder="e.g. 20000"
                  disabled={isStockFinanciallyLocked}
                />
              </div>

              {/* ── Live Formula Auto-Calculated Value Card ── */}
              <div
                style={{
                  background: 'var(--fill-tertiary)',
                  borderRadius: 16,
                  padding: '14px 16px',
                  marginBottom: 14,
                  border: '0.5px solid var(--separator)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--label-secondary)' }}>
                    Coal Cost ({parsedTonnage}t × {curSym} {formatAmountNumber(parsedBaseRate)}):
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-primary)' }} className="tabular-nums">
                    {curSym} {formatAmountNumber(liveBaseCoalCost, settings)}
                  </span>
                </div>

                {(parsedLoading > 0 || parsedFare > 0) && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: 'var(--label-secondary)' }}>
                      Loading + Fare:
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-primary)' }} className="tabular-nums">
                      +{curSym} {formatAmountNumber(parsedLoading + parsedFare, settings)}
                    </span>
                  </div>
                )}

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingTop: 8,
                    borderTop: '0.5px solid var(--separator)',
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--label-primary)' }}>
                    Total Entry Amount:
                  </span>
                  <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--ios-green)' }} className="tabular-nums">
                    {curSym} {formatAmountNumber(liveTotalValue, settings)}
                  </span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: 6,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-secondary)' }}>
                    Effective Landed Rate:
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ios-blue)' }} className="tabular-nums">
                    {curSym} {formatAmountNumber(liveLandedRate, settings)} / ton
                  </span>
                </div>
              </div>

              {/* Field 7: Stored At */}
              <div style={{ marginBottom: 12 }}>
                <FloatingField
                  label="Stored At (Yard / Dump Location)"
                  value={stockForm.storedAt}
                  onChange={(val) => setStockForm((prev) => ({ ...prev, storedAt: val }))}
                  placeholder="e.g. Plot 3 - Sector B"
                />
              </div>

              {/* Field 8: Date using IOSDatePicker */}
              <div style={{ marginBottom: 20 }}>
                <IOSDatePicker
                  label="Date"
                  value={stockForm.date}
                  onChange={(d) => setStockForm((prev) => ({ ...prev, date: d }))}
                  floating
                  disabled={isStockFinanciallyLocked}
                />
              </div>

              {stockFormError && (
                <div
                  role="alert"
                  style={{
                    marginBottom: 14,
                    padding: '11px 13px',
                    borderRadius: 12,
                    background: 'rgba(255, 59, 48, 0.1)',
                    border: '0.5px solid rgba(255, 59, 48, 0.32)',
                    color: 'var(--ios-red)',
                    fontSize: 13,
                    fontWeight: 550,
                    lineHeight: 1.35,
                  }}
                >
                  {stockFormError}
                </div>
              )}

              {/* Save Button */}
              <button
                type="submit"
                disabled={isSavingStock}
                style={{
                  width: '100%',
                  height: 52,
                  borderRadius: 14,
                  background: 'var(--ios-blue)',
                  color: '#FFFFFF',
                  border: 'none',
                  fontSize: 16,
                  fontWeight: 600,
                  cursor: isSavingStock ? 'wait' : 'pointer',
                  opacity: isSavingStock ? 0.65 : 1,
                }}
                className="ios-btn-primary"
              >
                {isSavingStock ? 'Saving Stock…' : editingLotId ? 'Update Stock Entry' : 'Add Stock Entry'}
              </button>
            </form>
          </div>
        </>
      )}

      {/* ── Stock Inflow Preview Receipt Modal ── */}
      {previewLot && (
        <StockPreviewModal
          lot={previewLot}
          mine={mine}
          linkedDispatches={dispatches.filter(
            (candidate) => !candidate.deleted && (candidate.coalInputs || []).some((input) => input.lotId === previewLot.id)
          )}
          settings={settings}
          onClose={() => setPreviewLot(null)}
          onEdit={(lot) => {
            setPreviewLot(null);
            handleOpenEditStock(lot);
          }}
          onDelete={(lot) => {
            setLotToDelete(lot);
          }}
          onViewDispatch={(disp) => {
            setPreviewLot(null);
            setPreviewDispatch(disp);
          }}
        />
      )}

      {/* ── Edit Mine Modal Sheet ── */}
      {isEditingMine && (
        <>
          <div
            className="ios-modal-backdrop"
            onClick={() => {
              playPopSound();
              setIsEditingMine(false);
            }}
          />
          <div
            className="ios-bottom-sheet"
            style={{
              maxHeight: '85vh',
              zIndex: 99999,
            }}
          >
            <div className="ios-sheet-handle" />

            {/* Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                borderBottom: '0.5px solid var(--separator)',
              }}
            >
              <button
                type="button"
                onClick={() => {
                  playPopSound();
                  setIsEditingMine(false);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--ios-blue)',
                  fontSize: 16,
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                Cancel
              </button>

              <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--label-primary)' }}>
                Edit Mine
              </div>

              <button
                type="button"
                onClick={handleSaveMine}
                disabled={isSavingMine}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--ios-blue)',
                  fontSize: 16,
                  fontWeight: 600,
                  cursor: isSavingMine ? 'wait' : 'pointer',
                  opacity: isSavingMine ? 0.55 : 1,
                  padding: 0,
                }}
              >
                {isSavingMine ? 'Saving…' : 'Save'}
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSaveMine} style={{ padding: '16px 16px 36px' }}>
              <div style={{ marginBottom: 12 }}>
                <FloatingField
                  label="Mine Name *"
                  value={mineForm.name}
                  onChange={(val) => setMineForm((prev) => ({ ...prev, name: val }))}
                  placeholder="e.g. Islam C or Hashim Mine"
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <FloatingField
                  label="Per-Ton Rate (PKR) *"
                  type="number"
                  suffix={`${curSym}/t`}
                  value={mineForm.ratePerTon}
                  onChange={(val) => setMineForm((prev) => ({ ...prev, ratePerTon: val }))}
                  placeholder="e.g. 25000"
                />
              </div>

              <div style={{ marginBottom: 12 }}>
                <FloatingField
                  label="Location / Region (optional)"
                  value={mineForm.location}
                  onChange={(val) => setMineForm((prev) => ({ ...prev, location: val }))}
                  placeholder="e.g. Duki, Balochistan"
                />
              </div>

              <div style={{ marginBottom: 20 }}>
                <FloatingField
                  label="Notes (optional)"
                  value={mineForm.notes}
                  onChange={(val) => setMineForm((prev) => ({ ...prev, notes: val }))}
                  placeholder="e.g. High GCV, low sulphur coal"
                />
              </div>

              {mineFormError && (
                <div
                  role="alert"
                  style={{
                    marginBottom: 14,
                    padding: '11px 13px',
                    borderRadius: 12,
                    background: 'rgba(255, 59, 48, 0.1)',
                    border: '0.5px solid rgba(255, 59, 48, 0.32)',
                    color: 'var(--ios-red)',
                    fontSize: 13,
                    fontWeight: 550,
                    lineHeight: 1.35,
                  }}
                >
                  {mineFormError}
                </div>
              )}

              <button
                type="submit"
                disabled={isSavingMine}
                style={{
                  width: '100%',
                  height: 52,
                  borderRadius: 14,
                  background: 'var(--ios-blue)',
                  color: '#FFFFFF',
                  border: 'none',
                  fontSize: 16,
                  fontWeight: 600,
                  cursor: isSavingMine ? 'wait' : 'pointer',
                  opacity: isSavingMine ? 0.65 : 1,
                }}
                className="ios-btn-primary"
              >
                {isSavingMine ? 'Saving Mine…' : 'Update Mine Details'}
              </button>
            </form>
          </div>
        </>
      )}

      {/* ── Dispatch Preview Modal (Outflow click) ── */}
      {previewDispatch && (
        <DispatchPreviewModal
          dispatch={previewDispatch}
          parties={parties}
          settings={settings}
          onClose={() => setPreviewDispatch(null)}
        />
      )}

      {/* ── Delete Lot Confirmation Modal ── */}
      <IOSConfirmModal
        isOpen={Boolean(lotToDelete)}
        title="Delete Stock Entry?"
        message="Are you sure you want to remove this stock entry? This will adjust your current mine yard stock accordingly."
        confirmText="Delete"
        destructive={true}
        onConfirm={handleDeleteStock}
        onCancel={() => setLotToDelete(null)}
      />

      {/* ── Error Alert Modal (Liquid Glass iOS Dialog) ── */}
      <IOSConfirmModal
        isOpen={Boolean(errorAlert)}
        title={errorAlert?.title || 'Notice'}
        message={errorAlert?.message}
        confirmText="OK"
        singleButton
        destructive={false}
        countdownSeconds={0}
        icon="warning"
        onConfirm={() => setErrorAlert(null)}
        onCancel={() => setErrorAlert(null)}
      />
    </div>
  );
}
