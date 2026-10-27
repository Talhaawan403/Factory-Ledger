import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import type ExcelJS from 'exceljs';
import type { Dispatch, Party, Payment, PurchaseOrder, AppSettings, InventoryLot } from '../types';
import { calculateSettlement, calculatePartyBalance, calculateTransitLoss, calculateLedgerTotals, isDispatchPending, getEffectiveAdjustments, roundPartyLedgerAmount } from './calculations';
import { getSettings, getExportBackupData, getSyncConflictHistory } from '../lib/db';
import { getTodayDateString, formatDisplayDate } from './dateUtils';
import { getCurrencySymbol, formatAmountNumber, getCurrencyExcelFormat } from './currency';
import { getMaterialForDispatch } from './materials';

// On-demand dynamic loaders for heavy export engines (Issue 15: Bundle Performance)
async function loadHtml2Canvas() {
  const mod = await import('html2canvas');
  const fn = (typeof mod.default === 'function' ? mod.default : mod) as typeof import('html2canvas').default;
  return fn;
}

async function waitForReceiptAssets(element: HTMLElement): Promise<void> {
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // The system font stack still renders if a web font fails to load.
    }
  }

  const images = Array.from(element.querySelectorAll('img'));
  await Promise.all(images.map(async (image) => {
    if (image.complete) return;

    try {
      if (typeof image.decode === 'function') {
        await image.decode();
        return;
      }
    } catch {
      // Fall through to the load/error listener for browsers with partial decode support.
    }

    await new Promise<void>((resolve) => {
      const finish = () => resolve();
      image.addEventListener('load', finish, { once: true });
      image.addEventListener('error', finish, { once: true });
    });
  }));
}

/** Captures the complete receipt only after its fonts and branding assets are ready. */
export async function captureReceiptPng(element: HTMLElement): Promise<string> {
  await waitForReceiptAssets(element);
  const html2canvas = await loadHtml2Canvas();
  const width = element.scrollWidth || element.offsetWidth;
  const height = element.scrollHeight || element.offsetHeight;
  const canvas = await html2canvas(element, {
    scale: 3,
    useCORS: true,
    allowTaint: false,
    logging: false,
    imageTimeout: 8000,
    backgroundColor: '#F2F2F7',
    width,
    height,
    windowWidth: width,
    windowHeight: height,
    scrollX: 0,
    scrollY: 0,
  });

  return canvas.toDataURL('image/png');
}

async function loadPdfEngines() {
  const [jsPdfMod, autoTableMod] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const autoTableFn = (typeof autoTableMod.default === 'function' ? autoTableMod.default : autoTableMod) as unknown as typeof import('jspdf-autotable').default;
  const JsPdfClass = (typeof jsPdfMod.default === 'function' ? jsPdfMod.default : jsPdfMod.jsPDF) as unknown as typeof import('jspdf').jsPDF;
  return {
    jsPDF: JsPdfClass,
    autoTable: autoTableFn,
  };
}

async function loadExcelEngine() {
  const mod = await import('exceljs');
  return mod.default || mod;
}

export interface ShareFileOptions {
  /** Base64 string (with or without data URI prefix) */
  data: string;
  fileName: string;
  mimeType: string;
  title?: string;
  text?: string;
  dialogTitle?: string;
}

/**
 * Universal file sharing engine:
 * Saves file locally and launches Android/iOS Native Share sheet via Capacitor.
 * Gracefully falls back to Web Share API or direct browser download on web.
 */
export async function shareBase64File(options: ShareFileOptions): Promise<void> {
  const { data, fileName, mimeType, title = 'Share File', text = '', dialogTitle = 'Share via' } = options;

  // Extract raw base64 data if it has data URI prefix
  const rawBase64 = data.includes(',') ? data.split(',')[1] : data;

  if (Capacitor.isNativePlatform()) {
    try {
      // 1. Write file to device Cache directory
      const writeResult = await Filesystem.writeFile({
        path: fileName,
        data: rawBase64,
        directory: Directory.Cache,
      });

      // 2. Open native Android/iOS share sheet with file URI
      await Share.share({
        title,
        text,
        url: writeResult.uri,
        files: [writeResult.uri],
        dialogTitle,
      });
      return;
    } catch (err) {
      console.warn('Capacitor native share failed, falling back:', err);
    }
  }

  // Web Browser Fallback
  try {
    const byteCharacters = atob(rawBase64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: mimeType });
    const file = new File([blob], fileName, { type: mimeType });

    // Try Web Share API with files if supported
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title,
        text,
      });
      return;
    }

    // Direct browser download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (webErr) {
    console.error('File export download failed:', webErr);
    throw webErr;
  }
}

/**
 * Capture an off-screen or rendered receipt DOM element as a crisp 3x image
 * and trigger native sharing.
 */
export async function shareReceiptImage(
  element: HTMLElement,
  dispatch: Dispatch,
  party?: Party
): Promise<void> {
  const dataUrl = await captureReceiptPng(element);
  const safeTruck = (dispatch.truckNumber || 'truck').replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = `Receipt-${safeTruck}-${dispatch.date}.png`;
  const partyName = party?.name || dispatch.factoryName || 'Factory';
  const material = getMaterialForDispatch(dispatch);

  await shareBase64File({
    data: dataUrl,
    fileName,
    mimeType: 'image/png',
    title: `Receipt - ${dispatch.truckNumber || 'Dispatch'}`,
    text: `${material.name} Dispatch Settlement Receipt for ${dispatch.truckNumber} delivered to ${partyName} on ${formatDisplayDate(dispatch.date)}.`,
    dialogTitle: 'Share Dispatch Receipt',
  });
}

/**
 * Capture an off-screen or rendered payment voucher DOM element as a crisp 3x image
 * and trigger native sharing.
 */
export async function sharePaymentImage(
  element: HTMLElement,
  payment: Payment,
  party?: Party
): Promise<void> {
  const dataUrl = await captureReceiptPng(element);
  const safeId = (payment.id || 'voucher').slice(0, 8).toUpperCase();
  const safeParty = (party?.name || 'Party').replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = `PaymentVoucher-${safeParty}-${safeId}-${payment.date}.png`;

  const dbSettings = await getSettings();
  const curSym = getCurrencySymbol(dbSettings.currency);
  const formattedAmt = formatAmountNumber(payment.amount, dbSettings);
  const isReceived = payment.type === 'received';
  const documentName = isReceived ? 'Payment Receipt' : 'Payment Voucher';
  const directionText = isReceived ? 'received from' : 'paid to';

  await shareBase64File({
    data: dataUrl,
    fileName,
    mimeType: 'image/png',
    title: `${documentName} - ${party?.name || 'Party'}`,
    text: `${documentName}: ${curSym} ${formattedAmt} ${directionText} ${party?.name || 'Party'} by ${payment.mode.toUpperCase()} on ${formatDisplayDate(payment.date)}.`,
    dialogTitle: `Share ${documentName}`,
  });
}

/**
 * Capture an off-screen or rendered supplier goods received voucher DOM element as a crisp 3x image
 * and trigger native sharing.
 */
export async function shareSupplierDeliveryImage(
  element: HTMLElement,
  lot: InventoryLot,
  party?: Party
): Promise<void> {
  const dataUrl = await captureReceiptPng(element);
  const safeTruck = (lot.truckNumber || 'delivery').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeSupplier = (party?.name || lot.supplier || 'Supplier').replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = `GoodsReceipt-${safeSupplier}-${safeTruck}-${lot.date}.png`;

  const dbSettings = await getSettings();
  const curSym = getCurrencySymbol(dbSettings.currency);
  const weight = Number(lot.receivedWeight || lot.billedWeight || lot.tonnage || 0);
  const rate = Number(lot.purchaseRate || lot.ratePerTon || 0);
  const freight = Number(lot.freightCost || 0);
  const totalAmount = lot.totalValue !== undefined ? Number(lot.totalValue) : weight * rate + freight;
  const formattedAmt = formatAmountNumber(totalAmount, dbSettings);

  await shareBase64File({
    data: dataUrl,
    fileName,
    mimeType: 'image/png',
    title: `Goods Receipt - ${lot.truckNumber || 'Delivery'}`,
    text: `Raw Material Goods Received Note: ${weight.toFixed(2)} tons (${curSym} ${formattedAmt}) received from ${party?.name || lot.supplier || 'Supplier'} on ${formatDisplayDate(lot.date)}.`,
    dialogTitle: 'Share Delivery Receipt',
  });
}

/**
 * Format a clean WhatsApp / SMS text receipt for an inward supplier delivery.
 */
export function generateSupplierDeliveryWhatsappText(
  lot: InventoryLot,
  party?: Party,
  settings?: AppSettings
): string {
  const curSym = getCurrencySymbol(settings?.currency);
  const businessName = settings?.businessName?.trim() || 'AWAN COAL LOGISTICS';
  const supplierName = party?.name || lot.supplier || lot.boughtFrom || 'Supplier';
  const weight = Number(lot.receivedWeight || lot.billedWeight || lot.tonnage || 0);
  const rate = Number(lot.purchaseRate || lot.ratePerTon || 0);
  const freight = Number(lot.freightCost || 0);
  const materialCost = weight * rate;
  const totalAmount = lot.totalValue !== undefined ? Number(lot.totalValue) : materialCost + freight;
  const landedRate = weight > 0 ? (lot.landedRate || totalAmount / weight) : rate;

  const lines = [
    `*${businessName}*`,
    `*GOODS RECEIVED NOTE (INWARD)*`,
    `══════════════════════════`,
    `*Supplier:* ${supplierName}`,
    `*Date:* ${formatDisplayDate(lot.date)}`,
    `*Commodity:* ${lot.itemName || 'Raw Material'}`,
    lot.grade ? `*Quality / Purity:* ${lot.grade}` : null,
    `*Truck No:* ${lot.truckNumber || 'N/A'}`,
    lot.mineName || lot.mineSource ? `*Source / Pit:* ${lot.mineName || lot.mineSource}` : null,
    lot.storedAt ? `*Storage Yard:* ${lot.storedAt}` : null,
    `──────────────────────────`,
    `*Weight:* ${weight.toFixed(2)} Tons`,
    `*Rate:* ${curSym} ${rate.toLocaleString()} / Ton`,
    `*Material Cost:* ${curSym} ${formatAmountNumber(materialCost, settings)}`,
    freight > 0 ? `*Freight Fare:* ${curSym} ${formatAmountNumber(freight, settings)}` : null,
    `*Total Inward Amount:* ${curSym} ${formatAmountNumber(totalAmount, settings)}`,
    `*Landed Rate:* ${curSym} ${landedRate.toFixed(2)} / Ton`,
    `──────────────────────────`,
    lot.notes ? `*Notes:* ${lot.notes}` : null,
    `*Status:* Received into stock & credited to supplier ledger.`,
  ].filter(Boolean);

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// Pure Export Data Preparation Engines (Issue 25: Testable Export Totals)
// ═══════════════════════════════════════════════════════════════════════════════

export interface StatementRow {
  index: number;
  date: string;
  kind: 'dispatch' | 'payment';
  reference: string;
  description: string;
  weightTons: number;
  ratePerTon: number;
  debit: number;
  credit: number;
  runningBalance: number;
  isPending: boolean;
  notes?: string;
}

export interface StatementData {
  rows: StatementRow[];
  totalTons: number;
  totalBilled: number;
  totalReceived: number;
  totalPaid: number;
  netReceived: number;
  outstandingBalance: number;
  isReceivable: boolean;
}

/**
 * Pure generator for chronological party ledger account statement.
 * Guaranteed to match canonical calculatePartyBalance totals.
 */
export function buildPartyStatementData(
  dispatches: Dispatch[],
  payments: Payment[] = [],
  pos?: PurchaseOrder[],
  _settings?: AppSettings
): StatementData {
  const balance = calculatePartyBalance(dispatches, payments);

  type StatementEntry =
    | { kind: 'dispatch'; date: string; data: Dispatch }
    | { kind: 'payment'; date: string; data: Payment };

  const entries: StatementEntry[] = [
    ...dispatches.map((d) => ({ kind: 'dispatch' as const, date: d.date, data: d })),
    ...payments.map((p) => ({ kind: 'payment' as const, date: p.date, data: p })),
  ].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  let runningBal = 0;
  const rows: StatementRow[] = [];

  entries.forEach((entry, idx) => {
    if (entry.kind === 'dispatch') {
      const d = entry.data;
      const s = calculateSettlement(d);
      const isPending = isDispatchPending(d);
      const invoiced = isPending ? 0 : roundPartyLedgerAmount(s.totalRevenue);
      runningBal += invoiced;
      const po = pos?.find((p) => p.id === d.poId);
      const material = getMaterialForDispatch(d);

      rows.push({
        index: idx + 1,
        date: formatDisplayDate(d.date) || '-',
        kind: 'dispatch',
        reference: po?.poNumber || d.truckNumber || '-',
        description: `${material.name} Dispatch Delivery (${d.truckNumber || 'Truck'})`,
        weightTons: isPending ? 0 : (d.labReceivedWeight || 0),
        ratePerTon: s.payableRate,
        debit: invoiced,
        credit: 0,
        runningBalance: runningBal,
        isPending,
        notes: d.notes,
      });
    } else {
      const p = entry.data;
      const isReceived = p.type === 'received';
      const amount = roundPartyLedgerAmount(p.amount);
      if (isReceived) {
        runningBal -= amount;
      } else {
        runningBal += amount;
      }

      rows.push({
        index: idx + 1,
        date: formatDisplayDate(p.date) || '-',
        kind: 'payment',
        reference: (p.id || '').slice(0, 8).toUpperCase(),
        description: `Payment ${isReceived ? 'Credit / Received' : 'Debit / Outflow'} (${p.mode.toUpperCase()})`,
        weightTons: 0,
        ratePerTon: 0,
        debit: !isReceived ? amount : 0,
        credit: isReceived ? amount : 0,
        runningBalance: runningBal,
        isPending: false,
        notes: p.referenceNote,
      });
    }
  });

  return {
    rows,
    totalTons: balance.totalTons,
    totalBilled: balance.totalBilled,
    totalReceived: balance.totalPaymentsReceived,
    totalPaid: balance.totalPaymentsPaid,
    netReceived: balance.netPaymentsReceived,
    outstandingBalance: balance.outstandingBalance,
    isReceivable: balance.isReceivable,
  };
}

export interface FleetRow {
  index: number;
  id: string;
  date: string;
  truckNumber: string;
  partyName: string;
  poNumber: string;
  loadedWeight: number;
  receivedWeight: number;
  transitDiff: number;
  transitLossPercentage: number;
  isPending: boolean;
  targetGcv: number;
  actualGcv: number;
  gcvDiff: number;
  sulphur: number;
  ash: number;
  moisture: number;
  baseRate: number;
  deduction: number;
  premium: number;
  taxDeduction: number;
  payableRate: number;
  revenue: number;
  totalCost: number;
  netProfit: number;
  notes: string;
}

export interface FleetExportData {
  rows: FleetRow[];
  totals: ReturnType<typeof calculateLedgerTotals>;
}

/**
 * Pure generator for fleet master dispatches audit data.
 * Guaranteed to match canonical calculateLedgerTotals.
 */
export function buildFleetExportData(
  dispatches: Dispatch[],
  parties: Party[] = [],
  pos: PurchaseOrder[] = [],
  settings?: AppSettings
): FleetExportData {
  const totals = calculateLedgerTotals(dispatches, settings);
  const sorted = [...dispatches].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const rows: FleetRow[] = sorted.map((d, index) => {
    const s = calculateSettlement(d);
    const adj = getEffectiveAdjustments(d);
    const transit = calculateTransitLoss(d);
    const isPending = transit.isPending;
    const party = parties.find((p) => p.id === d.partyId);
    const po = pos.find((p) => p.id === d.poId);
    const gcvDiff = d.targetGcv && d.labActualGcv ? d.labActualGcv - d.targetGcv : 0;

    return {
      index: index + 1,
      id: d.id,
      date: formatDisplayDate(d.date) || '-',
      truckNumber: d.truckNumber || '-',
      partyName: party?.name || d.factoryName || 'Direct',
      poNumber: po?.poNumber || '-',
      loadedWeight: transit.totalLoadedWeight || 0,
      receivedWeight: isPending ? 0 : (d.labReceivedWeight || 0),
      transitDiff: parseFloat(transit.diff.toFixed(2)),
      transitLossPercentage: parseFloat((transit.lossPercentage / 100).toFixed(4)),
      isPending,
      targetGcv: d.targetGcv || 0,
      actualGcv: d.labActualGcv || 0,
      gcvDiff,
      sulphur: d.labSulphur ? parseFloat(d.labSulphur.toFixed(2)) : 0,
      ash: d.labAsh ? parseFloat(d.labAsh.toFixed(2)) : 0,
      moisture: d.labMoisture ? parseFloat(d.labMoisture.toFixed(2)) : 0,
      baseRate: d.baseRate || 0,
      deduction: adj.deduction,
      premium: adj.premium,
      taxDeduction: s.taxDeduction ? parseFloat(s.taxDeduction.toFixed(2)) : 0,
      payableRate: parseFloat(s.payableRate.toFixed(2)),
      revenue: isPending ? 0 : Math.round(s.totalRevenue),
      totalCost: isPending ? 0 : Math.round(s.totalCost),
      netProfit: isPending ? 0 : Math.round(s.netProfit),
      notes: isPending
        ? (d.notes ? `[In-Transit] ${d.notes}` : 'In-Transit (Awaiting Weighbridge)')
        : (d.notes || ''),
    };
  });

  return {
    rows,
    totals,
  };
}

export interface ExportDispatchesPdfOptions {
  title?: string;
  subtitle?: string;
  partyName?: string;
  party?: Party;
  payments?: Payment[];
  dateRange?: string;
  startDate?: string;
  endDate?: string;
  openingBalance?: number;
  dispatches: Dispatch[];
  parties: Party[];
  pos: PurchaseOrder[];
  settings?: AppSettings;
}

/**
 * Universal PDF Export:
 * - If exporting for a single party (party or payments provided), produces an executive Portrait A4 Statement of Account.
 * - If exporting multiple parties / all dispatches, produces a high-density Landscape A4 Fleet Audit Report.
 */
export async function exportDispatchesPdf(options: ExportDispatchesPdfOptions): Promise<void> {
  const dbSettings = await getSettings();
  const settings: AppSettings = {
    ...dbSettings,
    ...(options.settings || {}),
    logoUrl: options.settings?.logoUrl || dbSettings.logoUrl || '',
    signatureUrl: options.settings?.signatureUrl || dbSettings.signatureUrl || '',
  };

  // Determine if this is a single party account statement or a multi-dispatch fleet audit
  const isPartyStatement = Boolean(options.party || (options.partyName && options.payments));

  if (isPartyStatement) {
    await exportPartyStatementPdf({ ...options, settings });
  } else {
    await exportFleetAuditPdf({ ...options, settings });
  }
}

/**
 * Generates an executive Portrait A4 Statement of Account for a single party
 */
async function exportPartyStatementPdf(options: ExportDispatchesPdfOptions & { settings: AppSettings }): Promise<void> {
  const {
    dispatches,
    payments = [],
    pos,
    settings,
    dateRange,
    openingBalance = 0,
  } = options;
  const hasDateRange = Boolean(dateRange && dateRange !== 'All Time');

  const party = options.party || options.parties.find((p) => p.name === options.partyName);
  const partyName = party?.name || options.partyName || 'Party Client';

  const { jsPDF, autoTable } = await loadPdfEngines();
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;

  // 1. Executive Top Accent Banner
  doc.setFillColor(11, 18, 32); // Deep Midnight Obsidian
  doc.rect(0, 0, pageWidth, 4.5, 'F');
  doc.setFillColor(197, 160, 89); // Antique Gold Micro-Rule
  doc.rect(0, 4.5, pageWidth, 0.8, 'F');

  // Header: Business Info
  let headerTextX = margin;
  if (settings.logoUrl && settings.logoUrl.startsWith('data:image')) {
    try {
      const isPng = settings.logoUrl.includes('image/png');
      doc.addImage(settings.logoUrl, isPng ? 'PNG' : 'JPEG', margin, 9, 14, 14);
      headerTextX = margin + 17;
    } catch {
      // ignore if image format unsupported
    }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(11, 18, 32);
  doc.text((settings.businessName || 'AWAN COAL LOGISTICS').toUpperCase(), headerTextX, 15.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  const subline = [
    settings.phoneNumber ? `Tel: ${settings.phoneNumber}` : '',
    settings.ntnNumber ? `NTN: ${settings.ntnNumber}` : '',
    settings.companyAddress ? settings.companyAddress : '',
  ]
    .filter(Boolean)
    .join('   •   ');
  if (subline) {
    doc.text(subline, headerTextX, 20.5);
  }

  // Right-aligned Document Badge & Serial Box
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(11, 18, 32);
  doc.text('STATEMENT OF ACCOUNT', pageWidth - margin, 15.5, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.setTextColor(100, 116, 139);
  if (hasDateRange) {
    doc.text(`Period: ${dateRange}`, pageWidth - margin, 19.5, { align: 'right' });
    doc.setFontSize(7);
    doc.text(`Issue Date: ${formatDisplayDate(new Date())}`, pageWidth - margin, 23.2, { align: 'right' });
  } else {
    doc.text(`Issue Date: ${formatDisplayDate(new Date())}`, pageWidth - margin, 20.5, { align: 'right' });
  }

  // Divider
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.4);
  doc.line(margin, 24.5, pageWidth - margin, 24.5);

  // 2. Party Dossier Card (Account Holder)
  const partyCardY = 28;
  const partyCardHeight = 21;
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(margin, partyCardY, contentWidth, partyCardHeight, 2, 2, 'F');
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, partyCardY, contentWidth, partyCardHeight, 2, 2, 'S');

  // Vertical brand accent bar on left edge of party card
  doc.setFillColor(30, 58, 138); // Royal Sapphire
  doc.roundedRect(margin, partyCardY, 2.5, partyCardHeight, 1, 1, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('ACCOUNT HOLDER / CONFLICT-FREE RECONCILED DOSSIER:', margin + 6, partyCardY + 5.5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text(partyName, margin + 6, partyCardY + 11.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  const partyMeta = [
    party?.contactPerson ? `Attn: ${party.contactPerson}` : null,
    party?.phone ? `Phone: ${party.phone}` : null,
    party?.address ? `Location: ${party.address}` : null,
  ].filter(Boolean).join('   |   ');
  doc.text(partyMeta || 'Verified Ledger Account', margin + 6, partyCardY + 17);

  // 3. Executive KPI Summary Cards
  const balanceResult = calculatePartyBalance(dispatches, payments);
  const totalTons = balanceResult.totalTons;
  const totalBilled = balanceResult.totalBilled;
  const totalReceived = balanceResult.totalPaymentsReceived;
  const outstanding = openingBalance + totalBilled - totalReceived;

  const kpiY = 52.5;
  const kpiHeight = 16.5;
  const kpiGap = 3;
  const kpiWidth = (contentWidth - kpiGap * 3) / 4;

  const curSym = getCurrencySymbol(settings.currency);

  const kpis = [
    { label: hasDateRange ? 'DELIVERED (PERIOD)' : 'COAL DELIVERED', value: `${totalTons.toFixed(2)} t`, sub: `${dispatches.length} Trucks Cleared`, color: [15, 23, 42], topBar: [30, 58, 138] },
    { label: hasDateRange ? 'BILLED (PERIOD)' : 'TOTAL INVOICED', value: `${curSym} ${formatAmountNumber(totalBilled, settings)}`, sub: 'Billed Deliveries', color: [15, 23, 42], topBar: [71, 85, 105] },
    { label: hasDateRange ? 'CREDITED (PERIOD)' : 'PAYMENTS CREDITED', value: `${curSym} ${formatAmountNumber(totalReceived, settings)}`, sub: `${payments.filter((p) => p.type === 'received').length} Cleared Credits`, color: [5, 150, 105], topBar: [5, 150, 105] },
    {
      label: hasDateRange ? 'CLOSING BALANCE DUE' : 'NET BALANCE DUE',
      value: `${curSym} ${formatAmountNumber(outstanding, settings)}`,
      sub: outstanding > 0 ? 'Receivable Balance Due' : 'Account Settled in Full',
      color: outstanding > 0 ? [220, 38, 38] : [5, 150, 105],
      topBar: outstanding > 0 ? [220, 38, 38] : [5, 150, 105],
    },
  ];

  kpis.forEach((kpi, idx) => {
    const x = margin + idx * (kpiWidth + kpiGap);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(x, kpiY, kpiWidth, kpiHeight, 1.5, 1.5, 'FD');

    // Colored top edge bar on KPI card
    doc.setFillColor(kpi.topBar[0], kpi.topBar[1], kpi.topBar[2]);
    doc.roundedRect(x, kpiY, kpiWidth, 1.2, 0.5, 0.5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(kpi.label, x + 3.5, kpiY + 5.2);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(kpi.color[0], kpi.color[1], kpi.color[2]);
    doc.text(kpi.value, x + 3.5, kpiY + 10.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(kpi.sub, x + 3.5, kpiY + 14.5);
  });

  // 4. Combined Chronological Statement Ledger
  // Multi-row per entry with alternating entry colors
  type StatementEntry =
    | { kind: 'dispatch'; date: string; data: Dispatch }
    | { kind: 'payment'; date: string; data: Payment };

  const entries: StatementEntry[] = [
    ...dispatches.map((d) => ({ kind: 'dispatch' as const, date: d.date, data: d })),
    ...payments.map((p) => ({ kind: 'payment' as const, date: p.date, data: p })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  let runningBal = openingBalance;
  const tableRows: any[] = [];

  interface RowMeta {
    entryIndex: number;
    subRow: number;
    totalSubRows: number;
    isPayment: boolean;
    isReceived: boolean;
  }
  const rowMetaMap: RowMeta[] = [];

  if (openingBalance !== 0 || hasDateRange) {
    const openDate = dateRange?.includes('–')
      ? dateRange.split('–')[0].trim()
      : (formatDisplayDate(options.startDate) || '-');

    tableRows.push([
      { content: '0', rowSpan: 1, styles: { valign: 'middle', halign: 'center', fontStyle: 'bold' } },
      openDate,
      'OPENING BALANCE BROUGHT FORWARD (B/F)',
      '-',
      '-',
      openingBalance > 0 ? openingBalance.toLocaleString('en-PK') : '-',
      openingBalance < 0 ? Math.abs(openingBalance).toLocaleString('en-PK') : '-',
      runningBal.toLocaleString('en-PK'),
    ]);
    rowMetaMap.push({ entryIndex: -1, subRow: 0, totalSubRows: 1, isPayment: false, isReceived: false });
  }

  entries.forEach((entry, idx) => {
    if (entry.kind === 'dispatch') {
      const d = entry.data;
      const s = calculateSettlement(d);
      const adj = getEffectiveAdjustments(d, settings);
      const isPending = isDispatchPending(d);
      const invoiced = isPending ? 0 : roundPartyLedgerAmount(s.totalRevenue);
      runningBal += invoiced;
      const po = pos?.find((p) => p.id === d.poId);
      const transit = calculateTransitLoss(d);
      const material = getMaterialForDispatch(d, settings);

      const sourcesStr =
        d.coalInputs && d.coalInputs.length > 0
          ? d.coalInputs
              .filter((c) => (c.weight || 0) > 0)
              .map((c) => `${c.sourceName || material.name}: ${c.weight}t`)
              .join(', ')
          : '';

      // Line 1: Primary logistics & commercial settlement rate
      const truckPart = d.truckNumber ? `Truck: ${d.truckNumber}` : 'Direct Delivery';
      const destPart = d.factoryName ? ` • ${d.factoryName}` : '';
      const ratePart = ` • ${curSym} ${formatAmountNumber(s.payableRate, settings)}/t${
        d.baseRate && Math.round(d.baseRate) !== Math.round(s.payableRate)
          ? ` (Base: ${curSym} ${formatAmountNumber(d.baseRate, settings)})`
          : ''
      }`;

      // Line 2: Material-specific factory quality analysis
      const labParts: string[] = [];
      if (material.pricingModel !== 'gcv' && d.receivedQuality) {
        labParts.push(`${material.qualityLabel || 'Quality'}: ${d.receivedQuality}${material.qualityUnit || ''}`);
        if (material.pricingModel === 'purity') labParts.push(`Rate/point: ${curSym}${d.ratePerQualityUnit || 0}`);
      } else if (d.labActualGcv) {
        const delta = d.targetGcv ? d.labActualGcv - d.targetGcv : null;
        const deltaStr = delta !== null ? ` (${delta >= 0 ? '+' : ''}${delta})` : '';
        labParts.push(`GCV: ${d.labActualGcv} kcal${deltaStr}`);
      } else if (d.targetGcv) {
        labParts.push(`Target GCV: ${d.targetGcv} kcal`);
      }
      if (material.pricingModel === 'gcv') {
        if (d.labSulphur) labParts.push(`S: ${d.labSulphur}%`);
        if (d.labMoisture) labParts.push(`Moist: ${d.labMoisture}%`);
        if (d.labAsh) labParts.push(`Ash: ${d.labAsh}%`);
        if (d.labVm) labParts.push(`VM: ${d.labVm}%`);
      }

      // Line 3: Commercial & Rate Adjustments
      const adjParts: string[] = [];
      if (adj.premium) adjParts.push(`Bonus: +${curSym}${adj.premium.toFixed(2)}/t${adj.isProrata ? ' (Pro-Rata)' : ''}`);
      if (adj.deduction) adjParts.push(`${material.pricingModel === 'gcv' ? 'GCV' : 'Manual'} Ded: -${curSym}${adj.deduction.toFixed(2)}/t${adj.isProrata ? ' (Pro-Rata)' : ''}`);
      if (s.dieselAdjustment) adjParts.push(`Diesel: ${s.dieselAdjustment > 0 ? '+' : '-'}${curSym}${Math.abs(s.dieselAdjustment).toFixed(2)}/t`);
      if (s.taxDeduction) adjParts.push(`Tax: -${curSym}${s.taxDeduction.toFixed(2)}/t`);
      if (d.commissionPerTon) adjParts.push(`Comm: -${curSym}${d.commissionPerTon}/t`);

      // Transit Loss & Delivery Notes
      const logParts: string[] = [];
      if (transit.totalLoadedWeight > 0 && Math.abs(transit.diff) >= 0.01) {
        logParts.push(`Transit: ${transit.diff < 0 ? '-' : '+'}${Math.abs(transit.diff).toFixed(2)}t (${transit.lossPercentage.toFixed(1)}%)`);
      }
      if (sourcesStr) {
        logParts.push(`Mines: ${sourcesStr}`);
      }
      if (d.notes) {
        logParts.push(`Note: ${d.notes}`);
      }

      const row1 = [
        { content: (idx + 1).toString(), rowSpan: 3, styles: { valign: 'middle', halign: 'center' } },
        formatDisplayDate(d.date) || '-',
        `DELIVERY: ${truckPart}${destPart}${ratePart}`,
        po?.poNumber || '-',
        (d.labReceivedWeight || 0).toFixed(2),
        invoiced.toLocaleString('en-PK'),
        '-',
        runningBal.toLocaleString('en-PK'),
      ];

      const row2 = [
        { content: `LAB ASSAY: ${labParts.length > 0 ? labParts.join('   •   ') : 'Standard Specifications Verified'}`, colSpan: 7 },
      ];

      const row3 = [
        { content: `RATE AUDIT: ${adjParts.length > 0 ? adjParts.join('   •   ') : 'Standard Settlement Rate'}${logParts.length > 0 ? `   |   LOGISTICS: ${logParts.join('   •   ')}` : ''}`, colSpan: 7 },
      ];

      tableRows.push(row1, row2, row3);
      rowMetaMap.push({ entryIndex: idx, subRow: 0, totalSubRows: 3, isPayment: false, isReceived: false });
      rowMetaMap.push({ entryIndex: idx, subRow: 1, totalSubRows: 3, isPayment: false, isReceived: false });
      rowMetaMap.push({ entryIndex: idx, subRow: 2, totalSubRows: 3, isPayment: false, isReceived: false });
    } else {
      const p = entry.data;
      const isReceived = p.type === 'received';
      const amount = roundPartyLedgerAmount(p.amount);
      if (isReceived) {
        runningBal -= amount;
      } else {
        runningBal += amount;
      }

      const pRow1 = [
        { content: (idx + 1).toString(), rowSpan: 2, styles: { valign: 'middle', halign: 'center' } },
        formatDisplayDate(p.date) || '-',
        `PAYMENT ${isReceived ? 'CREDIT / RECEIVED' : 'DEBIT / OUTFLOW'} (${p.mode.toUpperCase()})`,
        (p.id || '').slice(0, 8).toUpperCase(),
        '-',
        !isReceived ? amount.toLocaleString('en-PK') : '-',
        isReceived ? amount.toLocaleString('en-PK') : '-',
        runningBal.toLocaleString('en-PK'),
      ];

      const pRow2 = [
        { content: `SETTLEMENT PARTICULARS: Voucher / Reference: ${p.referenceNote || 'Direct Settlement'}   •   System Txn ID: #${(p.id || '').slice(0, 10).toUpperCase()}   •   Posted to Party Ledger`, colSpan: 7 },
      ];

      tableRows.push(pRow1, pRow2);
      rowMetaMap.push({ entryIndex: idx, subRow: 0, totalSubRows: 2, isPayment: true, isReceived });
      rowMetaMap.push({ entryIndex: idx, subRow: 1, totalSubRows: 2, isPayment: true, isReceived });
    }
  });

  // Table Footer
  const tableFooter = [
    [
      '',
      'TOTALS',
      `${dispatches.length} Deliveries • ${payments.length} Payments`,
      '',
      totalTons.toFixed(2),
      formatAmountNumber(totalBilled, settings),
      formatAmountNumber(totalReceived, settings),
      `${curSym} ${formatAmountNumber(outstanding, settings)}`,
    ],
  ];

  autoTable(doc, {
    startY: kpiY + kpiHeight + 5,
    margin: { left: margin, right: margin, bottom: 20 },
    head: [
      [
        '#',
        'Date',
        'Particulars & Detailed Description',
        'Ref / PO',
        'Weight (t)',
        'Invoiced (Rs)',
        'Payment (Rs)',
        'Balance (Rs)',
      ],
    ],
    body: tableRows,
    foot: tableFooter,
    theme: 'grid',
    rowPageBreak: 'avoid',
    headStyles: {
      fillColor: [11, 18, 32], // Deep Obsidian
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
      cellPadding: 2.8,
    },
    footStyles: {
      fillColor: [11, 18, 32],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8.5,
      cellPadding: 3.2,
    },
    bodyStyles: {
      fontSize: 7.2,
      textColor: [51, 65, 85],
      cellPadding: 2,
    },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center', valign: 'middle' },
      1: { cellWidth: 20, valign: 'middle' },
      2: { cellWidth: 64, valign: 'top' },
      3: { cellWidth: 16, halign: 'center', valign: 'middle' },
      4: { cellWidth: 16, halign: 'right', valign: 'middle' },
      5: { cellWidth: 19, halign: 'right', valign: 'middle' },
      6: { cellWidth: 19, halign: 'right', valign: 'middle' },
      7: { cellWidth: 20, halign: 'right', valign: 'middle' },
    },
    didParseCell: (data) => {
      if (data.section === 'body') {
        const meta = rowMetaMap[data.row.index];
        if (!meta) return;

        if (meta.entryIndex === -1) {
          data.cell.styles.fillColor = [241, 245, 249];
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.textColor = [15, 23, 42];
          data.cell.styles.fontSize = 7.5;
          return;
        }

        const isEven = meta.entryIndex % 2 === 0;

        if (meta.isPayment) {
          const bg1: [number, number, number] = meta.isReceived ? [240, 253, 244] : [255, 241, 242];
          const bg2: [number, number, number] = meta.isReceived ? [232, 250, 238] : [254, 230, 232];
          data.cell.styles.fillColor = meta.subRow === 0 ? bg1 : bg2;

          if (meta.subRow === 0) {
            if (data.column.index === 6 && meta.isReceived) {
              data.cell.styles.textColor = [5, 150, 105];
              data.cell.styles.fontStyle = 'bold';
            } else if (data.column.index === 5 && !meta.isReceived) {
              data.cell.styles.textColor = [220, 38, 38];
              data.cell.styles.fontStyle = 'bold';
            }
          }
        } else {
          // Alternating colors for dispatches across all sub-rows
          const line1Bg: [number, number, number] = isEven ? [255, 255, 255] : [241, 245, 249];
          const line2Bg: [number, number, number] = isEven ? [250, 252, 255] : [236, 241, 246];
          const line3Bg: [number, number, number] = isEven ? [246, 249, 254] : [232, 237, 243];
          data.cell.styles.fillColor = meta.subRow === 0 ? line1Bg : meta.subRow === 1 ? line2Bg : line3Bg;
        }

        if (meta.subRow === 0) {
          data.cell.styles.fontSize = 7.5;
          data.cell.styles.cellPadding = { top: 2.2, bottom: 1.5, left: 2.5, right: 2.5 };
          data.cell.styles.lineWidth = { top: 0, right: 0.15, bottom: 0.15, left: 0.15 };
          data.cell.styles.lineColor = [226, 232, 240];

          if (data.column.index === 1 || data.column.index === 7) {
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.textColor = [15, 23, 42];
          }
          if (data.column.index === 4) {
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.textColor = [15, 23, 42];
          }
        } else if (meta.subRow === 1 && meta.totalSubRows === 3) {
          data.cell.styles.fontSize = 6.8;
          data.cell.styles.textColor = [51, 65, 85];
          data.cell.styles.cellPadding = { top: 1.2, bottom: 1.2, left: 3, right: 3 };
          data.cell.styles.lineWidth = { top: 0, right: 0.15, bottom: 0.15, left: 0.15 };
          data.cell.styles.lineColor = [226, 232, 240];
        } else {
          // Last row of this entry: strong bottom dividing border!
          data.cell.styles.fontSize = 6.8;
          data.cell.styles.textColor = [71, 85, 105];
          data.cell.styles.cellPadding = { top: 1.2, bottom: 2.2, left: 3, right: 3 };
          data.cell.styles.lineWidth = { top: 0, right: 0.15, bottom: 0.75, left: 0.15 };
          data.cell.styles.lineColor = [148, 163, 184]; // Distinct division between entries
        }

        if (data.column.index === 0) {
          data.cell.styles.valign = 'middle';
          data.cell.styles.halign = 'center';
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.textColor = [100, 116, 139];
          data.cell.styles.lineWidth = { top: 0, right: 0.2, bottom: 0.75, left: 0.15 };
          data.cell.styles.lineColor = [148, 163, 184];
          data.cell.styles.fillColor = isEven ? [255, 255, 255] : [241, 245, 249];
        }
      }
    },
    didDrawPage: () => {
      const pageStr = `Page ${doc.getNumberOfPages()} of ${doc.getNumberOfPages()}  •  ${settings.businessName || 'Awan Coal Logistics'} Official Statement`;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(148, 163, 184);
      doc.text(pageStr, pageWidth / 2, pageHeight - 8, { align: 'center' });
    },
  });

  // --- Official Authorized Signature Section on Last Page ---
  doc.setPage(doc.getNumberOfPages());
  const finalY = (doc as any).lastAutoTable?.finalY || 140;

  // Ensure adequate vertical clearance for signature block (needs ~35mm)
  let sigY: number;
  if (finalY + 36 > pageHeight - 15) {
    doc.addPage();
    doc.setPage(doc.getNumberOfPages());
    sigY = 24;
  } else {
    sigY = finalY + 8;
  }

  const sigWidth = 55;
  const sigBoxHeight = 18;
  const sigX = pageWidth - margin - sigWidth;

  // Left-aligned courtesy & system note
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Thank you for conducting business with us.', margin, sigY + 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text('Official Account Statement • Computer generated electronic record', margin, sigY + 18.5);

  // Right-aligned Authorized Signatory Block
  if (settings.signatureUrl && settings.signatureUrl.trim().length > 0) {
    // 1. Signature card container
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.roundedRect(sigX, sigY, sigWidth, sigBoxHeight, 2, 2, 'FD');

    // 2. Embedded signature image
    try {
      const isPng = !settings.signatureUrl.includes('image/jpeg');
      doc.addImage(settings.signatureUrl, isPng ? 'PNG' : 'JPEG', sigX + 2, sigY + 1, sigWidth - 4, sigBoxHeight - 2, undefined, 'FAST');
    } catch (err) {
      console.warn('Failed to embed signature in Statement PDF:', err);
    }

    // 3. Signature line
    doc.setDrawColor(71, 85, 105);
    doc.setLineWidth(0.5);
    doc.line(sigX, sigY + sigBoxHeight + 2, sigX + sigWidth, sigY + sigBoxHeight + 2);

    // 4. Signatory / Trader Name
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text((settings.userName || 'Authorized Signatory').toUpperCase(), sigX + sigWidth / 2, sigY + sigBoxHeight + 6.5, { align: 'center' });

    // 5. Signatory title
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('Authorized Signatory', sigX + sigWidth / 2, sigY + sigBoxHeight + 10, { align: 'center' });
  } else {
    // Placeholder line for manual sign/stamp if signature image not yet configured
    doc.setDrawColor(148, 163, 184);
    doc.setLineWidth(0.5);
    doc.line(sigX, sigY + 16, sigX + sigWidth, sigY + 16);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text((settings.userName || 'Authorized Signatory').toUpperCase(), sigX + sigWidth / 2, sigY + 20.5, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('Authorized Signatory', sigX + sigWidth / 2, sigY + 24, { align: 'center' });
  }

  const pdfDataUri = doc.output('datauristring');
  const safeName = partyName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const dateStamp = getTodayDateString();
  const fileName = `Statement-${safeName}-${dateStamp}.pdf`;

  await shareBase64File({
    data: pdfDataUri,
    fileName,
    mimeType: 'application/pdf',
    title: `Account Statement - ${partyName}`,
    text: `Official Statement of Account for ${partyName}. Net Balance Due: ${curSym} ${formatAmountNumber(outstanding, settings)}.`,
    dialogTitle: 'Share Statement PDF',
  });
}

/**
 * Generates a high-density Landscape A4 Fleet & Multi-Dispatch Audit Report
 */
async function exportFleetAuditPdf(options: ExportDispatchesPdfOptions & { settings: AppSettings }): Promise<void> {
  const {
    title = 'COAL DISPATCH LEDGER & FLEET AUDIT',
    subtitle,
    partyName,
    dateRange,
    dispatches,
    parties,
    pos,
    settings,
  } = options;

  const { jsPDF, autoTable } = await loadPdfEngines();
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;

  // 1. Executive Top Accent Banner
  doc.setFillColor(11, 18, 32); // Deep Midnight Obsidian
  doc.rect(0, 0, pageWidth, 4.5, 'F');
  doc.setFillColor(197, 160, 89); // Antique Gold Micro-Rule
  doc.rect(0, 4.5, pageWidth, 0.8, 'F');

  // Header: Business Information
  let headerTextX = margin;
  if (settings.logoUrl && settings.logoUrl.startsWith('data:image')) {
    try {
      const isPng = settings.logoUrl.includes('image/png');
      doc.addImage(settings.logoUrl, isPng ? 'PNG' : 'JPEG', margin, 8.5, 14, 14);
      headerTextX = margin + 17;
    } catch {
      // ignore if image format unsupported
    }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(11, 18, 32);
  doc.text((settings.businessName || 'AWAN COAL LOGISTICS').toUpperCase(), headerTextX, 15);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  const subline = [
    settings.phoneNumber ? `Tel: ${settings.phoneNumber}` : '',
    settings.ntnNumber ? `NTN: ${settings.ntnNumber}` : '',
    settings.companyAddress ? settings.companyAddress : '',
  ]
    .filter(Boolean)
    .join('   •   ');
  if (subline) {
    doc.text(subline, headerTextX, 20);
  }

  // Report Title & Meta
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(11, 18, 32);
  doc.text(title, margin, 28);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);

  const ledgerTotals = calculateLedgerTotals(dispatches, settings);
  const totalTons = ledgerTotals.receivedTons;
  const totalRevenue = ledgerTotals.revenue;
  const totalCost = ledgerTotals.cost;
  const totalProfit = ledgerTotals.profit;

  const metaParts = [
    partyName ? `Party: ${partyName}` : null,
    dateRange ? `Period: ${dateRange}` : null,
    subtitle ? subtitle : null,
    `Audit Generated: ${formatDisplayDate(new Date())}`,
    `Total Dispatches: ${dispatches.length}${ledgerTotals.pendingCount > 0 ? ` (${ledgerTotals.settledCount} Settled, ${ledgerTotals.pendingCount} In-Transit)` : ''}`,
  ].filter(Boolean);
  doc.text(metaParts.join('   •   '), margin, 33);

  const bannerY = 37.5;
  const bannerHeight = 15;
  const bannerWidth = pageWidth - margin * 2;

  // Light gray background box
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, bannerY, bannerWidth, bannerHeight, 2, 2, 'FD');

  const curSym = getCurrencySymbol(settings.currency);
  const colWidth = bannerWidth / 4;
  const kpiItems = [
    { label: 'TOTAL DELIVERED', value: `${totalTons.toFixed(2)} Tons`, color: [15, 23, 42], topBar: [30, 58, 138] },
    { label: 'TOTAL REVENUE', value: `${curSym} ${formatAmountNumber(totalRevenue, settings)}`, color: [15, 23, 42], topBar: [71, 85, 105] },
    { label: 'TOTAL COST', value: `${curSym} ${formatAmountNumber(totalCost, settings)}`, color: [15, 23, 42], topBar: [180, 83, 9] },
    { label: 'NET TRADING PROFIT', value: `${curSym} ${formatAmountNumber(totalProfit, settings)}`, color: [5, 150, 105], topBar: [5, 150, 105] },
  ];

  kpiItems.forEach((kpi, idx) => {
    const x = margin + idx * colWidth;
    // Top colored bar for each segment
    doc.setFillColor(kpi.topBar[0], kpi.topBar[1], kpi.topBar[2]);
    doc.rect(x + 1, bannerY, colWidth - 2, 1, 'F');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(kpi.label, x + 6, bannerY + 5.2);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(kpi.color[0], kpi.color[1], kpi.color[2]);
    doc.text(kpi.value, x + 6, bannerY + 11);
  });

  // Table Data - 3 lines per dispatch entry with alternating colors
  const sortedDispatches = [...dispatches].sort((a, b) => b.date.localeCompare(a.date));

  const tableRows: any[] = [];
  sortedDispatches.forEach((d, index) => {
    const party = parties.find((p) => p.id === d.partyId);
    const po = pos.find((p) => p.id === d.poId);
    const s = calculateSettlement(d);
    const adj = getEffectiveAdjustments(d);
    const transit = calculateTransitLoss(d);
    const isPending = transit.isPending;

    const gcvDelta = d.targetGcv && d.labActualGcv ? d.labActualGcv - d.targetGcv : null;
    const gcvDeltaStr = gcvDelta !== null ? `(${gcvDelta >= 0 ? '+' : ''}${gcvDelta} kcal)` : '';
    const marginPct = !isPending && s.totalRevenue > 0 ? ((s.netProfit / s.totalRevenue) * 100).toFixed(1) : '0';

    const sourcesStr =
      d.coalInputs && d.coalInputs.length > 0
        ? d.coalInputs
            .filter((c) => (c.weight || 0) > 0)
            .map((c) => `${c.sourceName || 'Coal'}: ${c.weight}t`)
            .join(', ') || 'Direct Dispatch'
        : 'Direct Dispatch';

    // Line 1: Primary logistics & commercial settlement numbers
    const row1 = [
      { content: (index + 1).toString(), rowSpan: 3, styles: { valign: 'middle', halign: 'center' } },
      formatDisplayDate(d.date) || '-',
      d.truckNumber || '-',
      party?.name || d.factoryName || '-',
      po?.poNumber || '-',
      isPending ? '0.00 (In-Transit)' : (d.labReceivedWeight || 0).toFixed(2),
      Math.round(d.baseRate || 0).toLocaleString('en-PK'),
      s.payableRate.toFixed(2),
      isPending ? '0 (Pending)' : Math.round(s.totalRevenue).toLocaleString('en-PK'),
      isPending ? '0 (Pending)' : Math.round(s.totalCost).toLocaleString('en-PK'),
      isPending ? 'Pending' : `${s.netProfit >= 0 ? '+' : ''}${Math.round(s.netProfit).toLocaleString('en-PK')}`,
    ];

    // Line 2: Lab specifications & quality audit
    const labSpecsList = [
      `Target: ${d.targetGcv ? d.targetGcv + ' kcal' : '-'}`,
      `Actual Lab: ${d.labActualGcv ? d.labActualGcv + ' kcal' : '-'} ${gcvDeltaStr}`.trim(),
      `Sulphur: ${d.labSulphur ? d.labSulphur + '%' : '-'}`,
      d.labAsh ? `Ash: ${d.labAsh}%` : null,
      d.labMoisture ? `Moisture: ${d.labMoisture}%` : null,
      d.labVm ? `VM: ${d.labVm}%` : null,
      isPending
        ? 'Status: In-Transit (Awaiting Weighbridge)'
        : (transit.totalLoadedWeight > 0 && Math.abs(transit.diff) >= 0.01
            ? `Transit: ${transit.diff < 0 ? '-' : '+'}${Math.abs(transit.diff).toFixed(2)}t (${transit.lossPercentage.toFixed(1)}%)`
            : null),
    ].filter(Boolean);

    const labText = `LAB QUALITY & ANALYSIS: ${labSpecsList.join('   •   ')}`;

    // Line 3: Commercial adjustments, pricing audit & sourcing
    const adjList = [
      adj.deduction ? `GCV Ded: -${curSym}${adj.deduction.toFixed(2)}/t${adj.isProrata ? ' (Pro-Rata)' : ''}` : null,
      adj.premium ? `Bonus: +${curSym}${adj.premium.toFixed(2)}/t${adj.isProrata ? ' (Pro-Rata)' : ''}` : null,
      s.dieselAdjustment ? `Diesel: ${s.dieselAdjustment > 0 ? '+' : '-'}${curSym}${Math.abs(s.dieselAdjustment).toFixed(2)}/t` : null,
      s.taxDeduction ? `Tax: -${curSym}${s.taxDeduction.toFixed(2)}/t` : null,
      d.commissionPerTon ? `Comm: -${curSym}${d.commissionPerTon}/t` : null,
    ].filter(Boolean);

    const adjText = adjList.length > 0 ? `RATE AUDIT: ${adjList.join('   •   ')}` : 'RATE AUDIT: Standard Settlement';

    const notesSnippet = d.notes ? `Note: ${d.notes}` : '';
    const sourcingText = [
      `Sources: ${sourcesStr}`,
      `Margin: ${marginPct}%`,
      notesSnippet,
    ]
      .filter(Boolean)
      .join('   •   ');

    const row2 = [
      { content: labText, colSpan: 10 },
    ];

    const row3 = [
      { content: `${adjText}   |   SOURCING & LOGISTICS: ${sourcingText}`, colSpan: 10 },
    ];

    tableRows.push(row1, row2, row3);
  });

  // Add Grand Totals footer row
  const tableFooter = [
    [
      '',
      'TOTALS',
      `${dispatches.length} trucks`,
      '',
      '',
      totalTons.toFixed(2),
      '-',
      '-',
      Math.round(totalRevenue).toLocaleString('en-PK'),
      Math.round(totalCost).toLocaleString('en-PK'),
      `${totalProfit >= 0 ? '+' : ''}${Math.round(totalProfit).toLocaleString('en-PK')}`,
    ],
  ];

  autoTable(doc, {
    startY: bannerY + bannerHeight + 5,
    margin: { left: margin, right: margin, bottom: 15 },
    head: [
      [
        '#',
        'Date',
        'Truck No',
        'Factory / Consignee',
        'PO #',
        'Tons',
        'Base (Rs)',
        'Payable (Rs)',
        'Revenue (Rs)',
        'Cost (Rs)',
        'Profit (Rs)',
      ],
    ],
    body: tableRows,
    foot: tableFooter,
    theme: 'grid',
    rowPageBreak: 'avoid',
    headStyles: {
      fillColor: [11, 18, 32],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
      halign: 'left',
      cellPadding: 2.5,
    },
    footStyles: {
      fillColor: [11, 18, 32],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8.5,
      cellPadding: 3,
    },
    bodyStyles: {
      fontSize: 8,
      textColor: [51, 65, 85],
      cellPadding: 2,
    },
    didParseCell: (data) => {
      if (data.section === 'body') {
        const rowIndex = data.row.index;
        const entryIndex = Math.floor(rowIndex / 3);
        const subRow = rowIndex % 3;
        const isEvenEntry = entryIndex % 2 === 0;

        const line1Bg: [number, number, number] = isEvenEntry ? [255, 255, 255] : [241, 245, 249];
        const line2Bg: [number, number, number] = isEvenEntry ? [250, 252, 255] : [236, 241, 246];
        const line3Bg: [number, number, number] = isEvenEntry ? [246, 249, 254] : [232, 237, 243];

        data.cell.styles.fillColor = subRow === 0 ? line1Bg : subRow === 1 ? line2Bg : line3Bg;

        if (subRow === 0) {
          data.cell.styles.fontSize = 8;
          data.cell.styles.cellPadding = { top: 2.2, bottom: 1.5, left: 2.5, right: 2.5 };
          data.cell.styles.lineWidth = { top: 0, right: 0.15, bottom: 0.15, left: 0.15 };
          data.cell.styles.lineColor = isEvenEntry ? [241, 245, 249] : [226, 232, 240];

          if (data.column.index === 2) {
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.textColor = [15, 23, 42];
          }

          if (data.column.index === 10) {
            const textVal = String(data.cell.raw || '');
            if (textVal.startsWith('+')) {
              data.cell.styles.textColor = [22, 163, 74];
              data.cell.styles.fontStyle = 'bold';
            } else if (textVal.startsWith('-')) {
              data.cell.styles.textColor = [220, 38, 38];
              data.cell.styles.fontStyle = 'bold';
            }
          }
        } else if (subRow === 1) {
          data.cell.styles.fontSize = 7;
          data.cell.styles.textColor = [51, 65, 85];
          data.cell.styles.fontStyle = 'normal';
          data.cell.styles.cellPadding = { top: 1.2, bottom: 1.2, left: 3, right: 3 };
          data.cell.styles.lineWidth = { top: 0, right: 0.15, bottom: 0.15, left: 0.15 };
          data.cell.styles.lineColor = [226, 232, 240];
        } else {
          data.cell.styles.fontSize = 7;
          data.cell.styles.textColor = [71, 85, 105];
          data.cell.styles.fontStyle = 'normal';
          data.cell.styles.cellPadding = { top: 1.2, bottom: 2.2, left: 3, right: 3 };
          // Bold bottom dividing border on the last line of the entry!
          data.cell.styles.lineWidth = { top: 0, right: 0.15, bottom: 0.8, left: 0.15 };
          data.cell.styles.lineColor = [148, 163, 184];
        }

        if (data.column.index === 0) {
          data.cell.styles.lineWidth = { top: 0, right: 0.2, bottom: 0.8, left: 0.15 };
          data.cell.styles.lineColor = [148, 163, 184];
          data.cell.styles.valign = 'middle';
          data.cell.styles.halign = 'center';
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.textColor = [100, 116, 139];
          data.cell.styles.fillColor = isEvenEntry ? ([255, 255, 255] as [number, number, number]) : ([241, 245, 249] as [number, number, number]);
        }
      }
    },
    columnStyles: {
      0: { cellWidth: 9, halign: 'center' },
      1: { cellWidth: 21 },
      2: { cellWidth: 25, fontStyle: 'bold' },
      3: { cellWidth: 46 },
      4: { cellWidth: 23 },
      5: { cellWidth: 18, halign: 'right' },
      6: { cellWidth: 22, halign: 'right' },
      7: { cellWidth: 24, halign: 'right' },
      8: { cellWidth: 28, halign: 'right' },
      9: { cellWidth: 27, halign: 'right' },
      10: { cellWidth: 28, halign: 'right', fontStyle: 'bold' },
    },
    didDrawPage: () => {
      const str = `Page ${doc.getNumberOfPages()} of ${doc.getNumberOfPages()}  •  ${settings.businessName || 'Awan Coal Logistics'} Official Ledger`;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(148, 163, 184);
      doc.text(str, pageWidth / 2, pageHeight - 8, { align: 'center' });
    },
  });

  // --- Official Authorized Signature Section on Last Page ---
  doc.setPage(doc.getNumberOfPages());
  const finalY = (doc as any).lastAutoTable?.finalY || 140;

  let sigY: number;
  if (finalY + 36 > pageHeight - 15) {
    doc.addPage();
    doc.setPage(doc.getNumberOfPages());
    sigY = 22;
  } else {
    sigY = finalY + 7;
  }

  const sigWidth = 55;
  const sigBoxHeight = 18;
  const sigX = pageWidth - margin - sigWidth;

  // Left-aligned courtesy & system note
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Thank you for conducting business with us.', margin, sigY + 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text(`Official Dispatch Ledger Audit • ${settings.businessName || 'Awan Coal Logistics'}`, margin, sigY + 18.5);

  // Right-aligned Authorized Signatory Block
  if (settings.signatureUrl && settings.signatureUrl.trim().length > 0) {
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.roundedRect(sigX, sigY, sigWidth, sigBoxHeight, 2, 2, 'FD');

    try {
      const isPng = !settings.signatureUrl.includes('image/jpeg');
      doc.addImage(settings.signatureUrl, isPng ? 'PNG' : 'JPEG', sigX + 2, sigY + 1, sigWidth - 4, sigBoxHeight - 2, undefined, 'FAST');
    } catch (err) {
      console.warn('Failed to embed signature in Fleet Ledger PDF:', err);
    }

    doc.setDrawColor(71, 85, 105);
    doc.setLineWidth(0.5);
    doc.line(sigX, sigY + sigBoxHeight + 2, sigX + sigWidth, sigY + sigBoxHeight + 2);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text((settings.userName || 'Authorized Signatory').toUpperCase(), sigX + sigWidth / 2, sigY + sigBoxHeight + 6.5, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('Authorized Signatory', sigX + sigWidth / 2, sigY + sigBoxHeight + 10, { align: 'center' });
  } else {
    doc.setDrawColor(148, 163, 184);
    doc.setLineWidth(0.5);
    doc.line(sigX, sigY + 16, sigX + sigWidth, sigY + 16);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text((settings.userName || 'Authorized Signatory').toUpperCase(), sigX + sigWidth / 2, sigY + 20.5, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('Authorized Signatory', sigX + sigWidth / 2, sigY + 24, { align: 'center' });
  }

  const pdfDataUri = doc.output('datauristring');
  const safeName = (partyName || 'All_Dispatches').replace(/[^a-zA-Z0-9_-]/g, '_');
  const dateStamp = getTodayDateString();
  const fileName = `Ledger-${safeName}-${dateStamp}.pdf`;

  await shareBase64File({
    data: pdfDataUri,
    fileName,
    mimeType: 'application/pdf',
    title: `Factory Ledger - ${partyName || 'All Dispatches'}`,
    text: `Factory Dispatch Ledger containing ${dispatches.length} deliveries. Total: ${totalTons.toFixed(2)} tons.`,
    dialogTitle: 'Share PDF Ledger',
  });
}

export interface ExportDispatchesExcelOptions {
  fileName?: string;
  partyName?: string;
  party?: Party;
  payments?: Payment[];
  dateRange?: string;
  startDate?: string;
  endDate?: string;
  openingBalance?: number;
  dispatches: Dispatch[];
  parties: Party[];
  pos: PurchaseOrder[];
  settings?: AppSettings;
}

/**
 * Helper to convert ExcelJS writeBuffer (ArrayBuffer) to Base64 string
 * without stack overflow on large exports.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 0x8000; // 32KB
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// ─────────────────────────────────────────────────────────────────────────────
// Executive Styling Palette (Strictly 100% Solid Flat Colors, NO Gradients)
// ─────────────────────────────────────────────────────────────────────────────
const XL_PALETTE = {
  NAVY_BANNER: 'FF0F172A',      // Slate 900
  NAVY_SUBBANNER: 'FF1E293B',   // Slate 800
  HEADER_PRIMARY: 'FF1E293B',   // Slate 800
  HEADER_ACCENT: 'FF2563EB',    // Royal Blue 600
  HEADER_TEXT: 'FFFFFFFF',      // White
  
  TEXT_PRIMARY: 'FF0F172A',     // Slate 900
  TEXT_SECONDARY: 'FF475569',   // Slate 600
  TEXT_MUTED: 'FF94A3B8',       // Slate 400
  TEXT_GREEN: 'FF047857',       // Emerald 700
  TEXT_RED: 'FFB91C1C',         // Rose 700
  TEXT_BLUE: 'FF1D4ED8',        // Blue 700

  CARD_FILL: 'FFF8FAFC',        // Slate 50
  CARD_BORDER: 'FFE2E8F0',      // Slate 200

  ZEBRA_EVEN: 'FFFFFFFF',       // Pure White
  ZEBRA_ODD: 'FFF8FAFC',        // Slate 50
  TOTAL_FILL: 'FFF1F5F9',       // Slate 100

  PAYMENT_REC_FILL: 'FFF0FDF4', // Light Emerald 50
  PAYMENT_REC_TEXT: 'FF047857', // Emerald 700
  PAYMENT_PAID_FILL: 'FFFFF1F2',// Light Rose 50
  PAYMENT_PAID_TEXT: 'FFB91C1C',// Rose 700

  BORDER_LIGHT: 'FFE2E8F0',     // Slate 200
  BORDER_MEDIUM: 'FFCBD5E1',    // Slate 300
  BORDER_DARK: 'FF94A3B8',      // Slate 400
  BORDER_DOUBLE: 'FF0F172A',    // Slate 900

  KPI_SLATE_FILL: 'FFF1F5F9',
  KPI_SLATE_BORDER: 'FFCBD5E1',
  KPI_BLUE_FILL: 'FFEFF6FF',
  KPI_BLUE_BORDER: 'FFBFDBFE',
  KPI_GREEN_FILL: 'FFECFDF5',
  KPI_GREEN_BORDER: 'FFA7F3D0',
  KPI_RED_FILL: 'FFFEF2F2',
  KPI_RED_BORDER: 'FFFECACA',
};

const BORDER_CELL_LIGHT: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: XL_PALETTE.BORDER_LIGHT } },
  bottom: { style: 'thin', color: { argb: XL_PALETTE.BORDER_LIGHT } },
  left: { style: 'thin', color: { argb: XL_PALETTE.BORDER_LIGHT } },
  right: { style: 'thin', color: { argb: XL_PALETTE.BORDER_LIGHT } },
};

const BORDER_TOTAL_ACCOUNTING: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: XL_PALETTE.BORDER_DARK } },
  bottom: { style: 'double', color: { argb: XL_PALETTE.BORDER_DOUBLE } },
  left: { style: 'thin', color: { argb: XL_PALETTE.BORDER_LIGHT } },
  right: { style: 'thin', color: { argb: XL_PALETTE.BORDER_LIGHT } },
};

/**
 * Universal auto-fit column widths calculator
 */
function autoFitWorksheetColumns(ws: ExcelJS.Worksheet, minWidths: { [colIdx: number]: number } = {}) {
  ws.columns.forEach((col, idx) => {
    let maxLen = 0;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      // Exclude top merged header banners from skewing column width
      if (Number(cell.row) <= 3) return;
      const val = cell.value !== undefined && cell.value !== null ? String(cell.value) : '';
      if (val.length > maxLen) {
        maxLen = val.length;
      }
    });
    const colNum = col.number || idx + 1;
    const minW = minWidths[colNum] || 12;
    col.width = Math.max(minW, Math.min(maxLen + 4, 46));
  });
}

/**
 * Adds an Executive Corporate Banner Header at Rows 1-2
 */
function addWorksheetBanner(
  ws: ExcelJS.Worksheet,
  lastColLetter: string,
  companyName: string,
  subline: string,
  docBadge: string
) {
  // Row 1: Company Title
  ws.mergeCells(`A1:${lastColLetter}1`);
  const r1 = ws.getCell('A1');
  r1.value = companyName.toUpperCase();
  r1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL_PALETTE.NAVY_BANNER } };
  r1.font = { name: 'Calibri', size: 16, bold: true, color: { argb: XL_PALETTE.HEADER_TEXT } };
  r1.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 36;

  // Row 2: Subline & Document Meta
  ws.mergeCells(`A2:${lastColLetter}2`);
  const r2 = ws.getCell('A2');
  r2.value = `${docBadge ? `${docBadge.toUpperCase()}   •   ` : ''}${subline}`;
  r2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL_PALETTE.NAVY_SUBBANNER } };
  r2.font = { name: 'Calibri', size: 9.5, color: { argb: XL_PALETTE.TEXT_MUTED } };
  r2.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(2).height = 20;

  // Row 3: Spacer
  ws.getRow(3).height = 10;
}

/**
 * Renders 4 Executive KPI Metric Cards in an Excel Worksheet
 */
function addKpiRowCards(
  ws: ExcelJS.Worksheet,
  rowStart: number,
  cards: Array<{
    colSpan: [string, string];
    label: string;
    value: string | number;
    sub: string;
    numFmt?: string;
    fillColor: string;
    borderColor: string;
    valColor: string;
  }>
) {
  ws.getRow(rowStart).height = 16;
  ws.getRow(rowStart + 1).height = 24;
  ws.getRow(rowStart + 2).height = 16;

  cards.forEach((card) => {
    const [cStart, cEnd] = card.colSpan;

    // Merge for Label
    ws.mergeCells(`${cStart}${rowStart}:${cEnd}${rowStart}`);
    const cellLabel = ws.getCell(`${cStart}${rowStart}`);
    cellLabel.value = card.label.toUpperCase();
    cellLabel.font = { name: 'Calibri', size: 8, bold: true, color: { argb: XL_PALETTE.TEXT_SECONDARY } };
    cellLabel.alignment = { vertical: 'middle', horizontal: 'center' };

    // Merge for Big Hero Value
    ws.mergeCells(`${cStart}${rowStart + 1}:${cEnd}${rowStart + 1}`);
    const cellVal = ws.getCell(`${cStart}${rowStart + 1}`);
    cellVal.value = card.value;
    if (card.numFmt) cellVal.numFmt = card.numFmt;
    cellVal.font = { name: 'Calibri', size: 14, bold: true, color: { argb: card.valColor } };
    cellVal.alignment = { vertical: 'middle', horizontal: 'center' };

    // Merge for Subtitle
    ws.mergeCells(`${cStart}${rowStart + 2}:${cEnd}${rowStart + 2}`);
    const cellSub = ws.getCell(`${cStart}${rowStart + 2}`);
    cellSub.value = card.sub;
    cellSub.font = { name: 'Calibri', size: 8, color: { argb: XL_PALETTE.TEXT_MUTED } };
    cellSub.alignment = { vertical: 'middle', horizontal: 'center' };

    // Apply card background and border styling to every cell in the block
    const startColNum = ws.getColumn(cStart).number;
    const endColNum = ws.getColumn(cEnd).number;
    for (let r = rowStart; r <= rowStart + 2; r++) {
      for (let c = startColNum; c <= endColNum; c++) {
        const cell = ws.getRow(r).getCell(c);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: card.fillColor } };
        cell.border = {
          top: r === rowStart ? { style: 'thin', color: { argb: card.borderColor } } : undefined,
          bottom: r === rowStart + 2 ? { style: 'thin', color: { argb: card.borderColor } } : undefined,
          left: c === startColNum ? { style: 'thin', color: { argb: card.borderColor } } : undefined,
          right: c === endColNum ? { style: 'thin', color: { argb: card.borderColor } } : undefined,
        };
      }
    }
  });

  // Spacer row after KPI row
  ws.getRow(rowStart + 3).height = 12;
}

/**
 * Generate a multi-sheet, beautifully formatted .xlsx workbook with executive styling.
 */
export async function exportDispatchesExcel(options: ExportDispatchesExcelOptions): Promise<void> {
  const { dispatches, parties, pos, payments = [] } = options;
  const settings = options.settings || (await getSettings());
  const party = options.party || parties.find((p) => p.name === options.partyName);
  const partyName = party?.name || options.partyName;
  const isSingleParty = Boolean(party || (partyName && payments.length > 0));

  const ExcelJSModule = await loadExcelEngine();
  const wb = new ExcelJSModule.Workbook();
  wb.creator = settings.businessName || 'Factory Ledger';
  wb.lastModifiedBy = settings.userName || 'Factory Ledger';
  wb.created = new Date();
  wb.modified = new Date();

  const xlCurFmt = getCurrencyExcelFormat(settings.currency);
  const curSym = getCurrencySymbol(settings.currency);

  const dateStamp = getTodayDateString();
  const companyName = settings.businessName || 'AWAN COAL LOGISTICS';
  const companySubline = [
    settings.phoneNumber ? `Tel: ${settings.phoneNumber}` : '',
    settings.ntnNumber ? `NTN: ${settings.ntnNumber}` : '',
    settings.companyAddress || '',
  ].filter(Boolean).join('   •   ');

  if (isSingleParty) {
    // ════════════════════════════════════════════════════════════════════════
    // SHEET 1: OFFICIAL STATEMENT OF ACCOUNT (Chronological Running Balance)
    // ════════════════════════════════════════════════════════════════════════
    const openingBalance = options.openingBalance || 0;
    const hasDateRange = Boolean(options.dateRange && options.dateRange !== 'All Time');
    const balanceResult = calculatePartyBalance(dispatches, payments);
    const totalTons = balanceResult.totalTons;
    const totalBilled = balanceResult.totalBilled;
    const totalReceived = balanceResult.totalPaymentsReceived;
    const netBalance = openingBalance + totalBilled - totalReceived;

    const wsStatement = wb.addWorksheet('Statement of Account', {
      views: [{ state: 'frozen', ySplit: 12, showGridLines: true }],
      properties: { tabColor: { argb: 'FF007AFF' } },
    });

    // 1. Top Banner
    addWorksheetBanner(
      wsStatement,
      'J',
      companyName,
      companySubline,
      'OFFICIAL STATEMENT OF ACCOUNT'
    );

    // 2. Party & Document Profile Card (Rows 4-6)
    wsStatement.getRow(4).height = 17;
    wsStatement.getRow(5).height = 22;
    wsStatement.getRow(6).height = 18;

    // Left block: Account Holder Details (A4:E6)
    wsStatement.mergeCells('A4:E4');
    const ch4 = wsStatement.getCell('A4');
    ch4.value = 'ACCOUNT HOLDER / FACTORY:';
    ch4.font = { name: 'Calibri', size: 8, bold: true, color: { argb: XL_PALETTE.TEXT_MUTED } };
    ch4.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    wsStatement.mergeCells('A5:E5');
    const ch5 = wsStatement.getCell('A5');
    ch5.value = (partyName || 'Ledger Account').toUpperCase();
    ch5.font = { name: 'Calibri', size: 13, bold: true, color: { argb: XL_PALETTE.TEXT_PRIMARY } };
    ch5.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    wsStatement.mergeCells('A6:E6');
    const ch6 = wsStatement.getCell('A6');
    const partyMetaParts = [
      party?.contactPerson ? `Attn: ${party.contactPerson}` : '',
      party?.phone ? `Tel: ${party.phone}` : '',
      party?.address || '',
    ].filter(Boolean);
    ch6.value = partyMetaParts.join('   |   ') || 'Verified Party Ledger';
    ch6.font = { name: 'Calibri', size: 9, color: { argb: XL_PALETTE.TEXT_SECONDARY } };
    ch6.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

    // Right block: Document Meta (F4:J6)
    wsStatement.mergeCells('F4:J4');
    const rh4 = wsStatement.getCell('F4');
    rh4.value = 'STATEMENT DETAILS:';
    rh4.font = { name: 'Calibri', size: 8, bold: true, color: { argb: XL_PALETTE.TEXT_MUTED } };
    rh4.alignment = { vertical: 'middle', horizontal: 'right' };

    wsStatement.mergeCells('F5:J5');
    const rh5 = wsStatement.getCell('F5');
    rh5.value = hasDateRange ? `Period: ${options.dateRange}` : `As of ${formatDisplayDate(new Date())}`;
    rh5.font = { name: 'Calibri', size: 12, bold: true, color: { argb: XL_PALETTE.TEXT_BLUE } };
    rh5.alignment = { vertical: 'middle', horizontal: 'right' };

    wsStatement.mergeCells('F6:J6');
    const rh6 = wsStatement.getCell('F6');
    rh6.value = `Issue Date: ${formatDisplayDate(new Date())}   •   Currency: ${settings.currency || 'PKR (Rs.)'}   •   Status: ${netBalance > 0 ? 'Payment Due' : 'Settled'}`;
    rh6.font = { name: 'Calibri', size: 9, color: { argb: XL_PALETTE.TEXT_SECONDARY } };
    rh6.alignment = { vertical: 'middle', horizontal: 'right' };

    // Fill & Borders for profile cards
    for (let r = 4; r <= 6; r++) {
      for (let c = 1; c <= 10; c++) {
        const cell = wsStatement.getRow(r).getCell(c);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL_PALETTE.CARD_FILL } };
        cell.border = {
          top: r === 4 ? { style: 'thin', color: { argb: XL_PALETTE.CARD_BORDER } } : undefined,
          bottom: r === 6 ? { style: 'thin', color: { argb: XL_PALETTE.CARD_BORDER } } : undefined,
          left: c === 1 || c === 6 ? { style: 'thin', color: { argb: XL_PALETTE.CARD_BORDER } } : undefined,
          right: c === 5 || c === 10 ? { style: 'thin', color: { argb: XL_PALETTE.CARD_BORDER } } : undefined,
        };
      }
    }

    // Spacer row
    wsStatement.getRow(7).height = 10;

    // 3. Four Executive KPI Cards (Rows 8-10)
    addKpiRowCards(wsStatement, 8, [
      {
        colSpan: ['A', 'B'],
        label: hasDateRange ? 'Delivered (Period)' : 'Delivered Tonnage',
        value: totalTons,
        sub: `${dispatches.length} Trucks Completed`,
        numFmt: '#,##0.00" t"',
        fillColor: XL_PALETTE.KPI_SLATE_FILL,
        borderColor: XL_PALETTE.KPI_SLATE_BORDER,
        valColor: XL_PALETTE.TEXT_PRIMARY,
      },
      {
        colSpan: ['C', 'E'],
        label: hasDateRange ? 'Billed in Period' : 'Total Invoiced (Debit)',
        value: Math.round(totalBilled),
        sub: 'Gross Deliveries Billed',
        numFmt: xlCurFmt,
        fillColor: XL_PALETTE.KPI_BLUE_FILL,
        borderColor: XL_PALETTE.KPI_BLUE_BORDER,
        valColor: XL_PALETTE.TEXT_BLUE,
      },
      {
        colSpan: ['F', 'G'],
        label: hasDateRange ? 'Credited in Period' : 'Payments Credited',
        value: Math.round(totalReceived),
        sub: `${payments.filter((p) => p.type === 'received').length} Receipts Cleared`,
        numFmt: xlCurFmt,
        fillColor: XL_PALETTE.KPI_GREEN_FILL,
        borderColor: XL_PALETTE.KPI_GREEN_BORDER,
        valColor: XL_PALETTE.TEXT_GREEN,
      },
      {
        colSpan: ['H', 'J'],
        label: hasDateRange ? 'Closing Balance Due' : 'Net Balance Due',
        value: Math.round(netBalance),
        sub: netBalance > 0 ? 'Receivable from Party' : 'Account Fully Settled',
        numFmt: xlCurFmt,
        fillColor: netBalance > 0 ? XL_PALETTE.KPI_RED_FILL : XL_PALETTE.KPI_GREEN_FILL,
        borderColor: netBalance > 0 ? XL_PALETTE.KPI_RED_BORDER : XL_PALETTE.KPI_GREEN_BORDER,
        valColor: netBalance > 0 ? XL_PALETTE.TEXT_RED : XL_PALETTE.TEXT_GREEN,
      },
    ]);

    // 4. Main Transaction Table Headers (Row 12)
    const stmtHeaders = [
      'Sr #',
      'Date',
      'Transaction Particulars & Description',
      'Ref / Truck #',
      'Weight (t)',
      'Rate (Rs/t)',
      'Invoiced Debit (Rs)',
      'Payment Credit (Rs)',
      'Running Balance (Rs)',
      'Remarks / Note',
    ];

    const hRow = wsStatement.getRow(12);
    hRow.height = 28;
    stmtHeaders.forEach((title, i) => {
      const cell = hRow.getCell(i + 1);
      cell.value = title;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL_PALETTE.HEADER_PRIMARY } };
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: XL_PALETTE.HEADER_TEXT } };
      cell.alignment = {
        vertical: 'middle',
        horizontal: i === 0 || i === 1 || i === 3 ? 'center' : i >= 4 && i <= 8 ? 'right' : 'left',
      };
      cell.border = BORDER_CELL_LIGHT;
    });

    // 5. Data Rows
    type StatementEntry =
      | { kind: 'dispatch'; date: string; data: Dispatch }
      | { kind: 'payment'; date: string; data: Payment };

    const statementEntries: StatementEntry[] = [
      ...dispatches.map((d) => ({ kind: 'dispatch' as const, date: d.date, data: d })),
      ...payments.map((p) => ({ kind: 'payment' as const, date: p.date, data: p })),
    ].sort((a, b) => a.date.localeCompare(b.date));

    let runBal = openingBalance;
    let currentRowIdx = 13;

    if (openingBalance !== 0 || hasDateRange) {
      const row = wsStatement.getRow(currentRowIdx);
      row.height = 22;
      row.getCell(1).value = 0;
      row.getCell(2).value = options.dateRange?.includes('–') ? options.dateRange.split('–')[0].trim() : '-';
      row.getCell(3).value = 'OPENING BALANCE BROUGHT FORWARD (B/F)';
      row.getCell(4).value = '-';
      row.getCell(5).value = '-';
      row.getCell(6).value = '-';
      row.getCell(7).value = openingBalance > 0 ? openingBalance : '-';
      if (openingBalance > 0) row.getCell(7).numFmt = xlCurFmt;
      row.getCell(8).value = openingBalance < 0 ? Math.abs(openingBalance) : '-';
      if (openingBalance < 0) row.getCell(8).numFmt = xlCurFmt;
      row.getCell(9).value = runBal;
      row.getCell(9).numFmt = xlCurFmt;
      row.getCell(10).value = 'Prior period accumulated balance';

      for (let c = 1; c <= 10; c++) {
        const cell = row.getCell(c);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL_PALETTE.KPI_SLATE_FILL } };
        cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: XL_PALETTE.TEXT_PRIMARY } };
        cell.border = BORDER_CELL_LIGHT;
        cell.alignment = {
          vertical: 'middle',
          horizontal: c === 1 || c === 2 || c === 4 ? 'center' : c >= 5 && c <= 9 ? 'right' : 'left',
        };
      }
      currentRowIdx++;
    }

    statementEntries.forEach((entry, idx) => {
      const row = wsStatement.getRow(currentRowIdx);
      row.height = 22;
      const isEven = idx % 2 === 0;

      if (entry.kind === 'dispatch') {
        const d = entry.data;
        const s = calculateSettlement(d);
        const isPending = isDispatchPending(d);
        const invoiced = isPending ? 0 : roundPartyLedgerAmount(s.totalRevenue);
        runBal += invoiced;
        const po = pos.find((p) => p.id === d.poId);

        row.values = [
          idx + 1,
          formatDisplayDate(d.date) || '-',
          `Coal Dispatch Delivery (${d.truckNumber || 'Truck'})`,
          po?.poNumber || d.truckNumber || '-',
          d.labReceivedWeight || 0,
          parseFloat(s.payableRate.toFixed(2)),
          invoiced,
          null, // Empty credit for dispatches
          runBal,
          d.notes || '',
        ];

        // Format cells
        for (let c = 1; c <= 10; c++) {
          const cell = row.getCell(c);
          cell.font = { name: 'Calibri', size: 9.5, color: { argb: XL_PALETTE.TEXT_PRIMARY } };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: isEven ? XL_PALETTE.ZEBRA_EVEN : XL_PALETTE.ZEBRA_ODD },
          };
          cell.border = BORDER_CELL_LIGHT;

          if (c === 1 || c === 2 || c === 4) {
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
          } else if (c === 5) {
            cell.alignment = { vertical: 'middle', horizontal: 'right' };
            cell.numFmt = '#,##0.00';
          } else if (c === 6) {
            cell.alignment = { vertical: 'middle', horizontal: 'right' };
            cell.numFmt = '#,##0.00';
          } else if (c === 7) {
            cell.alignment = { vertical: 'middle', horizontal: 'right' };
            cell.numFmt = '#,##0';
            cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: XL_PALETTE.TEXT_PRIMARY } };
          } else if (c === 8) {
            cell.alignment = { vertical: 'middle', horizontal: 'right' };
            cell.value = '-';
            cell.font = { name: 'Calibri', size: 9.5, color: { argb: XL_PALETTE.TEXT_MUTED } };
          } else if (c === 9) {
            cell.alignment = { vertical: 'middle', horizontal: 'right' };
            cell.numFmt = '#,##0';
            cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: XL_PALETTE.TEXT_PRIMARY } };
          } else {
            cell.alignment = { vertical: 'middle', horizontal: 'left' };
          }
        }
      } else {
        const p = entry.data;
        const isRec = p.type === 'received';
        const amt = roundPartyLedgerAmount(p.amount);
        if (isRec) runBal -= amt;
        else runBal += amt;

        row.values = [
          idx + 1,
          formatDisplayDate(p.date) || '-',
          isRec ? `Payment Received (${p.mode.toUpperCase()})` : `Payment Outflow (${p.mode.toUpperCase()})`,
          p.referenceNote || (p.id || '').slice(0, 8).toUpperCase(),
          null,
          null,
          !isRec ? amt : null,
          isRec ? amt : null,
          runBal,
          p.referenceNote || (isRec ? 'Bank Settlement' : 'Disbursement'),
        ];

        // Format payment row with soft green/rose tint
        const bgFill = isRec ? XL_PALETTE.PAYMENT_REC_FILL : XL_PALETTE.PAYMENT_PAID_FILL;
        const txtColor = isRec ? XL_PALETTE.PAYMENT_REC_TEXT : XL_PALETTE.PAYMENT_PAID_TEXT;

        for (let c = 1; c <= 10; c++) {
          const cell = row.getCell(c);
          cell.font = { name: 'Calibri', size: 9.5, color: { argb: XL_PALETTE.TEXT_PRIMARY } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgFill } };
          cell.border = BORDER_CELL_LIGHT;

          if (c === 1 || c === 2 || c === 4) {
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
          } else if (c === 3) {
            cell.alignment = { vertical: 'middle', horizontal: 'left' };
            cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: txtColor } };
          } else if (c === 5 || c === 6) {
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.value = '-';
            cell.font = { name: 'Calibri', size: 9.5, color: { argb: XL_PALETTE.TEXT_MUTED } };
          } else if (c === 7) {
            cell.alignment = { vertical: 'middle', horizontal: 'right' };
            if (!isRec) {
              cell.numFmt = '#,##0';
              cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: XL_PALETTE.TEXT_RED } };
            } else {
              cell.value = '-';
              cell.font = { name: 'Calibri', size: 9.5, color: { argb: XL_PALETTE.TEXT_MUTED } };
            }
          } else if (c === 8) {
            cell.alignment = { vertical: 'middle', horizontal: 'right' };
            if (isRec) {
              cell.numFmt = '#,##0';
              cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: XL_PALETTE.TEXT_GREEN } };
            } else {
              cell.value = '-';
              cell.font = { name: 'Calibri', size: 9.5, color: { argb: XL_PALETTE.TEXT_MUTED } };
            }
          } else if (c === 9) {
            cell.alignment = { vertical: 'middle', horizontal: 'right' };
            cell.numFmt = '#,##0';
            cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: XL_PALETTE.TEXT_PRIMARY } };
          } else {
            cell.alignment = { vertical: 'middle', horizontal: 'left' };
          }
        }
      }

      currentRowIdx++;
    });

    // 6. Grand Total Accounting Row
    const totalRow = wsStatement.getRow(currentRowIdx);
    totalRow.height = 28;
    totalRow.values = [
      '',
      'TOTALS',
      `${dispatches.length} Deliveries • ${payments.length} Payments`,
      '',
      totalTons,
      '',
      totalBilled,
      totalReceived,
      netBalance,
      '',
    ];

    for (let c = 1; c <= 10; c++) {
      const cell = totalRow.getCell(c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL_PALETTE.TOTAL_FILL } };
      cell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: XL_PALETTE.TEXT_PRIMARY } };
      cell.border = BORDER_TOTAL_ACCOUNTING;

      if (c === 2) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else if (c === 5) {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
        cell.numFmt = '#,##0.00';
      } else if (c === 7 || c === 8) {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
        cell.numFmt = '#,##0';
      } else if (c === 9) {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
        cell.numFmt = '#,##0';
        cell.font = {
          name: 'Calibri',
          size: 11,
          bold: true,
          color: { argb: netBalance > 0 ? XL_PALETTE.TEXT_RED : XL_PALETTE.TEXT_GREEN },
        };
      } else {
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      }
    }

    // 7. Signatory & Official Footnote
    const footRowIdx = currentRowIdx + 2;
    wsStatement.mergeCells(`A${footRowIdx}:E${footRowIdx}`);
    const footCell = wsStatement.getCell(`A${footRowIdx}`);
    footCell.value = 'Official Account Statement • Computer generated electronic record • Verified by Factory Ledger';
    footCell.font = { name: 'Calibri', size: 8.5, italic: true, color: { argb: XL_PALETTE.TEXT_MUTED } };
    footCell.alignment = { vertical: 'middle', horizontal: 'left' };

    wsStatement.mergeCells(`G${footRowIdx}:J${footRowIdx}`);
    const sigCell = wsStatement.getCell(`G${footRowIdx}`);
    sigCell.value = `Authorized Signatory: ${(settings.userName || 'Authorized Signatory').toUpperCase()}`;
    sigCell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: XL_PALETTE.TEXT_SECONDARY } };
    sigCell.alignment = { vertical: 'middle', horizontal: 'right' };

    // Column Widths
    autoFitWorksheetColumns(wsStatement, {
      1: 6,
      2: 13,
      3: 36,
      4: 16,
      5: 14,
      6: 14,
      7: 18,
      8: 18,
      9: 20,
      10: 24,
    });

    // ════════════════════════════════════════════════════════════════════════
    // SHEET 2: DISPATCHES & QUALITY (Technical Fleet Audit)
    // ════════════════════════════════════════════════════════════════════════
    const wsDispatches = wb.addWorksheet('Dispatches & Quality', {
      views: [{ state: 'frozen', ySplit: 8, showGridLines: true }],
      properties: { tabColor: { argb: 'FF10B981' } },
    });

    addWorksheetBanner(
      wsDispatches,
      'U',
      companyName,
      companySubline,
      `${(partyName || 'Party').toUpperCase()} — DISPATCHES & LAB AUDIT`
    );

    // KPI Cards for dispatches
    const avgGcv =
      dispatches.filter((d) => d.labActualGcv).length > 0
        ? Math.round(
            dispatches.reduce((acc, d) => acc + (d.labActualGcv || 0), 0) /
              dispatches.filter((d) => d.labActualGcv).length
          )
        : 0;

    addKpiRowCards(wsDispatches, 4, [
      {
        colSpan: ['A', 'D'],
        label: 'Total Dispatches',
        value: `${dispatches.length} Trucks`,
        sub: 'Verified Factory Deliveries',
        fillColor: XL_PALETTE.KPI_SLATE_FILL,
        borderColor: XL_PALETTE.KPI_SLATE_BORDER,
        valColor: XL_PALETTE.TEXT_PRIMARY,
      },
      {
        colSpan: ['E', 'I'],
        label: 'Net Delivered Weight',
        value: totalTons,
        sub: 'Factory Weighbridge Weight',
        numFmt: '#,##0.00" t"',
        fillColor: XL_PALETTE.KPI_BLUE_FILL,
        borderColor: XL_PALETTE.KPI_BLUE_BORDER,
        valColor: XL_PALETTE.TEXT_BLUE,
      },
      {
        colSpan: ['J', 'O'],
        label: 'Average Lab GCV',
        value: avgGcv > 0 ? `${avgGcv.toLocaleString()} kcal/kg` : 'Pending Lab',
        sub: 'Calorific Energy Rating',
        fillColor: XL_PALETTE.KPI_GREEN_FILL,
        borderColor: XL_PALETTE.KPI_GREEN_BORDER,
        valColor: XL_PALETTE.TEXT_GREEN,
      },
      {
        colSpan: ['P', 'U'],
        label: 'Gross Invoiced Value',
        value: Math.round(totalBilled),
        sub: 'Total Delivery Revenue',
        numFmt: xlCurFmt,
        fillColor: XL_PALETTE.KPI_BLUE_FILL,
        borderColor: XL_PALETTE.KPI_BLUE_BORDER,
        valColor: XL_PALETTE.TEXT_BLUE,
      },
    ]);

    // Dispatch Table Headers (Row 8)
    const dispHeaders = [
      'Sr #',
      'Date',
      'Truck Number',
      'PO #',
      'Loaded Weight (t)',
      'Received Weight (t)',
      'Transit Diff (t)',
      'Loss %',
      'Target GCV',
      'Lab Actual GCV',
      'GCV Variance',
      'Sulphur %',
      'Ash %',
      'Moisture %',
      'Base Rate (Rs)',
      'GCV Deduction (Rs)',
      'Bonus Premium (Rs)',
      'WHT Tax (Rs)',
      'Payable Rate (Rs)',
      'Gross Invoiced (Rs)',
      'Logistics Notes',
    ];

    const dhRow = wsDispatches.getRow(8);
    dhRow.height = 28;
    dispHeaders.forEach((t, i) => {
      const cell = dhRow.getCell(i + 1);
      cell.value = t;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL_PALETTE.HEADER_PRIMARY } };
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: XL_PALETTE.HEADER_TEXT } };
      cell.alignment = {
        vertical: 'middle',
        horizontal: i < 4 ? 'center' : i >= 4 && i <= 19 ? 'right' : 'left',
      };
      cell.border = BORDER_CELL_LIGHT;
    });

    let dispRowIdx = 9;
    const sortedDispatches = [...dispatches].sort((a, b) => b.date.localeCompare(a.date));

    sortedDispatches.forEach((d, idx) => {
      const row = wsDispatches.getRow(dispRowIdx);
      row.height = 21;
      const isEven = idx % 2 === 0;
      const po = pos.find((p) => p.id === d.poId);
      const s = calculateSettlement(d);
      const adj = getEffectiveAdjustments(d, settings);
      const transit = calculateTransitLoss(d);
      const isPending = transit.isPending;
      const gcvDiff = d.targetGcv && d.labActualGcv ? d.labActualGcv - d.targetGcv : 0;

      row.values = [
        idx + 1,
        formatDisplayDate(d.date) || '-',
        d.truckNumber || '-',
        po?.poNumber || '-',
        transit.totalLoadedWeight || 0,
        isPending ? 0 : (d.labReceivedWeight || 0),
        parseFloat(transit.diff.toFixed(2)),
        parseFloat((transit.lossPercentage / 100).toFixed(4)),
        d.targetGcv || 0,
        d.labActualGcv || 0,
        gcvDiff,
        d.labSulphur ? parseFloat(d.labSulphur.toFixed(2)) : 0,
        d.labAsh ? parseFloat(d.labAsh.toFixed(2)) : 0,
        d.labMoisture ? parseFloat(d.labMoisture.toFixed(2)) : 0,
        d.baseRate || 0,
        adj.deduction,
        adj.premium,
        s.taxDeduction ? parseFloat(s.taxDeduction.toFixed(2)) : 0,
        parseFloat(s.payableRate.toFixed(2)),
        isPending ? 0 : Math.round(s.totalRevenue),
        isPending ? (d.notes ? `[In-Transit] ${d.notes}` : 'In-Transit (Awaiting Weighbridge)') : (d.notes || ''),
      ];

      for (let c = 1; c <= 21; c++) {
        const cell = row.getCell(c);
        cell.font = { name: 'Calibri', size: 9.5, color: { argb: XL_PALETTE.TEXT_PRIMARY } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: isEven ? XL_PALETTE.ZEBRA_EVEN : XL_PALETTE.ZEBRA_ODD },
        };
        cell.border = BORDER_CELL_LIGHT;

        if (c <= 4) {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        } else if (c === 5 || c === 6 || c === 7) {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.numFmt = '#,##0.00';
        } else if (c === 8) {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.numFmt = '0.0%';
        } else if (c === 9 || c === 10 || c === 11) {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.numFmt = '#,##0';
        } else if (c >= 12 && c <= 14) {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.numFmt = '0.00';
        } else if (c >= 15 && c <= 19) {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.numFmt = '#,##0.00';
        } else if (c === 20) {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.numFmt = '#,##0';
          cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: XL_PALETTE.TEXT_PRIMARY } };
        } else {
          cell.alignment = { vertical: 'middle', horizontal: 'left' };
        }
      }

      dispRowIdx++;
    });

    // Totals row for dispatches using unified calculateLedgerTotals (Issue 20)
    const dTotRow = wsDispatches.getRow(dispRowIdx);
    dTotRow.height = 26;
    const dispTotals = calculateLedgerTotals(sortedDispatches, settings);
    const totLoaded = dispTotals.loadedTonsSettled;
    const totReceived = dispTotals.receivedTons;
    const totTransitDiff = dispTotals.transitDiffTons;

    dTotRow.values = [
      '',
      dispTotals.pendingCount > 0 ? 'TOTALS (SETTLED)' : 'TOTALS',
      dispTotals.pendingCount > 0 ? `${dispTotals.settledCount} Settled Trucks` : `${dispatches.length} Trucks`,
      '',
      totLoaded,
      totReceived,
      totTransitDiff,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      Math.round(totalBilled),
      '',
    ];

    for (let c = 1; c <= 21; c++) {
      const cell = dTotRow.getCell(c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL_PALETTE.TOTAL_FILL } };
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: XL_PALETTE.TEXT_PRIMARY } };
      cell.border = BORDER_TOTAL_ACCOUNTING;

      if (c === 2) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else if (c === 5 || c === 6 || c === 7) {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
        cell.numFmt = '#,##0.00';
      } else if (c === 20) {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
        cell.numFmt = '#,##0';
      }
    }

    autoFitWorksheetColumns(wsDispatches, {
      1: 6,
      2: 13,
      3: 16,
      4: 14,
      5: 16,
      6: 16,
      7: 15,
      8: 12,
      9: 14,
      10: 14,
      11: 14,
      12: 12,
      13: 12,
      14: 12,
      15: 14,
      16: 15,
      17: 15,
      18: 14,
      19: 15,
      20: 18,
      21: 24,
    });

    // ════════════════════════════════════════════════════════════════════════
    // SHEET 3: PAYMENT TRANSACTIONS (Voucher Audit)
    // ════════════════════════════════════════════════════════════════════════
    if (payments.length > 0) {
      const wsPayments = wb.addWorksheet('Payment History', {
        views: [{ state: 'frozen', ySplit: 8, showGridLines: true }],
        properties: { tabColor: { argb: 'FF8B5CF6' } },
      });

      addWorksheetBanner(
        wsPayments,
        'G',
        companyName,
        companySubline,
        `${(partyName || 'Party').toUpperCase()} — PAYMENT VOUCHERS AUDIT`
      );

      const totInflow = payments.filter((p) => p.type === 'received').reduce((acc, p) => acc + p.amount, 0);
      const totOutflow = payments.filter((p) => p.type !== 'received').reduce((acc, p) => acc + p.amount, 0);

      addKpiRowCards(wsPayments, 4, [
        {
          colSpan: ['A', 'B'],
          label: 'Total Receipts (Inflow)',
          value: Math.round(totInflow),
          sub: `${payments.filter((p) => p.type === 'received').length} Payments Inflow`,
          numFmt: xlCurFmt,
          fillColor: XL_PALETTE.KPI_GREEN_FILL,
          borderColor: XL_PALETTE.KPI_GREEN_BORDER,
          valColor: XL_PALETTE.TEXT_GREEN,
        },
        {
          colSpan: ['C', 'D'],
          label: 'Total Paid (Outflow)',
          value: Math.round(totOutflow),
          sub: `${payments.filter((p) => p.type !== 'received').length} Payments Outflow`,
          numFmt: xlCurFmt,
          fillColor: XL_PALETTE.KPI_RED_FILL,
          borderColor: XL_PALETTE.KPI_RED_BORDER,
          valColor: XL_PALETTE.TEXT_RED,
        },
        {
          colSpan: ['E', 'G'],
          label: 'Net Financial Volume',
          value: Math.round(totInflow - totOutflow),
          sub: 'Total Cash & Bank Movement',
          numFmt: xlCurFmt,
          fillColor: XL_PALETTE.KPI_BLUE_FILL,
          borderColor: XL_PALETTE.KPI_BLUE_BORDER,
          valColor: XL_PALETTE.TEXT_BLUE,
        },
      ]);

      const payHeaders = [
        'Sr #',
        'Date',
        'Voucher Ref #',
        'Direction / Flow',
        'Payment Mode',
        `Amount (${curSym.trim()})`,
        'Reference Note / Cheque Details',
      ];

      const phRow = wsPayments.getRow(8);
      phRow.height = 28;
      payHeaders.forEach((t, i) => {
        const cell = phRow.getCell(i + 1);
        cell.value = t;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL_PALETTE.HEADER_PRIMARY } };
        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: XL_PALETTE.HEADER_TEXT } };
        cell.alignment = {
          vertical: 'middle',
          horizontal: i <= 2 ? 'center' : i === 5 ? 'right' : 'left',
        };
        cell.border = BORDER_CELL_LIGHT;
      });

      let pRowIdx = 9;
      const sortedPayments = [...payments].sort((a, b) => b.date.localeCompare(a.date));

      sortedPayments.forEach((p, idx) => {
        const row = wsPayments.getRow(pRowIdx);
        row.height = 22;
        const isRec = p.type === 'received';
        const bgFill = isRec ? XL_PALETTE.PAYMENT_REC_FILL : XL_PALETTE.PAYMENT_PAID_FILL;
        const txtColor = isRec ? XL_PALETTE.PAYMENT_REC_TEXT : XL_PALETTE.PAYMENT_PAID_TEXT;

        row.values = [
          idx + 1,
          formatDisplayDate(p.date) || '-',
          (p.id || '').slice(0, 8).toUpperCase(),
          isRec ? 'Payment Received (Inflow)' : 'Payment Disbursed (Outflow)',
          p.mode.toUpperCase(),
          Math.round(p.amount),
          p.referenceNote || 'Direct Settlement',
        ];

        for (let c = 1; c <= 7; c++) {
          const cell = row.getCell(c);
          cell.font = { name: 'Calibri', size: 9.5, color: { argb: XL_PALETTE.TEXT_PRIMARY } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgFill } };
          cell.border = BORDER_CELL_LIGHT;

          if (c <= 3) {
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
          } else if (c === 4) {
            cell.alignment = { vertical: 'middle', horizontal: 'left' };
            cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: txtColor } };
          } else if (c === 5) {
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
          } else if (c === 6) {
            cell.alignment = { vertical: 'middle', horizontal: 'right' };
            cell.numFmt = '#,##0';
            cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: txtColor } };
          } else {
            cell.alignment = { vertical: 'middle', horizontal: 'left' };
          }
        }

        pRowIdx++;
      });

      const pTotRow = wsPayments.getRow(pRowIdx);
      pTotRow.height = 26;
      pTotRow.values = [
        '',
        'TOTALS',
        `${payments.length} Transactions`,
        '',
        '',
        Math.round(totInflow),
        '',
      ];

      for (let c = 1; c <= 7; c++) {
        const cell = pTotRow.getCell(c);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL_PALETTE.TOTAL_FILL } };
        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: XL_PALETTE.TEXT_PRIMARY } };
        cell.border = BORDER_TOTAL_ACCOUNTING;

        if (c === 2) {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        } else if (c === 6) {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.numFmt = '#,##0';
        }
      }

      autoFitWorksheetColumns(wsPayments, {
        1: 6,
        2: 13,
        3: 16,
        4: 26,
        5: 16,
        6: 20,
        7: 32,
      });
    }
  } else {
    // ════════════════════════════════════════════════════════════════════════
    // FLEET / MULTI-PARTY EXPORT (Enterprise Business Workbook)
    // ════════════════════════════════════════════════════════════════════════
    const sortedDispatches = [...dispatches].sort((a, b) => b.date.localeCompare(a.date));

    // Aggregate Enterprise Metrics using unified calculateLedgerTotals (Issue 20)
    const fleetTotals = calculateLedgerTotals(sortedDispatches, settings);
    const totalFleetTons = fleetTotals.receivedTons;
    const totalFleetRevenue = fleetTotals.revenue;
    const totalFleetCost = fleetTotals.cost;
    const totalFleetProfit = fleetTotals.profit;
    const fleetMargin = totalFleetRevenue > 0 ? (totalFleetProfit / totalFleetRevenue) * 100 : 0;

    // ── SHEET 1: DISPATCHES MASTER ──
    const wsMaster = wb.addWorksheet('Dispatches Master', {
      views: [{ state: 'frozen', ySplit: 8, showGridLines: true }],
      properties: { tabColor: { argb: 'FF007AFF' } },
    });

    addWorksheetBanner(
      wsMaster,
      'S',
      companyName,
      companySubline,
      'FLEET DISPATCHES MASTER AUDIT'
    );

    addKpiRowCards(wsMaster, 4, [
      {
        colSpan: ['A', 'C'],
        label: 'Total Dispatches',
        value: `${sortedDispatches.length} Trucks`,
        sub: 'Fleet Delivery Volume',
        fillColor: XL_PALETTE.KPI_SLATE_FILL,
        borderColor: XL_PALETTE.KPI_SLATE_BORDER,
        valColor: XL_PALETTE.TEXT_PRIMARY,
      },
      {
        colSpan: ['D', 'F'],
        label: 'Delivered Tonnage',
        value: totalFleetTons,
        sub: 'Factory Weighbridge Net',
        numFmt: '#,##0.00" t"',
        fillColor: XL_PALETTE.KPI_BLUE_FILL,
        borderColor: XL_PALETTE.KPI_BLUE_BORDER,
        valColor: XL_PALETTE.TEXT_BLUE,
      },
      {
        colSpan: ['G', 'J'],
        label: 'Total Gross Revenue',
        value: Math.round(totalFleetRevenue),
        sub: 'Billed Realized Revenue',
        numFmt: xlCurFmt,
        fillColor: XL_PALETTE.KPI_BLUE_FILL,
        borderColor: XL_PALETTE.KPI_BLUE_BORDER,
        valColor: XL_PALETTE.TEXT_BLUE,
      },
      {
        colSpan: ['K', 'N'],
        label: 'Procurement & Logistics Cost',
        value: Math.round(totalFleetCost),
        sub: 'Coal Purchase + Overheads',
        numFmt: xlCurFmt,
        fillColor: XL_PALETTE.KPI_SLATE_FILL,
        borderColor: XL_PALETTE.KPI_SLATE_BORDER,
        valColor: XL_PALETTE.TEXT_PRIMARY,
      },
      {
        colSpan: ['O', 'S'],
        label: 'Net Trading Profit',
        value: Math.round(totalFleetProfit),
        sub: `Overall Margin: ${fleetMargin.toFixed(1)}%`,
        numFmt: xlCurFmt,
        fillColor: totalFleetProfit >= 0 ? XL_PALETTE.KPI_GREEN_FILL : XL_PALETTE.KPI_RED_FILL,
        borderColor: totalFleetProfit >= 0 ? XL_PALETTE.KPI_GREEN_BORDER : XL_PALETTE.KPI_RED_BORDER,
        valColor: totalFleetProfit >= 0 ? XL_PALETTE.TEXT_GREEN : XL_PALETTE.TEXT_RED,
      },
    ]);

    const masterHeaders = [
      'Sr #',
      'Date',
      'Truck Number',
      'Party / Factory',
      'PO Number',
      'Loaded Weight (t)',
      'Received Weight (t)',
      'Transit Diff (t)',
      'Target GCV',
      'Actual Lab GCV',
      'Lab Ash %',
      'Lab Moisture %',
      'Base Rate (Rs/t)',
      'Payable Rate (Rs/t)',
      'Total Revenue (Rs)',
      'Total Cost (Rs)',
      'Net Profit (Rs)',
      'Margin %',
      'Delivery Notes',
    ];

    const mhRow = wsMaster.getRow(8);
    mhRow.height = 28;
    masterHeaders.forEach((t, i) => {
      const cell = mhRow.getCell(i + 1);
      cell.value = t;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL_PALETTE.HEADER_PRIMARY } };
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: XL_PALETTE.HEADER_TEXT } };
      cell.alignment = {
        vertical: 'middle',
        horizontal: i < 5 ? 'center' : i >= 5 && i <= 17 ? 'right' : 'left',
      };
      cell.border = BORDER_CELL_LIGHT;
    });

    let mRowIdx = 9;
    sortedDispatches.forEach((d, idx) => {
      const row = wsMaster.getRow(mRowIdx);
      row.height = 21;
      const isEven = idx % 2 === 0;
      const p = parties.find((partyItem) => partyItem.id === d.partyId);
      const po = pos.find((poItem) => poItem.id === d.poId);
      const s = calculateSettlement(d);
      const transit = calculateTransitLoss(d);
      const isPending = transit.isPending;
      const profit = isPending ? 0 : Math.round(s.netProfit);
      const margin = !isPending && s.totalRevenue > 0 ? (s.netProfit / s.totalRevenue) : 0;
      const revenue = isPending ? 0 : Math.round(s.totalRevenue);
      const cost = isPending ? 0 : Math.round(s.totalCost);

      row.values = [
        idx + 1,
        formatDisplayDate(d.date) || '-',
        d.truckNumber || '-',
        p?.name || d.factoryName || '-',
        po?.poNumber || '-',
        transit.totalLoadedWeight || 0,
        isPending ? 0 : (d.labReceivedWeight || 0),
        parseFloat(transit.diff.toFixed(2)),
        d.targetGcv || 0,
        d.labActualGcv || 0,
        d.labAsh ? parseFloat(d.labAsh.toFixed(2)) : 0,
        d.labMoisture ? parseFloat(d.labMoisture.toFixed(2)) : 0,
        d.baseRate || 0,
        parseFloat(s.payableRate.toFixed(2)),
        revenue,
        cost,
        profit,
        parseFloat(margin.toFixed(4)),
        isPending ? (d.notes ? `[In-Transit] ${d.notes}` : 'In-Transit (Awaiting Weighbridge)') : (d.notes || ''),
      ];

      for (let c = 1; c <= 19; c++) {
        const cell = row.getCell(c);
        cell.font = { name: 'Calibri', size: 9.5, color: { argb: XL_PALETTE.TEXT_PRIMARY } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: isEven ? XL_PALETTE.ZEBRA_EVEN : XL_PALETTE.ZEBRA_ODD },
        };
        cell.border = BORDER_CELL_LIGHT;

        if (c <= 3 || c === 5) {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        } else if (c === 4) {
          cell.alignment = { vertical: 'middle', horizontal: 'left' };
          cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: XL_PALETTE.TEXT_PRIMARY } };
        } else if (c === 6 || c === 7 || c === 8) {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.numFmt = '#,##0.00';
        } else if (c === 9 || c === 10) {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.numFmt = '#,##0';
        } else if (c === 11 || c === 12) {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.numFmt = '0.00';
        } else if (c === 13 || c === 14) {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.numFmt = '#,##0.00';
        } else if (c === 15 || c === 16) {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.numFmt = '#,##0';
        } else if (c === 17) {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.numFmt = '#,##0';
          cell.font = {
            name: 'Calibri',
            size: 9.5,
            bold: true,
            color: { argb: profit >= 0 ? XL_PALETTE.TEXT_GREEN : XL_PALETTE.TEXT_RED },
          };
          if (profit < 0) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL_PALETTE.PAYMENT_PAID_FILL } };
          }
        } else if (c === 18) {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.numFmt = '0.0%';
        } else {
          cell.alignment = { vertical: 'middle', horizontal: 'left' };
        }
      }

      mRowIdx++;
    });

    // Grand Totals Row
    const mTotRow = wsMaster.getRow(mRowIdx);
    mTotRow.height = 28;
    mTotRow.values = [
      '',
      fleetTotals.pendingCount > 0 ? 'TOTALS (SETTLED)' : 'TOTALS',
      fleetTotals.pendingCount > 0 ? `${fleetTotals.settledCount} Settled Trucks` : `${sortedDispatches.length} Trucks`,
      '',
      '',
      fleetTotals.loadedTonsSettled,
      totalFleetTons,
      fleetTotals.transitDiffTons,
      '',
      '',
      '',
      '',
      '',
      '',
      Math.round(totalFleetRevenue),
      Math.round(totalFleetCost),
      Math.round(totalFleetProfit),
      parseFloat((fleetMargin / 100).toFixed(4)),
      '',
    ];

    for (let c = 1; c <= 19; c++) {
      const cell = mTotRow.getCell(c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL_PALETTE.TOTAL_FILL } };
      cell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: XL_PALETTE.TEXT_PRIMARY } };
      cell.border = BORDER_TOTAL_ACCOUNTING;

      if (c === 2) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else if (c === 6 || c === 7 || c === 8) {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
        cell.numFmt = '#,##0.00';
      } else if (c === 15 || c === 16) {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
        cell.numFmt = '#,##0';
      } else if (c === 17) {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
        cell.numFmt = '#,##0';
        cell.font = {
          name: 'Calibri',
          size: 11,
          bold: true,
          color: { argb: totalFleetProfit >= 0 ? XL_PALETTE.TEXT_GREEN : XL_PALETTE.TEXT_RED },
        };
      } else if (c === 18) {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
        cell.numFmt = '0.0%';
      }
    }

    autoFitWorksheetColumns(wsMaster, {
      1: 6,
      2: 13,
      3: 16,
      4: 28,
      5: 14,
      6: 16,
      7: 16,
      8: 15,
      9: 14,
      10: 14,
      11: 12,
      12: 12,
      13: 14,
      14: 15,
      15: 18,
      16: 18,
      17: 18,
      18: 12,
      19: 26,
    });

    // ── SHEET 2: COST & MARGIN ANALYSIS ──
    const wsCost = wb.addWorksheet('Cost & Profit Analysis', {
      views: [{ state: 'frozen', ySplit: 5, showGridLines: true }],
      properties: { tabColor: { argb: 'FF10B981' } },
    });

    addWorksheetBanner(
      wsCost,
      'L',
      companyName,
      companySubline,
      'COAL SOURCING, OVERHEADS & TRADING MARGINS'
    );

    const costHeaders = [
      'Sr #',
      'Date',
      'Truck Number',
      'Factory',
      'Delivered Tons',
      'Coal Sourcing Blends & Mine Rates',
      'Freight Overheads (Rs)',
      'Loading Overheads (Rs)',
      'Total Procurement Cost (Rs)',
      'Gross Billed Revenue (Rs)',
      'Net Trading Profit (Rs)',
      'Profit / Ton (Rs)',
    ];

    const chRow = wsCost.getRow(5);
    chRow.height = 28;
    costHeaders.forEach((t, i) => {
      const cell = chRow.getCell(i + 1);
      cell.value = t;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL_PALETTE.HEADER_PRIMARY } };
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: XL_PALETTE.HEADER_TEXT } };
      cell.alignment = {
        vertical: 'middle',
        horizontal: i < 3 ? 'center' : i >= 4 && i <= 11 ? 'right' : 'left',
      };
      cell.border = BORDER_CELL_LIGHT;
    });

    let cRowIdx = 6;
    sortedDispatches.forEach((d, idx) => {
      const row = wsCost.getRow(cRowIdx);
      row.height = 21;
      const isEven = idx % 2 === 0;
      const p = parties.find((partyItem) => partyItem.id === d.partyId);
      const isPending = isDispatchPending(d);
      const s = calculateSettlement(d);
      const profit = isPending ? 0 : Math.round(s.netProfit);
      const cost = isPending ? 0 : Math.round(s.totalCost);
      const revenue = isPending ? 0 : Math.round(s.totalRevenue);
      const profitPerTon = !isPending && (d.labReceivedWeight || 0) > 0 ? Math.round(s.netProfit / (d.labReceivedWeight || 1)) : 0;
      const blendsStr = (d.coalInputs || [])
        .filter((c) => (c.weight || 0) > 0)
        .map((c) => `${c.sourceName || 'Coal'}: ${c.weight}t @ ${curSym}${c.purchaseRate}`)
        .join('  •  ');

      row.values = [
        idx + 1,
        formatDisplayDate(d.date) || '-',
        d.truckNumber || '-',
        p?.name || d.factoryName || '-',
        isPending ? 0 : (d.labReceivedWeight || 0),
        blendsStr || (isPending ? 'In-Transit Procurement' : 'Direct Procurement'),
        isPending ? 0 : (d.overheads?.freight || 0),
        isPending ? 0 : (d.overheads?.loading || 0),
        cost,
        revenue,
        profit,
        profitPerTon,
      ];

      for (let c = 1; c <= 12; c++) {
        const cell = row.getCell(c);
        cell.font = { name: 'Calibri', size: 9.5, color: { argb: XL_PALETTE.TEXT_PRIMARY } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: isEven ? XL_PALETTE.ZEBRA_EVEN : XL_PALETTE.ZEBRA_ODD },
        };
        cell.border = BORDER_CELL_LIGHT;

        if (c <= 3) {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        } else if (c === 4) {
          cell.alignment = { vertical: 'middle', horizontal: 'left' };
        } else if (c === 5) {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.numFmt = '#,##0.00';
        } else if (c === 6) {
          cell.alignment = { vertical: 'middle', horizontal: 'left' };
        } else if (c >= 7 && c <= 10) {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.numFmt = '#,##0';
        } else if (c === 11 || c === 12) {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.numFmt = '#,##0';
          cell.font = {
            name: 'Calibri',
            size: 9.5,
            bold: true,
            color: { argb: profit >= 0 ? XL_PALETTE.TEXT_GREEN : XL_PALETTE.TEXT_RED },
          };
        }
      }

      cRowIdx++;
    });

    const cTotRow = wsCost.getRow(cRowIdx);
    cTotRow.height = 26;
    cTotRow.values = [
      '',
      fleetTotals.pendingCount > 0 ? 'TOTALS (SETTLED)' : 'TOTALS',
      fleetTotals.pendingCount > 0 ? `${fleetTotals.settledCount} Settled Trucks` : `${sortedDispatches.length} Trucks`,
      '',
      totalFleetTons,
      '',
      sortedDispatches.filter(d => !isDispatchPending(d)).reduce((acc, d) => acc + (d.overheads?.freight || 0), 0),
      sortedDispatches.filter(d => !isDispatchPending(d)).reduce((acc, d) => acc + (d.overheads?.loading || 0), 0),
      Math.round(totalFleetCost),
      Math.round(totalFleetRevenue),
      Math.round(totalFleetProfit),
      totalFleetTons > 0 ? Math.round(totalFleetProfit / totalFleetTons) : 0,
    ];

    for (let c = 1; c <= 12; c++) {
      const cell = cTotRow.getCell(c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL_PALETTE.TOTAL_FILL } };
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: XL_PALETTE.TEXT_PRIMARY } };
      cell.border = BORDER_TOTAL_ACCOUNTING;

      if (c === 2) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else if (c === 5) {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
        cell.numFmt = '#,##0.00';
      } else if (c >= 7 && c <= 12) {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
        cell.numFmt = '#,##0';
      }
    }

    autoFitWorksheetColumns(wsCost, {
      1: 6,
      2: 13,
      3: 16,
      4: 26,
      5: 14,
      6: 38,
      7: 18,
      8: 18,
      9: 22,
      10: 22,
      11: 20,
      12: 16,
    });

    // ── SHEET 3: PARTY SUMMARY SCORECARD ──
    const wsParty = wb.addWorksheet('Party Summary', {
      views: [{ state: 'frozen', ySplit: 5, showGridLines: true }],
      properties: { tabColor: { argb: 'FF8B5CF6' } },
    });

    addWorksheetBanner(
      wsParty,
      'I',
      companyName,
      companySubline,
      'CUSTOMER & PLANT PERFORMANCE SCORECARD'
    );

    const partySummaryHeaders = [
      'Sr #',
      'Party / Consignee',
      'Total Trucks',
      'Total Delivered Tons',
      'Gross Revenue (Rs)',
      'Procurement Cost (Rs)',
      'Net Profit (Rs)',
      'Avg Rate / Ton (Rs)',
      'Profit Margin %',
    ];

    const pshRow = wsParty.getRow(5);
    pshRow.height = 28;
    partySummaryHeaders.forEach((t, i) => {
      const cell = pshRow.getCell(i + 1);
      cell.value = t;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL_PALETTE.HEADER_PRIMARY } };
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: XL_PALETTE.HEADER_TEXT } };
      cell.alignment = {
        vertical: 'middle',
        horizontal: i === 0 || i === 2 ? 'center' : i >= 3 ? 'right' : 'left',
      };
      cell.border = BORDER_CELL_LIGHT;
    });

    const partyMap: { [id: string]: { name: string; trucks: number; tons: number; revenue: number; cost: number; profit: number } } = {};
    dispatches.forEach((d) => {
      const p = parties.find((partyItem) => partyItem.id === d.partyId);
      const pName = p?.name || d.factoryName || 'Unspecified';
      if (!partyMap[pName]) {
        partyMap[pName] = { name: pName, trucks: 0, tons: 0, revenue: 0, cost: 0, profit: 0 };
      }
      const s = calculateSettlement(d);
      const isPending = isDispatchPending(d);
      partyMap[pName].trucks += 1;
      if (!isPending) {
        partyMap[pName].tons += d.labReceivedWeight || 0;
        partyMap[pName].revenue += s.totalRevenue;
        partyMap[pName].cost += s.totalCost;
        partyMap[pName].profit += s.netProfit;
      }
    });

    let pmRowIdx = 6;
    const sortedPartySummaries = Object.values(partyMap).sort((a, b) => b.revenue - a.revenue);

    sortedPartySummaries.forEach((pm, idx) => {
      const row = wsParty.getRow(pmRowIdx);
      row.height = 22;
      const isEven = idx % 2 === 0;
      const avgRate = pm.tons > 0 ? Math.round(pm.revenue / pm.tons) : 0;
      const margin = pm.revenue > 0 ? pm.profit / pm.revenue : 0;

      row.values = [
        idx + 1,
        pm.name,
        pm.trucks,
        parseFloat(pm.tons.toFixed(2)),
        Math.round(pm.revenue),
        Math.round(pm.cost),
        Math.round(pm.profit),
        avgRate,
        parseFloat(margin.toFixed(4)),
      ];

      for (let c = 1; c <= 9; c++) {
        const cell = row.getCell(c);
        cell.font = { name: 'Calibri', size: 9.5, color: { argb: XL_PALETTE.TEXT_PRIMARY } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: isEven ? XL_PALETTE.ZEBRA_EVEN : XL_PALETTE.ZEBRA_ODD },
        };
        cell.border = BORDER_CELL_LIGHT;

        if (c === 1 || c === 3) {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        } else if (c === 2) {
          cell.alignment = { vertical: 'middle', horizontal: 'left' };
          cell.font = { name: 'Calibri', size: 9.5, bold: true, color: { argb: XL_PALETTE.TEXT_PRIMARY } };
        } else if (c === 4) {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.numFmt = '#,##0.00';
        } else if (c >= 5 && c <= 8) {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.numFmt = '#,##0';
          if (c === 7) {
            cell.font = {
              name: 'Calibri',
              size: 9.5,
              bold: true,
              color: { argb: pm.profit >= 0 ? XL_PALETTE.TEXT_GREEN : XL_PALETTE.TEXT_RED },
            };
          }
        } else if (c === 9) {
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
          cell.numFmt = '0.0%';
        }
      }

      pmRowIdx++;
    });

    const pmTotRow = wsParty.getRow(pmRowIdx);
    pmTotRow.height = 28;
    pmTotRow.values = [
      '',
      fleetTotals.pendingCount > 0 ? 'TOTALS (SETTLED)' : 'TOTALS',
      fleetTotals.pendingCount > 0 ? `${fleetTotals.settledCount} Settled Trucks` : sortedDispatches.length,
      totalFleetTons,
      Math.round(totalFleetRevenue),
      Math.round(totalFleetCost),
      Math.round(totalFleetProfit),
      totalFleetTons > 0 ? Math.round(totalFleetRevenue / totalFleetTons) : 0,
      parseFloat((fleetMargin / 100).toFixed(4)),
    ];

    for (let c = 1; c <= 9; c++) {
      const cell = pmTotRow.getCell(c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL_PALETTE.TOTAL_FILL } };
      cell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: XL_PALETTE.TEXT_PRIMARY } };
      cell.border = BORDER_TOTAL_ACCOUNTING;

      if (c === 2 || c === 3) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else if (c === 4) {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
        cell.numFmt = '#,##0.00';
      } else if (c >= 5 && c <= 8) {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
        cell.numFmt = '#,##0';
        if (c === 7) {
          cell.font = {
            name: 'Calibri',
            size: 11,
            bold: true,
            color: { argb: totalFleetProfit >= 0 ? XL_PALETTE.TEXT_GREEN : XL_PALETTE.TEXT_RED },
          };
        }
      } else if (c === 9) {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
        cell.numFmt = '0.0%';
      }
    }

    autoFitWorksheetColumns(wsParty, {
      1: 6,
      2: 28,
      3: 14,
      4: 18,
      5: 22,
      6: 22,
      7: 18,
      8: 16,
      9: 14,
    });
  }

  // Generate buffer and encode to base64
  const xlsxBuffer = await wb.xlsx.writeBuffer();
  const base64Xlsx = arrayBufferToBase64(xlsxBuffer);
  const safeName = (partyName || 'Fleet_Ledger').replace(/[^a-zA-Z0-9_-]/g, '_');
  const finalFileName = options.fileName || `Ledger-${safeName}-${dateStamp}.xlsx`;

  await shareBase64File({
    data: base64Xlsx,
    fileName: finalFileName,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    title: `Factory Ledger - ${partyName || 'Fleet Ledger'}`,
    text: `Official Factory Ledger Excel Workbook containing ${dispatches.length} dispatch deliveries.`,
    dialogTitle: 'Share Excel Spreadsheet',
  });
}

/**
 * Universal JSON database backup exporter:
 * Exports all ledger entities (parties, dispatches, payments, POs, business settings)
 * with the security PIN and lock credentials completely omitted.
 * Triggers native Android/iOS system share or direct browser file download.
 */
export async function exportDatabaseBackupJson(): Promise<{
  success: boolean;
  exportedAt: string;
  counts: { parties: number; dispatches: number; payments: number; expenses: number; pos: number; mines: number; lots: number };
}> {
  const exportData = await getExportBackupData();
  const jsonString = JSON.stringify(exportData, null, 2);
  const dateStamp = getTodayDateString();
  const fileName = `factory-ledger-full-backup-${dateStamp}.json`;

  // Safe UTF-8 to Base64 conversion (handles Unicode characters reliably)
  const utf8Bytes = new TextEncoder().encode(jsonString);
  let binary = '';
  for (let i = 0; i < utf8Bytes.length; i++) {
    binary += String.fromCharCode(utf8Bytes[i]);
  }
  const base64Data = btoa(binary);

  const minesCount = exportData.mines?.length || 0;
  const lotsCount = exportData.lots?.length || 0;

  await shareBase64File({
    data: base64Data,
    fileName,
    mimeType: 'application/json',
    title: 'Factory Ledger Database Backup',
    text: `Factory Ledger full backup (${exportData.parties.length} parties, ${exportData.dispatches.length} dispatches, ${exportData.payments.length} payments, ${exportData.expenses?.length || 0} expenses, ${exportData.pos.length} orders, ${minesCount} mines, ${lotsCount} stock entries).`,
    dialogTitle: 'Export / Share Ledger Backup',
  });

  const nowIso = new Date().toISOString();
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem('fl_last_backup_date', nowIso);
    } catch (e) {
      console.warn('Could not save last backup date:', e);
    }
  }

  return {
    success: true,
    exportedAt: nowIso,
    counts: {
      parties: exportData.parties.length,
      dispatches: exportData.dispatches.length,
      payments: exportData.payments.length,
      expenses: exportData.expenses?.length || 0,
      pos: exportData.pos.length,
      mines: minesCount,
      lots: lotsCount,
    },
  };
}

/** Export both sides of locally archived sync conflicts for manual recovery. */
export async function exportSyncConflictHistoryJson(): Promise<number> {
  const conflicts = await getSyncConflictHistory();
  if (conflicts.length === 0) throw new Error('No conflict recovery snapshots are available.');

  const exportedAt = new Date().toISOString();
  const jsonString = JSON.stringify({
    format: 'factory-ledger-conflict-archive-v1',
    exportedAt,
    warning: 'Sensitive ledger data. Winning and losing record versions are included for manual recovery.',
    conflicts,
  }, null, 2);
  const utf8Bytes = new TextEncoder().encode(jsonString);
  let binary = '';
  for (let i = 0; i < utf8Bytes.length; i++) binary += String.fromCharCode(utf8Bytes[i]);

  await shareBase64File({
    data: btoa(binary),
    fileName: `factory-ledger-conflict-archive-${getTodayDateString()}.json`,
    mimeType: 'application/json',
    title: 'Factory Ledger Conflict Recovery Archive',
    text: 'Sensitive recovery archive containing both versions of multi-device conflicts.',
    dialogTitle: 'Export Conflict Recovery Archive',
  });
  return conflicts.length;
}
