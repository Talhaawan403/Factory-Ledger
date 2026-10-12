import React from 'react';
import type { AppSettings } from '../types';
import { formatDisplayDate } from '../utils/dateUtils';

const COLORS = {
  ink: '#111827',
  secondary: '#64748B',
  muted: '#94A3B8',
  line: '#DCE3EC',
  softLine: '#EDF1F5',
  paper: '#FFFFFF',
  canvas: '#EEF2F6',
  panel: '#F7F9FC',
} as const;

export interface ReceiptDocumentProps {
  settings?: AppSettings;
  documentTitle: string;
  documentLabel: string;
  documentId: string;
  date: string;
  statusLabel: string;
  accentColor: string;
  accentTint: string;
  verificationLabel: string;
  footerText: string;
  kind: 'dispatch' | 'payment';
  children: React.ReactNode;
}

function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('') || 'FL';
}

export const ReceiptDocument = React.forwardRef<HTMLDivElement, ReceiptDocumentProps>(
  ({
    settings,
    documentTitle,
    documentLabel,
    documentId,
    date,
    statusLabel,
    accentColor,
    accentTint,
    verificationLabel,
    footerText,
    kind,
    children,
  }, ref) => {
    const businessName = settings?.businessName?.trim() || 'AWAN COAL LOGISTICS';
    const contactLine = [
      settings?.phoneNumber ? `Tel: ${settings.phoneNumber}` : null,
      settings?.ntnNumber ? `NTN: ${settings.ntnNumber}` : null,
    ].filter(Boolean).join('  •  ');

    return (
      <div
        ref={ref}
        data-receipt-kind={kind}
        data-receipt-version="2"
        style={{
          width: 480,
          padding: 12,
          boxSizing: 'border-box',
          backgroundColor: COLORS.canvas,
          color: COLORS.ink,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          lineHeight: 1.4,
          position: 'relative',
        }}
      >
        <div
          style={{
            overflow: 'hidden',
            borderRadius: 20,
            border: `1px solid ${COLORS.line}`,
            backgroundColor: COLORS.paper,
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
          }}
        >
          <div style={{ height: 8, backgroundColor: accentColor }} />

          <div style={{ padding: '22px 24px 20px' }}>
            <header
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 16,
                marginBottom: 18,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, flex: 1, gap: 12 }}>
                <div
                  style={{
                    width: 54,
                    height: 54,
                    borderRadius: 14,
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    backgroundColor: settings?.logoUrl ? '#FFFFFF' : accentTint,
                    border: `1px solid ${settings?.logoUrl ? COLORS.line : accentTint}`,
                    color: accentColor,
                    fontSize: 18,
                    fontWeight: 850,
                    letterSpacing: -0.4,
                  }}
                >
                  {settings?.logoUrl ? (
                    <img
                      src={settings.logoUrl}
                      alt="Company Logo"
                      crossOrigin="anonymous"
                      style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 4, boxSizing: 'border-box' }}
                    />
                  ) : getInitials(businessName)}
                </div>

                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 18,
                      fontWeight: 850,
                      color: COLORS.ink,
                      letterSpacing: -0.35,
                      lineHeight: 1.15,
                      textTransform: 'uppercase',
                    }}
                  >
                    {businessName}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 9.5, fontWeight: 700, color: COLORS.secondary, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                    {settings?.accountType || 'Commercial Coal Ledger'}
                  </div>
                  {contactLine && (
                    <div style={{ marginTop: 3, fontSize: 9.5, color: COLORS.secondary }}>{contactLine}</div>
                  )}
                </div>
              </div>

              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div
                  style={{
                    display: 'inline-block',
                    padding: '5px 9px',
                    borderRadius: 999,
                    backgroundColor: accentTint,
                    color: accentColor,
                    fontSize: 8.5,
                    fontWeight: 850,
                    textTransform: 'uppercase',
                    letterSpacing: 0.8,
                  }}
                >
                  {documentLabel}
                </div>
                <div style={{ marginTop: 7, fontSize: 13, fontWeight: 800, color: COLORS.ink }}>{documentTitle}</div>
              </div>
            </header>

            {settings?.companyAddress && (
              <div
                style={{
                  marginTop: -8,
                  marginBottom: 14,
                  paddingBottom: 12,
                  borderBottom: `1px solid ${COLORS.softLine}`,
                  fontSize: 9.5,
                  color: COLORS.secondary,
                }}
              >
                {settings.companyAddress}
              </div>
            )}

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1.2fr 1fr 1fr',
                overflow: 'hidden',
                border: `1px solid ${COLORS.line}`,
                borderRadius: 12,
                marginBottom: 16,
                backgroundColor: COLORS.panel,
              }}
            >
              {[
                { label: 'Document No.', value: documentId },
                { label: 'Document Date', value: formatDisplayDate(date) || 'Not recorded' },
                { label: 'Status', value: statusLabel },
              ].map((item, index) => (
                <div
                  key={item.label}
                  style={{
                    minWidth: 0,
                    padding: '10px 11px',
                    borderLeft: index === 0 ? 'none' : `1px solid ${COLORS.line}`,
                  }}
                >
                  <div style={{ fontSize: 8, fontWeight: 750, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.55 }}>
                    {item.label}
                  </div>
                  <div
                    style={{
                      marginTop: 3,
                      fontSize: index === 0 ? 10.5 : 10,
                      fontWeight: 750,
                      color: index === 2 ? accentColor : COLORS.ink,
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {item.value}
                  </div>
                </div>
              ))}
            </div>

            {children}

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-end',
                gap: 18,
                marginTop: 18,
                paddingTop: 16,
                borderTop: `1px solid ${COLORS.line}`,
              }}
            >
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    display: 'inline-block',
                    padding: '5px 8px',
                    border: `1px solid ${accentColor}`,
                    borderRadius: 6,
                    color: accentColor,
                    fontSize: 8.5,
                    fontWeight: 850,
                    textTransform: 'uppercase',
                    letterSpacing: 0.55,
                  }}
                >
                  {verificationLabel}
                </div>
                <div style={{ marginTop: 5, fontSize: 8.5, color: COLORS.muted }}>
                  Permanent system reference: {documentId}
                </div>
              </div>

              <div style={{ width: 142, textAlign: 'center', flexShrink: 0 }}>
                <div style={{ height: 42, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 3 }}>
                  {settings?.signatureUrl && (
                    <img
                      src={settings.signatureUrl}
                      alt="Authorized Signature"
                      crossOrigin="anonymous"
                      style={{ maxHeight: 38, maxWidth: 132, objectFit: 'contain' }}
                    />
                  )}
                </div>
                <div style={{ borderBottom: `1px solid ${COLORS.secondary}` }} />
                <div style={{ marginTop: 4, fontSize: 9, fontWeight: 700, color: COLORS.secondary }}>
                  Authorized Signatory
                </div>
              </div>
            </div>

            <footer
              style={{
                marginTop: 14,
                paddingTop: 10,
                borderTop: `1px solid ${COLORS.softLine}`,
                textAlign: 'center',
                fontSize: 8.5,
                color: COLORS.muted,
              }}
            >
              {footerText}
            </footer>
          </div>
        </div>
      </div>
    );
  }
);

ReceiptDocument.displayName = 'ReceiptDocument';

export function ReceiptSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 15 }}>
      <div
        style={{
          marginBottom: 7,
          fontSize: 9,
          fontWeight: 850,
          color: COLORS.secondary,
          textTransform: 'uppercase',
          letterSpacing: 0.75,
        }}
      >
        {title}
      </div>
      <div style={{ borderTop: `1px solid ${COLORS.line}` }}>{children}</div>
    </section>
  );
}

export function ReceiptRow({
  label,
  value,
  valueColor = COLORS.ink,
  labelColor = COLORS.secondary,
  strong = false,
  backgroundColor,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  valueColor?: string;
  labelColor?: string;
  strong?: boolean;
  backgroundColor?: string;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(135px, auto)',
        gap: 14,
        alignItems: 'start',
        padding: strong ? '9px 8px' : '7px 2px',
        borderBottom: `1px solid ${COLORS.softLine}`,
        backgroundColor,
      }}
    >
      <div style={{ fontSize: strong ? 11 : 10.5, color: labelColor, fontWeight: strong ? 750 : 500 }}>
        {label}
      </div>
      <div
        style={{
          minWidth: 0,
          textAlign: 'right',
          fontSize: strong ? 11.5 : 10.5,
          color: valueColor,
          fontWeight: strong ? 850 : 700,
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </div>
    </div>
  );
}

export function ReceiptMetric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div
      style={{
        minWidth: 0,
        padding: '10px 9px',
        borderRadius: 10,
        border: `1px solid ${COLORS.line}`,
        backgroundColor: COLORS.panel,
      }}
    >
      <div style={{ fontSize: 8, fontWeight: 800, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ marginTop: 3, fontSize: 13, fontWeight: 850, color: COLORS.ink, overflowWrap: 'anywhere' }}>
        {value}
      </div>
      {detail && <div style={{ marginTop: 2, fontSize: 8.5, color: COLORS.secondary }}>{detail}</div>}
    </div>
  );
}

export const RECEIPT_COLORS = COLORS;
