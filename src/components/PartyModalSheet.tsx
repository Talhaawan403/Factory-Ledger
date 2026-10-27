import React, { useState, useEffect } from 'react';
import {
  Building2,
  X,
  Store,
  Layers,
  Check,
  Pickaxe,
  UserPlus,
  ShieldCheck,
} from 'lucide-react';
import { playPopSound } from '../utils/delight';
import { getSettings } from '../lib/db';
import { getMaterialItems, getMaterialBadgeTheme, COAL_ITEM_ID } from '../utils/materials';
import type { AppSettings, MaterialDefinition } from '../types';
import FloatingField from './FloatingField';

interface PartyModalSheetProps {
  isOpen: boolean;
  mode: 'add' | 'edit';
  initialData?: {
    name: string;
    contactPerson?: string;
    phone?: string;
    address?: string;
    type?: 'buyer' | 'supplier';
    materialIds?: string[];
    isDirectMine?: boolean;
    linkedMineId?: string;
  };
  settings?: AppSettings;
  onClose: () => void;
  onSave: (data: {
    name: string;
    contactPerson: string;
    phone: string;
    address: string;
    type: 'buyer' | 'supplier';
    materialIds?: string[];
  }) => void;
}

export default function PartyModalSheet({
  isOpen,
  mode,
  initialData,
  settings,
  onClose,
  onSave,
}: PartyModalSheetProps) {
  if (!isOpen) return null;

  return (
    <PartyModalContent
      key={mode === 'edit' ? `${initialData?.name || 'edit'}_${initialData?.type || 'buyer'}` : 'add'}
      mode={mode}
      initialData={initialData}
      settings={settings}
      onClose={onClose}
      onSave={onSave}
    />
  );
}

function PartyModalContent({
  mode,
  initialData,
  settings: propSettings,
  onClose,
  onSave,
}: Omit<PartyModalSheetProps, 'isOpen'>) {
  const [name, setName] = useState(initialData?.name || '');
  const [contactPerson, setContactPerson] = useState(initialData?.contactPerson || '');
  const [phone, setPhone] = useState(initialData?.phone || '');
  const [address, setAddress] = useState(initialData?.address || '');
  const [partyType, setPartyType] = useState<'buyer' | 'supplier'>(initialData?.type || 'buyer');
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<string[]>(
    initialData?.materialIds && initialData.materialIds.length > 0
      ? initialData.materialIds
      : [COAL_ITEM_ID]
  );
  const [availableMaterials, setAvailableMaterials] = useState<MaterialDefinition[]>([]);

  useEffect(() => {
    if (propSettings) {
      setAvailableMaterials(getMaterialItems(propSettings, true));
    } else {
      getSettings().then((s) => {
        setAvailableMaterials(getMaterialItems(s, true));
      });
    }
  }, [propSettings]);

  const isValid = name.trim().length > 0;

  const toggleMaterial = (matId: string) => {
    setSelectedMaterialIds((prev) => {
      if (prev.includes(matId)) {
        if (prev.length === 1) return prev;
        return prev.filter((id) => id !== matId);
      } else {
        return [...prev, matId];
      }
    });
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isValid) return;
    onSave({
      name: name.trim(),
      contactPerson: contactPerson.trim() || name.trim(),
      phone: phone.trim(),
      address: address.trim(),
      type: partyType,
      materialIds:
        partyType === 'supplier'
          ? selectedMaterialIds.length > 0
            ? selectedMaterialIds
            : [COAL_ITEM_ID]
          : undefined,
    });
  };

  // Monogram initials
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');

  const isBuyer = partyType === 'buyer';

  return (
    <>
      {/* ── Apple Dimmed Blur Backdrop ── */}
      <div className="ios-modal-backdrop" onClick={onClose} />

      {/* ── Modal Dialog / Bottom Sheet ── */}
      <div className="ios-bottom-sheet party-modal-container" role="dialog" aria-modal="true">
        {/* Grabber Handle for mobile swipe hint */}
        <div className="ios-sheet-handle sm:hidden" />

        {/* ── Modal Header ── */}
        <div className="party-modal-header">
          <div className="party-modal-header-left">
            <div className={`party-modal-badge ${isBuyer ? 'is-buyer' : 'is-supplier'}`}>
              {initials ? initials : isBuyer ? <Building2 size={20} /> : <Store size={20} />}
            </div>
            <div>
              <div className="party-modal-title">
                {mode === 'add' ? 'New Party Profile' : 'Edit Party Profile'}
              </div>
              <div className="party-modal-subtitle">
                {isBuyer
                  ? 'Customer Account · Sales & Invoices'
                  : 'Vendor Profile · Purchases & Inward Stock'}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="party-modal-close-btn"
          >
            <X size={16} strokeWidth={2.4} />
          </button>
        </div>

        {/* ── Modal Form Body ── */}
        <form onSubmit={handleSubmit} className="party-modal-body">
          {/* ── Party Role / Type Selector ── */}
          <div className="party-form-field">
            <div className="party-field-label">ACCOUNT TYPE / ROLE</div>
            <div className="party-type-grid">
              <button
                type="button"
                onClick={() => {
                  playPopSound();
                  setPartyType('buyer');
                }}
                className={`party-type-card ${isBuyer ? 'active-buyer' : ''}`}
              >
                <div className="party-type-icon buyer-icon">
                  <Building2 size={18} strokeWidth={2.2} />
                </div>
                <div className="party-type-text">
                  <div className="party-type-name">Buyer</div>
                  <div className="party-type-desc">Purchases Material / owes payment</div>
                </div>
                {isBuyer && <Check size={16} strokeWidth={2.6} className="party-type-check" />}
              </button>

              <button
                type="button"
                onClick={() => {
                  playPopSound();
                  setPartyType('supplier');
                }}
                className={`party-type-card ${!isBuyer ? 'active-supplier' : ''}`}
              >
                <div className="party-type-icon supplier-icon">
                  <Store size={18} strokeWidth={2.2} />
                </div>
                <div className="party-type-text">
                  <div className="party-type-name">Supplier</div>
                  <div className="party-type-desc">Supplies material / vendor</div>
                </div>
                {!isBuyer && <Check size={16} strokeWidth={2.6} className="party-type-check" />}
              </button>
            </div>
          </div>

          {/* ── Company / Party Name ── */}
          <FloatingField
            label="Company / Party Name *"
            value={name}
            onChange={setName}
            required
            autoFocus={mode === 'add'}
            placeholder="e.g. Lucky Cement Ltd, Star Coal Traders"
          />

          {Boolean(initialData?.isDirectMine || initialData?.linkedMineId) && (
            <div
              style={{
                fontSize: 12,
                color: 'var(--label-secondary)',
                marginTop: -8,
                marginBottom: 14,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 10px',
                borderRadius: 8,
                background: 'rgba(0, 122, 255, 0.08)',
                border: '1px solid rgba(0, 122, 255, 0.18)',
              }}
            >
              <ShieldCheck size={14} color="var(--ios-blue)" style={{ flexShrink: 0 }} />
              <span>Direct Mine Supplier: Linked to mine origin. Managed via Mine Ledger.</span>
            </div>
          )}

          {/* ── Contact Person & Phone (2 Columns on Desktop) ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3">
            <FloatingField
              label="Contact Person"
              value={contactPerson}
              onChange={setContactPerson}
              placeholder="e.g. Tariq Mehmood (Manager)"
            />
            <FloatingField
              label="Phone / WhatsApp"
              type="tel"
              value={phone}
              onChange={setPhone}
              placeholder="e.g. 0300-1234567"
            />
          </div>

          {/* ── Address ── */}
          <FloatingField
            label="Office or Delivery Address"
            value={address}
            onChange={setAddress}
            placeholder="e.g. Plot 42, Industrial Zone, Quetta"
          />

          {/* ── Supplied Commodities (Suppliers only) ── */}
          {!isBuyer && (
            <div className="party-form-field">
              <div className="party-field-label">
                <span>SUPPLIED COMMODITIES & MATERIALS</span>
              </div>

              {Boolean(initialData?.isDirectMine || initialData?.linkedMineId) ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 14px',
                    borderRadius: 12,
                    background: 'rgba(0, 122, 255, 0.08)',
                    border: '1px solid rgba(0, 122, 255, 0.22)',
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: 'rgba(0, 122, 255, 0.16)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--ios-blue)',
                      flexShrink: 0,
                    }}
                  >
                    <Pickaxe size={16} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--label-primary)' }}>
                      Direct Mine Commodity (Bound)
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--label-secondary)', marginTop: 2 }}>
                      This profile is linked to {initialData?.name || 'the mine'} directly. Material commodity is managed by the mine.
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {availableMaterials.map((mat) => {
                    const isSelected = selectedMaterialIds.includes(mat.id);
                    const theme = getMaterialBadgeTheme(mat.id);
                    return (
                      <button
                        key={mat.id}
                        type="button"
                        onClick={() => {
                          playPopSound();
                          toggleMaterial(mat.id);
                        }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '7px 12px',
                          borderRadius: 20,
                          fontSize: 12.5,
                          fontWeight: isSelected ? 650 : 500,
                          border: isSelected
                            ? `1.5px solid ${theme.dot || '#007AFF'}`
                            : '1px solid var(--separator)',
                          background: isSelected
                            ? theme.bg || 'rgba(0,122,255,0.12)'
                            : 'var(--fill-quaternary)',
                          color: isSelected
                            ? theme.color || 'var(--ios-blue)'
                            : 'var(--label-primary)',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {isSelected ? (
                          <Check size={13} strokeWidth={2.8} />
                        ) : (
                          <Layers size={13} strokeWidth={1.8} style={{ opacity: 0.6 }} />
                        )}
                        <span>{mat.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </form>

        {/* ── Modal Sticky Action Footer ── */}
        <div className="party-modal-footer">
          <button type="button" onClick={onClose} className="party-btn-secondary">
            Cancel
          </button>
          <button
            type="button"
            disabled={!isValid}
            onClick={() => handleSubmit()}
            className={`party-btn-primary ${isBuyer ? 'is-buyer' : 'is-supplier'}`}
          >
            {mode === 'add' ? (
              <>
                <UserPlus size={16} strokeWidth={2.4} />
                <span>Add Party Profile</span>
              </>
            ) : (
              <>
                <Check size={16} strokeWidth={2.8} />
                <span>Save Changes</span>
              </>
            )}
          </button>
        </div>
      </div>
    </>
  );
}
