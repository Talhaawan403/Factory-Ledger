import { useState, useMemo, useEffect } from 'react';
import { Calculator, Share2, Copy, Check, Truck, Info } from 'lucide-react';
import { playPopSound, playSuccessSound } from '../utils/delight';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';
import NumericInput from './NumericInput';
import { getSettings } from '../lib/db';
import type { AppSettings } from '../types';
import { getCurrencySymbol, formatAmountNumber } from '../utils/currency';

interface DealEstimatorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function DealEstimatorModal({ isOpen, onClose }: DealEstimatorModalProps) {
  if (!isOpen) return null;

  return <DealEstimatorContent onClose={onClose} />;
}

function DealEstimatorContent({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<AppSettings | undefined>(undefined);
  const curSym = getCurrencySymbol(settings?.currency);

  useEffect(() => {
    getSettings().then(s => setSettings(s));
  }, []);

  const [tons, setTons] = useState<number>(50);
  // Purchase rate & selling rate are strictly per ton
  const [purchaseRate, setPurchaseRate] = useState<number>(18500);
  const [sellingRate, setSellingRate] = useState<number>(23000);

  // Freight: can be entered as Total Lump Sum (flat truck fare) or Per Ton
  const [freightMode, setFreightMode] = useState<'total' | 'perTon'>('total');
  const [freightValue, setFreightValue] = useState<number>(160000); // 160k flat truck fare

  // Other / Misc / Kanta: can be entered as Total Lump Sum or Per Ton (default flat total)
  const [miscMode, setMiscMode] = useState<'total' | 'perTon'>('total');
  const [miscValue, setMiscValue] = useState<number>(3000); // 3k flat kanta/bilty

  // Transit Loss: weighbridge shortage between mine loading scale and factory scale
  // Default to 0% (standard / factory pays loading weight)
  const [shortagePercent, setShortagePercent] = useState<number>(0);
  const [showTransitLossExplainer, setShowTransitLossExplainer] = useState(false);

  const [copied, setCopied] = useState(false);

  // Derived financial calculations
  const calc = useMemo(() => {
    const loadedTons = Math.max(0, Number(tons) || 0);
    const buyRate = Math.max(0, Number(purchaseRate) || 0);
    const sellRate = Math.max(0, Number(sellingRate) || 0);
    const shortagePct = Math.max(0, Number(shortagePercent) || 0);

    // Freight calculations
    let freightTotal = 0;
    let freightPerTon = 0;
    if (freightMode === 'total') {
      freightTotal = Math.max(0, Number(freightValue) || 0);
      freightPerTon = loadedTons > 0 ? freightTotal / loadedTons : 0;
    } else {
      freightPerTon = Math.max(0, Number(freightValue) || 0);
      freightTotal = loadedTons * freightPerTon;
    }

    // Misc / Kanta calculations
    let miscTotal = 0;
    let miscPerTon = 0;
    if (miscMode === 'total') {
      miscTotal = Math.max(0, Number(miscValue) || 0);
      miscPerTon = loadedTons > 0 ? miscTotal / loadedTons : 0;
    } else {
      miscPerTon = Math.max(0, Number(miscValue) || 0);
      miscTotal = loadedTons * miscPerTon;
    }

    // Costs
    const coalCost = loadedTons * buyRate;
    const totalCost = coalCost + freightTotal + miscTotal;

    // Weight and Revenue
    const shortageTons = (loadedTons * shortagePct) / 100;
    const billedTons = Math.max(0, loadedTons - shortageTons);
    const totalRevenue = billedTons * sellRate;
    const shortageValueLost = shortageTons * sellRate; // Revenue lost due to weighbridge shortage

    // Profits
    const netProfit = totalRevenue - totalCost;
    const costPerLoadedTon = loadedTons > 0 ? totalCost / loadedTons : 0;
    const profitPerLoadedTon = loadedTons > 0 ? netProfit / loadedTons : 0;
    const marginPercent = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

    // Breakeven selling rate per billed ton
    const breakevenRate = billedTons > 0 ? Math.ceil(totalCost / billedTons) : 0;

    return {
      loadedTons,
      buyRate,
      sellRate,
      freightMode,
      freightTotal,
      freightPerTon,
      miscMode,
      miscTotal,
      miscPerTon,
      coalCost,
      totalCost,
      shortagePercent: shortagePct,
      shortageTons,
      shortageValueLost,
      billedTons,
      totalRevenue,
      netProfit,
      costPerLoadedTon,
      profitPerLoadedTon,
      marginPercent,
      breakevenRate,
    };
  }, [tons, purchaseRate, sellingRate, freightMode, freightValue, miscMode, miscValue, shortagePercent]);

  // Mode toggling helpers (preserves entered cost seamlessly)
  const handleFreightModeChange = (newMode: 'total' | 'perTon') => {
    if (newMode === freightMode) return;
    playPopSound();
    if (newMode === 'perTon') {
      setFreightValue(calc.loadedTons > 0 ? Math.round(calc.freightTotal / calc.loadedTons) : 0);
    } else {
      setFreightValue(Math.round(calc.freightPerTon * calc.loadedTons));
    }
    setFreightMode(newMode);
  };

  const handleMiscModeChange = (newMode: 'total' | 'perTon') => {
    if (newMode === miscMode) return;
    playPopSound();
    if (newMode === 'perTon') {
      setMiscValue(calc.loadedTons > 0 ? Math.round(calc.miscTotal / calc.loadedTons) : 0);
    } else {
      setMiscValue(Math.round(calc.miscPerTon * calc.loadedTons));
    }
    setMiscMode(newMode);
  };

  const truckPresets = [
    { label: '10 Wheeler (35t)', tons: 35 },
    { label: '12 Wheeler (45t)', tons: 45 },
    { label: 'Trailer (55t)', tons: 55 },
    { label: 'Super (65t)', tons: 65 },
  ];

  const transitLossPresets = [
    { label: '0% None', value: 0 },
    { label: '0.5% Normal', value: 0.5 },
    { label: '1.0% High', value: 1.0 },
    { label: '1.5% Extreme', value: 1.5 },
  ];

  const dealSummaryText = `*DEAL ESTIMATE (Factory Ledger)*\n` +
    `• Load Weight: ${calc.loadedTons.toFixed(2)} Tons\n` +
    `• Purchase Rate: ${curSym} ${formatAmountNumber(calc.buyRate, settings)}/ton\n` +
    `• Freight: ${curSym} ${formatAmountNumber(calc.freightTotal, settings)} (${freightMode === 'total' ? `Flat Total, ≈ ${curSym} ${formatAmountNumber(calc.freightPerTon, settings)}/ton` : `${curSym} ${formatAmountNumber(calc.freightPerTon, settings)}/ton`})\n` +
    (calc.miscTotal > 0
      ? `• Misc/Kanta: ${curSym} ${formatAmountNumber(calc.miscTotal, settings)} (${miscMode === 'total' ? `Flat Total, ≈ ${curSym} ${formatAmountNumber(calc.miscPerTon, settings)}/ton` : `${curSym} ${formatAmountNumber(calc.miscPerTon, settings)}/ton`})\n`
      : '') +
    `• Total Cost: ${curSym} ${formatAmountNumber(calc.totalCost, settings)} (${curSym} ${formatAmountNumber(calc.costPerLoadedTon, settings)}/ton)\n` +
    `• Factory Selling Rate: ${curSym} ${formatAmountNumber(calc.sellRate, settings)}/ton\n` +
    (calc.shortagePercent > 0
      ? `• Transit Loss: ${calc.shortagePercent}% (-${calc.shortageTons.toFixed(2)}t shortage, Billed: ${calc.billedTons.toFixed(2)}t)\n`
      : `• Transit Loss: 0% (Full ${calc.loadedTons.toFixed(2)}t Billed)\n`) +
    `────────────────────\n` +
    `*Net Profit: ${curSym} ${formatAmountNumber(calc.netProfit, settings)}*\n` +
    `*Profit/Ton: ${curSym} ${formatAmountNumber(calc.profitPerLoadedTon, settings)}/ton (${calc.marginPercent.toFixed(1)}% margin)*\n` +
    `• Breakeven Rate: ${curSym} ${formatAmountNumber(calc.breakevenRate, settings)}/ton\n` +
    `• Total Deal Value: ${curSym} ${formatAmountNumber(calc.totalRevenue, settings)}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(dealSummaryText);
      playSuccessSound();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleShare = async () => {
    playPopSound();
    if (Capacitor.isNativePlatform()) {
      try {
        await Share.share({
          title: 'Coal Deal Estimate',
          text: dealSummaryText,
          dialogTitle: 'Share Deal Estimate',
        });
        return;
      } catch {
        // Fallback to clipboard
      }
    }
    handleCopy();
  };

  const isProfitable = calc.netProfit >= 0;

  return (
    <>
      {/* ── Apple Dimmed Blur Backdrop ── */}
      <div
        className="ios-modal-backdrop"
        onClick={onClose}
        style={{ zIndex: 99998 }}
      />

      {/* ── Apple iOS Modal Sheet ── */}
      <div
        className="ios-bottom-sheet"
        style={{
          zIndex: 99999,
          maxHeight: '92vh',
          height: 'auto',
          background: 'var(--bg-grouped)',
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          borderTop: '0.5px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 -10px 40px rgba(0, 0, 0, 0.5)',
          overflowY: 'auto',
        }}
      >
        {/* Grabber Handle */}
        <div
          className="ios-sheet-handle"
          style={{
            width: 36,
            height: 5,
            borderRadius: 3,
            backgroundColor: 'rgba(255, 255, 255, 0.25)',
            margin: '8px auto 4px',
          }}
        />

        {/* Navigation Bar */}
        <div
          className="ios-sheet-header"
          style={{
            padding: '10px 16px 12px',
            borderBottom: '0.5px solid var(--separator)',
            background: 'var(--bg-grouped)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--ios-blue)',
              fontSize: 17,
              fontWeight: 400,
              cursor: 'pointer',
              padding: '4px 6px',
            }}
          >
            Close
          </button>

          <span
            style={{
              fontSize: 17,
              fontWeight: 600,
              color: 'var(--text-main)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Calculator style={{ width: 18, height: 18, color: 'var(--ios-blue)' }} />
            Deal Estimator
          </span>

          <button
            type="button"
            onClick={handleShare}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--ios-blue)',
              fontSize: 17,
              fontWeight: 600,
              cursor: 'pointer',
              padding: '4px 6px',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Share2 style={{ width: 16, height: 16 }} />
            Share
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* ── Key Results KPI Card (Apple Flat Solid, No Gradient) ── */}
          <div
            style={{
              backgroundColor: isProfitable ? 'var(--ios-green)' : 'var(--ios-red)',
              borderRadius: 16,
              padding: '18px 20px',
              color: '#ffffff',
            }}
          >
            <div style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.9, fontWeight: 600 }}>
              {isProfitable ? 'Projected Net Profit' : 'Projected Net Loss'}
            </div>
            <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: -0.5, marginTop: 4 }}>
              {isProfitable ? `+${curSym} ` : `-${curSym} `}{formatAmountNumber(Math.abs(calc.netProfit), settings)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255, 255, 255, 0.2)' }}>
              <div>
                <div style={{ fontSize: 11, opacity: 0.85 }}>Profit / Ton</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>
                  {curSym} {formatAmountNumber(calc.profitPerLoadedTon, settings)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, opacity: 0.85 }}>Margin</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>
                  {calc.marginPercent.toFixed(1)}%
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, opacity: 0.85 }}>Breakeven Rate</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>
                  {curSym} {formatAmountNumber(calc.breakevenRate, settings)}
                </div>
              </div>
            </div>
          </div>

          {/* ── Quick Truck Capacity Preset Chips ── */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Truck Capacity Presets
            </div>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
              {truckPresets.map(p => (
                <button
                  key={p.tons}
                  type="button"
                  onClick={() => {
                    playPopSound();
                    setTons(p.tons);
                  }}
                  style={{
                    backgroundColor: tons === p.tons ? 'var(--ios-blue)' : 'var(--bg-card)',
                    color: tons === p.tons ? '#ffffff' : 'var(--text-main)',
                    border: '1px solid var(--separator)',
                    borderRadius: 12,
                    padding: '8px 12px',
                    fontSize: 13,
                    fontWeight: tons === p.tons ? 600 : 500,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  <Truck style={{ width: 14, height: 14 }} />
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── Input Parameters Form (Apple Inset Grouped) ── */}
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--separator)', overflow: 'hidden' }}>

            {/* 1. Load Weight */}
            <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--separator)' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-main)' }}>Load Weight</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Mine loading scale weight</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <NumericInput
                  value={tons || ''}
                  onChange={val => setTons(parseFloat(val) || 0)}
                  style={{
                    width: 90,
                    textAlign: 'right',
                    fontSize: 16,
                    fontWeight: 600,
                    padding: '6px 8px',
                    borderRadius: 8,
                    border: '1px solid var(--separator)',
                    backgroundColor: 'var(--bg-grouped)',
                    color: 'var(--text-main)',
                  }}
                />
                <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Tons</span>
              </div>
            </div>

            {/* 2. Purchase Rate (strictly Rs/ton) */}
            <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--separator)' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-main)' }}>Purchase Rate</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Mine / source rate (per ton)</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <NumericInput
                  value={purchaseRate || ''}
                  onChange={val => setPurchaseRate(parseFloat(val) || 0)}
                  style={{
                    width: 100,
                    textAlign: 'right',
                    fontSize: 16,
                    fontWeight: 600,
                    padding: '6px 8px',
                    borderRadius: 8,
                    border: '1px solid var(--separator)',
                    backgroundColor: 'var(--bg-grouped)',
                    color: 'var(--text-main)',
                  }}
                />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>{curSym}/ton</span>
              </div>
            </div>

            {/* 3. Freight / Transport (Toggle: Total Rs vs Per Ton) */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--separator)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-main)' }}>Transport</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {freightMode === 'total' ? 'Transport Fare' : 'Carriage rate per ton'}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {/* Segmented Mode Toggle */}
                  <div style={{ display: 'inline-flex', padding: 2, background: 'var(--bg-grouped)', borderRadius: 8, border: '1px solid var(--separator)' }}>
                    <button
                      type="button"
                      onClick={() => handleFreightModeChange('total')}
                      style={{
                        padding: '3px 8px',
                        fontSize: 11,
                        fontWeight: 600,
                        borderRadius: 6,
                        border: 'none',
                        background: freightMode === 'total' ? 'var(--ios-blue)' : 'transparent',
                        color: freightMode === 'total' ? '#ffffff' : 'var(--text-secondary)',
                        cursor: 'pointer',
                      }}
                    >
                      Total {curSym}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleFreightModeChange('perTon')}
                      style={{
                        padding: '3px 8px',
                        fontSize: 11,
                        fontWeight: 600,
                        borderRadius: 6,
                        border: 'none',
                        background: freightMode === 'perTon' ? 'var(--ios-blue)' : 'transparent',
                        color: freightMode === 'perTon' ? '#ffffff' : 'var(--text-secondary)',
                        cursor: 'pointer',
                      }}
                    >
                      {curSym}/ton
                    </button>
                  </div>

                  {/* Input field */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <NumericInput
                      value={freightValue || ''}
                      onChange={val => setFreightValue(parseFloat(val) || 0)}
                      style={{
                        width: 100,
                        textAlign: 'right',
                        fontSize: 16,
                        fontWeight: 600,
                        padding: '6px 8px',
                        borderRadius: 8,
                        border: '1px solid var(--separator)',
                        backgroundColor: 'var(--bg-grouped)',
                        color: 'var(--text-main)',
                      }}
                    />
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', minWidth: 38 }}>
                      {freightMode === 'total' ? curSym : `${curSym}/t`}
                    </span>
                  </div>
                </div>
              </div>
              {/* Calculated Counterpart helper */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {freightMode === 'total'
                    ? `≈ ${curSym} ${formatAmountNumber(calc.freightPerTon, settings)}/ton`
                    : `≈ ${curSym} ${formatAmountNumber(calc.freightTotal, settings)} total`}
                </span>
              </div>
            </div>

            {/* 4. Other / Kanta / Bilty (Toggle: Total Rs vs Per Ton, default flat Total) */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--separator)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-main)' }}>Kanta / Bilty</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {miscMode === 'total' ? 'Miscellaneous' : 'Misc fees per ton'}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {/* Segmented Mode Toggle */}
                  <div style={{ display: 'inline-flex', padding: 2, background: 'var(--bg-grouped)', borderRadius: 8, border: '1px solid var(--separator)' }}>
                    <button
                      type="button"
                      onClick={() => handleMiscModeChange('total')}
                      style={{
                        padding: '3px 8px',
                        fontSize: 11,
                        fontWeight: 600,
                        borderRadius: 6,
                        border: 'none',
                        background: miscMode === 'total' ? 'var(--ios-blue)' : 'transparent',
                        color: miscMode === 'total' ? '#ffffff' : 'var(--text-secondary)',
                        cursor: 'pointer',
                      }}
                    >
                      Total {curSym}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMiscModeChange('perTon')}
                      style={{
                        padding: '3px 8px',
                        fontSize: 11,
                        fontWeight: 600,
                        borderRadius: 6,
                        border: 'none',
                        background: miscMode === 'perTon' ? 'var(--ios-blue)' : 'transparent',
                        color: miscMode === 'perTon' ? '#ffffff' : 'var(--text-secondary)',
                        cursor: 'pointer',
                      }}
                    >
                      {curSym}/ton
                    </button>
                  </div>

                  {/* Input field */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <NumericInput
                      value={miscValue || ''}
                      onChange={val => setMiscValue(parseFloat(val) || 0)}
                      style={{
                        width: 100,
                        textAlign: 'right',
                        fontSize: 16,
                        fontWeight: 600,
                        padding: '6px 8px',
                        borderRadius: 8,
                        border: '1px solid var(--separator)',
                        backgroundColor: 'var(--bg-grouped)',
                        color: 'var(--text-main)',
                      }}
                    />
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', minWidth: 38 }}>
                      {miscMode === 'total' ? curSym : `${curSym}/t`}
                    </span>
                  </div>
                </div>
              </div>
              {/* Calculated Counterpart helper */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {miscMode === 'total'
                    ? `≈ ${curSym} ${formatAmountNumber(calc.miscPerTon, settings)}/ton`
                    : `≈ ${curSym} ${formatAmountNumber(calc.miscTotal, settings)} total`}
                </span>
              </div>
            </div>

            {/* 5. Factory Selling Rate (strictly curSym/ton) */}
            <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--separator)' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ios-blue)' }}>Factory Selling Rate</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Mill contract rate (per ton)</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <NumericInput
                  value={sellingRate || ''}
                  onChange={val => setSellingRate(parseFloat(val) || 0)}
                  style={{
                    width: 100,
                    textAlign: 'right',
                    fontSize: 16,
                    fontWeight: 700,
                    padding: '6px 8px',
                    borderRadius: 8,
                    border: '1px solid var(--ios-blue)',
                    backgroundColor: 'var(--bg-grouped)',
                    color: 'var(--ios-blue)',
                  }}
                />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ios-blue)' }}>{curSym}/ton</span>
              </div>
            </div>

            {/* 6. Transit Loss (Weighbridge Shortage) */}
            <div style={{ padding: '12px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-main)' }}>Transit Loss Allowance</span>
                    <button
                      type="button"
                      onClick={() => setShowTransitLossExplainer(!showTransitLossExplainer)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--ios-blue)',
                        cursor: 'pointer',
                        padding: 0,
                        display: 'flex',
                        alignItems: 'center',
                      }}
                      title="What is Transit Loss?"
                    >
                      <Info style={{ width: 15, height: 15 }} />
                    </button>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {shortagePercent === 0 ? '0% — Full loaded weight paid by factory' : `Weighbridge shortage (${calc.shortageTons.toFixed(2)}t lost)`}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <NumericInput
                    value={shortagePercent === 0 ? '0' : shortagePercent || ''}
                    onChange={val => setShortagePercent(parseFloat(val) || 0)}
                    style={{
                      width: 70,
                      textAlign: 'right',
                      fontSize: 16,
                      fontWeight: 600,
                      padding: '6px 8px',
                      borderRadius: 8,
                      border: '1px solid var(--separator)',
                      backgroundColor: 'var(--bg-grouped)',
                      color: 'var(--text-main)',
                    }}
                  />
                  <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>%</span>
                </div>
              </div>

              {/* Transit Loss Quick Chips */}
              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                {transitLossPresets.map(preset => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => {
                      playPopSound();
                      setShortagePercent(preset.value);
                    }}
                    style={{
                      padding: '4px 10px',
                      fontSize: 12,
                      fontWeight: shortagePercent === preset.value ? 600 : 400,
                      borderRadius: 8,
                      border: '1px solid var(--separator)',
                      background: shortagePercent === preset.value ? 'var(--ios-blue)' : 'var(--bg-grouped)',
                      color: shortagePercent === preset.value ? '#ffffff' : 'var(--text-main)',
                      cursor: 'pointer',
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              {/* Transit Loss Explainer Accordion Banner */}
              {showTransitLossExplainer && (
                <div
                  style={{
                    marginTop: 10,
                    padding: '10px 12px',
                    borderRadius: 10,
                    backgroundColor: 'var(--bg-grouped)',
                    border: '1px solid var(--separator)',
                    fontSize: 12,
                    lineHeight: 1.45,
                    color: 'var(--text-secondary)',
                  }}
                >
                  <strong style={{ color: 'var(--text-main)' }}>What is Transit Loss? (کانٹا شارٹیج / وزن کی کمی):</strong>
                  <p style={{ margin: '4px 0 0' }}>
                    In coal logistics, trucks travel 2–4 days from loading mines to factories. Moisture evaporates under the sun, coal dust blows off in transit, and different weighbridges have slight calibration differences.
                  </p>
                  <p style={{ margin: '4px 0 0' }}>
                    The factory weighs the truck upon arrival and pays <em>only for received weighbridge weight</em>.
                    • If the factory pays based on <strong>Loading weight</strong>, keep this at <strong>0% (None)</strong>.
                    • If the factory pays on <strong>Destination weighbridge</strong>, select <strong>0.5% or 1.0%</strong> to project actual billed profit.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ── Cost Breakdown Summary Table ── */}
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 16, padding: '16px', border: '1px solid var(--separator)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
              Deal Financial Breakdown
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
                <span>Coal ({calc.loadedTons.toFixed(2)}t @ {curSym} {formatAmountNumber(calc.buyRate, settings)}):</span>
                <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{curSym} {formatAmountNumber(calc.coalCost, settings)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
                <span>Transport:</span>
                <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                  {curSym} {formatAmountNumber(calc.freightTotal, settings)}
                  <span style={{ fontSize: 12, opacity: 0.75, marginLeft: 4 }}>
                    ({freightMode === 'total' ? 'Lump Sum' : `@ ${curSym} ${formatAmountNumber(calc.freightPerTon, settings)}/t`})
                  </span>
                </span>
              </div>
              {calc.miscTotal > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
                  <span>Kanta / Bilty:</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                    {curSym} {formatAmountNumber(calc.miscTotal, settings)}
                    <span style={{ fontSize: 12, opacity: 0.75, marginLeft: 4 }}>
                      ({miscMode === 'total' ? 'Lump Sum' : `@ ${curSym} ${formatAmountNumber(calc.miscPerTon, settings)}/t`})
                    </span>
                  </span>
                </div>
              )}

              {/* Total Cost Line */}
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 6, borderTop: '1px dashed var(--separator)' }}>
                <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>Total Cost:</span>
                <span style={{ fontWeight: 700, color: 'var(--ios-red)' }}>
                  {curSym} {formatAmountNumber(calc.totalCost, settings)}
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginLeft: 4 }}>
                    ({curSym} {formatAmountNumber(calc.costPerLoadedTon, settings)}/t)
                  </span>
                </span>
              </div>

              {/* Gross Billed */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>Factory Gross Billed</span>
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginTop: 1 }}>
                    ({calc.billedTons.toFixed(2)}t @ {curSym} {formatAmountNumber(calc.sellRate, settings)})
                  </span>
                </div>
                <span style={{ fontWeight: 700, color: 'var(--ios-blue)' }}>{curSym} {formatAmountNumber(calc.totalRevenue, settings)}</span>
              </div>

              {/* Shortage deduction note if shortage > 0 */}
              {calc.shortagePercent > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--ios-red)', fontSize: 12 }}>
                  <span>↳ Transit Shortage ({calc.shortagePercent}% = -{calc.shortageTons.toFixed(2)} tons):</span>
                  <span>-{curSym} {formatAmountNumber(calc.shortageValueLost, settings)} lost</span>
                </div>
              )}

              {/* Net Profit Margin */}
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 6, borderTop: '1px solid var(--separator)', fontSize: 15 }}>
                <span style={{ fontWeight: 700, color: isProfitable ? 'var(--ios-green)' : 'var(--ios-red)' }}>
                  {isProfitable ? 'Net Profit Margin:' : 'Net Loss Margin:'}
                </span>
                <span style={{ fontWeight: 700, color: isProfitable ? 'var(--ios-green)' : 'var(--ios-red)' }}>
                  {isProfitable ? `+${curSym} ` : `-${curSym} `}{formatAmountNumber(Math.abs(calc.netProfit), settings)} ({calc.marginPercent.toFixed(1)}%)
                </span>
              </div>
            </div>
          </div>

          {/* ── Actions: Copy & Close ── */}
          <div style={{ display: 'flex', gap: 10, marginTop: 4, paddingBottom: 16 }}>
            <button
              type="button"
              onClick={handleCopy}
              style={{
                flex: 1,
                backgroundColor: 'var(--bg-card)',
                color: 'var(--text-main)',
                border: '1px solid var(--separator)',
                borderRadius: 14,
                padding: '14px',
                fontSize: 15,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              {copied ? <Check style={{ width: 18, height: 18, color: 'var(--ios-green)' }} /> : <Copy style={{ width: 18, height: 18 }} />}
              {copied ? 'Copied to Clipboard' : 'Copy Deal Text'}
            </button>
            <button
              type="button"
              onClick={handleShare}
              style={{
                flex: 1,
                backgroundColor: 'var(--ios-blue)',
                color: '#ffffff',
                border: 'none',
                borderRadius: 14,
                padding: '14px',
                fontSize: 15,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <Share2 style={{ width: 18, height: 18 }} />
              WhatsApp Share
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
