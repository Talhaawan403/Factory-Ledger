import React from 'react';
import type { Payment, Party, AppSettings } from '../types';
import { getCurrencyCode, getCurrencySymbol, formatAmountNumber } from '../utils/currency';
import { formatDisplayDate } from '../utils/dateUtils';
import {
  RECEIPT_COLORS,
  ReceiptDocument,
  ReceiptHero,
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
export function numberToWords(num: number): string {
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
    const balanceColor = isSettled ? RECEIPT_COLORS.green : isReceivable ? RECEIPT_COLORS.red : RECEIPT_COLORS.blue;

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
        verificationLabel="Ledger Posted"
        footerText="Computer-generated transaction record • Retain for account reconciliation and business audit"
      >
        {/* ─── Grand Hero Amount (Zero Box Enclosure) ─── */}
        <ReceiptHero
          label={isReceived ? 'Amount Received' : 'Amount Paid'}
          amount={`${curSym} ${formatAmountNumber(payment.amount, settings)}`}
          subtitle={numberToWords(payment.amount)}
          accentColor={RECEIPT_COLORS.ink}
        />

        {/* ─── Party / Client Information (Open Lines) ─── */}
        <ReceiptSection title="Party Information">
          <ReceiptRow
            label={isReceived ? 'Received From' : 'Paid To'}
            value={partyName}
            strong
          />
          {party?.contactPerson && (
            <ReceiptRow
              label="Contact"
              value={party.contactPerson}
              labelColor={RECEIPT_COLORS.muted}
              valueColor={RECEIPT_COLORS.secondary}
            />
          )}
          {party?.phone && (
            <ReceiptRow
              label="Telephone"
              value={party.phone}
              labelColor={RECEIPT_COLORS.muted}
              valueColor={RECEIPT_COLORS.secondary}
            />
          )}
          {party?.address && (
            <ReceiptRow
              label="Address"
              value={party.address}
              labelColor={RECEIPT_COLORS.muted}
              valueColor={RECEIPT_COLORS.secondary}
            />
          )}
        </ReceiptSection>

        {/* ─── Payment Details (Open Lines) ─── */}
        <ReceiptSection title="Payment Details">
          <ReceiptRow
            label="Accounting Entry"
            value={isReceived ? 'Credit • reduces receivable' : 'Debit • increases receivable'}
            valueColor={isReceived ? RECEIPT_COLORS.green : RECEIPT_COLORS.orange}
            strong
          />
          <ReceiptRow
            label="Payment Mode"
            value={
              <span style={{ textTransform: 'uppercase', fontWeight: 600 }}>
                {payment.mode}
              </span>
            }
          />
          {payment.referenceNote?.trim() && (
            <ReceiptRow
              label="Payment Reference"
              value={payment.referenceNote.trim()}
            />
          )}
          <ReceiptRow
            label="Transaction Date"
            value={formatDisplayDate(payment.date) || 'Not recorded'}
          />
          <ReceiptRow
            label="Transaction ID"
            value={voucherId}
            valueColor={RECEIPT_COLORS.secondary}
          />
          <ReceiptRow
            label="Currency"
            value={`${currencyCode} (${curSym})`}
          />
        </ReceiptSection>

        {/* ─── Party Account Position (Open Lines) ─── */}
        {currentBalance !== undefined && (
          <ReceiptSection title="Party Account Position">
            <ReceiptRow
              label={balanceLabel}
              value={`${curSym} ${formatAmountNumber(Math.abs(balance), settings)}`}
              valueColor={balanceColor}
              strong
            />
          </ReceiptSection>
        )}
      </ReceiptDocument>
    );
  }
);

PaymentReceipt.displayName = 'PaymentReceipt';
