import { useState, useEffect, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Check, ChevronDown, Flame, Layers, PackagePlus, Percent, Plus, Trash2 } from 'lucide-react';
import type { AppSettings, MaterialDefinition, MaterialPricingModel, Dispatch, Party, InventoryLot, PurchaseOrder } from '../types';
import { normalizeMaterialItems, COAL_ITEM_ID } from '../utils/materials';
import { playPopSound, playSuccessSound } from '../utils/delight';
import { getDispatches, getLots, getPurchaseOrders, getParties } from '../lib/db';
import IOSSelect, { type IOSSelectOption } from './IOSSelect';
import { stripNonNumeric } from '../utils/numberFormat';

interface MaterialUsage {
  total: number;
  dispatches: number;
  lots: number;
  pos: number;
  parties: number;
}

interface MaterialSettingsPanelProps {
  settings: AppSettings;
  onSave: (settings: AppSettings) => Promise<void>;
}

const PRICING_OPTIONS: IOSSelectOption<MaterialPricingModel>[] = [
  {
    value: 'purity',
    label: 'Purity × rate',
    subtitle: 'Calculated as: Weight × (Purity % / 100) × Rate',
    badge: 'Formula',
    icon: (
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          background: 'var(--ios-purple)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#FFFFFF',
          flexShrink: 0,
        }}
      >
        <Percent size={16} strokeWidth={2.4} />
      </div>
    ),
  },
  {
    value: 'flat',
    label: 'Flat per ton',
    subtitle: 'Standard fixed rate per metric ton',
    badge: 'Per Ton',
    icon: (
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          background: 'var(--ios-blue)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#FFFFFF',
          flexShrink: 0,
        }}
      >
        <Layers size={16} strokeWidth={2.4} />
      </div>
    ),
  },
  {
    value: 'gcv',
    label: 'GCV Pro-rata',
    subtitle: 'Standard calorific value pro-rata formula (Coal)',
    badge: 'GCV',
    icon: (
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          background: 'var(--ios-orange)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#FFFFFF',
          flexShrink: 0,
        }}
      >
        <Flame size={16} strokeWidth={2.4} />
      </div>
    ),
  },
];

function fieldStyle(width?: number | string) {
  return {
    width: width || '100%',
    border: '0.5px solid var(--separator-opaque)',
    background: 'var(--fill-tertiary)',
    color: 'var(--label-primary)',
    borderRadius: 10,
    minHeight: 40,
    padding: '8px 10px',
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box' as const,
  };
}

export default function MaterialSettingsPanel({ settings, onSave }: MaterialSettingsPanelProps) {
  const [materials, setMaterials] = useState<MaterialDefinition[]>(() => normalizeMaterialItems(settings.materialItems));
  const [newMaterialName, setNewMaterialName] = useState('');
  const [newPricingModel, setNewPricingModel] = useState<MaterialPricingModel>('flat');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dbData, setDbData] = useState<{
    dispatches: Dispatch[];
    lots: InventoryLot[];
    pos: PurchaseOrder[];
    parties: Party[];
  } | null>(null);

  useEffect(() => {
    let isCurrent = true;
    Promise.all([
      getDispatches(),
      getLots(),
      getPurchaseOrders(),
      getParties(),
    ]).then(([dispatches, lots, pos, parties]) => {
      if (isCurrent) {
        setDbData({ dispatches, lots, pos, parties });
      }
    }).catch((err) => {
      console.error('[MaterialSettingsPanel] Failed to load data for usage metrics:', err);
    });

    return () => {
      isCurrent = false;
    };
  }, []);

  const usageMap = useMemo<Record<string, MaterialUsage>>(() => {
    if (!dbData) return {};
    const map: Record<string, MaterialUsage> = {};
    for (const mat of materials) {
      const dCount = dbData.dispatches.filter((d) => !d.deleted && (d.itemId || COAL_ITEM_ID) === mat.id).length;
      const lCount = dbData.lots.filter((l) => !l.deleted && (l.itemId || COAL_ITEM_ID) === mat.id).length;
      const poCount = dbData.pos.filter((p) => !p.deleted && (p.itemId || COAL_ITEM_ID) === mat.id).length;
      const partyCount = dbData.parties.filter((p) => !p.deleted && p.materialIds?.includes(mat.id)).length;
      map[mat.id] = {
        total: dCount + lCount + poCount + partyCount,
        dispatches: dCount,
        lots: lCount,
        pos: poCount,
        parties: partyCount,
      };
    }
    return map;
  }, [dbData, materials]);

  const getUsage = (matId: string): MaterialUsage => {
    return usageMap[matId] || { total: 0, dispatches: 0, lots: 0, pos: 0, parties: 0 };
  };

  const updateMaterial = (id: string, patch: Partial<MaterialDefinition>) => {
    setMaterials((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
    setSaved(false);
  };

  const handlePricingModelChange = (id: string, newModel: MaterialPricingModel) => {
    setMaterials((current) => current.map((item) => {
      if (item.id !== id) return item;
      const prevModel = item.pricingModel;
      const wasDefaultLabel = !item.qualityLabel ||
        (prevModel === 'gcv' && item.qualityLabel === 'GCV') ||
        (prevModel === 'purity' && item.qualityLabel === 'Purity') ||
        (prevModel === 'flat' && (item.qualityLabel === 'Quality' || item.qualityLabel === 'Purity'));
      const wasDefaultUnit = !item.qualityUnit ||
        (prevModel === 'gcv' && item.qualityUnit === 'kcal/kg') ||
        ((prevModel === 'purity' || prevModel === 'flat') && item.qualityUnit === '%');

      return {
        ...item,
        pricingModel: newModel,
        qualityLabel: wasDefaultLabel
          ? (newModel === 'gcv' ? 'GCV' : newModel === 'purity' ? 'Purity' : 'Quality')
          : item.qualityLabel,
        qualityUnit: wasDefaultUnit
          ? (newModel === 'gcv' ? 'kcal/kg' : '%')
          : item.qualityUnit,
      };
    }));
    setSaved(false);
  };

  const addMaterial = () => {
    const name = newMaterialName.trim();
    if (!name) return;
    const id = `material-${uuidv4()}`;
    setMaterials((current) => [...current, {
      id,
      name,
      pricingModel: newPricingModel,
      qualityLabel: newPricingModel === 'gcv' ? 'GCV' : newPricingModel === 'purity' ? 'Purity' : 'Quality',
      qualityUnit: newPricingModel === 'gcv' ? 'kcal/kg' : '%',
      defaultRate: 0,
      isActive: true,
    }]);
    setNewMaterialName('');
    setSaved(false);
    playPopSound();
  };

  const persist = async () => {
    setSaving(true);
    try {
      await onSave({
        ...settings,
        materialItems: normalizeMaterialItems(materials),
      });
      setSaved(true);
      playSuccessSound();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: '12px 16px 16px' }}>
      <div style={{ fontSize: 12, color: 'var(--label-secondary)', lineHeight: 1.45, marginBottom: 14 }}>
        Configure raw material definitions, pricing formulas, and quality metrics. Coal uses standard GCV pricing, while other materials support flat per-ton or purity-based pricing.
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--label-secondary)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>
        Materials
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {materials.map((item) => {
          const usage = getUsage(item.id);
          const isDeactivated = item.isActive === false;
          const isInUse = usage.total > 0;
          const isCoal = item.id === COAL_ITEM_ID;

          return (
            <div
              key={item.id}
              style={{
                padding: 12,
                borderRadius: 14,
                background: isDeactivated ? 'var(--fill-tertiary)' : 'var(--fill-quaternary)',
                border: isDeactivated ? '0.5px dashed var(--separator)' : '0.5px solid var(--separator)',
                opacity: isDeactivated ? 0.72 : 1,
                transition: 'opacity 0.2s ease, border 0.2s ease',
              }}
            >
              {/* Header with Title & Usage Badge */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--label-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.name || 'Unnamed Material'}
                  </span>
                  {isCoal ? (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: 'rgba(255, 149, 0, 0.15)', color: 'var(--ios-orange)', flexShrink: 0 }}>
                      Primary
                    </span>
                  ) : null}
                  {isDeactivated && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: 'rgba(255, 59, 48, 0.15)', color: 'var(--ios-red)', flexShrink: 0 }}>
                      Deactivated
                    </span>
                  )}
                </div>

                {/* Usage Badge */}
                {isInUse ? (
                  <span
                    title={`In use: ${[
                      usage.dispatches ? `${usage.dispatches} dispatches` : null,
                      usage.lots ? `${usage.lots} inward batches` : null,
                      usage.pos ? `${usage.pos} PO contracts` : null,
                      usage.parties ? `${usage.parties} suppliers` : null,
                    ].filter(Boolean).join(', ')}`}
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 8,
                      background: 'rgba(0, 122, 255, 0.12)',
                      color: 'var(--ios-blue)',
                      border: '0.5px solid rgba(0, 122, 255, 0.25)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      flexShrink: 0,
                    }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ios-blue)' }} />
                    {usage.total} {usage.total === 1 ? 'record' : 'records'}
                  </span>
                ) : (
                  <span style={{ fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 8, background: 'var(--fill-tertiary)', color: 'var(--label-tertiary)', flexShrink: 0 }}>
                    Unused
                  </span>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 140px', gap: 8 }}>
                <input
                  value={item.name}
                  disabled={isCoal}
                  onChange={(event) => updateMaterial(item.id, { name: event.target.value })}
                  aria-label="Material name"
                  style={{ ...fieldStyle(), opacity: isCoal ? 0.72 : 1 }}
                />
                <IOSSelect<MaterialPricingModel>
                  label="Pricing Model"
                  title={`${item.name} Pricing`}
                  value={item.pricingModel}
                  disabled={isCoal}
                  onChange={(model) => handlePricingModelChange(item.id, model)}
                  options={PRICING_OPTIONS}
                  searchable={false}
                  customTrigger={({ open, displayLabel, isOpen }) => (
                    <button
                      type="button"
                      onClick={open}
                      disabled={isCoal}
                      aria-label={`${item.name} pricing model`}
                      className="ios-select-trigger"
                      style={{
                        ...fieldStyle(),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 4,
                        cursor: isCoal ? 'not-allowed' : 'pointer',
                        opacity: isCoal ? 0.72 : 1,
                        fontFamily: 'inherit',
                        textAlign: 'left',
                      }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: 'var(--label-primary)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {displayLabel || 'Pricing'}
                      </span>
                      <ChevronDown
                        size={14}
                        strokeWidth={2.2}
                        style={{
                          color: 'var(--label-tertiary)',
                          flexShrink: 0,
                          transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                          transition: 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                        }}
                      />
                    </button>
                  )}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 92px 112px', gap: 8, marginTop: 8 }}>
                <input
                  value={item.qualityLabel || ''}
                  onChange={(event) => updateMaterial(item.id, { qualityLabel: event.target.value })}
                  placeholder="Quality label"
                  aria-label={`${item.name} quality label`}
                  style={fieldStyle()}
                />
                <input
                  value={item.qualityUnit || ''}
                  onChange={(event) => updateMaterial(item.id, { qualityUnit: event.target.value })}
                  placeholder="Unit"
                  aria-label={`${item.name} quality unit`}
                  style={fieldStyle()}
                />
                <input
                  type="text"
                  inputMode="decimal"
                  pattern="[0-9.]*"
                  value={item.defaultRate || ''}
                  onKeyDown={(e) => {
                    if (
                      ['Backspace', 'Delete', 'Tab', 'Escape', 'Enter', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) ||
                      e.ctrlKey || e.metaKey
                    ) return;
                    if (e.key >= '0' && e.key <= '9') return;
                    if (e.key === '.' && !e.currentTarget.value.includes('.')) return;
                    e.preventDefault();
                  }}
                  onChange={(event) => {
                    const clean = stripNonNumeric(event.target.value, true, false);
                    updateMaterial(item.id, { defaultRate: clean ? Number(clean) : 0 });
                  }}
                  placeholder={item.pricingModel === 'purity' ? 'Rate/point' : 'Default rate'}
                  aria-label={`${item.name} default rate`}
                  style={fieldStyle()}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 8, borderTop: '0.5px solid var(--separator)' }}>
                <span style={{ fontSize: 11, color: 'var(--label-secondary)', maxWidth: '70%', lineHeight: 1.35 }}>
                  {isDeactivated
                    ? 'Deactivated: hidden from new entries. Existing records retain this material.'
                    : item.pricingModel === 'purity'
                      ? 'Default is copied into new dispatches; old dispatches retain their saved rate.'
                      : 'Material definition is snapshotted when a dispatch is saved.'}
                </span>

                {isCoal ? (
                  <span style={{ fontSize: 12, color: 'var(--label-tertiary)', fontWeight: 600, padding: '4px 6px' }}>
                    Required
                  </span>
                ) : isInUse || item.isSystem ? (
                  <button
                    type="button"
                    onClick={() => {
                      playPopSound();
                      updateMaterial(item.id, { isActive: isDeactivated });
                    }}
                    style={{
                      border: '0.5px solid var(--separator-opaque)',
                      background: isDeactivated ? 'rgba(52, 199, 89, 0.15)' : 'var(--fill-tertiary)',
                      color: isDeactivated ? 'var(--ios-green)' : 'var(--ios-red)',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 650,
                      cursor: 'pointer',
                      padding: '5px 12px',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    {isDeactivated ? 'Reactivate' : 'Deactivate'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      playPopSound();
                      setMaterials((current) => current.filter((candidate) => candidate.id !== item.id));
                      setSaved(false);
                    }}
                    title="Delete unused material"
                    style={{ border: 0, background: 'transparent', color: 'var(--ios-red)', fontSize: 12, fontWeight: 650, cursor: 'pointer', padding: 6 }}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 140px 42px', gap: 8, marginTop: 10 }}>
        <input
          value={newMaterialName}
          onChange={(event) => setNewMaterialName(event.target.value)}
          placeholder="New material name"
          style={fieldStyle()}
        />
        <IOSSelect<MaterialPricingModel>
          label="Pricing Model"
          title="New Material Pricing"
          value={newPricingModel}
          onChange={(model) => setNewPricingModel(model)}
          options={PRICING_OPTIONS}
          searchable={false}
          customTrigger={({ open, displayLabel, isOpen }) => (
            <button
              type="button"
              onClick={open}
              aria-label="New material pricing model"
              className="ios-select-trigger"
              style={{
                ...fieldStyle(),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 4,
                cursor: 'pointer',
                fontFamily: 'inherit',
                textAlign: 'left',
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: 'var(--label-primary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {displayLabel || 'Pricing'}
              </span>
              <ChevronDown
                size={14}
                strokeWidth={2.2}
                style={{
                  color: 'var(--label-tertiary)',
                  flexShrink: 0,
                  transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              />
            </button>
          )}
        />
        <button
          type="button"
          onClick={addMaterial}
          disabled={!newMaterialName.trim()}
          aria-label="Add material"
          style={{
            border: 0,
            borderRadius: 10,
            background: 'var(--ios-blue)',
            color: '#fff',
            cursor: !newMaterialName.trim() ? 'not-allowed' : 'pointer',
            opacity: !newMaterialName.trim() ? 0.5 : 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Plus size={18} />
        </button>
      </div>

      <button
        type="button"
        onClick={() => void persist()}
        disabled={saving}
        className="ios-btn ios-btn-primary"
        style={{ width: '100%', marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
      >
        {saved ? <Check size={17} /> : saving ? <PackagePlus size={17} /> : <PackagePlus size={17} />}
        {saved ? 'Materials Saved' : saving ? 'Saving…' : 'Save Materials'}
      </button>
    </div>
  );
}
