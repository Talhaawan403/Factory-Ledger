import React from 'react';
import type { AppSettings } from '../types';
import { formatDisplayDate } from '../utils/dateUtils';

export const RECEIPT_COLORS = {
  ink: '#1D1D1F',
  secondary: '#6E6E73',
  muted: '#8E8E93',
  line: '#E5E5EA',
  hairline: '#F2F2F7',
  paper: '#FFFFFF',
  canvas: '#F5F5F7',
  blue: '#007AFF',
  green: '#15803D',
  orange: '#D97706',
  red: '#DC2626',
} as const;

export interface ReceiptDocumentProps {
  settings?: AppSettings;
  documentTitle: string;
  documentLabel: string;
  documentId: string;
  date: string;
  statusLabel: string;
  accentColor?: string;
  accentTint?: string;
  verificationLabel: string;
  footerText: string;
  kind: 'dispatch' | 'payment';
  children: React.ReactNode;
}

function getInitials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase())
      .join('') || 'FL'
  );
}

export const ReceiptDocument = React.forwardRef<HTMLDivElement, ReceiptDocumentProps>(
  (
    {
      settings,
      documentTitle,
      documentLabel,
      documentId,
      date,
      statusLabel,
      verificationLabel,
      footerText,
      kind,
      children,
    },
    ref
  ) => {
    const businessName = settings?.businessName?.trim() || 'Factory Ledger';
    const contactLine = [
      settings?.phoneNumber ? `Tel: ${settings.phoneNumber}` : null,
      settings?.ntnNumber ? `NTN: ${settings.ntnNumber}` : null,
      settings?.companyAddress ? settings.companyAddress : null,
    ]
      .filter(Boolean)
      .join(' • ');

    const formattedDate = formatDisplayDate(date) || 'Not recorded';

    return (
      <div
        ref={ref}
        data-receipt-kind={kind}
        data-receipt-version="2"
        style={{
          width: 450,
          margin: '0 auto',
          padding: '24px 20px',
          boxSizing: 'border-box',
          backgroundColor: RECEIPT_COLORS.canvas,
          color: RECEIPT_COLORS.ink,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", Arial, sans-serif',
          lineHeight: 1.4,
          WebkitFontSmoothing: 'antialiased',
        }}
      >
        {/* ─── Pure Apple Minimalist Document (Single Breathable White Card) ─── */}
        <div
          style={{
            borderRadius: 20,
            border: `1px solid ${RECEIPT_COLORS.line}`,
            backgroundColor: RECEIPT_COLORS.paper,
            padding: '34px 28px 28px',
            boxSizing: 'border-box',
          }}
        >
          {/* ─── Apple Header (Clean, Centered, Zero Clutter) ─── */}
          <div
            style={{
              textAlign: 'center',
              paddingBottom: 22,
              borderBottom: `1px solid ${RECEIPT_COLORS.line}`,
            }}
          >
            {/* Squircle Brand Avatar */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  backgroundColor: '#FFFFFF',
                  border: `1px solid ${RECEIPT_COLORS.line}`,
                  color: RECEIPT_COLORS.ink,
                  fontSize: 17,
                  fontWeight: 700,
                  letterSpacing: -0.2,
                }}
              >
                {settings?.logoUrl ? (
                  <img
                    src={settings.logoUrl}
                    alt="Logo"
                    crossOrigin="anonymous"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      padding: 4,
                      boxSizing: 'border-box',
                    }}
                  />
                ) : (
                  getInitials(businessName)
                )}
              </div>
            </div>

            {/* Business Name */}
            <div
              style={{
                fontSize: 19,
                fontWeight: 700,
                color: RECEIPT_COLORS.ink,
                letterSpacing: -0.4,
                lineHeight: 1.25,
              }}
            >
              {businessName}
            </div>

            {/* Subline Contact Details */}
            {contactLine && (
              <div
                style={{
                  marginTop: 4,
                  fontSize: 11.5,
                  color: RECEIPT_COLORS.muted,
                  lineHeight: 1.35,
                }}
              >
                {contactLine}
              </div>
            )}

            {/* Executive Document Title */}
            <div
              style={{
                marginTop: 14,
                fontSize: 12,
                fontWeight: 700,
                color: RECEIPT_COLORS.ink,
                letterSpacing: 0.8,
                textTransform: 'uppercase',
              }}
            >
              {documentTitle}
            </div>

            {/* Elegant Sub-line (Classification, Status & Date as clean text) */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                marginTop: 5,
                fontSize: 12,
                color: RECEIPT_COLORS.secondary,
              }}
            >
              <span>{documentLabel}</span>
              <span style={{ color: RECEIPT_COLORS.muted }}>•</span>
              <span style={{ fontWeight: 600, color: RECEIPT_COLORS.ink }}>{statusLabel}</span>
              <span style={{ color: RECEIPT_COLORS.muted }}>•</span>
              <span>{formattedDate}</span>
            </div>
          </div>

          {/* ─── Children Content (Hero Number, Line Lists) ─── */}
          <div style={{ paddingTop: 6 }}>
            {children}

            {/* ─── Document Information (Clean Open Lines) ─── */}
            <div style={{ marginTop: 24, paddingTop: 14, borderTop: `1px solid ${RECEIPT_COLORS.line}` }}>
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  color: RECEIPT_COLORS.muted,
                  textTransform: 'uppercase',
                  letterSpacing: 0.6,
                  marginBottom: 10,
                }}
              >
                Document Information
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '7px 0',
                  borderBottom: `1px solid ${RECEIPT_COLORS.hairline}`,
                  fontSize: 12.5,
                }}
              >
                <span style={{ color: RECEIPT_COLORS.secondary }}>Document Number</span>
                <span
                  style={{
                    fontWeight: 600,
                    color: RECEIPT_COLORS.ink,
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  }}
                >
                  {documentId}
                </span>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '7px 0',
                  borderBottom: `1px solid ${RECEIPT_COLORS.hairline}`,
                  fontSize: 12.5,
                }}
              >
                <span style={{ color: RECEIPT_COLORS.secondary }}>Issue Date</span>
                <span style={{ fontWeight: 600, color: RECEIPT_COLORS.ink }}>{formattedDate}</span>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '7px 0',
                  fontSize: 12.5,
                }}
              >
                <span style={{ color: RECEIPT_COLORS.secondary }}>Verification</span>
                <span style={{ fontWeight: 600, color: RECEIPT_COLORS.ink }}>
                  {verificationLabel}
                </span>
              </div>
            </div>

            {/* ─── Apple Signatory Line ─── */}
            <div
              style={{
                marginTop: 26,
                paddingTop: 18,
                borderTop: `1px solid ${RECEIPT_COLORS.line}`,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-end',
              }}
            >
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: RECEIPT_COLORS.ink }}>
                  Factory Ledger Authentication
                </div>
                <div style={{ fontSize: 10, color: RECEIPT_COLORS.muted, marginTop: 2 }}>
                  System Ref: {documentId}
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                {settings?.signatureUrl ? (
                  <div
                    style={{
                      height: 32,
                      display: 'flex',
                      alignItems: 'flex-end',
                      justifyContent: 'flex-end',
                      marginBottom: 4,
                    }}
                  >
                    <img
                      src={settings.signatureUrl}
                      alt="Signature"
                      crossOrigin="anonymous"
                      style={{ maxHeight: 28, maxWidth: 120, objectFit: 'contain' }}
                    />
                  </div>
                ) : (
                  <div
                    style={{
                      width: 110,
                      height: 1,
                      backgroundColor: RECEIPT_COLORS.muted,
                      marginBottom: 5,
                    }}
                  />
                )}
                <div style={{ fontSize: 11.5, fontWeight: 600, color: RECEIPT_COLORS.ink }}>
                  {settings?.userName || 'Authorized Signatory'}
                </div>
                <div style={{ fontSize: 10, color: RECEIPT_COLORS.muted }}>
                  Authorized Signatory
                </div>
              </div>
            </div>

            {/* ─── Footer Disclaimer ─── */}
            <footer
              style={{
                marginTop: 18,
                paddingTop: 12,
                borderTop: `1px dashed ${RECEIPT_COLORS.line}`,
                textAlign: 'center',
                fontSize: 9.5,
                color: RECEIPT_COLORS.muted,
                lineHeight: 1.45,
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

/**
 * Apple Store / Apple Pay Grand Hero Amount
 * Pure typography directly on the white canvas (no enclosed box or background tile).
 */
export function ReceiptHero({
  label,
  amount,
  subtitle,
  isPending = false,
  accentColor,
}: {
  label: string;
  amount: React.ReactNode;
  subtitle?: React.ReactNode;
  isPending?: boolean;
  accentColor?: string;
}) {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '24px 0 16px',
        margin: '0 auto',
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: isPending ? RECEIPT_COLORS.orange : RECEIPT_COLORS.muted,
          textTransform: 'uppercase',
          letterSpacing: 0.8,
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: isPending ? 26 : 38,
          fontWeight: 700,
          color: isPending
            ? accentColor || RECEIPT_COLORS.orange
            : accentColor || RECEIPT_COLORS.ink,
          letterSpacing: -1.2,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.15,
        }}
      >
        {amount}
      </div>
      {subtitle && (
        <div
          style={{
            marginTop: 6,
            fontSize: 12.5,
            color: RECEIPT_COLORS.secondary,
            fontWeight: 500,
          }}
        >
          {subtitle}
        </div>
      )}
    </div>
  );
}

/**
 * Apple Open Line List Section
 * Zero box enclosure. Clear header with clean horizontal lines.
 */
export function ReceiptSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginTop: 22 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: RECEIPT_COLORS.ink,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          paddingBottom: 6,
          borderBottom: `1.5px solid ${RECEIPT_COLORS.ink}`,
        }}
      >
        {title}
      </div>
      <div>{children}</div>
    </section>
  );
}

/**
 * Apple Line Row
 * Left-aligned descriptive label, right-aligned bold value, separated by a light hairline divider.
 */
export function ReceiptRow({
  label,
  value,
  valueColor = RECEIPT_COLORS.ink,
  labelColor = RECEIPT_COLORS.secondary,
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
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 16,
        padding: strong ? '10px 0' : '8.5px 0',
        borderBottom: `1px solid ${RECEIPT_COLORS.hairline}`,
        backgroundColor,
      }}
    >
      <div
        style={{
          fontSize: strong ? 13 : 12.5,
          color: labelColor,
          fontWeight: strong ? 600 : 400,
          lineHeight: 1.35,
          flex: 1,
          minWidth: 0,
        }}
      >
        {label}
      </div>
      <div
        style={{
          textAlign: 'right',
          fontSize: strong ? 13.5 : 12.5,
          color: valueColor,
          fontWeight: strong ? 700 : 600,
          fontVariantNumeric: 'tabular-nums',
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * Metric helper fallback
 */
export function ReceiptMetric({
  label,
  value,
  detail,
  accentColor,
}: {
  label: string;
  value: string;
  detail?: string;
  accentColor?: string;
}) {
  return (
    <div
      style={{
        padding: '8px 0',
        borderBottom: `1px solid ${RECEIPT_COLORS.hairline}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <div style={{ fontSize: 12, color: RECEIPT_COLORS.secondary }}>
        {label}
        {detail && (
          <span style={{ fontSize: 10, color: RECEIPT_COLORS.muted, marginLeft: 6 }}>
            ({detail})
          </span>
        )}
      </div>
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: accentColor || RECEIPT_COLORS.ink,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
    </div>
  );
}
