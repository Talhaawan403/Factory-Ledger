import { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Check, ChevronDown, Flame, Layers, PackagePlus, Percent, Plus, Trash2 } from 'lucide-react';
import type { AppSettings, MaterialDefinition, MaterialPricingModel } from '../types';
import { normalizeMaterialItems } from '../utils/materials';
import { playPopSound, playSuccessSound } from '../utils/delight';
import IOSSelect, { type IOSSelectOption } from './IOSSelect';
import { stripNonNumeric } from '../utils/numberFormat';

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
        {materials.map((item) => (
          <div key={item.id} style={{ padding: 12, borderRadius: 14, background: 'var(--fill-quaternary)', border: '0.5px solid var(--separator)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 140px', gap: 8 }}>
              <input
                value={item.name}
                disabled={item.id === 'material-coal'}
                onChange={(event) => updateMaterial(item.id, { name: event.target.value })}
                aria-label="Material name"
                style={{ ...fieldStyle(), opacity: item.id === 'material-coal' ? 0.72 : 1 }}
              />
              <IOSSelect<MaterialPricingModel>
                label="Pricing Model"
                title={`${item.name} Pricing`}
                value={item.pricingModel}
                disabled={item.id === 'material-coal'}
                onChange={(model) => handlePricingModelChange(item.id, model)}
                options={PRICING_OPTIONS}
                searchable={false}
                customTrigger={({ open, displayLabel, isOpen }) => (
                  <button
                    type="button"
                    onClick={open}
                    disabled={item.id === 'material-coal'}
                    aria-label={`${item.name} pricing model`}
                    className="ios-select-trigger"
                    style={{
                      ...fieldStyle(),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 4,
                      cursor: item.id === 'material-coal' ? 'not-allowed' : 'pointer',
                      opacity: item.id === 'material-coal' ? 0.72 : 1,
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--label-secondary)' }}>
                {item.pricingModel === 'purity' ? 'Default is copied into new dispatches; old dispatches retain their saved rate.' : 'Material definition is snapshotted when a dispatch is saved.'}
              </span>
              <button
                type="button"
                onClick={() => item.isSystem
                  ? updateMaterial(item.id, { isActive: item.isActive === false })
                  : setMaterials((current) => current.filter((candidate) => candidate.id !== item.id))}
                style={{ border: 0, background: 'transparent', color: item.isSystem ? 'var(--ios-blue)' : 'var(--ios-red)', fontSize: 12, fontWeight: 650, cursor: 'pointer', padding: 6 }}
              >
                {item.isSystem ? (item.isActive === false ? 'Enable' : 'Disable') : <Trash2 size={16} />}
              </button>
            </div>
          </div>
        ))}
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
