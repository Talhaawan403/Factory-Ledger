import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DispatchReceipt } from '../src/components/DispatchReceipt';
import { PaymentReceipt } from '../src/components/PaymentReceipt';
import type { AppSettings, Dispatch, Party, Payment } from '../src/types';

const settings: AppSettings = {
  userName: 'Demo Trader',
  businessName: 'Indus Coal Traders & Logistics',
  phoneNumber: '0300-1234567',
  logoUrl: '',
  theme: 'light',
  currency: 'PKR',
  numberFormat: 'lakh',
  accountType: 'Commercial Coal Trader',
  companyAddress: 'Coal Logistics Plaza, Quetta',
  ntnNumber: '7829104-5',
};

const party: Party = {
  id: 'party-1',
  name: 'Frontier Cement Works',
  contactPerson: 'Accounts Office',
  phone: '0301-1112233',
  address: 'Industrial Estate, Hattar',
  createdAt: 1,
};

function dispatch(overrides: Partial<Dispatch> = {}): Dispatch {
  return {
    id: 'dispatch-abcd1234',
    partyId: party.id,
    date: '2026-10-11',
    truckNumber: 'TKA-908',
    factoryName: party.name,
    targetGcv: 4500,
    baseRate: 38000,
    coalInputs: [{ id: 'coal-1', sourceName: 'Chamalang Main', weight: 40, purchaseRate: 30000 }],
    overheads: { loading: 3000, freight: 90000, crush: 0, royalty: 0, other: 0 },
    labActualGcv: 4475,
    labSulphur: 1.1,
    labReceivedWeight: 39.25,
    manualTax: 500,
    manualDeduction: 250,
    manualPremium: 0,
    taxMethod: 'manual',
    commissionPerTon: 100,
    status: 'settled',
    settledDate: '2026-10-12',
    settledAt: 2,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'payment-12345678',
    partyId: party.id,
    date: '2026-10-11',
    amount: 1250000,
    type: 'received',
    mode: 'bank',
    referenceNote: 'HBL transfer 7812',
    createdAt: 1,
    ...overrides,
  };
}

describe('receipt image documents', () => {
  it('renders a settled dispatch as a human-readable factory settlement receipt', () => {
    const html = renderToStaticMarkup(
      <DispatchReceipt dispatch={dispatch()} party={party} settings={settings} />,
    );

    expect(html).toContain('data-receipt-version="2"');
    expect(html).toContain('Settlement Receipt');
    expect(html).toContain('Factory Settled');
    expect(html).toContain('OCT 11, 2026');
    expect(html).toContain('TKA-908');
    expect(html).toContain('Total Settlement Revenue');
    expect(html).toContain('Factory settlement date');
  });

  it('makes pending dispatch revenue recognition explicit', () => {
    const html = renderToStaticMarkup(
      <DispatchReceipt
        dispatch={dispatch({ status: 'pending', settledDate: undefined, settledAt: undefined, labActualGcv: 0, labReceivedWeight: 0 })}
        party={party}
        settings={settings}
      />,
    );

    expect(html).toContain('Dispatch Advice');
    expect(html).toContain('Revenue Pending');
    expect(html).toContain('Revenue Not Yet Recognized');
    expect(html).toContain('cost already posted to books');
    expect(html).not.toContain('Total Settlement Revenue');
  });

  it('renders Laterite purity terms from the saved dispatch snapshot', () => {
    const html = renderToStaticMarkup(
      <DispatchReceipt
        dispatch={dispatch({
          itemId: 'material-laterite',
          itemName: 'Laterite',
          pricingModel: 'purity',
          qualityLabel: 'Purity',
          qualityUnit: '%',
          ratePerQualityUnit: 116,
          receivedQuality: 30,
          baseRate: 3480,
          labActualGcv: 0,
          labSulphur: 0,
          coalInputs: [{ id: 'source-1', sourceName: 'Laterite Supplier', weight: 40, purchaseRate: 2500 }],
        })}
        party={party}
        settings={settings}
      />,
    );

    expect(html).toContain('Laterite Dispatch');
    expect(html).toContain('Factory received Purity');
    expect(html).toContain('30 %');
    expect(html).toContain('Rate per Purity point');
    expect(html).toContain('PKR 116.00');
    expect(html).toContain('Purity-derived rate');
    expect(html).toContain('PKR 3,480.00 / ton');
    expect(html).not.toContain('Actual GCV');
  });

  it('labels incoming payments and positive closing balances correctly', () => {
    const html = renderToStaticMarkup(
      <PaymentReceipt payment={payment()} party={party} settings={settings} currentBalance={50000} />,
    );

    expect(html).toContain('Payment Receipt');
    expect(html).toContain('Cash Inflow');
    expect(html).toContain('Credit • reduces receivable');
    expect(html).toContain('Receivable Outstanding');
    expect(html).toContain('PKR 1,250,000');
    expect(html).toContain('OCT 11, 2026');
  });

  it('labels outgoing payments as debits and negative balances as advance credit', () => {
    const html = renderToStaticMarkup(
      <PaymentReceipt
        payment={payment({ type: 'paid', mode: 'cash', amount: 25000 })}
        party={party}
        settings={settings}
        currentBalance={-25000}
      />,
    );

    expect(html).toContain('Payment Voucher');
    expect(html).toContain('Cash Outflow');
    expect(html).toContain('Debit • increases receivable');
    expect(html).toContain('Advance Credit Held');
    expect(html).not.toContain('Coal Account Ledger Credit');
  });

  it('writes large rupee values using crore and lakh wording', () => {
    const html = renderToStaticMarkup(
      <PaymentReceipt payment={payment({ amount: 12500000 })} party={party} settings={settings} />,
    );

    expect(html).toContain('One Crore Twenty Five Lakh Only');
  });
});
