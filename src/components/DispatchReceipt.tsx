import React from 'react';
import type { Dispatch, Party, PurchaseOrder, AppSettings } from '../types';
import { calculateSettlement, getEffectiveAdjustments, isDispatchPending } from '../utils/calculations';
import { getCurrencySymbol, formatAmountNumber } from '../utils/currency';
import { formatDisplayDate } from '../utils/dateUtils';
import {
  ReceiptDocument,
  ReceiptMetric,
  ReceiptRow,
  ReceiptSection,
  RECEIPT_COLORS,
} from './ReceiptDocument';

interface DispatchReceiptProps {
  dispatch: Dispatch;
  party?: Party;
  po?: PurchaseOrder;
  settings?: AppSettings;
}

const DISPATCH_ACCENT = '#155E8B';
const DISPATCH_TINT = '#E7F2F8';

export const DispatchReceipt = React.forwardRef<HTMLDivElement, DispatchReceiptProps>(
  ({ dispatch, party, po, settings }, ref) => {
    const settlement = calculateSettlement(dispatch, settings);
    const adjustments = getEffectiveAdjustments(dispatch, settings);
    const pending = isDispatchPending(dispatch);
    const businessName = settings?.businessName?.trim() || 'AWAN COAL LOGISTICS';
    const factoryName = party?.name || dispatch.factoryName || 'Factory Client';
    const currency = getCurrencySymbol(settings?.currency);
    const salesPercent = dispatch.taxSalesPercent ?? settings?.taxFormulaSalesPercent ?? 18;
    const incomePercent = dispatch.taxIncomePercent ?? settings?.taxFormulaIncomePercent ?? 5;
    const voucherId = `DSP-${(dispatch.id || '00000000').slice(0, 8).toUpperCase()}`;
    const totalLoaded = (dispatch.coalInputs || []).reduce((sum, input) => sum + (Number(input.weight) || 0), 0);
    const receivedWeight = Number(dispatch.labReceivedWeight) || 0;
    const weightDifference = receivedWeight - totalLoaded;
    const sourceNames = Array.from(new Set(
      (dispatch.coalInputs || []).map((input) => input.sourceName?.trim()).filter(Boolean)
    ));
    const sourceSummary = sourceNames.length === 0
      ? 'Manual coal source'
      : sourceNames.length <= 2
        ? sourceNames.join(' + ')
        : `${sourceNames.slice(0, 2).join(' + ')} + ${sourceNames.length - 2} more`;
    const money = (amount: number, decimals = 0) => `${currency} ${formatAmountNumber(amount, settings, decimals)}`;

    return (
      <ReceiptDocument
        ref={ref}
        settings={settings}
        kind="dispatch"
        documentTitle={pending ? 'Dispatch Advice' : 'Settlement Receipt'}
        documentLabel="Coal Dispatch"
        documentId={voucherId}
        date={dispatch.date}
        statusLabel={pending ? 'Revenue Pending' : 'Factory Settled'}
        accentColor={DISPATCH_ACCENT}
        accentTint={DISPATCH_TINT}
        verificationLabel={pending ? 'Recorded Dispatch Voucher' : 'Verified Settlement Voucher'}
        footerText={`Generated electronically by ${businessName} • Retain with the factory weighbridge and laboratory record`}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 128px',
            gap: 14,
            padding: '14px 15px',
            borderRadius: 12,
            border: `1px solid ${RECEIPT_COLORS.line}`,
            backgroundColor: '#F7F9FC',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 8.5, fontWeight: 800, color: RECEIPT_COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.6 }}>
              Factory / Consignee
            </div>
            <div style={{ marginTop: 3, fontSize: 15.5, fontWeight: 850, color: RECEIPT_COLORS.ink, lineHeight: 1.2 }}>
              {factoryName}
            </div>
            {(party?.contactPerson || party?.phone) && (
              <div style={{ marginTop: 4, fontSize: 9.5, color: RECEIPT_COLORS.secondary }}>
                {[party.contactPerson, party.phone].filter(Boolean).join(' • ')}
              </div>
            )}
            <div style={{ marginTop: 5, fontSize: 9.5, color: RECEIPT_COLORS.secondary, overflowWrap: 'anywhere' }}>
              <strong style={{ color: RECEIPT_COLORS.ink }}>Coal source:</strong> {sourceSummary}
            </div>
            {po?.poNumber && (
              <div style={{ marginTop: 2, fontSize: 9.5, color: RECEIPT_COLORS.secondary }}>
                <strong style={{ color: RECEIPT_COLORS.ink }}>Purchase order:</strong> {po.poNumber}
              </div>
            )}
          </div>

          <div
            style={{
              alignSelf: 'stretch',
              padding: '11px 10px',
              borderRadius: 10,
              backgroundColor: '#FFFFFF',
              border: `1px solid ${RECEIPT_COLORS.line}`,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 8, fontWeight: 800, color: RECEIPT_COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.55 }}>
              Truck Number
            </div>
            <div style={{ marginTop: 6, fontSize: 17, fontWeight: 900, color: DISPATCH_ACCENT, letterSpacing: 0.35, overflowWrap: 'anywhere' }}>
              {dispatch.truckNumber || 'Not recorded'}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginTop: 10 }}>
          <ReceiptMetric label="Loaded Weight" value={`${totalLoaded.toFixed(2)} t`} detail="Dispatch scale" />
          <ReceiptMetric
            label="Received Weight"
            value={pending ? 'Pending' : `${receivedWeight.toFixed(2)} t`}
            detail={pending ? 'Factory weighbridge' : 'Factory accepted'}
          />
          <ReceiptMetric
            label="Actual GCV"
            value={pending || !dispatch.labActualGcv ? 'Pending' : `${dispatch.labActualGcv}`}
            detail={`Target ${dispatch.targetGcv || 0} kcal/kg`}
          />
        </div>

        {pending ? (
          <div
            style={{
              marginTop: 14,
              padding: '11px 12px',
              borderRadius: 10,
              border: '1px solid #F4C98B',
              backgroundColor: '#FFF8EB',
              color: '#8A4B08',
              fontSize: 10,
              lineHeight: 1.45,
            }}
          >
            <strong>Settlement is pending.</strong> Dispatch cost is recorded in the books, but revenue remains unrecognized until the factory confirms received weight, laboratory quality and the final payable rate.
          </div>
        ) : (
          <ReceiptSection title="Delivery and Laboratory Result">
            <ReceiptRow label="Loaded dispatch weight" value={`${totalLoaded.toFixed(2)} tons`} />
            <ReceiptRow label="Factory received weight" value={`${receivedWeight.toFixed(2)} tons`} strong />
            {totalLoaded > 0 && Math.abs(weightDifference) >= 0.01 && (
              <ReceiptRow
                label={`Transit ${weightDifference < 0 ? 'shortage' : 'gain'}`}
                value={`${weightDifference >= 0 ? '+' : ''}${weightDifference.toFixed(2)} tons (${((Math.abs(weightDifference) / totalLoaded) * 100).toFixed(1)}%)`}
                labelColor={weightDifference < 0 ? '#B42318' : '#087443'}
                valueColor={weightDifference < 0 ? '#B42318' : '#087443'}
              />
            )}
            <ReceiptRow label="Target GCV" value={`${dispatch.targetGcv || 0} kcal/kg`} />
            <ReceiptRow
              label="Actual laboratory GCV"
              value={`${dispatch.labActualGcv || 0} kcal/kg${dispatch.targetGcv ? ` (${dispatch.labActualGcv >= dispatch.targetGcv ? '+' : ''}${dispatch.labActualGcv - dispatch.targetGcv})` : ''}`}
              valueColor={dispatch.targetGcv && dispatch.labActualGcv < dispatch.targetGcv ? '#B42318' : '#087443'}
            />
            <ReceiptRow label="Sulphur" value={dispatch.labSulphur ? `${dispatch.labSulphur}%` : 'Standard'} />
            {Boolean(dispatch.labAsh && dispatch.labAsh > 0) && <ReceiptRow label="Ash" value={`${dispatch.labAsh}%`} />}
            {Boolean(dispatch.labMoisture && dispatch.labMoisture > 0) && <ReceiptRow label="Moisture" value={`${dispatch.labMoisture}%`} />}
            {Boolean(dispatch.labVm && dispatch.labVm > 0) && <ReceiptRow label="Volatile matter (VM)" value={`${dispatch.labVm}%`} />}
            {dispatch.settledDate && (
              <ReceiptRow label="Factory settlement date" value={formatDisplayDate(dispatch.settledDate)} />
            )}
          </ReceiptSection>
        )}

        <ReceiptSection title={pending ? 'Contract Terms' : 'Rate and Settlement Breakdown'}>
          <ReceiptRow label="Contract base rate" value={`${money(dispatch.baseRate || 0, 2)} / ton`} />
          {!pending && adjustments.deduction > 0 && (
            <ReceiptRow
              label={`GCV quality deduction${adjustments.isProrata ? ` • ${adjustments.ruleLabel}` : ''}`}
              value={`− ${money(adjustments.deduction, 2)} / ton`}
              labelColor="#B42318"
              valueColor="#B42318"
            />
          )}
          {!pending && adjustments.premium > 0 && (
            <ReceiptRow
              label={`Quality premium${adjustments.isProrata ? ` • ${adjustments.ruleLabel}` : ''}`}
              value={`+ ${money(adjustments.premium, 2)} / ton`}
              labelColor="#087443"
              valueColor="#087443"
            />
          )}
          {!pending && settlement.taxDeduction > 0 && (
            <ReceiptRow
              label={`Tax withholding${dispatch.taxMethod === 'formula_18_5' ? ` • (rate + ${salesPercent}%) × ${incomePercent}%` : ''}`}
              value={`− ${money(settlement.taxDeduction, 2)} / ton`}
            />
          )}
          {!pending && Boolean(dispatch.commissionPerTon && dispatch.commissionPerTon > 0) && (
            <ReceiptRow label="Commission / margin" value={`− ${money(dispatch.commissionPerTon || 0, 2)} / ton`} />
          )}
          <ReceiptRow
            label={pending ? 'Final payable rate' : 'Final factory-payable rate'}
            value={pending ? 'Awaiting laboratory settlement' : `${money(settlement.payableRate, 2)} / ton`}
            strong
            backgroundColor="#F7F9FC"
          />
        </ReceiptSection>

        <div
          style={{
            marginTop: 16,
            padding: '15px 17px',
            borderRadius: 12,
            backgroundColor: pending ? '#7C4A03' : '#102A43',
            color: '#FFFFFF',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 9, fontWeight: 800, color: pending ? '#FDE7BC' : '#B9D4E7', textTransform: 'uppercase', letterSpacing: 1 }}>
            {pending ? 'Revenue Not Yet Recognized' : 'Total Settlement Revenue'}
          </div>
          <div style={{ marginTop: 4, fontSize: pending ? 20 : 27, fontWeight: 900, letterSpacing: -0.35 }}>
            {pending ? 'Factory approval pending' : money(settlement.totalRevenue)}
          </div>
          <div style={{ marginTop: 4, fontSize: 9.5, color: pending ? '#FDE7BC' : '#D6E5F0' }}>
            {pending
              ? `${totalLoaded.toFixed(2)} tons dispatched • cost already posted to books`
              : `${receivedWeight.toFixed(2)} tons × ${money(settlement.payableRate, 2)} per ton`}
          </div>
        </div>

        {dispatch.notes?.trim() && (
          <div
            style={{
              marginTop: 12,
              padding: '10px 12px',
              borderRadius: 9,
              border: `1px solid ${RECEIPT_COLORS.line}`,
              backgroundColor: '#F7F9FC',
              fontSize: 9.5,
              color: RECEIPT_COLORS.secondary,
              overflowWrap: 'anywhere',
            }}
          >
            <strong style={{ color: RECEIPT_COLORS.ink }}>Remarks:</strong> {dispatch.notes.trim()}
          </div>
        )}
      </ReceiptDocument>
    );
  }
);

DispatchReceipt.displayName = 'DispatchReceipt';
