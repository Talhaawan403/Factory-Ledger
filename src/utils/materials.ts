import type {
  AppSettings,
  Dispatch,
  InventoryLot,
  MaterialDefinition,
  MaterialPricingModel,
  SupplierProfile,
} from '../types';

export const COAL_ITEM_ID = 'material-coal';

export const DEFAULT_MATERIAL_ITEMS: MaterialDefinition[] = [
  {
    id: COAL_ITEM_ID,
    name: 'Coal',
    pricingModel: 'gcv',
    qualityLabel: 'GCV',
    qualityUnit: 'kcal/kg',
    defaultRate: 0,
    isActive: true,
    isSystem: true,
  },
  {
    id: 'material-laterite',
    name: 'Laterite',
    pricingModel: 'purity',
    qualityLabel: 'Fe2O3',
    qualityUnit: '%',
    defaultRate: 116,
    isActive: true,
    isSystem: true,
  },
  {
    id: 'material-bauxite',
    name: 'Bauxite',
    pricingModel: 'flat',
    qualityLabel: 'Al2O3',
    qualityUnit: '%',
    defaultRate: 0,
    isActive: true,
    isSystem: true,
  },
  {
    id: 'material-gypsum',
    name: 'Gypsum',
    pricingModel: 'flat',
    qualityLabel: 'Purity',
    qualityUnit: '%',
    defaultRate: 0,
    isActive: true,
    isSystem: true,
  },
  {
    id: 'material-bricks-waste',
    name: 'Bricks Waste',
    pricingModel: 'flat',
    qualityLabel: 'Purity',
    qualityUnit: '%',
    defaultRate: 0,
    isActive: true,
    isSystem: true,
  },
  {
    id: 'material-wheat-waste',
    name: 'Wheat Waste',
    pricingModel: 'flat',
    qualityLabel: 'Purity',
    qualityUnit: '%',
    defaultRate: 0,
    isActive: true,
    isSystem: true,
  },
];

const PRICING_MODELS = new Set<MaterialPricingModel>(['gcv', 'purity', 'flat']);

function finiteNonNegative(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function normalizeMaterialItems(items?: MaterialDefinition[]): MaterialDefinition[] {
  const source = Array.isArray(items) && items.length > 0 ? items : DEFAULT_MATERIAL_ITEMS;
  const normalized: MaterialDefinition[] = [];
  const seen = new Set<string>();

  for (const raw of source) {
    const id = String(raw?.id || '').trim();
    const name = String(raw?.name || '').trim();
    if (!id || !name || seen.has(id)) continue;
    const pricingModel = PRICING_MODELS.has(raw.pricingModel) ? raw.pricingModel : 'flat';
    normalized.push({
      id,
      name,
      pricingModel,
      qualityLabel: String(raw.qualityLabel || (pricingModel === 'gcv' ? 'GCV' : pricingModel === 'purity' ? 'Purity' : 'Quality')).trim(),
      qualityUnit: String(raw.qualityUnit || (pricingModel === 'gcv' ? 'kcal/kg' : '%')).trim(),
      defaultRate: finiteNonNegative(raw.defaultRate),
      isActive: raw.isActive !== false,
      isSystem: Boolean(raw.isSystem || id === COAL_ITEM_ID),
    });
    seen.add(id);
  }

  if (!seen.has(COAL_ITEM_ID)) normalized.unshift({ ...DEFAULT_MATERIAL_ITEMS[0] });
  return normalized;
}

export function normalizeSuppliers(suppliers?: SupplierProfile[]): SupplierProfile[] {
  if (!Array.isArray(suppliers)) return [];
  const seen = new Set<string>();
  return suppliers.flatMap((raw) => {
    const id = String(raw?.id || '').trim();
    const name = String(raw?.name || '').trim();
    if (!id || !name || seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      name,
      contactPerson: String(raw.contactPerson || '').trim() || undefined,
      phone: String(raw.phone || '').trim() || undefined,
      address: String(raw.address || '').trim() || undefined,
      materialIds: Array.isArray(raw.materialIds)
        ? Array.from(new Set(raw.materialIds.map(String).map((value) => value.trim()).filter(Boolean)))
        : undefined,
      isArchived: Boolean(raw.isArchived),
    }];
  });
}

export function getMaterialItems(settings?: AppSettings | null, activeOnly = true): MaterialDefinition[] {
  const items = normalizeMaterialItems(settings?.materialItems);
  return activeOnly ? items.filter((item) => item.isActive !== false) : items;
}

export function getMaterialForDispatch(dispatch?: Partial<Dispatch> | null, settings?: AppSettings | null): MaterialDefinition {
  // A dispatch snapshot is historical evidence. Prefer it over the current
  // catalog so later settings edits cannot rename or reinterpret old records.
  if (dispatch?.itemName || dispatch?.pricingModel) {
    return {
      id: dispatch.itemId || COAL_ITEM_ID,
      name: dispatch.itemName || 'Coal',
      pricingModel: dispatch.pricingModel || 'gcv',
      qualityLabel: dispatch.qualityLabel || (dispatch.pricingModel === 'purity' ? 'Purity' : 'GCV'),
      qualityUnit: dispatch.qualityUnit || (dispatch.pricingModel === 'gcv' || !dispatch.pricingModel ? 'kcal/kg' : '%'),
      defaultRate: finiteNonNegative(dispatch.ratePerQualityUnit),
      isActive: true,
    };
  }

  const items = getMaterialItems(settings, false);
  const matched = dispatch?.itemId ? items.find((item) => item.id === dispatch.itemId) : undefined;
  if (matched) return matched;

  return items.find((item) => item.id === COAL_ITEM_ID) || { ...DEFAULT_MATERIAL_ITEMS[0] };
}

export function getDispatchBaseRate(dispatch: Partial<Dispatch>): number {
  if (dispatch.pricingModel === 'purity') {
    return finiteNonNegative(dispatch.ratePerQualityUnit) * finiteNonNegative(dispatch.receivedQuality);
  }
  return finiteNonNegative(dispatch.baseRate);
}

export function withMaterialSnapshot<T extends Partial<Dispatch>>(dispatch: T, material: MaterialDefinition): T {
  return {
    ...dispatch,
    itemId: material.id,
    itemName: material.name,
    pricingModel: material.pricingModel,
    qualityLabel: material.qualityLabel,
    qualityUnit: material.qualityUnit,
    ratePerQualityUnit: material.pricingModel === 'purity'
      ? finiteNonNegative(dispatch.ratePerQualityUnit, material.defaultRate || 0)
      : dispatch.ratePerQualityUnit,
  };
}

export function suppliersForMaterial(settings: AppSettings | null | undefined, materialId: string): SupplierProfile[] {
  return normalizeSuppliers(settings?.suppliers)
    .filter((supplier) => !supplier.isArchived)
    .filter((supplier) => !supplier.materialIds?.length || supplier.materialIds.includes(materialId));
}

export function getMaterialById(materialId?: string, settings?: AppSettings | null): MaterialDefinition {
  const items = getMaterialItems(settings, false);
  const matched = materialId ? items.find((item) => item.id === materialId) : undefined;
  return matched || items.find((item) => item.id === COAL_ITEM_ID) || { ...DEFAULT_MATERIAL_ITEMS[0] };
}

export function getMaterialForLot(lot?: Partial<InventoryLot> | null, settings?: AppSettings | null): MaterialDefinition {
  if (lot?.itemId) {
    return getMaterialById(lot.itemId, settings);
  }
  return getMaterialById(COAL_ITEM_ID, settings);
}

export interface MaterialBadgeTheme {
  bg: string;
  color: string;
  border: string;
  dot: string;
}

export function getMaterialDefaultTaxIncomePercent(materialIdOrName?: string): number {
  const s = String(materialIdOrName || '').toLowerCase();
  return s.includes('laterite') ? 5.5 : 5.0;
}

export function getMaterialBadgeTheme(materialId?: string): MaterialBadgeTheme {
  const id = String(materialId || '').toLowerCase();
  if (id.includes('laterite')) {
    return {
      bg: 'rgba(255, 149, 0, 0.12)',
      color: '#d97706',
      border: 'rgba(255, 149, 0, 0.28)',
      dot: '#f59e0b',
    };
  }
  if (id.includes('bauxite')) {
    return {
      bg: 'rgba(52, 199, 89, 0.12)',
      color: '#16a34a',
      border: 'rgba(52, 199, 89, 0.28)',
      dot: '#22c55e',
    };
  }
  if (id.includes('gypsum')) {
    return {
      bg: 'rgba(175, 82, 222, 0.12)',
      color: '#9333ea',
      border: 'rgba(175, 82, 222, 0.28)',
      dot: '#a855f7',
    };
  }
  if (id.includes('brick')) {
    return {
      bg: 'rgba(234, 88, 12, 0.12)',
      color: '#c2410c',
      border: 'rgba(234, 88, 12, 0.28)',
      dot: '#ea580c',
    };
  }
  if (id.includes('wheat')) {
    return {
      bg: 'rgba(202, 138, 4, 0.12)',
      color: '#b45309',
      border: 'rgba(202, 138, 4, 0.28)',
      dot: '#ca8a04',
    };
  }
  if (id.includes('coal')) {
    return {
      bg: 'rgba(0, 122, 255, 0.12)',
      color: 'var(--ios-blue, #007aff)',
      border: 'rgba(0, 122, 255, 0.28)',
      dot: '#007aff',
    };
  }
  return {
    bg: 'var(--fill-tertiary, rgba(120, 120, 128, 0.12))',
    color: 'var(--label-primary, #1c1c1e)',
    border: 'var(--separator, rgba(60, 60, 67, 0.2))',
    dot: 'var(--label-secondary, #8e8e93)',
  };
}
