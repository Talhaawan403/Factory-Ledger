import React from 'react';
import type { Payment, Party, AppSettings } from '../types';
import { getCurrencyCode, getCurrencySymbol, formatAmountNumber } from '../utils/currency';
import {
  RECEIPT_COLORS,
  ReceiptDocument,
  ReceiptRow,
  ReceiptSection,
} from './ReceiptDocument';

interface PaymentReceiptProps {
  payment: Payment;
  party?: Party;
  settings?: AppSettings;
  currentBalance?: number;
}

/** Converts a whole amount to the Pakistani business numbering system. */
function numberToWords(num: number): string {
  const rounded = Math.round(Math.abs(num));
  if (rounded === 0) return 'Zero Only';

  const a = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
  ];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function inWords(n: number): string {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 !== 0 ? ` ${a[n % 10]}` : '');
    if (n < 1000) return `${a[Math.floor(n / 100)]} Hundred${n % 100 !== 0 ? ` ${inWords(n % 100)}` : ''}`;
    if (n < 100000) return `${inWords(Math.floor(n / 1000))} Thousand${n % 1000 !== 0 ? ` ${inWords(n % 1000)}` : ''}`;
    if (n < 10000000) return `${inWords(Math.floor(n / 100000))} Lakh${n % 100000 !== 0 ? ` ${inWords(n % 100000)}` : ''}`;
    return `${inWords(Math.floor(n / 10000000))} Crore${n % 10000000 !== 0 ? ` ${inWords(n % 10000000)}` : ''}`;
  }

  return `${inWords(rounded)} Only`;
}

export const PaymentReceipt = React.forwardRef<HTMLDivElement, PaymentReceiptProps>(
  ({ payment, party, settings, currentBalance }, ref) => {
    const isReceived = payment.type === 'received';
    const accentColor = isReceived ? '#047857' : '#B45309';
    const accentTint = isReceived ? '#ECFDF5' : '#FFF7ED';
    const curSym = getCurrencySymbol(settings?.currency);
    const currencyCode = getCurrencyCode(settings?.currency);
    const partyName = party?.name?.trim() || 'Client Account';
    const voucherPrefix = isReceived ? 'RCP' : 'PAY';
    const voucherId = `${voucherPrefix}-${(payment.id || '00000000').slice(0, 8).toUpperCase()}`;
    const balance = currentBalance ?? 0;
    const isSettled = currentBalance !== undefined && Math.abs(balance) < 50;
    const isReceivable = currentBalance !== undefined && balance >= 50;
    const balanceLabel = isSettled
      ? 'Account Settled'
      : isReceivable
        ? 'Receivable Outstanding'
        : 'Advance Credit Held';
    const balanceColor = isSettled ? '#047857' : isReceivable ? '#B91C1C' : '#1D4ED8';

    return (
      <ReceiptDocument
        ref={ref}
        settings={settings}
        kind="payment"
        documentTitle={isReceived ? 'Payment Receipt' : 'Payment Voucher'}
        documentLabel={isReceived ? 'Cash Inflow' : 'Cash Outflow'}
        documentId={voucherId}
        date={payment.date}
        statusLabel={isReceived ? 'Funds Received' : 'Payment Issued'}
        accentColor={accentColor}
        accentTint={accentTint}
        verificationLabel="Ledger Posted"
        footerText="Computer-generated transaction record • Retain for account reconciliation and business audit"
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 16,
            padding: '13px 14px',
            borderRadius: 12,
            border: `1px solid ${RECEIPT_COLORS.line}`,
            backgroundColor: RECEIPT_COLORS.panel,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 8.5, fontWeight: 800, color: RECEIPT_COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.65 }}>
              {isReceived ? 'Received From' : 'Paid To'}
            </div>
            <div style={{ marginTop: 3, fontSize: 16, fontWeight: 850, color: RECEIPT_COLORS.ink, overflowWrap: 'anywhere' }}>
              {partyName}
            </div>
            {party?.contactPerson && (
              <div style={{ marginTop: 3, fontSize: 10, color: RECEIPT_COLORS.secondary }}>
                Contact: {party.contactPerson}
              </div>
            )}
            {party?.phone && (
              <div style={{ marginTop: 2, fontSize: 10, color: RECEIPT_COLORS.secondary }}>
                Tel: {party.phone}
              </div>
            )}
            {party?.address && (
              <div style={{ marginTop: 2, fontSize: 9.5, color: RECEIPT_COLORS.secondary, overflowWrap: 'anywhere' }}>
                {party.address}
              </div>
            )}
          </div>
          <div
            style={{
              flexShrink: 0,
              padding: '5px 8px',
              borderRadius: 7,
              backgroundColor: accentTint,
              color: accentColor,
              fontSize: 8.5,
              fontWeight: 850,
              textTransform: 'uppercase',
              letterSpacing: 0.55,
            }}
          >
            Party Ledger
          </div>
        </div>

        <div
          style={{
            marginTop: 14,
            padding: '17px 18px 16px',
            borderRadius: 14,
            backgroundColor: accentColor,
            color: '#FFFFFF',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 9, fontWeight: 750, textTransform: 'uppercase', letterSpacing: 1.05, opacity: 0.9 }}>
            {isReceived ? 'Amount Received' : 'Amount Paid'}
          </div>
          <div style={{ marginTop: 4, fontSize: 28, lineHeight: 1.15, fontWeight: 900, letterSpacing: -0.7 }}>
            {curSym} {formatAmountNumber(payment.amount, settings)}
          </div>
          <div style={{ marginTop: 5, fontSize: 9.5, lineHeight: 1.35, fontWeight: 600, opacity: 0.95 }}>
            {currencyCode} • {numberToWords(payment.amount)}
          </div>
        </div>

        <ReceiptSection title="Payment Details">
          <ReceiptRow label="Payment Method" value={payment.mode.toUpperCase()} />
          <ReceiptRow label="Reference / Note" value={payment.referenceNote?.trim() || 'Direct settlement'} />
          <ReceiptRow
            label="Ledger Posting"
            value={isReceived ? 'Credit • reduces receivable' : 'Debit • increases receivable'}
            valueColor={accentColor}
          />
        </ReceiptSection>

        {currentBalance !== undefined && (
          <div
            style={{
              marginTop: 14,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 14,
              padding: '12px 13px',
              borderRadius: 11,
              border: `1px solid ${balanceColor}33`,
              backgroundColor: isSettled ? '#ECFDF5' : isReceivable ? '#FEF2F2' : '#EFF6FF',
            }}
          >
            <div>
              <div style={{ fontSize: 8.5, fontWeight: 800, color: RECEIPT_COLORS.secondary, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                Closing Party Balance
              </div>
              <div style={{ marginTop: 3, fontSize: 10.5, fontWeight: 800, color: balanceColor }}>
                {balanceLabel}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 900, color: balanceColor }}>
                {curSym} {formatAmountNumber(Math.abs(balance), settings)}
              </div>
              <div style={{ marginTop: 2, fontSize: 8.5, color: RECEIPT_COLORS.secondary }}>
                after this entry
              </div>
            </div>
          </div>
        )}

        <div
          style={{
            marginTop: 13,
            padding: '9px 11px',
            borderRadius: 9,
            border: `1px solid ${RECEIPT_COLORS.softLine}`,
            backgroundColor: '#FBFCFE',
            fontSize: 9,
            lineHeight: 1.45,
            color: RECEIPT_COLORS.secondary,
          }}
        >
          This document records a {isReceived ? 'receipt from' : 'payment to'} the named party and has been posted to their account ledger.
        </div>
      </ReceiptDocument>
    );
  },
);

PaymentReceipt.displayName = 'PaymentReceipt';
