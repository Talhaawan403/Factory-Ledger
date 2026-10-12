import type { LucideIcon } from 'lucide-react';
import {
  Building2,
  Users,
  Zap,
  Wrench,
  Hammer,
  FileText,
  Truck,
  ReceiptText,
} from 'lucide-react';
import type { GeneralExpenseCategory } from '../types';
import type { IOSSelectOption } from '../components/IOSSelect';

export interface ExpenseCategoryMeta {
  id: GeneralExpenseCategory;
  label: string;
  subtitle: string;
  icon: LucideIcon;
  color: string;
  quickDescriptions: string[];
}

export const EXPENSE_CATEGORIES: ExpenseCategoryMeta[] = [
  {
    id: 'warehouse_rent',
    label: 'Warehouse Rent',
    subtitle: 'Yard, depot, godown, or plot rent',
    icon: Building2,
    color: 'var(--ios-purple)',
    quickDescriptions: ['Monthly Yard Rent', 'Warehouse Advance', 'Depot Lease Payment', 'Godown Rent'],
  },
  {
    id: 'warehouse_labour',
    label: 'Warehouse Labour',
    subtitle: 'Independent handling and staff wages',
    icon: Users,
    color: 'var(--ios-blue)',
    quickDescriptions: ['Unloading Labour Wages', 'Loading / Stacking Staff', 'Yard Security Wages', 'Daily Labour Pool'],
  },
  {
    id: 'utilities',
    label: 'Utilities',
    subtitle: 'Electricity, water, diesel, and communications',
    icon: Zap,
    color: 'var(--ios-yellow)',
    quickDescriptions: ['Depot Electricity Bill', 'Water Supply Tanker', 'Generator Diesel', 'Yard Phone / Internet'],
  },
  {
    id: 'equipment',
    label: 'Equipment',
    subtitle: 'Machinery rental, tools, and weighbridge charges',
    icon: Wrench,
    color: 'var(--ios-teal)',
    quickDescriptions: ['Weighbridge Annual Fee', 'Loader Hire & Maintenance', 'Tarpaulin & Tools', 'Safety Equipment'],
  },
  {
    id: 'maintenance',
    label: 'Maintenance',
    subtitle: 'Yard ground, depot shed, and facility repairs',
    icon: Hammer,
    color: 'var(--ios-orange)',
    quickDescriptions: ['Yard Ground Leveling', 'Depot Shed Repair', 'Weighbridge Calibration', 'Gate / Fence Repair'],
  },
  {
    id: 'office',
    label: 'Office & Admin',
    subtitle: 'Office supplies, tea/food, and accounting costs',
    icon: FileText,
    color: 'var(--ios-indigo)',
    quickDescriptions: ['Stationery & Bill Books', 'Staff Tea & Refreshments', 'Accountant Service Fee', 'Office Cleaning'],
  },
  {
    id: 'transport',
    label: 'General Transport',
    subtitle: 'Independent shuttles not assigned to a single dispatch',
    icon: Truck,
    color: 'var(--ios-mint)',
    quickDescriptions: ['Internal Yard Tractor Ferry', 'Depot Equipment Moving', 'Empty Truck Return Shift'],
  },
  {
    id: 'other',
    label: 'Other Overhead',
    subtitle: 'Any other independent business cost',
    icon: ReceiptText,
    color: 'var(--label-secondary)',
    quickDescriptions: ['Trade License Fee', 'Bank Service Charges', 'Legal & Regulatory Fee', 'Miscellaneous Expense'],
  },
];

export const EXPENSE_CATEGORY_MAP: Record<GeneralExpenseCategory, ExpenseCategoryMeta> =
  EXPENSE_CATEGORIES.reduce((acc, cat) => {
    acc[cat.id] = cat;
    return acc;
  }, {} as Record<GeneralExpenseCategory, ExpenseCategoryMeta>);

export function getExpenseCategoryMeta(category?: GeneralExpenseCategory | string): ExpenseCategoryMeta {
  if (category && category in EXPENSE_CATEGORY_MAP) {
    return EXPENSE_CATEGORY_MAP[category as GeneralExpenseCategory];
  }
  return EXPENSE_CATEGORY_MAP.other;
}

export const CATEGORY_SELECT_OPTIONS: IOSSelectOption<GeneralExpenseCategory>[] = EXPENSE_CATEGORIES.map(
  (cat) => ({
    value: cat.id,
    label: cat.label,
    subtitle: cat.subtitle,
  })
);
