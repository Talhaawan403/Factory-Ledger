import { useState, useEffect, useMemo, useRef } from 'react';
import type { InventoryLot, Party, AppSettings, Mine, MaterialDefinition } from '../types';
import { getTodayDateString } from '../utils/dateUtils';
import { getCurrencySymbol, formatAmountNumber } from '../utils/currency';
import { playSuccessSound, playPopSound } from '../utils/delight';
import { cleanNumber, getMines, saveMine } from '../lib/db';
import { v4 as uuidv4 } from 'uuid';
import IOSDatePicker from './IOSDatePicker';
import IOSSelect from './IOSSelect';
import NumericInput from './NumericInput';
import {
  Truck,
  Store,
  AlertCircle,
  Pickaxe,
  ChevronRight,
  Layers,
  Percent,
  Check,
  Banknote,
} from 'lucide-react';
import {
  COAL_ITEM_ID,
  getMaterialItems,
  getMaterialById,
  getMaterialBadgeTheme,
} from '../utils/materials';

interface SupplierInwardSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (lotData: Partial<InventoryLot>) => Promise<void>;
  party: Party;
  existingLot?: InventoryLot | null;
  settings?: AppSettings;
  mines?: Mine[];
}

export default function SupplierInwardSheet({
  isOpen,
  onClose,
  onSave,
  party,
  existingLot,
  settings,
  mines: propMines,
}: SupplierInwardSheetProps) {
  const [date, setDate] = useState(getTodayDateString());
  const [truckNumber, setTruckNumber] = useState('');
  const [mineName, setMineName] = useState('');
  const [selectedMineId, setSelectedMineId] = useState<string | undefined>(undefined);
  const [minesList, setMinesList] = useState<Mine[]>(propMines || []);
  const [storedAt, setStoredAt] = useState('');
  const [weight, setWeight] = useState('');
  const [rate, setRate] = useState('');
  const [fare, setFare] = useState('');
  const [paidOnSpot, setPaidOnSpot] = useState(
    existingLot?.paidOnSpot ? String(existingLot.paidOnSpot) : ''
  );
  const [paidOnSpotMode, setPaidOnSpotMode] = useState<'cash' | 'bank' | 'online' | 'cheque'>(
    existingLot?.paidOnSpotMode || 'cash'
  );
  const [paidOnSpotNote, setPaidOnSpotNote] = useState(
    existingLot?.paidOnSpotNote || ''
  );
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isDirectMine = Boolean(
    party.isDirectMine || party.linkedMineId || party.name.toLowerCase().includes('direct ledger')
  );

  // Multi-material catalog & selection:
  // Direct mine suppliers are strictly locked to the mine's commodity.
  // Regular suppliers with assigned materialIds only show their designated commodities.
  const availableMaterials = useMemo(() => {
    const all = getMaterialItems(settings, true);

    if (isDirectMine) {
      const mineMatId = party.materialIds?.[0] || COAL_ITEM_ID;
      const matched = all.find((m) => m.id === mineMatId);
      return [matched || getMaterialById(mineMatId, settings)];
    }

    if (party.materialIds && party.materialIds.length > 0) {
      const filtered = all.filter((m) => party.materialIds!.includes(m.id));
      if (filtered.length > 0) return filtered;
    }

    return all;
  }, [settings, party.materialIds, party.linkedMineId, propMines, isDirectMine]);

  const defaultMaterialId = existingLot?.itemId || availableMaterials[0]?.id || party.materialIds?.[0] || COAL_ITEM_ID;
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>(defaultMaterialId);

  const activeMaterial: MaterialDefinition = useMemo(
    () => getMaterialById(selectedMaterialId, settings),
    [selectedMaterialId, settings]
  );
  const isPurityPricing = activeMaterial.pricingModel === 'purity';
  const theme = useMemo(() => getMaterialBadgeTheme(activeMaterial.id), [activeMaterial.id]);

  // Purity calculation state for Laterite and purity-based commodities
  const [pricingMode, setPricingMode] = useState<'purity' | 'flat'>(
    existingLot && existingLot.purchaseRate && !existingLot.grade ? 'flat' : 'purity'
  );
  const [purityPercent, setPurityPercent] = useState('30');
  const [ratePerPoint, setRatePerPoint] = useState(String(activeMaterial.defaultRate || 116));

  const defaultStorageYard = activeMaterial.id.includes('coal')
    ? 'Main Coal Yard'
    : `${activeMaterial.name} Storage Yard`;

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const partyRef = useRef(party);
  partyRef.current = party;

  useEffect(() => {
    if (propMines && propMines.length > 0) {
      setMinesList(propMines);
    } else {
      getMines().then((m) => setMinesList(m.filter((item) => !item.deleted)));
    }
  }, [propMines, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const currentParty = partyRef.current;
    const currentSettings = settingsRef.current;

    if (existingLot) {
      const lotMatId = existingLot.itemId || currentParty?.materialIds?.[0] || COAL_ITEM_ID;
      const lotMat = getMaterialById(lotMatId, currentSettings);
      const lotDefaultYard = lotMatId.includes('coal')
        ? 'Main Coal Yard'
        : `${lotMat.name} Storage Yard`;

      setSelectedMaterialId(lotMatId);
      setDate(existingLot.date || getTodayDateString());
      setTruckNumber(existingLot.truckNumber || '');
      setSelectedMineId(existingLot.mineId);
      setMineName(existingLot.mineName || existingLot.mineSource || '');
      setStoredAt(existingLot.storedAt || lotDefaultYard);
      const w = existingLot.receivedWeight ?? existingLot.billedWeight ?? existingLot.tonnage;
      setWeight(w !== undefined && w !== null ? String(w) : '');
      const r = existingLot.purchaseRate ?? existingLot.ratePerTon;
      setRate(r !== undefined && r !== null ? String(r) : '');
      const f = existingLot.freightCost;
      setFare(f !== undefined && f !== null && f !== 0 ? String(f) : '');
      setNotes(existingLot.notes || '');
      setPaidOnSpot(existingLot.paidOnSpot ? String(existingLot.paidOnSpot) : '');
      setPaidOnSpotMode(existingLot.paidOnSpotMode || 'cash');
      setPaidOnSpotNote(existingLot.paidOnSpotNote || '');

      if (lotMat.pricingModel === 'purity') {
        if (existingLot.grade && existingLot.grade.includes('%')) {
          const match = existingLot.grade.match(/(\d+(\.\d+)?)%/);
          if (match) {
            const p = parseFloat(match[1]);
            if (p > 0) {
              setPurityPercent(String(p));
              const rateVal = existingLot.purchaseRate ?? existingLot.ratePerTon;
              if (rateVal && rateVal > 0) {
                setRatePerPoint(String(Math.round((rateVal / p) * 100) / 100));
              }
            }
          }
        }
        if (existingLot.purchaseRate && !existingLot.grade) {
          setPricingMode('flat');
        } else {
          setPricingMode('purity');
        }
      } else {
        setPricingMode('flat');
      }
    } else {
      let initialMatId = currentParty?.materialIds?.[0] || COAL_ITEM_ID;
      let initMineId: string | undefined = undefined;
      let initMineName = '';

      if (isDirectMine) {
        const linkedMine = (propMines || []).find((m) => m.id === currentParty?.linkedMineId);
        if (linkedMine) {
          initMineId = linkedMine.id;
          initMineName = linkedMine.name;
        } else if (currentParty?.name?.includes('Direct Ledger')) {
          initMineName = currentParty.name.replace(/\s+Direct Ledger.*$/i, '').trim();
        }
      }

      const mat = getMaterialById(initialMatId, currentSettings);
      const initDefaultYard = initialMatId.includes('coal')
        ? 'Main Coal Yard'
        : `${mat.name} Storage Yard`;

      setSelectedMaterialId(initialMatId);
      setDate(getTodayDateString());
      setTruckNumber('');
      setSelectedMineId(initMineId);
      setMineName(initMineName);
      setStoredAt(initDefaultYard);
      setWeight('');
      setRate(mat.pricingModel !== 'purity' && mat.defaultRate ? String(mat.defaultRate) : '');
      setFare('');
      setPaidOnSpot('');
      setPaidOnSpotMode('cash');
      setPaidOnSpotNote('');
      setNotes('');
      setRatePerPoint(String(mat.defaultRate || 116));
      setPurityPercent('30');
      setPricingMode(mat.pricingModel === 'purity' ? 'purity' : 'flat');
    }
    setErrorMsg(null);
  }, [isOpen, existingLot?.id, party.id]);

  if (!isOpen) return null;

  const curSym = getCurrencySymbol(settings?.currency);
  const numWeight = cleanNumber(weight);
  const numFare = cleanNumber(fare);

  // Compute rate per ton based on pricing mode
  const parsedPurity = cleanNumber(purityPercent);
  const parsedRatePerPoint = cleanNumber(ratePerPoint);
  const computedPurityRate = parsedPurity > 0 && parsedRatePerPoint > 0 ? parsedPurity * parsedRatePerPoint : 0;

  const effectiveRate = isPurityPricing && pricingMode === 'purity'
    ? computedPurityRate
    : cleanNumber(rate);

  const materialCost = numWeight * effectiveRate;
  const totalValue = materialCost + numFare;
  const landedRate = numWeight > 0 ? totalValue / numWeight : effectiveRate;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!truckNumber.trim()) {
      setErrorMsg('Please enter a truck number');
      return;
    }
    if (numWeight <= 0) {
      setErrorMsg('Please enter a valid weight in tons');
      return;
    }
    if (effectiveRate <= 0) {
      setErrorMsg(
        isPurityPricing && pricingMode === 'purity'
          ? 'Please enter valid purity % and rate per point'
          : 'Please enter a purchase rate per ton'
      );
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMsg(null);
      const trimmedMine = mineName.trim();
      let resolvedMineId: string | undefined = undefined;
      let resolvedMineName: string | undefined = undefined;

      if (trimmedMine) {
        const matchedMine = minesList.find(
          (m) =>
            m.name.toLowerCase() === trimmedMine.toLowerCase() ||
            (selectedMineId && m.id === selectedMineId)
        );

        if (matchedMine) {
          resolvedMineId = matchedMine.id;
          resolvedMineName = matchedMine.name;
        } else {
          // Seamlessly auto-create the new Mine/Source in the database
          const newMine: Mine = {
            id: uuidv4(),
            name: trimmedMine,
            ratePerTon: effectiveRate,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          await saveMine(newMine);
          resolvedMineId = newMine.id;
          resolvedMineName = newMine.name;
          setMinesList((prev) => [...prev, newMine]);
          window.dispatchEvent(new Event('ledger-data-changed'));
        }
      }

      await onSave({
        ...(existingLot || {}),
        id: existingLot?.id || undefined,
        date,
        truckNumber: truckNumber.trim().toUpperCase(),
        itemId: activeMaterial.id,
        itemName: activeMaterial.name,
        mineId: resolvedMineId,
        mineName: resolvedMineName,
        mineSource: resolvedMineName,
        storedAt: storedAt.trim() || defaultStorageYard,
        billedWeight: numWeight,
        receivedWeight: numWeight,
        tonnage: numWeight,
        purchaseRate: effectiveRate,
        ratePerTon: effectiveRate,
        freightCost: numFare,
        totalValue,
        landedRate,
        grade: isPurityPricing && pricingMode === 'purity'
          ? `${parsedPurity}% ${activeMaterial.qualityLabel || 'Purity'}`
          : undefined,
        paidOnSpot: cleanNumber(paidOnSpot) > 0 ? cleanNumber(paidOnSpot) : undefined,
        paidOnSpotMode: cleanNumber(paidOnSpot) > 0 ? paidOnSpotMode : undefined,
        paidOnSpotNote: cleanNumber(paidOnSpot) > 0 ? (paidOnSpotNote.trim() || undefined) : undefined,
        linkedPaymentId: existingLot?.linkedPaymentId,
        notes: notes.trim() || undefined,
      });
      playSuccessSound();
      onClose();
    } catch (err: any) {
      console.error('Error saving inward delivery:', err);
      setErrorMsg(err.message || 'Failed to save inward delivery');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isCoal = activeMaterial.id === COAL_ITEM_ID;

  return (
    <>
      <div className="ios-modal-backdrop" onClick={onClose} style={{ zIndex: 99990 }} />
      <div
        className="ios-bottom-sheet"
        style={{
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 99995,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ios-sheet-handle" />

        {/* Header */}
        <div className="ios-sheet-header">
          <button type="button" onClick={onClose} className="ios-nav-action" style={{ fontWeight: 400 }}>
            Cancel
          </button>
          <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--label-primary)' }}>
            {existingLot ? `Edit ${activeMaterial.name} Delivery` : `Record Inward ${activeMaterial.name}`}
          </span>
          <button
            type="button"
            onClick={() => handleSubmit()}
            disabled={isSubmitting || !truckNumber.trim() || numWeight <= 0 || effectiveRate <= 0}
            className="ios-nav-action"
            style={{ fontWeight: 600 }}
          >
            {isSubmitting ? 'Saving…' : 'Done'}
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} style={{ overflowY: 'auto', padding: '16px', flex: 1, WebkitOverflowScrolling: 'touch' }}>
          {errorMsg && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'rgba(255, 59, 48, 0.1)',
                border: '0.5px solid rgba(255, 59, 48, 0.3)',
                padding: '10px 14px',
                borderRadius: 12,
                color: 'var(--ios-red)',
                fontSize: 13,
                fontWeight: 500,
                marginBottom: 16,
              }}
            >
              <AlertCircle size={16} />
              {errorMsg}
            </div>
          )}

          {/* Supplier Info Banner */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: 'var(--fill-secondary)',
              padding: '12px 14px',
              borderRadius: 14,
              marginBottom: 14,
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: '#FF9500',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#FFFFFF',
                flexShrink: 0,
              }}
            >
              <Store size={18} strokeWidth={2.2} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--label-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Supplier Account
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--label-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {party.name}
              </div>
            </div>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: '4px 8px',
                borderRadius: 6,
                background: theme.bg,
                color: theme.color,
                border: `1px solid ${theme.border}`,
                textTransform: 'uppercase',
                letterSpacing: '0.4px',
              }}
            >
              {activeMaterial.name}
            </span>
          </div>

          {/* Commodity / Material Selection */}
          <div className="ios-group" style={{ marginBottom: 16 }}>
            <div className="ios-group-title">Raw Material Commodity</div>
            <div className="ios-card-grouped" style={{ padding: '10px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: availableMaterials.length > 1 ? 10 : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      background: theme.bg,
                      border: `1px solid ${theme.border}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: theme.color,
                    }}
                  >
                    <Layers size={15} strokeWidth={2.2} />
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--label-primary)' }}>
                      {activeMaterial.name}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--label-secondary)' }}>
                      {isDirectMine
                        ? `Direct Mine Commodity (Locked to ${mineName || party.name})`
                        : isPurityPricing
                        ? `Purity-Based Commodity (${activeMaterial.qualityLabel || 'Fe2O3'} %)`
                        : isCoal
                        ? 'GCV-Based Energy Commodity'
                        : 'Flat-Rate Commodity'}
                    </div>
                  </div>
                </div>
              </div>

              {!isDirectMine && availableMaterials.length > 1 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 8, borderTop: '0.5px solid var(--separator)' }}>
                  {availableMaterials.map((mat) => {
                    const isSelected = mat.id === selectedMaterialId;
                    const mTheme = getMaterialBadgeTheme(mat.id);
                    return (
                      <button
                        key={mat.id}
                        type="button"
                        onClick={() => {
                          playPopSound();
                          setSelectedMaterialId(mat.id);
                          const oldDefaultYard = activeMaterial.id.includes('coal')
                            ? 'Main Coal Yard'
                            : `${activeMaterial.name} Storage Yard`;
                          const nextDefaultYard = mat.id.includes('coal')
                            ? 'Main Coal Yard'
                            : `${mat.name} Storage Yard`;
                          if (!storedAt || storedAt === oldDefaultYard) {
                            setStoredAt(nextDefaultYard);
                          }
                          if (mat.pricingModel === 'purity') {
                            setRatePerPoint(String(mat.defaultRate || 116));
                            setPurityPercent('30');
                            setPricingMode('purity');
                          } else {
                            setPricingMode('flat');
                            if (mat.defaultRate && (!rate || rate === '0')) {
                              setRate(String(mat.defaultRate));
                            }
                          }
                        }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          padding: '6px 10px',
                          borderRadius: 14,
                          fontSize: 12,
                          fontWeight: isSelected ? 600 : 500,
                          background: isSelected ? mTheme.bg : 'var(--fill-tertiary)',
                          color: isSelected ? mTheme.color : 'var(--label-secondary)',
                          border: isSelected ? `1.5px solid ${mTheme.dot}` : '1px solid var(--separator)',
                          cursor: 'pointer',
                        }}
                      >
                        {isSelected && <Check size={12} strokeWidth={2.5} />}
                        <span>{mat.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Delivery Logistics Group */}
          <div className="ios-group">
            <div className="ios-group-title">Delivery & Truck Details</div>
            <div className="ios-card-grouped" style={{ marginBottom: 16 }}>
              <div className="ios-cell" style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 15, color: 'var(--label-secondary)', minWidth: 100 }}>Date</span>
                <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
                  <IOSDatePicker
                    label=""
                    value={date}
                    onChange={setDate}
                    style={{ padding: 0 }}
                    inputStyle={{ textAlign: 'right', fontSize: 16, fontWeight: 500, color: 'var(--label-primary)' }}
                  />
                </div>
              </div>
              <div className="ios-separator with-glyph" style={{ left: 16 }} />

              <div className="ios-cell" style={{ padding: '10px 16px' }}>
                <span style={{ fontSize: 15, color: 'var(--label-secondary)', minWidth: 100 }}>Truck #</span>
                <input
                  type="text"
                  placeholder="e.g. TK-4821"
                  value={truckNumber}
                  onChange={(e) => setTruckNumber(e.target.value.toUpperCase())}
                  style={{
                    flex: 1,
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    fontSize: 16,
                    fontWeight: 600,
                    color: 'var(--label-primary)',
                    textAlign: 'right',
                  }}
                />
              </div>
              <div className="ios-separator with-glyph" style={{ left: 16 }} />

              <IOSSelect
                label={isCoal ? 'Mine / Origin' : 'Pit / Source Quarry'}
                value={selectedMineId || mineName}
                onChange={(val) => {
                  const m = minesList.find(
                    (item) => item.id === val || item.name.toLowerCase() === String(val).toLowerCase()
                  );
                  if (m) {
                    setSelectedMineId(m.id);
                    setMineName(m.name);
                  } else {
                    setSelectedMineId(undefined);
                    setMineName(String(val));
                  }
                }}
                options={minesList.map((m) => ({
                  value: m.id,
                  label: m.name,
                  subtitle: m.ratePerTon
                    ? `${curSym} ${formatAmountNumber(m.ratePerTon, settings)} / ton base rate`
                    : (m.location || undefined),
                  icon: <Pickaxe size={18} color="var(--ios-blue)" />,
                }))}
                allowCustomOption={true}
                createOptionLabel={(q) => `Use "${q}"`}
                createOptionSubtitle={() =>
                  isCoal ? 'New Mine (Will be added to Mines inventory)' : 'New Source Pit / Quarry'
                }
                onCreateOption={(q) => {
                  setSelectedMineId(undefined);
                  setMineName(q);
                }}
                searchable={true}
                searchPlaceholder={isCoal ? 'Search or enter new mine...' : 'Search or enter pit / quarry...'}
                placeholder={isCoal ? 'Select Mine / Origin' : 'Select Source Pit / Depot'}
                title={isCoal ? 'Select Mine / Origin' : 'Select Source Pit / Depot'}
                clearable={true}
                onClear={() => {
                  setSelectedMineId(undefined);
                  setMineName('');
                }}
                customTrigger={({ open, displayLabel }) => (
                  <div
                    className="ios-cell"
                    onClick={open}
                    style={{
                      padding: '10px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ fontSize: 15, color: 'var(--label-secondary)', minWidth: 110 }}>
                      {isCoal ? 'Mine / Origin' : 'Source Pit / Depot'}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1, justifyContent: 'flex-end' }}>
                      <span
                        style={{
                          fontSize: 16,
                          fontWeight: displayLabel ? 600 : 400,
                          color: displayLabel ? 'var(--label-primary)' : 'var(--label-tertiary)',
                          textAlign: 'right',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: '70%',
                        }}
                      >
                        {displayLabel || (isCoal ? 'Select Mine / Origin' : 'Select Pit / Depot')}
                      </span>
                      <ChevronRight size={18} color="var(--label-tertiary)" style={{ flexShrink: 0 }} />
                    </div>
                  </div>
                )}
              />
              <div className="ios-separator with-glyph" style={{ left: 16 }} />

              <div className="ios-cell" style={{ padding: '10px 16px' }}>
                <span style={{ fontSize: 15, color: 'var(--label-secondary)', minWidth: 100 }}>Storage Yard</span>
                <input
                  type="text"
                  placeholder={`e.g. ${defaultStorageYard}`}
                  value={storedAt}
                  onChange={(e) => setStoredAt(e.target.value)}
                  style={{
                    flex: 1,
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    fontSize: 15,
                    color: 'var(--label-primary)',
                    textAlign: 'right',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Pricing & Weight Group */}
          <div className="ios-group">
            <div className="ios-group-title">Weight, Buy Rate & Freight</div>
            <div className="ios-card-grouped" style={{ marginBottom: 16 }}>
              {/* Purity Pricing Switcher for Laterite and purity commodities */}
              {isPurityPricing && (
                <>
                  <div style={{ padding: '10px 14px' }}>
                    <div className="ios-segmented">
                      <button
                        type="button"
                        className={`ios-segmented-item ${pricingMode === 'purity' ? 'active' : ''}`}
                        onClick={() => {
                          playPopSound();
                          setPricingMode('purity');
                        }}
                        style={pricingMode === 'purity' ? { background: '#FF9500', color: '#FFFFFF', fontWeight: 600 } : {}}
                      >
                        <Percent size={14} style={{ marginRight: 6, display: 'inline', verticalAlign: -2 }} />
                        Purity Pricing (% × Point)
                      </button>
                      <button
                        type="button"
                        className={`ios-segmented-item ${pricingMode === 'flat' ? 'active' : ''}`}
                        onClick={() => {
                          playPopSound();
                          setPricingMode('flat');
                        }}
                        style={pricingMode === 'flat' ? { background: 'var(--fill-secondary)', color: 'var(--label-primary)', fontWeight: 600 } : {}}
                      >
                        <Banknote size={14} style={{ marginRight: 6, display: 'inline', verticalAlign: -2 }} />
                        Flat Rate / Ton
                      </button>
                    </div>
                  </div>
                  <div className="ios-separator with-glyph" style={{ left: 16 }} />

                  {pricingMode === 'purity' && (
                    <>
                      <div className="ios-cell" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div>
                          <span style={{ fontSize: 15, color: 'var(--label-primary)' }}>Purity ({activeMaterial.qualityLabel || 'Fe2O3'} %) *</span>
                          <div style={{ fontSize: 11, color: 'var(--label-secondary)' }}>Received purity percentage</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <NumericInput
                            required
                            placeholder="30"
                            value={purityPercent}
                            onChange={setPurityPercent}
                            style={{
                              border: 'none',
                              outline: 'none',
                              background: 'transparent',
                              fontSize: 17,
                              fontWeight: 700,
                              color: 'var(--label-primary)',
                              textAlign: 'right',
                              maxWidth: 90,
                            }}
                            className="tabular-nums"
                          />
                          <span style={{ fontSize: 15, color: 'var(--label-secondary)' }}>%</span>
                        </div>
                      </div>
                      <div className="ios-separator with-glyph" style={{ left: 16 }} />

                      <div className="ios-cell" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div>
                          <span style={{ fontSize: 15, color: 'var(--label-primary)' }}>Rate / Purity Point *</span>
                          <div style={{ fontSize: 11, color: 'var(--label-secondary)' }}>Contract rate per 1.0% purity</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 15, color: 'var(--label-secondary)' }}>{curSym}</span>
                          <NumericInput
                            required
                            placeholder="116"
                            value={ratePerPoint}
                            onChange={setRatePerPoint}
                            style={{
                              border: 'none',
                              outline: 'none',
                              background: 'transparent',
                              fontSize: 17,
                              fontWeight: 700,
                              color: 'var(--label-primary)',
                              textAlign: 'right',
                              maxWidth: 110,
                            }}
                            className="tabular-nums"
                          />
                        </div>
                      </div>
                      <div className="ios-separator with-glyph" style={{ left: 16 }} />

                      <div className="ios-cell" style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--fill-quaternary)' }}>
                        <span style={{ fontSize: 14, color: 'var(--label-secondary)' }}>Calculated Buy Rate</span>
                        <span style={{ fontSize: 16, fontWeight: 700, color: '#FF9500' }}>
                          {curSym} {formatAmountNumber(computedPurityRate, settings)} / ton
                        </span>
                      </div>
                      <div className="ios-separator with-glyph" style={{ left: 16 }} />
                    </>
                  )}
                </>
              )}

              {/* Weight row */}
              <div className="ios-cell" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 15, color: 'var(--label-secondary)', minWidth: 120 }}>Weight (Tons) *</span>
                <NumericInput
                  required
                  placeholder="0.00"
                  value={weight}
                  onChange={setWeight}
                  style={{
                    flex: 1,
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    fontSize: 17,
                    fontWeight: 700,
                    color: 'var(--label-primary)',
                    textAlign: 'right',
                    maxWidth: 160,
                  }}
                  className="tabular-nums"
                />
              </div>
              <div className="ios-separator with-glyph" style={{ left: 16 }} />

              {/* Rate per ton row (if not in purity mode) */}
              {(!isPurityPricing || pricingMode === 'flat') && (
                <>
                  <div className="ios-cell" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 15, color: 'var(--label-secondary)', minWidth: 120 }}>Rate / Ton ({curSym}) *</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 15, color: 'var(--label-secondary)' }}>{curSym}</span>
                      <NumericInput
                        required
                        placeholder="0"
                        value={rate}
                        onChange={setRate}
                        style={{
                          border: 'none',
                          outline: 'none',
                          background: 'transparent',
                          fontSize: 17,
                          fontWeight: 700,
                          color: 'var(--label-primary)',
                          textAlign: 'right',
                          maxWidth: 140,
                        }}
                        className="tabular-nums"
                      />
                    </div>
                  </div>
                  <div className="ios-separator with-glyph" style={{ left: 16 }} />
                </>
              )}

              {/* Freight fare */}
              <div className="ios-cell" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 15, color: 'var(--label-primary)' }}>Freight / Fare</div>
                  <div style={{ fontSize: 11, color: 'var(--label-secondary)' }}>Optional carrier/truck fare</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 15, color: 'var(--label-secondary)' }}>{curSym}</span>
                  <NumericInput
                    placeholder="0"
                    value={fare}
                    onChange={setFare}
                    style={{
                      border: 'none',
                      outline: 'none',
                      background: 'transparent',
                      fontSize: 16,
                      color: 'var(--label-primary)',
                      textAlign: 'right',
                      maxWidth: 140,
                    }}
                    className="tabular-nums"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Live Landed Cost Valuation Card */}
          <div
            style={{
              background: 'var(--fill-secondary)',
              borderRadius: 16,
              padding: 14,
              marginBottom: 16,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#FF9500', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                Landed Stock Valuation ({activeMaterial.name})
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, textAlign: 'center' }}>
              <div style={{ background: 'var(--bg-card)', padding: '8px 6px', borderRadius: 10, border: '0.5px solid var(--separator)' }}>
                <div style={{ fontSize: 10, color: 'var(--label-tertiary)', textTransform: 'uppercase' }}>Material Cost</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--label-primary)', marginTop: 2 }}>
                  {curSym} {formatAmountNumber(materialCost, settings)}
                </div>
              </div>

              <div style={{ background: 'var(--bg-card)', padding: '8px 6px', borderRadius: 10, border: '0.5px solid var(--separator)' }}>
                <div style={{ fontSize: 10, color: 'var(--label-tertiary)', textTransform: 'uppercase' }}>Total Inward</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#FF9500', marginTop: 2 }}>
                  {curSym} {formatAmountNumber(totalValue, settings)}
                </div>
              </div>

              <div style={{ background: 'var(--bg-card)', padding: '8px 6px', borderRadius: 10, border: '0.5px solid var(--separator)' }}>
                <div style={{ fontSize: 10, color: 'var(--label-tertiary)', textTransform: 'uppercase' }}>Landed / Ton</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--label-primary)', marginTop: 2 }}>
                  {curSym} {landedRate.toFixed(2)}
                </div>
              </div>
            </div>
          </div>

          {/* On-the-spot Payment (Optional) */}
          <div className="ios-group">
            <div className="ios-group-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Banknote size={15} /> Payment Paid on Spot (Optional)
            </div>
            <div className="ios-card-grouped" style={{ marginBottom: 16 }}>
              <div className="ios-cell" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 15, color: 'var(--label-primary)' }}>Amount Paid</div>
                  <div style={{ fontSize: 11, color: 'var(--label-secondary)' }}>Cash / transfer paid to supplier or truck</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 15, color: 'var(--label-secondary)' }}>{curSym}</span>
                  <NumericInput
                    placeholder="0"
                    value={paidOnSpot}
                    onChange={setPaidOnSpot}
                    style={{
                      border: 'none',
                      outline: 'none',
                      background: 'transparent',
                      fontSize: 16,
                      fontWeight: 700,
                      color: 'var(--label-primary)',
                      textAlign: 'right',
                      maxWidth: 140,
                    }}
                    className="tabular-nums"
                  />
                </div>
              </div>

              {Boolean(cleanNumber(paidOnSpot) > 0) && (
                <>
                  <div className="ios-separator with-glyph" style={{ left: 16 }} />
                  <div className="ios-cell" style={{ padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-secondary)' }}>Payment Method</span>
                    <div className="ios-segmented-control" style={{ margin: 0 }}>
                      {(['cash', 'bank', 'online', 'cheque'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          className={`ios-segmented-item ${paidOnSpotMode === mode ? 'active' : ''}`}
                          onClick={() => {
                            playPopSound();
                            setPaidOnSpotMode(mode);
                          }}
                        >
                          {mode.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="ios-separator with-glyph" style={{ left: 16 }} />
                  <div className="ios-cell" style={{ padding: '10px 16px' }}>
                    <input
                      type="text"
                      placeholder="Payment note / reference (e.g. Driver cash advance)"
                      value={paidOnSpotNote}
                      onChange={(e) => setPaidOnSpotNote(e.target.value)}
                      style={{
                        width: '100%',
                        border: 'none',
                        outline: 'none',
                        background: 'transparent',
                        fontSize: 14,
                        color: 'var(--label-primary)',
                      }}
                    />
                  </div>

                  <div className="ios-separator with-glyph" style={{ left: 16 }} />
                  <div className="ios-cell" style={{ padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, color: 'var(--label-secondary)' }}>Remaining Inward Due</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: Math.max(0, totalValue - cleanNumber(paidOnSpot)) > 0 ? '#FF9500' : 'var(--ios-green)' }} className="tabular-nums">
                      {curSym} {formatAmountNumber(Math.max(0, totalValue - cleanNumber(paidOnSpot)), settings)}
                      {Math.max(0, totalValue - cleanNumber(paidOnSpot)) === 0 && ' (Settled)'}
                    </span>
                  </div>
                </>
              )}
            </div>
            <div className="ios-group-footnote" style={{ padding: '0 16px 8px' }}>
              {cleanNumber(paidOnSpot) > 0
                ? 'A payment entry will be automatically recorded in the supplier\'s ledger upon saving.'
                : 'Leave 0 or empty if payment will be settled later.'}
            </div>
          </div>

          {/* Remarks / Notes */}
          <div className="ios-group">
            <div className="ios-group-title">Notes & Remarks</div>
            <div className="ios-card-grouped" style={{ marginBottom: 20 }}>
              <div className="ios-cell" style={{ padding: '12px 16px' }}>
                <textarea
                  placeholder="Optional delivery remarks, pit quality, driver details..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  style={{
                    width: '100%',
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    fontSize: 14,
                    color: 'var(--label-primary)',
                    resize: 'none',
                    fontFamily: 'inherit',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Action button */}
          <div style={{ padding: '0 4px', marginBottom: 20 }}>
            <button
              type="submit"
              disabled={isSubmitting || !truckNumber.trim() || numWeight <= 0 || effectiveRate <= 0}
              className="ios-btn ios-btn-primary"
              style={{
                width: '100%',
                padding: 16,
                fontSize: 16,
                borderRadius: 14,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <Truck size={18} />
              {isSubmitting ? 'Saving to Stock…' : existingLot ? `Update ${activeMaterial.name} Delivery` : `Receive ${activeMaterial.name} into Stock`}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
