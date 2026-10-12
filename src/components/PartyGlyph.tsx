import React from 'react';
import { Building2, Factory, Warehouse, Briefcase } from 'lucide-react';

/**
 * Authentic Apple iOS Solid System Tones
 * (Strictly compliant with Apple HIG & workspace rules: 100% flat solid colors, NO gradients, NO neon glow)
 */
const APPLE_BUSINESS_PALETTE = [
  '#007AFF', // System Blue
  '#5856D6', // System Indigo
  '#30B0C7', // System Teal
  '#34C759', // System Green
  '#FF9500', // System Orange
  '#636366', // System Slate
  '#8E8E93', // System Gray
  '#A2845E', // System Earth / Sand
  '#2C2C2E', // System Obsidian
];

function getPartyGlyphData(name: string) {
  const lower = (name || '').trim().toLowerCase();

  // Deterministic hash based on party name
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  const colorIndex = Math.abs(hash) % APPLE_BUSINESS_PALETTE.length;
  const bg = APPLE_BUSINESS_PALETTE[colorIndex];

  // Specific industrial, cement & manufacturing keywords
  const isIndustrial =
    lower.includes('cement') ||
    lower.includes('bestway') ||
    lower.includes('lucky') ||
    lower.includes('fauji') ||
    lower.includes('cherat') ||
    lower.includes('maple') ||
    lower.includes('kohat') ||
    lower.includes('askari') ||
    lower.includes('pioneer') ||
    lower.includes('attock') ||
    lower.includes('dg') ||
    lower.includes('flying') ||
    lower.includes('dewan') ||
    lower.includes('mill') ||
    lower.includes('steel') ||
    lower.includes('power') ||
    lower.includes('plant') ||
    lower.includes('factory') ||
    lower.includes('furnace') ||
    lower.includes('industr');

  // Warehouses, depots, coal sidings
  const isLogistics =
    lower.includes('warehouse') ||
    lower.includes('depot') ||
    lower.includes('yard') ||
    lower.includes('storage') ||
    lower.includes('terminal') ||
    lower.includes('logistics') ||
    lower.includes('siding');

  // Commercial trading firms, dealerships & agencies
  const isCommercial =
    lower.includes('trader') ||
    lower.includes('trading') ||
    lower.includes('agency') ||
    lower.includes('enterprises') ||
    lower.includes('brothers') ||
    lower.includes('sons') ||
    lower.includes('corp') ||
    lower.includes('co.') ||
    lower.includes('coal') ||
    lower.includes('fuel') ||
    lower.includes('energy');

  let Icon = Building2;
  if (isIndustrial) {
    Icon = Factory;
  } else if (isLogistics) {
    Icon = Warehouse;
  } else if (isCommercial) {
    Icon = Briefcase;
  }

  return { Icon, bg };
}

interface PartyGlyphProps {
  name: string;
  size?: number;
  borderRadius?: number;
  iconSize?: number;
  style?: React.CSSProperties;
  className?: string;
}

export default function PartyGlyph({
  name,
  size = 42,
  borderRadius = 11,
  iconSize = 20,
  style,
  className
}: PartyGlyphProps) {
  const { Icon, bg } = getPartyGlyphData(name);

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        borderRadius,
        backgroundColor: bg,
        color: '#FFFFFF',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        boxShadow: 'none',
        ...style
      }}
      aria-hidden="true"
    >
      <Icon style={{ width: iconSize, height: iconSize }} strokeWidth={2} />
    </div>
  );
}
