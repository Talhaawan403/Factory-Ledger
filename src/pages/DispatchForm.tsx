import React, { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  ChevronLeft,
  Save,
  Trash2,
  AlertTriangle,
  ClipboardList,
  FileText,
  Layers,
  Receipt,
  TestTubes,
  SlidersHorizontal,
  AlignLeft,
  Calculator,
  Plus,
  ChevronDown,
  Package,
} from 'lucide-react';
import type { Dispatch, CoalInput, Party, PurchaseOrder, AppSettings, InventoryLot, Mine } from '../types';
import { getDispatch, saveDispatch, deleteDispatch, getParties, getPartyPurchaseOrders, getDispatches, getLots, getMines, saveParty, getSettings, cleanNumber } from '../lib/db';
import { getTodayDateString } from '../utils/dateUtils';
import { calculateSettlement, getEffectiveAdjustments, calculateLotAvailabilityForDispatch, calculateMineAvailabilityForDispatch } from '../utils/calculations';
import { getCurrencySymbol, formatAmountNumber } from '../utils/currency';
import { useParams, useNavigate, Link } from 'react-router-dom';
import IOSDatePicker from '../components/IOSDatePicker';
import IOSConfirmModal from '../components/IOSConfirmModal';
import IOSSelect from '../components/IOSSelect';
import CoalSourceModal, { type CoalSourceSelection } from '../components/CoalSourceModal';
import PartyGlyph from '../components/PartyGlyph';
import PartyModalSheet from '../components/PartyModalSheet';
import { triggerConfetti, playSuccessSound, playPopSound } from '../utils/delight';

const defaultOverheads = {
  loading: 0,
  freight: 0,
  crush: 0,
  royalty: 0,
  other: 0,
};

const emptyDispatch: Omit<Dispatch, 'id' | 'createdAt' | 'updatedAt'> = {
  partyId: '',
  poId: '',
  date: getTodayDateString(),
  truckNumber: '',
  factoryName: '',
  targetGcv: 0,
  baseRate: 0,
  commissionPerTon: 0,
  coalInputs: [
    { id: uuidv4(), sourceName: '', weight: 0, purchaseRate: 0 },
  ],
  overheads: defaultOverheads,
  labActualGcv: 0,
  labSulphur: 0,
  labAsh: 0,
  labVm: 0,
  labMoisture: 0,
  labReceivedWeight: 0,
  manualDeduction: 0,
  manualPremium: 0,
  manualTax: 0,
  gcvAdjustment: 'manual',
  gcvAdjustmentRounding: 'rupee',
  taxMethod: 'manual',
  taxSalesPercent: undefined,
  taxIncomePercent: undefined,
  notes: '',
};

import FloatingField from '../components/FloatingField';

export default function DispatchForm() {
  const { partyId, dispatchId } = useParams<{ partyId: string; dispatchId: string }>();
  const navigate = useNavigate();

  const [dispatch, setDispatch] = useState<Omit<Dispatch, 'createdAt' | 'updatedAt'> | null>(() => {
    if (dispatchId === 'new') {
      return {
        ...emptyDispatch,
        id: uuidv4(),
        partyId: partyId || '',
      };
    }
    return null;
  });
  const [parties, setParties] = useState<Party[]>([]);
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [allDispatches, setAllDispatches] = useState<Dispatch[]>([]);
  const [lots, setLots] = useState<InventoryLot[]>([]);
  const [mines, setMines] = useState<Mine[]>([]);
  const [settings, setSettings] = useState<AppSettings | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(() => dispatchId !== 'new');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isPartyModalOpen, setIsPartyModalOpen] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isInTransit, setIsInTransit] = useState(false);
  const [activePickingInputId, setActivePickingInputId] = useState<string | null>(null);

  const curSym = getCurrencySymbol(settings?.currency);
  const salesPct = settings?.taxFormulaSalesPercent ?? 18;
  const incomePct = settings?.taxFormulaIncomePercent ?? 5;

  useEffect(() => {
    let active = true;
    getSettings().then((s) => {
      if (active) {
        setSettings(s);
        if (dispatchId === 'new') {
          setDispatch(prev => prev ? {
            ...prev,
            taxMethod: s.defaultTaxMethod || 'manual',
            taxSalesPercent: s.taxFormulaSalesPercent ?? 18,
            taxIncomePercent: s.taxFormulaIncomePercent ?? 5,
          } : null);
        }
      }
    });
    getParties().then((p) => {
      if (active) {
        setParties(p);
        if (dispatchId === 'new' && partyId) {
          const selectedParty = p.find((party) => party.id === partyId);
          if (selectedParty) {
            setDispatch((prev) => prev ? { ...prev, factoryName: selectedParty.name } : prev);
          }
        }
      }
    });
    getDispatches().then((d) => {
      if (active) setAllDispatches(d);
    });
    getLots().then((l) => {
      if (active) setLots(l);
    });
    getMines().then((m) => {
      if (active) setMines(m);
    });

    const currentPartyId = partyId;
    if (currentPartyId) {
      getPartyPurchaseOrders(currentPartyId).then((orders) => {
        if (active) {
          setPos(orders);
          if (dispatchId === 'new' && orders.length > 0) {
            const activePo = orders.find(p => p.isActive) || orders[0];
            setDispatch(prev => prev ? {
              ...prev,
              poId: activePo.id,
              targetGcv: activePo.targetGcv || prev.targetGcv,
              baseRate: activePo.baseRate || prev.baseRate,
              commissionPerTon: activePo.commissionPerTon ?? prev.commissionPerTon,
              gcvAdjustment: activePo.gcvAdjustment || prev.gcvAdjustment || 'manual',
              gcvAdjustmentRounding: activePo.gcvAdjustmentRounding || prev.gcvAdjustmentRounding || 'rupee',
            } : null);
          }
        }
      });
    }

    if (dispatchId && dispatchId !== 'new') {
      getDispatch(dispatchId).then((data) => {
        if (!active) return;
        if (data) {
          const cleanDispatch: Omit<Dispatch, 'createdAt' | 'updatedAt'> = {
            ...emptyDispatch,
            ...data,
            gcvAdjustment: data.gcvAdjustment || 'manual',
            gcvAdjustmentRounding: data.gcvAdjustmentRounding || 'rupee',
            taxSalesPercent: data.taxSalesPercent !== undefined
              ? data.taxSalesPercent
              : (data.taxMethod === 'formula_18_5' ? 18 : undefined),
            taxIncomePercent: data.taxIncomePercent !== undefined
              ? data.taxIncomePercent
              : (data.taxMethod === 'formula_18_5' ? 5 : undefined),
            coalInputs: Array.isArray(data.coalInputs) && data.coalInputs.length > 0
              ? data.coalInputs
              : [{ id: uuidv4(), sourceName: '', weight: 0, purchaseRate: 0 }],
            overheads: { ...defaultOverheads, ...(data.overheads || {}) },
          };
          setDispatch(cleanDispatch);
          if (data.status === 'pending' || (cleanNumber(data.labReceivedWeight) === 0 && Boolean(data.id))) {
            setIsInTransit(true);
          }
          if (cleanDispatch.partyId) {
            getPartyPurchaseOrders(cleanDispatch.partyId).then((orders) => {
              if (active) setPos(orders);
            });
          }
        }
        setIsLoading(false);
      });
    }

    return () => {
      active = false;
    };
  }, [dispatchId, partyId]);

  useEffect(() => {
    const handleLedgerChange = () => {
      getDispatches().then(setAllDispatches);
      getLots().then(setLots);
    };
    window.addEventListener('ledger_data_changed', handleLedgerChange);
    return () => window.removeEventListener('ledger_data_changed', handleLedgerChange);
  }, []);

  if (isLoading || !dispatch) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--label-secondary)', fontSize: 15 }}>
        Loading dispatch editor…
      </div>
    );
  }

  // Calculate live settlement
  const settlement = calculateSettlement(dispatch as Dispatch, settings);
  const adj = getEffectiveAdjustments(dispatch as Dispatch, settings);
  const isProfit = settlement.netProfit >= 0;

  // Blend metrics
  const coalInputsList = dispatch.coalInputs || [];
  const totalInputWeight = coalInputsList.reduce((s, i) => s + (i.weight || 0), 0);
  const totalCoalCost = coalInputsList.reduce((s, i) => s + (i.weight || 0) * (i.purchaseRate || 0), 0);
  const avgCoalPurchaseRate = totalInputWeight > 0 ? totalCoalCost / totalInputWeight : 0;
  const transitWeightDiff = (dispatch.labReceivedWeight || 0) - totalInputWeight;

  // Pro-rata GCV Calculations
  const gcvDelta = dispatch.targetGcv && dispatch.labActualGcv ? dispatch.labActualGcv - dispatch.targetGcv : 0;
  const proRataDeduction = dispatch.targetGcv > 0 && dispatch.baseRate > 0 && dispatch.labActualGcv > 0 && dispatch.labActualGcv < dispatch.targetGcv
    ? Math.round(dispatch.baseRate * (1 - (dispatch.labActualGcv / dispatch.targetGcv)))
    : 0;
  const proRataPremium = dispatch.targetGcv > 0 && dispatch.baseRate > 0 && dispatch.labActualGcv > dispatch.targetGcv
    ? Math.round(dispatch.baseRate * ((dispatch.labActualGcv / dispatch.targetGcv) - 1))
    : 0;

  const clearError = (field: string) => {
    setValidationErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};
    if (!dispatch.partyId) {
      errors.partyId = 'Please select a factory / party account';
    }
    if (!dispatch.truckNumber || dispatch.truckNumber.trim().length < 3) {
      errors.truckNumber = 'Enter a valid truck number (e.g. TKX-418)';
    }
    const totalLoaded = (dispatch.coalInputs || []).reduce((sum, ci) => sum + cleanNumber(ci.weight), 0);
    if (totalLoaded <= 0) {
      errors.coalInputs = 'Loaded coal recipe weight must be greater than 0';
    } else {
      const duplicateLotIds = new Set<string>();
      for (const input of dispatch.coalInputs || []) {
        if (!input.sourceName.trim()) {
          errors.coalInputs = 'Every coal source needs a source name';
          break;
        }
        if (!Number.isFinite(input.weight) || input.weight <= 0) {
          errors.coalInputs = `Enter a positive weight for ${input.sourceName || 'every coal source'}`;
          break;
        }
        if (!Number.isFinite(input.purchaseRate) || input.purchaseRate <= 0) {
          errors.coalInputs = `Enter a positive purchase rate for ${input.sourceName || 'every coal source'}`;
          break;
        }
        if (input.lotId) {
          if (duplicateLotIds.has(input.lotId)) {
            errors.coalInputs = 'A stock entry can only appear once in a dispatch';
            break;
          }
          duplicateLotIds.add(input.lotId);
          const linkedLot = lots.find((lot) => lot.id === input.lotId && !lot.deleted);
          if (!linkedLot) {
            errors.coalInputs = `The stock entry selected for ${input.sourceName} is no longer available`;
            break;
          }
          const availability = calculateLotAvailabilityForDispatch(linkedLot, allDispatches, dispatch);
          if (availability.isOverdraw) {
            errors.coalInputs = `${input.sourceName} exceeds its available stock by ${Math.abs(availability.remainingAfter).toFixed(2)} tons`;
            break;
          }
        }
      }
    }
    if (cleanNumber(dispatch.baseRate) <= 0) {
      errors.baseRate = 'Base rate must be greater than 0';
    }
    if (!isInTransit && cleanNumber(dispatch.labReceivedWeight) <= 0) {
      errors.labReceivedWeight = 'Enter factory received weight or toggle In-Transit';
    }
    if (!isInTransit && cleanNumber(dispatch.labActualGcv) <= 0) {
      errors.labActualGcv = 'Enter the final factory lab GCV before settlement';
    }
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) {
      playPopSound();
      return;
    }

    try {
      setIsSaving(true);
      setSaveError(null);
      const statusToSave: 'pending' | 'settled' = isInTransit || cleanNumber(dispatch.labReceivedWeight) <= 0 ? 'pending' : 'settled';
      const wasSettled = dispatch.status === 'settled';
      const savedDispatchObj = {
        ...dispatch,
        status: statusToSave,
        settledAt: statusToSave === 'settled' ? (wasSettled ? dispatch.settledAt : Date.now()) : undefined,
        settledDate: statusToSave === 'settled' ? (wasSettled ? dispatch.settledDate || dispatch.date : getTodayDateString()) : undefined,
      } as Dispatch;
      await saveDispatch(savedDispatchObj);

      playSuccessSound();
      triggerConfetti();
      navigate(`/parties/${dispatch.partyId || partyId}`);
    } catch (err: any) {
      console.error('[DispatchForm] Failed to save dispatch:', err);
      playPopSound();
      setSaveError(err?.message || 'Storage full or write failed: Could not save dispatch.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = () => {
    setDeleteError(null);
    playPopSound();
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = async () => {
    if (dispatchId && dispatchId !== 'new') {
      try {
        setDeleteError(null);
        await deleteDispatch(dispatchId);
        setShowDeleteConfirm(false);
        navigate(`/parties/${dispatch.partyId || partyId}`);
      } catch (err: any) {
        console.error('[DispatchForm] Failed to delete dispatch:', err);
        playPopSound();
        setDeleteError(err?.message || 'Storage write failed: Could not delete dispatch record.');
      }
    }
  };

  const handleChange = (field: keyof typeof dispatch, value: any) => {
    clearError(field as string);
    setDispatch((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const handlePartyChange = async (newPartyId: string) => {
    clearError('partyId');
    const selectedParty = parties.find((party) => party.id === newPartyId);
    setDispatch((prev) => prev ? {
      ...prev,
      partyId: newPartyId,
      factoryName: selectedParty?.name || prev.factoryName,
    } : prev);
    const partyOrders = await getPartyPurchaseOrders(newPartyId);
    setPos(partyOrders);
    if (partyOrders.length > 0) {
      const activePo = partyOrders.find(p => p.isActive) || partyOrders[0];
      setDispatch(prev => prev ? {
        ...prev,
        partyId: newPartyId,
        factoryName: selectedParty?.name || prev.factoryName,
        poId: activePo.id,
        targetGcv: activePo.targetGcv || prev.targetGcv,
        baseRate: activePo.baseRate || prev.baseRate,
        commissionPerTon: activePo.commissionPerTon ?? prev.commissionPerTon,
        gcvAdjustment: activePo.gcvAdjustment || prev.gcvAdjustment || 'manual',
        gcvAdjustmentRounding: activePo.gcvAdjustmentRounding || prev.gcvAdjustmentRounding || 'rupee',
      } : prev);
    } else {
      setDispatch(prev => prev ? {
        ...prev,
        partyId: newPartyId,
        factoryName: selectedParty?.name || prev.factoryName,
        poId: '',
      } : prev);
    }
  };

  const handlePOChange = (poId: string) => {
    const po = pos.find(p => p.id === poId);
    if (po) {
      setDispatch(prev => prev ? {
        ...prev,
        poId,
        targetGcv: po.targetGcv || prev.targetGcv,
        baseRate: po.baseRate || prev.baseRate,
        commissionPerTon: po.commissionPerTon ?? prev.commissionPerTon,
        gcvAdjustment: po.gcvAdjustment || prev.gcvAdjustment || 'manual',
        gcvAdjustmentRounding: po.gcvAdjustmentRounding || prev.gcvAdjustmentRounding || 'rupee',
      } : prev);
    } else {
      setDispatch(prev => prev ? { ...prev, poId } : prev);
    }
  };

  const handleOverheadChange = (field: keyof typeof dispatch.overheads, value: number) => {
    setDispatch((prev) =>
      prev ? { ...prev, overheads: { ...prev.overheads, [field]: value } } : prev
    );
  };

  const addCoalInput = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDispatch((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        coalInputs: [
          ...prev.coalInputs,
          { id: uuidv4(), sourceName: '', weight: 0, purchaseRate: 0 },
        ],
      };
    });
  };

  const updateCoalInput = (id: string, field: keyof CoalInput, value: any) => {
    clearError('coalInputs');
    setDispatch((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        coalInputs: prev.coalInputs.map((input) =>
          input.id === id ? { ...input, [field]: value } : input
        ),
      };
    });
  };

  const removeCoalInput = (id: string) => {
    setDispatch((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        coalInputs: prev.coalInputs.filter((input) => input.id !== id),
      };
    });
  };

  const handleCoalSourceSelection = (inputId: string, sel: CoalSourceSelection) => {
    clearError('coalInputs');
    setDispatch((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        coalInputs: prev.coalInputs.map((ci) =>
          ci.id === inputId
            ? {
              ...ci,
              mineId: sel.mineId,
              lotId: sel.lotId,
              sourceName: sel.sourceName,
              weight: sel.weight > 0 ? sel.weight : ci.weight,
              purchaseRate: sel.rate > 0 ? sel.rate : ci.purchaseRate,
            }
            : ci
        ),
      };
    });
    setActivePickingInputId(null);
  };

  const handleSelectManual = (inputId: string) => {
    setDispatch((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        coalInputs: prev.coalInputs.map((ci) =>
          ci.id === inputId
            ? {
              ...ci,
              mineId: undefined,
              lotId: undefined,
            }
            : ci
        ),
      };
    });
    setActivePickingInputId(null);
  };

  return (
    <div className="ios-fade-in" style={{ paddingBottom: 32 }}>
      {/* ── Top Apple iOS Navigation Bar ── */}
      <div className="ios-navbar">
        <div className="ios-navbar-top-row">
          <Link to={`/parties/${dispatch.partyId || partyId}`} className="ios-back-button">
            <ChevronLeft style={{ width: 22, height: 22 }} strokeWidth={2.6} />
            <span>Ledger</span>
          </Link>
          <div className="ios-navbar-title-inline">
            {dispatchId === 'new' ? 'New Dispatch' : dispatch.truckNumber || 'Edit Dispatch'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              onClick={handleSave}
              className="ios-nav-action"
              style={{ fontWeight: 600, fontSize: 16, opacity: isSaving ? 0.6 : 1 }}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Done'}
            </button>
          </div>
        </div>
      </div>

      {saveError && (
        <div
          style={{
            margin: '12px 16px 0',
            padding: '12px 14px',
            background: 'rgba(255, 59, 48, 0.1)',
            border: '1px solid #ff3b30',
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            color: '#ff3b30',
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          <AlertTriangle size={18} style={{ flexShrink: 0 }} />
          <span>{saveError}</span>
        </div>
      )}

      {/* ── Apple Card Floating Live Settlement Banner ── */}
      <div className="ios-hero-card" style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-secondary)', textTransform: 'uppercase', letterSpacing: 0.3 }}>
              {isProfit ? 'Live Calculated Profit' : 'Live Calculated Loss'}
            </span>
            <div
              style={{
                fontSize: 32,
                fontWeight: 700,
                color: isProfit ? 'var(--ios-green)' : 'var(--ios-red)',
                lineHeight: 1.15,
                marginTop: 2,
              }}
              className="tabular-nums"
            >
              {isProfit ? `+${curSym} ` : `-${curSym} `}{formatAmountNumber(Math.abs(settlement.netProfit), settings)}
            </div>
          </div>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          marginTop: 14,
          paddingTop: 12,
          borderTop: '0.5px solid var(--separator)'
        }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--label-secondary)', textTransform: 'uppercase' }}>Payable Rate</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ios-blue)', marginTop: 1 }} className="tabular-nums">
              {curSym} {settlement.payableRate.toFixed(2)}<span style={{ fontSize: 11, fontWeight: 400 }}>/t</span>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--label-secondary)', textTransform: 'uppercase' }}>Total Revenue</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--label-primary)', marginTop: 1 }} className="tabular-nums">
              {curSym} {formatAmountNumber(settlement.totalRevenue, settings)}
            </div>
          </div>
        </div>
      </div>

      {/* ── Section 1: Dispatch General Info ── */}
      <div className="ios-group">
        <div className="ios-group-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ClipboardList size={16} /> Dispatch Details
        </div>
        <div style={{ padding: '0 16px' }}>
          {/* Party / Factory Picker */}
          <IOSSelect
            label="Factory"
            value={dispatch.partyId}
            onChange={handlePartyChange}
            error={validationErrors.partyId}
            options={parties.map((p) => ({
              value: p.id,
              label: p.name,
              subtitle: [p.contactPerson, p.phone, p.address].filter(Boolean).join(' • '),
              icon: <PartyGlyph name={p.name} size={32} borderRadius={8} iconSize={16} />,
            }))}
            placeholder="Select Factory"
            title="Select Factory"
            floating
            searchable
            searchPlaceholder="Search factory by name..."
            actionButton={{
              label: 'New Party',
              icon: <Plus size={16} />,
              onClick: () => setIsPartyModalOpen(true),
            }}
          />

          {pos.length > 0 && (
            <IOSSelect
              label="Purchase Order (PO)"
              value={dispatch.poId || ''}
              onChange={handlePOChange}
              options={pos.map((p) => ({
                value: p.id,
                label: `PO #${p.poNumber}`,
                subtitle: `Base: ${curSym} ${formatAmountNumber(p.baseRate, settings)} • Target GCV: ${p.targetGcv}${p.commissionPerTon ? ` • Comm: ${curSym} ${p.commissionPerTon}/t` : ''}`,
                badge: p.isActive ? 'Active' : undefined,
              }))}
              placeholder="Select Purchase Order"
              title="Select Purchase Order"
              floating
            />
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 10 }}>
            {/* Date */}
            <IOSDatePicker
              label="Dispatch Date"
              value={dispatch.date}
              onChange={(v) => handleChange('date', v)}
              floating
            />

            {/* Truck Number */}
            <FloatingField
              label="Truck Number"
              value={dispatch.truckNumber}
              onChange={(v) => handleChange('truckNumber', v.toUpperCase())}
              error={validationErrors.truckNumber}
              placeholder="e.g. TKX-418"
            />
          </div>

        </div>
      </div>

      {/* ── Section 2: Contract Parameters ── */}
      <div className="ios-group">
        <div className="ios-group-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <FileText size={16} /> Contract Agreement Terms
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '0 16px' }}>
          <FloatingField
            label="Target GCV"
            type="number"
            value={dispatch.targetGcv || ''}
            onChange={(v) => handleChange('targetGcv', parseFloat(v) || 0)}
            placeholder="6000"
            suffix="kcal/kg"
          />
          <FloatingField
            label="Base Rate"
            type="number"
            value={dispatch.baseRate || ''}
            onChange={(v) => handleChange('baseRate', parseFloat(v) || 0)}
            error={validationErrors.baseRate}
            placeholder="8500"
            suffix={`${curSym}/t`}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10, padding: '0 16px' }}>
          <FloatingField
            label="Commission (deducted/t)"
            type="number"
            value={dispatch.commissionPerTon || ''}
            onChange={(v) => handleChange('commissionPerTon', parseFloat(v) || 0)}
            placeholder="0"
            suffix={`${curSym}/t`}
          />
        </div>
      </div>

      {/* ── Section 3: Coal Input Recipe & Blending ── */}
      <div className="ios-group">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 16px 8px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: validationErrors.coalInputs ? '#ff3b30' : 'var(--label-secondary)', textTransform: 'uppercase', letterSpacing: 0.3 }}>
            <Layers size={16} /> Coal Blending Recipe ({dispatch.coalInputs.length})
          </span>
          <button
            onClick={addCoalInput}
            style={{
              background: 'var(--ios-blue)',
              color: 'white',
              border: 'none',
              borderRadius: 8,
              padding: '4px 10px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            + Add Source
          </button>
        </div>

        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Live Coal Blend Multi-color Proportion Bar */}
          {dispatch.coalInputs.length > 1 && (() => {
            const totalBlendWeight = dispatch.coalInputs.reduce((sum, ci) => sum + (ci.weight || 0), 0);
            if (totalBlendWeight <= 0) return null;
            const blendPalette = ['#0A84FF', '#30D158', '#FF9F0A', '#BF5AF2', '#64D2FF'];
            return (
              <div style={{ padding: '0 4px 6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 600, color: 'var(--label-secondary)', marginBottom: 6 }}>
                  <span>Blend Proportions ({totalBlendWeight.toFixed(1)}t total sourced)</span>
                  <span>{dispatch.coalInputs.length} sources blended</span>
                </div>
                <div style={{ height: 10, borderRadius: 5, overflow: 'hidden', display: 'flex', background: 'var(--fill-tertiary)', border: '0.5px solid var(--separator)' }}>
                  {dispatch.coalInputs.map((ci, i) => {
                    const pct = totalBlendWeight > 0 ? ((ci.weight || 0) / totalBlendWeight) * 100 : 0;
                    if (pct <= 0) return null;
                    return (
                      <div
                        key={ci.id}
                        title={`${ci.sourceName || `Source ${i + 1}`}: ${pct.toFixed(1)}%`}
                        style={{
                          width: `${pct}%`,
                          background: blendPalette[i % blendPalette.length],
                          transition: 'width 0.3s ease'
                        }}
                      />
                    );
                  })}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
                  {dispatch.coalInputs.map((ci, i) => {
                    const pct = totalBlendWeight > 0 ? (((ci.weight || 0) / totalBlendWeight) * 100).toFixed(0) : '0';
                    return (
                      <div key={ci.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--label-secondary)' }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: blendPalette[i % blendPalette.length] }} />
                        <span>{ci.sourceName || `Source ${i + 1}`} <strong>{pct}%</strong></span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {dispatch.coalInputs.map((input, idx) => {
            const rowCost = (input.weight || 0) * (input.purchaseRate || 0);

            return (
              <div
                key={input.id}
                style={{
                  background: 'var(--bg-card)',
                  borderRadius: 16,
                  padding: '14px 14px 4px',
                  boxShadow: 'var(--shadow-card)',
                  border: '0.5px solid var(--separator)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--label-primary)', textTransform: 'uppercase', letterSpacing: 0.3 }}>
                    Source #{idx + 1}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--label-primary)' }} className="tabular-nums">
                      {curSym} {formatAmountNumber(rowCost, settings)}
                    </span>
                    {dispatch.coalInputs.length > 1 && (
                      <button
                        onClick={() => removeCoalInput(input.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--ios-red)',
                          padding: 4,
                          cursor: 'pointer',
                        }}
                        title="Remove source"
                      >
                        <Trash2 style={{ width: 15, height: 15 }} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Native iOS-styled Coal Mine & Stock Picker with grouped dropdown */}
                <div style={{ marginBottom: 12 }}>
                  <div
                    onClick={() => setActivePickingInputId(input.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 14px',
                      borderRadius: 14,
                      background: 'var(--fill-tertiary)',
                      border: '0.5px solid var(--separator)',
                      cursor: 'pointer',
                    }}
                    className="hover-bg"
                  >
                    <div style={{ minWidth: 0, flex: 1, marginRight: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--label-secondary)', textTransform: 'uppercase' }}>
                        Coal Mine / Stock Source
                      </div>
                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 600,
                          color: 'var(--label-primary)',
                          marginTop: 2,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {input.sourceName || 'Select Mine or Stock Entry'}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <span style={{ fontSize: 13, color: 'var(--ios-blue)', fontWeight: 600 }}>
                        {input.mineId || input.lotId ? 'Change' : 'Select'}
                      </span>
                      <ChevronDown size={16} style={{ color: 'var(--label-tertiary)' }} />
                    </div>
                  </div>

                  {/* Stock status indicator if specific Lot is linked */}
                  {input.lotId && (() => {
                    const linkedLot = lots.find((l) => l.id === input.lotId);
                    if (!linkedLot) return null;
                    const avail = calculateLotAvailabilityForDispatch(linkedLot, allDispatches, dispatch);
                    const overdrawnAmount = avail.isOverdraw ? Math.abs(avail.remainingAfter) : 0;

                    return (
                      <div
                        style={{
                          marginTop: 8,
                          marginBottom: 4,
                          padding: '8px 12px',
                          borderRadius: 10,
                          background: avail.isOverdraw ? 'rgba(255, 59, 48, 0.1)' : 'var(--fill-tertiary)',
                          border: `0.5px solid ${avail.isOverdraw ? 'rgba(255, 59, 48, 0.3)' : 'var(--separator)'}`,
                          fontSize: 12,
                          color: avail.isOverdraw ? 'var(--ios-red)' : 'var(--label-primary)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                        }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          <Package size={14} style={{ flexShrink: 0 }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <strong>{linkedLot.boughtFrom || linkedLot.supplier}</strong>: {avail.availableBeforeThis.toFixed(2)}t available · {Math.max(0, avail.remainingAfter).toFixed(2)}t left after this dispatch
                          </span>
                        </span>
                        {avail.isOverdraw && (
                          <span style={{ fontWeight: 600, color: 'var(--ios-red)', fontSize: 11, flexShrink: 0 }}>
                            Overdrawn by {overdrawnAmount.toFixed(1)}t
                          </span>
                        )}
                      </div>
                    );
                  })()}

                  {/* Stock status indicator if Mine is linked without a specific lot */}
                  {input.mineId && !input.lotId && (() => {
                    const linkedMine = mines.find((m) => m.id === input.mineId);
                    if (!linkedMine) return null;
                    const availability = calculateMineAvailabilityForDispatch(linkedMine, lots, allDispatches, dispatch);
                    const isOverdraw = availability.isOverdraw;

                    return (
                      <div
                        style={{
                          marginTop: 8,
                          marginBottom: 4,
                          padding: '8px 12px',
                          borderRadius: 10,
                          background: isOverdraw ? 'rgba(255, 59, 48, 0.1)' : 'var(--fill-tertiary)',
                          border: `0.5px solid ${isOverdraw ? 'rgba(255, 59, 48, 0.3)' : 'var(--separator)'}`,
                          fontSize: 12,
                          color: isOverdraw ? 'var(--ios-red)' : 'var(--label-primary)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                        }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          <Layers size={14} style={{ flexShrink: 0 }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <strong>{linkedMine.name}</strong>: {availability.availableBeforeThis.toFixed(1)}t available (legacy untracked source)
                          </span>
                        </span>
                        {isOverdraw && (
                          <span style={{ fontWeight: 600, color: 'var(--ios-red)', fontSize: 11, flexShrink: 0 }}>Exceeds yard stock</span>
                        )}
                      </div>
                    );
                  })()}
                </div>

                <FloatingField
                  label="Coal Source / Grade"
                  value={input.sourceName}
                  onChange={(val) => updateCoalInput(input.id, 'sourceName', val)}
                  placeholder="e.g. Afghan 6000 or Duki Mine"
                  disabled={Boolean(input.lotId)}
                  helperText={input.lotId ? 'Linked to the selected stock voucher. Tap Change to use another source.' : undefined}
                />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <FloatingField
                    label="Weight"
                    type="number"
                    step="0.1"
                    suffix="tons"
                    value={input.weight || ''}
                    onChange={(val) => updateCoalInput(input.id, 'weight', parseFloat(val) || 0)}
                    helperText={input.lotId ? (() => {
                      const linkedLot = lots.find((lot) => lot.id === input.lotId);
                      if (!linkedLot) return 'The linked stock entry is no longer available.';
                      const availability = calculateLotAvailabilityForDispatch(linkedLot, allDispatches, dispatch);
                      return `Allocate up to ${availability.availableBeforeThis.toFixed(2)} tons from this stock entry.`;
                    })() : undefined}
                  />
                  <FloatingField
                    label="Buy Price"
                    type="number"
                    suffix={`${curSym}/t`}
                    value={input.purchaseRate || ''}
                    onChange={(val) => updateCoalInput(input.id, 'purchaseRate', parseFloat(val) || 0)}
                    disabled={Boolean(input.lotId)}
                    helperText={input.lotId ? 'Landed rate is locked; only the allocated weight can change.' : undefined}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {validationErrors.coalInputs && (
          <div style={{ padding: '0 18px 6px', color: '#ff3b30', fontSize: 12, fontWeight: 500 }}>
            {validationErrors.coalInputs}
          </div>
        )}

        <div className="ios-group-footnote" style={{ padding: '8px 18px 0' }}>
          Total Blend Weight: <strong>{totalInputWeight.toFixed(1)} tons</strong> · Avg Coal Purchase Rate: <strong>{curSym} {formatAmountNumber(avgCoalPurchaseRate, settings)}/t</strong>
        </div>
      </div>

      {/* ── Section 4: Overhead Expenses ── */}
      <div className="ios-group">
        <div className="ios-group-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Receipt size={16} /> Overhead Expenses
        </div>
        <div style={{ padding: '0 16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FloatingField
              label="Loading Amnt"
              type="number"
              suffix={curSym}
              value={dispatch.overheads.loading || ''}
              onChange={(v) => handleOverheadChange('loading', parseFloat(v) || 0)}
            />
            <FloatingField
              label="Transport"
              type="number"
              suffix={curSym}
              value={dispatch.overheads.freight || ''}
              onChange={(v) => handleOverheadChange('freight', parseFloat(v) || 0)}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FloatingField
              label="Crushing Amnt"
              type="number"
              suffix={curSym}
              value={dispatch.overheads.crush || ''}
              onChange={(v) => handleOverheadChange('crush', parseFloat(v) || 0)}
            />
            <FloatingField
              label="Royalty / Taxes"
              type="number"
              suffix={curSym}
              value={dispatch.overheads.royalty || ''}
              onChange={(v) => handleOverheadChange('royalty', parseFloat(v) || 0)}
            />
          </div>

          <FloatingField
            label="Other Expenses"
            type="number"
            suffix={curSym}
            value={dispatch.overheads.other || ''}
            onChange={(v) => handleOverheadChange('other', parseFloat(v) || 0)}
          />
        </div>
      </div>

      {/* ── Section 5: Factory Lab Results ── */}
      <div className="ios-group">
        <div className="ios-group-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <TestTubes size={16} /> Factory Lab Test Results
        </div>
        <div style={{ padding: '0 16px' }}>
          {/* Caloric Quality Gauge Bar */}
          {Boolean(dispatch.targetGcv && dispatch.labActualGcv) && (() => {
            const ratio = (dispatch.labActualGcv / dispatch.targetGcv) * 100;
            const cappedPercent = Math.min(Math.max(ratio, 70), 130);
            const normalizedBar = ((cappedPercent - 70) / 60) * 100;
            const isSurplus = gcvDelta >= 0;
            const gaugeColor = isSurplus ? 'var(--ios-green)' : Math.abs(gcvDelta) <= 150 ? 'var(--ios-amber)' : 'var(--ios-red)';

            return (
              <div
                style={{
                  background: 'var(--bg-card)',
                  borderRadius: 14,
                  padding: '12px 14px',
                  marginBottom: 14,
                  border: '0.5px solid var(--separator)',
                  boxShadow: 'var(--shadow-card)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--label-secondary)', textTransform: 'uppercase' }}>
                      Caloric Compliance
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: 10,
                        background: isSurplus ? 'var(--ios-green)' : 'var(--ios-red)',
                        color: isSurplus ? 'white' : 'white'
                      }}
                    >
                      {isSurplus ? 'Quality Bonus' : 'Deduction'}
                    </span>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: gaugeColor }} className="tabular-nums">
                    {gcvDelta >= 0 ? '+' : ''}{gcvDelta} kcal/kg ({ratio.toFixed(1)}%)
                  </span>
                </div>

                {/* Progress track */}
                <div style={{ position: 'relative', height: 10, background: 'var(--fill-tertiary)', borderRadius: 5, overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${normalizedBar}%`,
                      background: gaugeColor,
                      borderRadius: 5,
                      transition: 'width 0.35s ease'
                    }}
                  />
                  {/* 100% target marker */}
                  <div
                    style={{
                      position: 'absolute',
                      left: '50%',
                      top: 0,
                      bottom: 0,
                      width: 2,
                      background: 'var(--label-primary)',
                      opacity: 0.6,
                      zIndex: 2
                    }}
                    title="100% Target Contract GCV"
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--label-tertiary)', marginTop: 4 }}>
                  <span>Low GCV (-30%)</span>
                  <span style={{ fontWeight: 600, color: 'var(--label-secondary)' }}>Target: {dispatch.targetGcv} kcal</span>
                  <span>High GCV (+30%)</span>
                </div>
              </div>
            );
          })()}

          {/* In-Transit Status Toggle */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              background: 'var(--fill-quaternary)',
              borderRadius: 12,
              marginBottom: 12,
              border: '0.5px solid var(--separator)',
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-primary)' }}>Truck Status</div>
              <div style={{ fontSize: 11, color: 'var(--label-secondary)' }}>
                {isInTransit ? 'In Transit (Revenue Pending)' : 'Factory Passed & Settled'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                const nextVal = !isInTransit;
                setIsInTransit(nextVal);
                if (nextVal) {
                  clearError('labReceivedWeight');
                }
              }}
              style={{
                padding: '5px 12px',
                borderRadius: 10,
                border: 'none',
                background: isInTransit ? 'var(--ios-blue)' : 'var(--fill-tertiary)',
                color: isInTransit ? '#FFFFFF' : 'var(--label-secondary)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {isInTransit ? 'In Transit' : 'Settled'}
            </button>
          </div>

          {totalInputWeight > 0 && (!dispatch.labReceivedWeight || dispatch.labReceivedWeight === 0) && (
            <div style={{ marginBottom: 10 }}>
              <button
                type="button"
                onClick={() => handleChange('labReceivedWeight', parseFloat(totalInputWeight.toFixed(2)))}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: 'none',
                  background: 'var(--ios-blue)',
                  color: 'white',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                Autofill Weighbridge Weight = Loaded Weight ({totalInputWeight.toFixed(2)}t)
              </button>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FloatingField
              label="Lab GCV"
              type="number"
              suffix="kcal/kg"
              value={dispatch.labActualGcv || ''}
              onChange={(v) => handleChange('labActualGcv', parseFloat(v) || 0)}
              error={validationErrors.labActualGcv}
              placeholder="5950"
            />
            <FloatingField
              label="Rcvd Weight"
              type="number"
              step="0.01"
              suffix="tons"
              value={dispatch.labReceivedWeight || ''}
              onChange={(v) => handleChange('labReceivedWeight', parseFloat(v) || 0)}
              error={validationErrors.labReceivedWeight}
              placeholder="39.5"
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FloatingField
              label="Sulphur %"
              type="number"
              step="0.01"
              suffix="%"
              value={dispatch.labSulphur || ''}
              onChange={(v) => handleChange('labSulphur', parseFloat(v) || 0)}
              placeholder="4.10"
            />
            <FloatingField
              label="Ash %"
              type="number"
              step="0.01"
              suffix="%"
              value={dispatch.labAsh || ''}
              onChange={(v) => handleChange('labAsh', parseFloat(v) || 0)}
              placeholder="0.0"
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FloatingField
              label="VM %"
              type="number"
              step="0.01"
              suffix="%"
              value={dispatch.labVm || ''}
              onChange={(v) => handleChange('labVm', parseFloat(v) || 0)}
              placeholder="0.0"
            />
            <FloatingField
              label="Moisture %"
              type="number"
              step="0.01"
              suffix="%"
              value={dispatch.labMoisture || ''}
              onChange={(v) => handleChange('labMoisture', parseFloat(v) || 0)}
              placeholder="0.0"
            />
          </div>

          {/* Warning pill if Sulphur is penalizable (> 4%) */}
          {dispatch.labSulphur > 4.0 && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 14px',
              background: 'var(--ios-orange)',
              borderRadius: 8,
              marginTop: 4,
              color: 'white',
              fontSize: 13,
              fontWeight: 600
            }}>
              <AlertTriangle style={{ width: 16, height: 16, flexShrink: 0 }} />
              <span>
                Sulphur {dispatch.labSulphur}% exceeds 4.0% limit.
              </span>
            </div>
          )}

          {totalInputWeight > 0 && dispatch.labReceivedWeight > 0 && (
            <div className="ios-group-footnote" style={{ padding: '6px 4px 0' }}>
              Transit Shortage / Gain: <strong>{transitWeightDiff >= 0 ? '+' : ''}{transitWeightDiff.toFixed(2)} tons</strong> ({((transitWeightDiff / totalInputWeight) * 100).toFixed(1)}%)
            </div>
          )}
        </div>
      </div>

      {/* ── Section 5.5: Pricing Adjustments & Tax ── */}
      <div className="ios-group">
        <div className="ios-group-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <SlidersHorizontal size={16} /> Pricing Adjustments & Tax
        </div>
        <div style={{ padding: '0 16px' }}>
          {/* GCV Adjustment Mode Switcher */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', background: 'var(--fill-tertiary)', borderRadius: 10, padding: 3, marginBottom: 8 }}>
              <button
                type="button"
                onClick={() => handleChange('gcvAdjustment', 'manual')}
                style={{
                  flex: 1,
                  padding: '7px 10px',
                  borderRadius: 8,
                  border: 'none',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: dispatch.gcvAdjustment !== 'prorata' ? 'var(--bg-card)' : 'transparent',
                  color: dispatch.gcvAdjustment !== 'prorata' ? 'var(--label-primary)' : 'var(--label-secondary)',
                  boxShadow: dispatch.gcvAdjustment !== 'prorata' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                }}
              >
                Manual Adjustments
              </button>
              <button
                type="button"
                onClick={() => handleChange('gcvAdjustment', 'prorata')}
                style={{
                  flex: 1,
                  padding: '7px 10px',
                  borderRadius: 8,
                  border: 'none',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: dispatch.gcvAdjustment === 'prorata' ? 'var(--ios-blue)' : 'transparent',
                  color: dispatch.gcvAdjustment === 'prorata' ? 'white' : 'var(--label-secondary)',
                  boxShadow: dispatch.gcvAdjustment === 'prorata' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                }}
              >
                Auto Pro-Rata Formula
              </button>
            </div>

            {/* Dynamic Pro-Rata Formula active banner */}
            {dispatch.gcvAdjustment === 'prorata' ? (
              <div
                style={{
                  background: 'var(--fill-quaternary)',
                  borderRadius: 10,
                  padding: '10px 12px',
                  marginBottom: 12,
                  border: '0.5px solid var(--separator)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ios-blue)', textTransform: 'uppercase', letterSpacing: 0.3 }}>
                    Dynamic Contract Pro-Rata
                  </span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      type="button"
                      onClick={() => handleChange('gcvAdjustmentRounding', 'rupee')}
                      style={{
                        padding: '2px 8px',
                        borderRadius: 6,
                        border: '0.5px solid var(--separator)',
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                        background: dispatch.gcvAdjustmentRounding !== 'paisa' ? 'var(--fill-primary)' : 'transparent',
                        color: dispatch.gcvAdjustmentRounding !== 'paisa' ? 'var(--label-primary)' : 'var(--label-secondary)',
                      }}
                    >
                      Whole Rs
                    </button>
                    <button
                      type="button"
                      onClick={() => handleChange('gcvAdjustmentRounding', 'paisa')}
                      style={{
                        padding: '2px 8px',
                        borderRadius: 6,
                        border: '0.5px solid var(--separator)',
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                        background: dispatch.gcvAdjustmentRounding === 'paisa' ? 'var(--fill-primary)' : 'transparent',
                        color: dispatch.gcvAdjustmentRounding === 'paisa' ? 'var(--label-primary)' : 'var(--label-secondary)',
                      }}
                    >
                      Paisa (0.01)
                    </button>
                  </div>
                </div>

                <div style={{ fontSize: 12, color: 'var(--label-secondary)', marginBottom: 6 }}>
                  Formula: Base Rate × (1 − Lab GCV ÷ Target GCV)
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, paddingTop: 4, borderTop: '0.5px solid var(--separator)' }}>
                  <span>
                    {settlement.gcvDeduction > 0
                      ? 'Live GCV Deduction:'
                      : (settlement.gcvPremium || 0) > 0
                        ? 'Live GCV Premium:'
                        : 'GCV Adjustment:'}
                  </span>
                  <strong
                    style={{
                      color:
                        settlement.gcvDeduction > 0
                          ? '#ff3b30'
                          : (settlement.gcvPremium || 0) > 0
                            ? 'var(--ios-green)'
                            : 'var(--label-secondary)',
                      fontSize: 14,
                    }}
                    className="tabular-nums"
                  >
                    {settlement.gcvDeduction > 0
                      ? `- ${curSym} ${settlement.gcvDeduction}/t`
                      : (settlement.gcvPremium || 0) > 0
                        ? `+ ${curSym} ${settlement.gcvPremium}/t`
                        : 'Rs 0/t (At or near target)'}
                  </strong>
                </div>
              </div>
            ) : (
              /* Pro-Rata Quick-Fill Helper Buttons for manual mode */
              (proRataDeduction > 0 || proRataPremium > 0) && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                  {proRataDeduction > 0 && (
                    <button
                      type="button"
                      onClick={() => handleChange('manualDeduction', proRataDeduction)}
                      style={{
                        flex: 1,
                        padding: '10px 14px',
                        borderRadius: 8,
                        border: 'none',
                        background: 'var(--ios-blue)',
                        color: 'white',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6
                      }}
                    >
                      Copy Pro-Rata GCV Deduction: {curSym} {proRataDeduction}/t
                    </button>
                  )}
                  {proRataPremium > 0 && (
                    <button
                      type="button"
                      onClick={() => handleChange('manualPremium', proRataPremium)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 8,
                        border: 'none',
                        background: 'var(--ios-green)',
                        color: 'white',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8
                      }}
                    >
                      Copy Pro-Rata GCV Premium: {curSym} {proRataPremium}/t
                    </button>
                  )}
                </div>
              )
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <FloatingField
              label={dispatch.gcvAdjustment === 'prorata' ? 'Other Deduction' : 'Deduction'}
              type="number"
              suffix={`${curSym}/t`}
              value={dispatch.manualDeduction || ''}
              onChange={(v) => handleChange('manualDeduction', parseFloat(v) || 0)}
              placeholder="0"
            />
            <FloatingField
              label={dispatch.gcvAdjustment === 'prorata' ? 'Other Premium' : 'Premium'}
              type="number"
              suffix={`${curSym}/t`}
              value={dispatch.manualPremium || ''}
              onChange={(v) => handleChange('manualPremium', parseFloat(v) || 0)}
              placeholder="0"
            />
          </div>
          {/* Tax Calculation Method */}
          {(() => {
            const activeDispatchSalesPct = dispatch.taxSalesPercent ?? salesPct;
            const activeDispatchIncomePct = dispatch.taxIncomePercent ?? incomePct;
            return (
              <>
                <IOSSelect
                  label="Tax Calculation Method"
                  value={dispatch.taxMethod || 'manual'}
                  onChange={(val) => {
                    setDispatch((prev) => {
                      if (!prev) return null;
                      if (val === 'formula_18_5') {
                        return {
                          ...prev,
                          taxMethod: 'formula_18_5',
                          taxSalesPercent: prev.taxSalesPercent ?? salesPct,
                          taxIncomePercent: prev.taxIncomePercent ?? incomePct,
                        };
                      }
                      return {
                        ...prev,
                        taxMethod: 'manual',
                      };
                    });
                  }}
                  options={[
                    {
                      value: 'manual',
                      label: 'Manual Entry',
                      subtitle: 'Enter sales tax and income tax values directly',
                    },
                    {
                      value: 'formula_18_5',
                      label: `Formula: (Rate + ${activeDispatchSalesPct}%) * ${activeDispatchIncomePct}%`,
                      subtitle: `Rate + ${activeDispatchSalesPct}% sales tax, then ${activeDispatchIncomePct}% advance income tax`,
                    },
                  ]}
                  title="Tax Calculation Method"
                  floating
                />

                {/* Dynamic UI: Manual Number Input or Read-Only Auto Formula Value */}
                {(dispatch.taxMethod || 'manual') === 'manual' ? (
                  <FloatingField
                    label="Tax Deduction"
                    type="number"
                    suffix={`${curSym}/t`}
                    value={dispatch.manualTax || ''}
                    onChange={(v) => handleChange('manualTax', parseFloat(v) || 0)}
                    placeholder="0"
                  />
                ) : (
                  <div className="floating-field is-floated has-suffix" style={{ marginBottom: 12 }}>
                    <input
                      type="text"
                      readOnly
                      disabled
                      value={settlement.taxDeduction.toFixed(2)}
                      className="floating-input"
                      style={{
                        color: 'var(--label-primary)',
                        fontWeight: 600,
                        cursor: 'not-allowed',
                        opacity: 0.9,
                        background: 'transparent',
                      }}
                    />
                    <label
                      className="floating-label"
                      style={{
                        top: 0,
                        transform: 'translateY(-50%)',
                        fontSize: 12,
                        fontWeight: 500,
                        background: 'var(--bg-card)',
                        color: 'var(--label-secondary)',
                      }}
                    >
                      Tax Deduction (Auto: (Rate + ${activeDispatchSalesPct}%) * ${activeDispatchIncomePct}%)
                    </label>
                    <span className="floating-suffix">{curSym}/t</span>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </div>

      {/* ── Section 5.6: Notes ── */}
      <div className="ios-group">
        <div className="ios-group-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <AlignLeft size={16} /> Notes
        </div>
        <div style={{ padding: '0 16px' }}>
          <textarea
            value={dispatch.notes || ''}
            onChange={(e) => {
              e.target.style.height = 'auto';
              e.target.style.height = `${e.target.scrollHeight}px`;
              handleChange('notes', e.target.value);
            }}
            placeholder="Enter any specific notes..."
            style={{
              width: '100%',
              minHeight: '80px',
              marginBottom: '12px',
              padding: '12px',
              fontFamily: 'inherit',
              fontSize: '15px',
              border: '1px solid var(--separator)',
              borderRadius: '12px',
              background: 'var(--bg-card)',
              color: 'var(--label-primary)',
              resize: 'none',
              overflow: 'hidden',
              boxSizing: 'border-box'
            }}
          />
        </div>
      </div>

      {/* ── Section 6: Official Settlement Audit Breakdown ── */}
      <div className="ios-group">
        <div className="ios-group-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Calculator size={16} /> Official Settlement Breakdown
        </div>
        <div className="ios-card-grouped" style={{ padding: '16px' }}>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, marginBottom: 8 }}>
            <span style={{ color: 'var(--label-secondary)' }}>Base Agreement Rate</span>
            <span style={{ fontWeight: 600 }} className="tabular-nums">{curSym} {dispatch.baseRate.toFixed(2)}</span>
          </div>

          {adj.deduction > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, marginBottom: 8, color: 'var(--ios-red)' }}>
              <span>- {adj.isProrata ? `GCV Deduction (${adj.ruleLabel})` : 'Manual Deduction'}</span>
              <span className="tabular-nums">- {curSym} {adj.deduction.toFixed(2)}</span>
            </div>
          )}

          {adj.premium > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, marginBottom: 8, color: 'var(--ios-green)' }}>
              <span>+ {adj.isProrata ? `Quality Premium (${adj.ruleLabel})` : 'Manual Premium'}</span>
              <span className="tabular-nums">+ {curSym} {adj.premium.toFixed(2)}</span>
            </div>
          )}

          <div style={{ height: 0.5, background: 'var(--separator)', margin: '10px 0' }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, marginBottom: 8 }}>
            <span style={{ fontWeight: 600 }}>Adjusted Rate</span>
            <span style={{ fontWeight: 600 }} className="tabular-nums">{curSym} {settlement.adjustedRate.toFixed(2)}</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, marginBottom: 8, color: 'var(--ios-red)' }}>
            <span>- Tax Deduction</span>
            <span className="tabular-nums">- {curSym} {settlement.taxDeduction.toFixed(2)}</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, marginBottom: 8 }}>
            <span style={{ color: 'var(--label-secondary)' }}>Net Rate</span>
            <span className="tabular-nums">{curSym} {settlement.netRate.toFixed(2)}</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, marginBottom: 8, color: 'var(--ios-red)' }}>
            <span>- Commission</span>
            <span className="tabular-nums">- {curSym} {(dispatch.commissionPerTon || 0).toFixed(2)}</span>
          </div>

          <div style={{ height: 0.5, background: 'var(--separator)', margin: '10px 0' }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, marginBottom: 12 }}>
            <span style={{ fontWeight: 700, color: 'var(--ios-blue)' }}>Payable Rate (per ton)</span>
            <span style={{ fontWeight: 700, color: 'var(--ios-blue)' }} className="tabular-nums">
              {curSym} {settlement.payableRate.toFixed(2)}
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: 'var(--label-secondary)', marginBottom: 6 }}>
            <span>Total Revenue ({dispatch.labReceivedWeight || 0} t × {curSym} {settlement.payableRate.toFixed(2)})</span>
            <span className="tabular-nums">{curSym} {formatAmountNumber(settlement.totalRevenue, settings)}</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: 'var(--label-secondary)', marginBottom: 12 }}>
            <span>Total Cost (Coal + Overheads)</span>
            <span className="tabular-nums">{curSym} {formatAmountNumber(settlement.totalCost, settings)}</span>
          </div>

          <div style={{
            padding: '12px 14px',
            borderRadius: 10,
            background: isProfit ? 'var(--ios-green)' : 'var(--ios-red)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'white' }}>
              {isProfit ? 'Net Profit' : 'Net Loss'}
            </span>
            <span style={{ fontSize: 20, fontWeight: 800, color: 'white' }} className="tabular-nums">
              {isProfit ? `+${curSym} ` : `-${curSym} `}{formatAmountNumber(Math.abs(settlement.netProfit), settings)}
            </span>
          </div>

        </div>
      </div>

      {/* ── Bottom Action Buttons ── */}
      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
        <button
          onClick={handleSave}
          className="ios-btn ios-btn-primary"
          style={{ width: '100%', opacity: isSaving ? 0.7 : 1 }}
          disabled={isSaving}
        >
          <Save style={{ width: 18, height: 18 }} strokeWidth={2.4} />
          <span>{isSaving ? 'Saving Dispatch...' : 'Save Dispatch'}</span>
        </button>

        {dispatchId !== 'new' && (
          <button
            onClick={handleDelete}
            className="ios-btn ios-btn-destructive"
            style={{ width: '100%', background: 'transparent' }}
          >
            <Trash2 style={{ width: 16, height: 16 }} />
            <span>Delete Dispatch Record</span>
          </button>
        )}
      </div>

      {/* ── iOS Liquid Glass Confirmation Modal ── */}
      <IOSConfirmModal
        isOpen={showDeleteConfirm}
        title="Delete Dispatch Record?"
        message={
          deleteError
            ? `Error: ${deleteError}`
            : `Are you sure you want to delete this dispatch record${dispatch.truckNumber ? ` for truck ${dispatch.truckNumber}` : ''}? This action cannot be undone.`
        }
        confirmText="Delete"
        cancelText="Cancel"
        destructive
        countdownSeconds={deleteError ? 0 : 2}
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          setShowDeleteConfirm(false);
          setDeleteError(null);
        }}
      />

      {/* ── Quick Add Party Apple iOS Modal Sheet ── */}
      <PartyModalSheet
        isOpen={isPartyModalOpen}
        mode="add"
        onClose={() => setIsPartyModalOpen(false)}
        onSave={async (data) => {
          const newParty: Party = {
            id: uuidv4(),
            name: data.name,
            contactPerson: data.contactPerson,
            phone: data.phone,
            address: data.address,
            createdAt: Date.now(),
          };
          await saveParty(newParty);
          const updatedParties = await getParties();
          setParties(updatedParties);
          setDispatch((prev) => prev ? {
            ...prev,
            partyId: newParty.id,
            factoryName: newParty.name,
          } : prev);
          setIsPartyModalOpen(false);
          await handlePartyChange(newParty.id);
        }}
      />

      {/* Coal Mine & Stock Entry Selection Modal */}
      <CoalSourceModal
        isOpen={Boolean(activePickingInputId)}
        onClose={() => setActivePickingInputId(null)}
        mines={mines}
        lots={lots}
        dispatches={allDispatches}
        settings={settings}
        currentMineId={dispatch.coalInputs.find((ci) => ci.id === activePickingInputId)?.mineId}
        currentLotId={dispatch.coalInputs.find((ci) => ci.id === activePickingInputId)?.lotId}
        currentDispatchId={dispatch.id}
        excludeLotIds={(dispatch.coalInputs || [])
          .filter((ci) => ci.id !== activePickingInputId && Boolean(ci.lotId))
          .map((ci) => ci.lotId as string)}
        onSelect={(sel) => {
          if (activePickingInputId) {
            handleCoalSourceSelection(activePickingInputId, sel);
          }
        }}
        onSelectManual={() => {
          if (activePickingInputId) {
            handleSelectManual(activePickingInputId);
          }
        }}
        onManageMines={() => navigate('/inventory')}
      />
    </div>
  );
}
