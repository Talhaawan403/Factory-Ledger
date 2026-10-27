export interface CoalInput {
  id: string;
  sourceName: string;
  weight: number;
  purchaseRate: number;
  mineId?: string;
  lotId?: string;
  supplierId?: string;
}

export type MaterialPricingModel = 'gcv' | 'purity' | 'flat';

export interface MaterialDefinition {
  id: string;
  name: string;
  pricingModel: MaterialPricingModel;
  qualityLabel?: string;
  qualityUnit?: string;
  defaultRate?: number;
  isActive?: boolean;
  isSystem?: boolean;
}

export interface SupplierProfile {
  id: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  address?: string;
  materialIds?: string[];
  isArchived?: boolean;
}

export interface OverheadExpenses {
  loading: number;
  freight: number;
  crush: number;
  royalty: number;
  other: number;
}

export interface PurchaseOrder {
  id: string;
  partyId: string;
  poNumber: string;
  targetGcv: number;
  baseRate: number;
  commissionPerTon: number;
  itemId?: string;
  itemName?: string;
  pricingModel?: MaterialPricingModel;
  qualityLabel?: string;
  qualityUnit?: string;
  ratePerQualityUnit?: number;
  totalTons?: number;
  notes?: string;
  gcvAdjustment?: 'manual' | 'prorata';
  gcvAdjustmentRounding?: 'rupee' | 'paisa';
  createdAt: number;
  updatedAt?: number;
  isActive: boolean;
  deleted?: boolean;
  deletedAt?: number;
  dirty?: boolean;
}

export interface Dispatch {
  id: string;
  partyId: string;
  poId?: string;
  date: string;
  truckNumber: string;
  factoryName: string;
  itemId?: string;
  itemName?: string;
  pricingModel?: MaterialPricingModel;
  qualityLabel?: string;
  qualityUnit?: string;
  ratePerQualityUnit?: number;
  receivedQuality?: number;
  targetGcv: number;
  baseRate: number;
  commissionPerTon?: number;
  coalInputs: CoalInput[];
  overheads: OverheadExpenses;
  labActualGcv: number;
  labSulphur: number;
  labAsh?: number;
  labVm?: number;
  labMoisture?: number;
  labReceivedWeight: number;
  manualDeduction?: number;
  manualPremium?: number;
  manualTax?: number;
  gcvAdjustment?: 'manual' | 'prorata';
  gcvAdjustmentRounding?: 'rupee' | 'paisa';
  taxMethod?: TaxMethod;
  taxSalesPercent?: number; // Snapshot of sales tax % (e.g. 18) when dispatch was saved
  taxIncomePercent?: number; // Snapshot of income tax % (e.g. 5 or 5.5) when dispatch was saved
  dieselRateAdjustment?: number; // Diesel Escalation / De-escalation adjustment per ton (+ for premium, - for deduction)
  notes?: string;
  status?: DispatchStatus;
  settledAt?: number;
  settledDate?: string;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
  deletedAt?: number;
  dirty?: boolean;
}

export type DispatchStatus = 'pending' | 'settled';

export type TaxMethod = 'manual' | 'formula_18_5';

export interface Party {
  id: string;
  name: string;
  contactPerson: string;
  phone: string;
  address: string;
  type?: 'buyer' | 'supplier';
  materialIds?: string[];
  notes?: string;
  isDirectMine?: boolean;
  linkedMineId?: string;
  createdAt: number;
  updatedAt?: number;
  isArchived?: boolean;
  deleted?: boolean;
  deletedAt?: number;
  dirty?: boolean;
}

export interface Payment {
  id: string;
  partyId: string;
  supplierId?: string; // Explicit link when payment is paid to a supplier
  mineId?: string; // Explicit link when payment is paid to a mine
  date: string;
  amount: number;
  type: 'received' | 'paid';
  mode: 'bank' | 'cash' | 'cheque' | 'online';
  referenceNote?: string;
  createdAt: number;
  updatedAt?: number;
  deleted?: boolean;
  deletedAt?: number;
  dirty?: boolean;
}

export type GeneralExpenseCategory =
  | 'warehouse_rent'
  | 'warehouse_labour'
  | 'utilities'
  | 'equipment'
  | 'office'
  | 'maintenance'
  | 'transport'
  | 'other';

export interface GeneralExpense {
  id: string;
  date: string;
  category: GeneralExpenseCategory;
  amount: number;
  description: string;
  vendor?: string;
  paymentMode?: Payment['mode'];
  notes?: string;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
  deletedAt?: number;
  dirty?: boolean;
}

export interface AppSettings {
  userName: string;
  businessName: string;
  phoneNumber: string;
  logoUrl: string;
  signatureUrl?: string;
  theme: 'light' | 'dark' | 'system';
  currency?: string;
  locale?: string;
  numberFormat?: 'lakh' | 'million';
  defaultTaxMethod?: TaxMethod;
  taxFormulaSalesPercent?: number;
  taxFormulaIncomePercent?: number;
  accountType?: string;
  companyAddress?: string;
  ntnNumber?: string;
  materialItems?: MaterialDefinition[];
  suppliers?: SupplierProfile[];
  updatedAt?: number;
  // Device-local App Lock settings (explicitly stripped from cloud sync)
  appLockEnabled?: boolean;
  pinHash?: string;
  pinLength?: number;
  lockTimeout?: number;
}

export interface Mine {
  id: string;
  name: string;
  ratePerTon: number;
  location?: string;
  notes?: string;
  phone?: string;
  defaultSupplierId?: string;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
  deletedAt?: number;
  dirty?: boolean;
}

export interface InventoryLot {
  id: string;
  mineId?: string; // Optional reference to Mine
  mineName?: string;
  itemId?: string;
  itemName?: string;
  supplierId?: string;
  supplier: string; // "Bought from" vendor/supplier
  boughtFrom?: string; // Alias for bought from
  storedAt?: string; // Yard or depot location
  date: string; // YYYY-MM-DD
  billedWeight: number; // Tons billed (e.g. 30 or 10)
  receivedWeight: number; // Tons received (e.g. 28.5 or 10)
  tonnage?: number; // Total tonnage
  purchaseRate: number; // Supplier rate or per-ton rate
  landedRate: number; // Landed cost or per-ton rate
  ratePerTon?: number; // Per-ton amount
  totalValue?: number; // Total cost (coal + loading + fare)
  loadingCost?: number; // Loading amount (PKR)
  freightCost?: number; // Fare / Freight amount (PKR)
  usedInDispatchId?: string; // Compatibility/display marker for one current allocation; dispatch coalInputs are authoritative
  usedInDispatchTruck?: string; // Linked dispatch truck number
  usedInPartyName?: string; // Linked dispatch party / factory name
  usedInDate?: string; // Linked dispatch date
  grade?: string;
  gcv?: number;
  targetGcv?: number;
  truckNumber?: string;
  mineSource?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
  deletedAt?: number;
  dirty?: boolean;
}

export type MineStockEntry = InventoryLot;

export interface BackupPayload {
  version?: string;
  exportDate: string;
  exportedAt?: string;
  createdAt?: string;
  app?: string;
  parties: Party[];
  dispatches: Dispatch[];
  payments: Payment[];
  expenses?: GeneralExpense[];
  pos: PurchaseOrder[];
  mines?: Mine[];
  lots?: InventoryLot[];
  settings: AppSettings;
  deviceInfo?: string;
  lastCloudSync?: string;
  images?: Record<string, string>;
  meta?: Record<string, unknown>;
}
