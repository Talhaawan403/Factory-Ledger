import React from 'react';
import type { InventoryLot, Party, AppSettings } from '../types';
import { getCurrencySymbol, formatAmountNumber } from '../utils/currency';
import { formatDisplayDate } from '../utils/dateUtils';
import {
  ReceiptDocument,
  ReceiptHero,
  ReceiptRow,
  ReceiptSection,
  RECEIPT_COLORS,
} from './ReceiptDocument';

interface SupplierDeliveryReceiptProps {
  lot: InventoryLot;
  party?: Party;
  settings?: AppSettings;
}

const SUPPLIER_ACCENT = '#FF9500'; // iOS System Orange
const SUPPLIER_TINT = 'rgba(255, 149, 0, 0.12)';

export const SupplierDeliveryReceipt = React.forwardRef<HTMLDivElement, SupplierDeliveryReceiptProps>(
  ({ lot, party, settings }, ref) => {
    const businessName = settings?.businessName?.trim() || 'Factory Ledger';
    const supplierName = party?.name || lot.supplier || lot.boughtFrom || 'Supplier / Mine';
    const currency = getCurrencySymbol(settings?.currency);
    const voucherId = `INW-${(lot.id || '00000000').slice(0, 8).toUpperCase()}`;

    const weight = Number(lot.receivedWeight || lot.billedWeight || lot.tonnage || 0);
    const rate = Number(lot.purchaseRate || lot.ratePerTon || 0);
    const freight = Number(lot.freightCost || 0);
    const materialCost = weight * rate;
    const totalAmount = lot.totalValue !== undefined ? Number(lot.totalValue) : materialCost + freight;
    const landedRate = weight > 0 ? (lot.landedRate || totalAmount / weight) : rate;

    const money = (amount: number, decimals = 0) => `${currency} ${formatAmountNumber(amount, settings, decimals)}`;

    return (
      <ReceiptDocument
        ref={ref}
        settings={settings}
        kind="dispatch"
        documentTitle="Goods Received Note"
        documentLabel={lot.itemName ? `Raw Material Inward: ${lot.itemName}` : "Raw Material Inward"}
        documentId={voucherId}
        date={lot.date}
        statusLabel="Received into Stock"
        accentColor={SUPPLIER_ACCENT}
        accentTint={SUPPLIER_TINT}
        verificationLabel="Verified Inward Goods Receipt"
        footerText={`Generated electronically by ${businessName} • Retain with weighbridge delivery ticket and gate register`}
      >
        {/* ─── Apple Wallet Hero Amount Banner ─── */}
        <ReceiptHero
          label="Total Inward Payable"
          amount={money(totalAmount, 0)}
          subtitle={`${weight.toFixed(2)} tons landed @ ${money(landedRate, 2)} per ton`}
          accentColor={RECEIPT_COLORS.ink}
        />

        {/* ─── Supplier & Logistics (Apple Inset Group) ─── */}
        <ReceiptSection title="Supplier and Logistics">
          <ReceiptRow
            label="Supplier / Source"
            value={supplierName}
            strong
          />
          {(party?.contactPerson || party?.phone) && (
            <ReceiptRow
              label="Contact"
              value={[party.contactPerson, party.phone].filter(Boolean).join(' • ')}
              labelColor={RECEIPT_COLORS.muted}
              valueColor={RECEIPT_COLORS.secondary}
            />
          )}
          <ReceiptRow
            label="Vehicle / Truck No"
            value={lot.truckNumber || 'N/A'}
            strong
          />
          {lot.itemName && (
            <ReceiptRow
              label="Commodity"
              value={lot.itemName}
            />
          )}
          {lot.grade && (
            <ReceiptRow
              label="Quality / Purity"
              value={lot.grade}
            />
          )}
          {(lot.mineName || lot.mineSource) && (
            <ReceiptRow
              label="Pit / Quarry"
              value={lot.mineName || lot.mineSource}
            />
          )}
          {lot.storedAt && (
            <ReceiptRow
              label="Storage Yard"
              value={lot.storedAt}
            />
          )}
          <ReceiptRow
            label="Inward Date"
            value={formatDisplayDate(lot.date) || 'Not recorded'}
          />
        </ReceiptSection>

        {/* ─── Delivery Breakdown & Landed Value (Apple Inset Group) ─── */}
        <ReceiptSection title="Delivery Breakdown & Landed Value">
          <ReceiptRow
            label="Received Weight"
            value={`${weight.toFixed(2)} tons`}
            strong
          />
          <ReceiptRow
            label="Purchase Rate"
            value={`${money(rate, 0)} / ton`}
          />
          <ReceiptRow
            label="Material Cost"
            value={money(materialCost, 0)}
          />
          {freight > 0 && (
            <ReceiptRow
              label="Freight / Transport Fare"
              value={money(freight, 0)}
            />
          )}
          <ReceiptRow
            label="Total Inward Payable"
            value={money(totalAmount, 0)}
            strong
            valueColor={SUPPLIER_ACCENT}
          />
          <ReceiptRow
            label="Final Landed Rate"
            value={`${money(landedRate, 2)} / ton`}
            strong
            backgroundColor="#F2F2F7"
          />
        </ReceiptSection>

        {lot.notes?.trim() && (
          <div
            style={{
              marginTop: 12,
              padding: '10px 14px',
              borderRadius: 10,
              backgroundColor: '#F9F9FB',
              border: `1px solid ${RECEIPT_COLORS.line}`,
              fontSize: 11,
              color: RECEIPT_COLORS.secondary,
              overflowWrap: 'anywhere',
            }}
          >
            <strong style={{ color: RECEIPT_COLORS.ink, fontWeight: 600 }}>Remarks:</strong> {lot.notes.trim()}
          </div>
        )}
      </ReceiptDocument>
    );
  }
);

SupplierDeliveryReceipt.displayName = 'SupplierDeliveryReceipt';

