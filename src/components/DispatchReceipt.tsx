import React from 'react';
import type { Dispatch, Party, PurchaseOrder, AppSettings } from '../types';
import { calculateSettlement, getEffectiveAdjustments, isDispatchPending } from '../utils/calculations';
import { getCurrencySymbol, formatAmountNumber } from '../utils/currency';
import { formatDisplayDate } from '../utils/dateUtils';
import {
  ReceiptDocument,
  ReceiptHero,
  ReceiptRow,
  ReceiptSection,
  RECEIPT_COLORS,
} from './ReceiptDocument';
import { getMaterialForDispatch } from '../utils/materials';

interface DispatchReceiptProps {
  dispatch: Dispatch;
  party?: Party;
  po?: PurchaseOrder;
  settings?: AppSettings;
}

export const DispatchReceipt = React.forwardRef<HTMLDivElement, DispatchReceiptProps>(
  ({ dispatch, party, po, settings }, ref) => {
    const settlement = calculateSettlement(dispatch, settings);
    const adjustments = getEffectiveAdjustments(dispatch, settings);
    const pending = isDispatchPending(dispatch);
    const material = getMaterialForDispatch(dispatch, settings);
    const isCoal = material.pricingModel === 'gcv';
    const isPurity = material.pricingModel === 'purity';
    const businessName = settings?.businessName?.trim() || 'Factory Ledger';
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
      ? `Standard ${material.name.toLowerCase()} stock`
      : sourceNames.join(', ');
    const money = (amount: number, decimals = 0) => `${currency} ${formatAmountNumber(amount, settings, decimals)}`;

    return (
      <ReceiptDocument
        ref={ref}
        settings={settings}
        kind="dispatch"
        documentTitle={pending ? 'Dispatch Advice' : 'Settlement Receipt'}
        documentLabel={`${material.name} Dispatch`}
        documentId={voucherId}
        date={dispatch.date}
        statusLabel={pending ? 'Revenue Pending' : 'Factory Settled'}
        verificationLabel={pending ? 'Recorded Dispatch Voucher' : 'Verified Settlement Voucher'}
        footerText={`Generated electronically by ${businessName} • Retain with the factory weighbridge and laboratory record`}
      >
        {/* ─── Grand Hero Amount (Zero Box Enclosure) ─── */}
        {pending ? (
          <ReceiptHero
            label="Revenue Not Yet Recognized"
            amount="Revenue Pending"
            subtitle={`${totalLoaded.toFixed(2)} tons dispatched • cost already posted to books`}
            isPending
            accentColor={RECEIPT_COLORS.orange}
          />
        ) : (
          <ReceiptHero
            label="Total Settlement Revenue"
            amount={money(settlement.totalRevenue)}
            subtitle={`${receivedWeight.toFixed(2)} tons accepted × ${money(settlement.payableRate, 2)} per ton`}
            accentColor={RECEIPT_COLORS.ink}
          />
        )}

        {/* ─── Factory & Consignment Particulars (Open Lines) ─── */}
        <ReceiptSection title="Factory and Consignment">
          <ReceiptRow
            label="Factory / Consignee"
            value={factoryName}
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
            value={dispatch.truckNumber || 'Not recorded'}
            strong
          />
          <ReceiptRow
            label={`${material.name} source`}
            value={sourceSummary}
          />
          <ReceiptRow
            label="Dispatch Date"
            value={formatDisplayDate(dispatch.date) || 'Not recorded'}
          />
          {po?.poNumber && (
            <ReceiptRow
              label="Purchase order"
              value={po.poNumber}
            />
          )}
        </ReceiptSection>

        {/* ─── Delivery & Laboratory Result (Open Lines) ─── */}
        <ReceiptSection title="Delivery and Laboratory Result">
          <ReceiptRow label="Loaded dispatch weight" value={`${totalLoaded.toFixed(2)} tons`} />
          <ReceiptRow
            label="Factory received weight"
            value={pending ? 'Pending weighbridge' : `${receivedWeight.toFixed(2)} tons`}
            strong
            valueColor={pending ? RECEIPT_COLORS.orange : RECEIPT_COLORS.ink}
          />
          {!pending && totalLoaded > 0 && Math.abs(weightDifference) >= 0.01 && (
            <ReceiptRow
              label={`Transit ${weightDifference < 0 ? 'shortage' : 'gain'}`}
              value={`${weightDifference >= 0 ? '+' : ''}${weightDifference.toFixed(2)} tons (${((Math.abs(weightDifference) / totalLoaded) * 100).toFixed(1)}%)`}
              labelColor={weightDifference < 0 ? RECEIPT_COLORS.red : RECEIPT_COLORS.green}
              valueColor={weightDifference < 0 ? RECEIPT_COLORS.red : RECEIPT_COLORS.green}
            />
          )}
          {isCoal ? (
            <>
              <ReceiptRow label="Target GCV" value={`${dispatch.targetGcv || 0} kcal/kg`} />
              <ReceiptRow
                label="Actual laboratory GCV"
                value={pending ? 'Pending analysis' : `${dispatch.labActualGcv || 0} kcal/kg${dispatch.targetGcv ? ` (${dispatch.labActualGcv >= dispatch.targetGcv ? '+' : ''}${dispatch.labActualGcv - dispatch.targetGcv})` : ''}`}
                valueColor={pending ? RECEIPT_COLORS.orange : (dispatch.targetGcv && dispatch.labActualGcv < dispatch.targetGcv ? RECEIPT_COLORS.red : RECEIPT_COLORS.green)}
              />
              <ReceiptRow label="Sulphur" value={dispatch.labSulphur ? `${dispatch.labSulphur}%` : 'Standard'} />
              {Boolean(dispatch.labAsh && dispatch.labAsh > 0) && <ReceiptRow label="Ash" value={`${dispatch.labAsh}%`} />}
              {Boolean(dispatch.labMoisture && dispatch.labMoisture > 0) && <ReceiptRow label="Moisture" value={`${dispatch.labMoisture}%`} />}
              {Boolean(dispatch.labVm && dispatch.labVm > 0) && <ReceiptRow label="Volatile matter (VM)" value={`${dispatch.labVm}%`} />}
            </>
          ) : isPurity ? (
            <ReceiptRow
              label="Factory received Purity"
              value={pending ? 'Pending assay' : `${dispatch.receivedQuality || 0} %`}
              strong
              valueColor={pending ? RECEIPT_COLORS.orange : RECEIPT_COLORS.ink}
            />
          ) : dispatch.receivedQuality ? (
            <ReceiptRow
              label={`Factory received ${material.qualityLabel || 'quality'}`}
              value={`${dispatch.receivedQuality} ${material.qualityUnit || ''}`.trim()}
              strong
            />
          ) : null}
          {dispatch.settledDate && (
            <ReceiptRow label="Factory settlement date" value={formatDisplayDate(dispatch.settledDate)} />
          )}
        </ReceiptSection>

        {/* ─── Rate & Settlement Breakdown (Open Lines) ─── */}
        <ReceiptSection title={pending ? 'Contract Terms' : 'Rate and Settlement Breakdown'}>
          {isPurity && (
            <ReceiptRow
              label="Rate per Purity point"
              value={money(dispatch.ratePerQualityUnit || 0, 2)}
            />
          )}
          <ReceiptRow
            label={isPurity ? 'Purity-derived rate' : 'Contract base rate'}
            value={`${money(isPurity ? (dispatch.ratePerQualityUnit || 0) * (dispatch.receivedQuality || 0) : dispatch.baseRate || 0, 2)} / ton`}
          />
          {!pending && adjustments.deduction > 0 && (
            <ReceiptRow
              label={`${isCoal ? 'GCV quality' : 'Manual'} deduction${adjustments.isProrata ? ` • ${adjustments.ruleLabel}` : ''}`}
              value={`− ${money(adjustments.deduction, 2)} / ton`}
              labelColor={RECEIPT_COLORS.red}
              valueColor={RECEIPT_COLORS.red}
            />
          )}
          {!pending && adjustments.premium > 0 && (
            <ReceiptRow
              label={`Quality premium${adjustments.isProrata ? ` • ${adjustments.ruleLabel}` : ''}`}
              value={`+ ${money(adjustments.premium, 2)} / ton`}
              labelColor={RECEIPT_COLORS.green}
              valueColor={RECEIPT_COLORS.green}
            />
          )}
          {!pending && settlement.dieselAdjustment !== 0 && (
            <ReceiptRow
              label={settlement.dieselAdjustment > 0 ? 'Diesel escalation (premium)' : 'Diesel de-escalation (deduction)'}
              value={`${settlement.dieselAdjustment > 0 ? '+' : '−'} ${money(Math.abs(settlement.dieselAdjustment), 2)} / ton`}
              labelColor={settlement.dieselAdjustment > 0 ? RECEIPT_COLORS.green : RECEIPT_COLORS.red}
              valueColor={settlement.dieselAdjustment > 0 ? RECEIPT_COLORS.green : RECEIPT_COLORS.red}
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
          />
        </ReceiptSection>

        {/* ─── Payment & Balance Breakdown (if recorded) ─── */}
        {Boolean(dispatch.paidOnSpot && dispatch.paidOnSpot > 0) && (() => {
          const paidSpot = dispatch.paidOnSpot || 0;
          const due = Math.max(0, settlement.totalRevenue - paidSpot);
          return (
            <ReceiptSection title="Payment and Account Balance">
              <ReceiptRow
                label="Total Consignment Invoiced"
                value={money(settlement.totalRevenue)}
              />
              <ReceiptRow
                label={`Payment Received on Spot (${(dispatch.paidOnSpotMode || 'cash').toUpperCase()})`}
                value={`− ${money(paidSpot)}`}
                labelColor={RECEIPT_COLORS.green}
                valueColor={RECEIPT_COLORS.green}
                strong
              />
              <ReceiptRow
                label="Remaining Consignment Due"
                value={money(due)}
                strong
                valueColor={due > 0 ? RECEIPT_COLORS.ink : RECEIPT_COLORS.green}
              />
              {dispatch.paidOnSpotNote && (
                <ReceiptRow
                  label="Payment Note"
                  value={dispatch.paidOnSpotNote}
                  labelColor={RECEIPT_COLORS.muted}
                  valueColor={RECEIPT_COLORS.secondary}
                />
              )}
            </ReceiptSection>
          );
        })()}

        {dispatch.notes?.trim() && (
          <div
            style={{
              marginTop: 18,
              paddingTop: 10,
              borderTop: `1px solid ${RECEIPT_COLORS.hairline}`,
              fontSize: 11,
              color: RECEIPT_COLORS.secondary,
              overflowWrap: 'anywhere',
            }}
          >
            <strong style={{ color: RECEIPT_COLORS.ink, fontWeight: 600 }}>Remarks:</strong> {dispatch.notes.trim()}
          </div>
        )}
      </ReceiptDocument>
    );
  }
);

DispatchReceipt.displayName = 'DispatchReceipt';
