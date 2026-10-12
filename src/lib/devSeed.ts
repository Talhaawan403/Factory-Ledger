import {
  saveMine,
  saveLot,
  saveParty,
  saveDispatch,
  savePayment,
  savePurchaseOrder,
  saveSettings,
  saveGeneralExpense,
} from './db';
import { idb } from './dexieDb';
import type { Mine, InventoryLot, Party, Dispatch, Payment, PurchaseOrder, AppSettings, GeneralExpense } from '../types';
import { toLocalDateString } from '../utils/dateUtils';

/**
 * Injects a comprehensive, realistic real-world dataset into IndexedDB for development testing.
 * Includes multiple mines, varied inventory lots, industrial cement factories, purchase orders,
 * linked dispatches with real lab metrics & tax formulas, and historical payments.
 */
export async function seedTestData(options: { reload?: boolean } = {}): Promise<void> {
  console.log('[DevSeed] Seeding comprehensive real-world dataset into IndexedDB...');

  const today = new Date();
  const dayAgo = (days: number): string => {
    const d = new Date(today);
    d.setDate(d.getDate() - days);
    return toLocalDateString(d);
  };

  const timestampAgo = (days: number): number => {
    return Date.now() - days * 86400000;
  };

  // -------------------------------------------------------------
  // 1. App Profile & Company Settings
  // -------------------------------------------------------------
  const settings: AppSettings = {
    userName: 'Talha Awan',
    businessName: 'Indus Coal Traders & Logistics',
    phoneNumber: '0300-1234567',
    companyAddress: 'Office #14, Coal Logistics Plaza, Quetta & Mianwali',
    ntnNumber: '7829104-5',
    logoUrl: '',
    theme: 'dark',
    currency: 'PKR',
    numberFormat: 'lakh',
    defaultTaxMethod: 'manual',
    taxFormulaSalesPercent: 18,
    taxFormulaIncomePercent: 5,
    updatedAt: Date.now(),
  };
  await saveSettings(settings);

  // -------------------------------------------------------------
  // 2. Mines (5 major mining zones)
  // -------------------------------------------------------------
  const mines: Mine[] = [
    {
      id: 'mine-islam-duki',
      name: 'Islam Coal Mine',
      ratePerTon: 22000,
      location: 'Block 4, Duki, Balochistan',
      notes: 'High-grade steaming coal with low sulfur content (< 1.2%)',
      createdAt: timestampAgo(45),
      updatedAt: timestampAgo(45),
    },
    {
      id: 'mine-chamalang',
      name: 'Chamalang Coal Field',
      ratePerTon: 24500,
      location: 'Sector B, Loralai, Balochistan',
      notes: 'Premium high caloric value lumps (5,500 - 6,200 GCV)',
      createdAt: timestampAgo(40),
      updatedAt: timestampAgo(40),
    },
    {
      id: 'mine-sorange-degari',
      name: 'Sorange Degari Colliery',
      ratePerTon: 26000,
      location: 'Quetta Coal Basin',
      notes: 'Dense lump coal suitable for kiln combustion',
      createdAt: timestampAgo(35),
      updatedAt: timestampAgo(35),
    },
    {
      id: 'mine-mach-bolan',
      name: 'Mach Bolan Mines',
      ratePerTon: 21500,
      location: 'Mach Siding, Kachhi',
      notes: 'Economic industrial grade, medium ash content',
      createdAt: timestampAgo(30),
      updatedAt: timestampAgo(30),
    },
    {
      id: 'mine-makerwal',
      name: 'Makerwal Collieries',
      ratePerTon: 23000,
      location: 'Salt Range, Mianwali, Punjab',
      notes: 'Reliable local supplies with minimal freight overheads',
      createdAt: timestampAgo(25),
      updatedAt: timestampAgo(25),
    },
  ];

  for (const m of mines) {
    await saveMine(m);
  }

  // -------------------------------------------------------------
  // 3. Inventory Stock Lots (14 lots across mines)
  // -------------------------------------------------------------
  const lots: InventoryLot[] = [
    // Islam Mine Lots
    {
      id: 'lot-hamza-pit',
      mineId: 'mine-islam-duki',
      mineName: 'Islam Coal Mine',
      boughtFrom: 'Hamza Pit Incline',
      supplier: 'Hamza Pit Incline',
      billedWeight: 40.0,
      receivedWeight: 40.0,
      tonnage: 40.0,
      purchaseRate: 20000,
      loadingCost: 5000,
      freightCost: 15000,
      totalValue: 820000,
      landedRate: 20500,
      date: dayAgo(20),
      createdAt: timestampAgo(20),
      updatedAt: timestampAgo(20),
    },
    {
      id: 'lot-gulkhan-pit',
      mineId: 'mine-islam-duki',
      mineName: 'Islam Coal Mine',
      boughtFrom: 'Gul Khan Deep Shaft',
      supplier: 'Gul Khan Deep Shaft',
      billedWeight: 35.0,
      receivedWeight: 34.6,
      tonnage: 35.0,
      purchaseRate: 21000,
      loadingCost: 4500,
      freightCost: 14000,
      totalValue: 753500,
      landedRate: 21528.57,
      date: dayAgo(16),
      createdAt: timestampAgo(16),
      updatedAt: timestampAgo(16),
    },
    {
      id: 'lot-islam-shaft3',
      mineId: 'mine-islam-duki',
      mineName: 'Islam Coal Mine',
      boughtFrom: 'Sardar Incline #3',
      supplier: 'Sardar Incline #3',
      billedWeight: 45.0,
      receivedWeight: 45.0,
      tonnage: 45.0,
      purchaseRate: 20500,
      loadingCost: 6000,
      freightCost: 16500,
      totalValue: 945000,
      landedRate: 21000,
      date: dayAgo(10),
      createdAt: timestampAgo(10),
      updatedAt: timestampAgo(10),
    },
    {
      id: 'lot-islam-reserve',
      mineId: 'mine-islam-duki',
      mineName: 'Islam Coal Mine',
      boughtFrom: 'Yard Stockpile A',
      supplier: 'Yard Stockpile A',
      billedWeight: 55.0,
      receivedWeight: 54.8,
      tonnage: 55.0,
      purchaseRate: 21500,
      loadingCost: 7000,
      freightCost: 20000,
      totalValue: 1209500,
      landedRate: 21990.91,
      date: dayAgo(3),
      createdAt: timestampAgo(3),
      updatedAt: timestampAgo(3),
    },

    // Chamalang Lots
    {
      id: 'lot-chamalang-cs2',
      mineId: 'mine-chamalang',
      mineName: 'Chamalang Coal Field',
      boughtFrom: 'Central Shaft 2',
      supplier: 'Central Shaft 2',
      billedWeight: 50.0,
      receivedWeight: 50.0,
      tonnage: 50.0,
      purchaseRate: 23500,
      loadingCost: 6000,
      freightCost: 18000,
      totalValue: 1199000,
      landedRate: 23980,
      date: dayAgo(18),
      createdAt: timestampAgo(18),
      updatedAt: timestampAgo(18),
    },
    {
      id: 'lot-chamalang-north',
      mineId: 'mine-chamalang',
      mineName: 'Chamalang Coal Field',
      boughtFrom: 'North Ridge Pit',
      supplier: 'North Ridge Pit',
      billedWeight: 38.0,
      receivedWeight: 37.5,
      tonnage: 38.0,
      purchaseRate: 24000,
      loadingCost: 5000,
      freightCost: 15500,
      totalValue: 932500,
      landedRate: 24539.47,
      date: dayAgo(12),
      createdAt: timestampAgo(12),
      updatedAt: timestampAgo(12),
    },
    {
      id: 'lot-chamalang-washed',
      mineId: 'mine-chamalang',
      mineName: 'Chamalang Coal Field',
      boughtFrom: 'High-GCV Washed Seam',
      supplier: 'High-GCV Washed Seam',
      billedWeight: 30.0,
      receivedWeight: 30.0,
      tonnage: 30.0,
      purchaseRate: 25000,
      loadingCost: 4000,
      freightCost: 13500,
      totalValue: 767500,
      landedRate: 25583.33,
      date: dayAgo(5),
      createdAt: timestampAgo(5),
      updatedAt: timestampAgo(5),
    },

    // Sorange Lots
    {
      id: 'lot-sorange-depot1',
      mineId: 'mine-sorange-degari',
      mineName: 'Sorange Degari Colliery',
      boughtFrom: 'Main Degari Siding',
      supplier: 'Main Degari Siding',
      billedWeight: 42.0,
      receivedWeight: 42.0,
      tonnage: 42.0,
      purchaseRate: 25000,
      loadingCost: 5500,
      freightCost: 16800,
      totalValue: 1072300,
      landedRate: 25530.95,
      date: dayAgo(15),
      createdAt: timestampAgo(15),
      updatedAt: timestampAgo(15),
    },
    {
      id: 'lot-sorange-lump',
      mineId: 'mine-sorange-degari',
      mineName: 'Sorange Degari Colliery',
      boughtFrom: 'Selected Lumps Incline 1',
      supplier: 'Selected Lumps Incline 1',
      billedWeight: 32.0,
      receivedWeight: 31.8,
      tonnage: 32.0,
      purchaseRate: 25800,
      loadingCost: 4500,
      freightCost: 14000,
      totalValue: 844100,
      landedRate: 26378.13,
      date: dayAgo(7),
      createdAt: timestampAgo(7),
      updatedAt: timestampAgo(7),
    },

    // Mach Lots
    {
      id: 'lot-mach-steamer',
      mineId: 'mine-mach-bolan',
      mineName: 'Mach Bolan Mines',
      boughtFrom: 'Bolan Railway Siding',
      supplier: 'Bolan Railway Siding',
      billedWeight: 36.0,
      receivedWeight: 36.0,
      tonnage: 36.0,
      purchaseRate: 20500,
      loadingCost: 4500,
      freightCost: 14500,
      totalValue: 757000,
      landedRate: 21027.78,
      date: dayAgo(14),
      createdAt: timestampAgo(14),
      updatedAt: timestampAgo(14),
    },
    {
      id: 'lot-mach-bulk',
      mineId: 'mine-mach-bolan',
      mineName: 'Mach Bolan Mines',
      boughtFrom: 'Lower Tunnel Pit',
      supplier: 'Lower Tunnel Pit',
      billedWeight: 48.0,
      receivedWeight: 47.4,
      tonnage: 48.0,
      purchaseRate: 21000,
      loadingCost: 6000,
      freightCost: 18500,
      totalValue: 1032500,
      landedRate: 21510.42,
      date: dayAgo(4),
      createdAt: timestampAgo(4),
      updatedAt: timestampAgo(4),
    },

    // Makerwal Lots
    {
      id: 'lot-makerwal-lump',
      mineId: 'mine-makerwal',
      mineName: 'Makerwal Collieries',
      boughtFrom: 'Salt Range Outcrop 5',
      supplier: 'Salt Range Outcrop 5',
      billedWeight: 32.0,
      receivedWeight: 32.0,
      tonnage: 32.0,
      purchaseRate: 22500,
      loadingCost: 4000,
      freightCost: 11000,
      totalValue: 735000,
      landedRate: 22968.75,
      date: dayAgo(13),
      createdAt: timestampAgo(13),
      updatedAt: timestampAgo(13),
    },
    {
      id: 'lot-makerwal-fines',
      mineId: 'mine-makerwal',
      mineName: 'Makerwal Collieries',
      boughtFrom: 'Tunnel Seam B',
      supplier: 'Tunnel Seam B',
      billedWeight: 40.0,
      receivedWeight: 39.5,
      tonnage: 40.0,
      purchaseRate: 21800,
      loadingCost: 5000,
      freightCost: 12500,
      totalValue: 889500,
      landedRate: 22237.5,
      date: dayAgo(8),
      createdAt: timestampAgo(8),
      updatedAt: timestampAgo(8),
    },
    {
      id: 'lot-makerwal-fresh',
      mineId: 'mine-makerwal',
      mineName: 'Makerwal Collieries',
      boughtFrom: 'Central Depot Stock',
      supplier: 'Central Depot Stock',
      billedWeight: 60.0,
      receivedWeight: 60.0,
      tonnage: 60.0,
      purchaseRate: 22200,
      loadingCost: 7500,
      freightCost: 17000,
      totalValue: 1356500,
      landedRate: 22608.33,
      date: dayAgo(1),
      createdAt: timestampAgo(1),
      updatedAt: timestampAgo(1),
    },
  ];

  for (const lot of lots) {
    await saveLot(lot);
  }

  // -------------------------------------------------------------
  // 4. Parties / Cement Factories (6 commercial clients)
  // -------------------------------------------------------------
  const parties: Party[] = [
    {
      id: 'party-maple-leaf',
      name: 'Maple Leaf Cement Factory',
      contactPerson: 'Tariq Mehmood (GM Procurement)',
      phone: '0300-8451122',
      address: 'Iskanderabad, Distt Mianwali, Punjab',
      createdAt: timestampAgo(60),
      updatedAt: timestampAgo(60),
    },
    {
      id: 'party-bestway',
      name: 'Bestway Cement Plant',
      contactPerson: 'Farooq Ahmed (Logistics Manager)',
      phone: '0321-5544332',
      address: 'Chakwal Plant, Kallar Kahar Interchange, M-2',
      createdAt: timestampAgo(55),
      updatedAt: timestampAgo(55),
    },
    {
      id: 'party-lucky',
      name: 'Lucky Cement Limited',
      contactPerson: 'Aslam Khan Niazi (Raw Materials)',
      phone: '0333-9988776',
      address: 'Pezu Plant, Main Indus Highway, Lakki Marwat',
      createdAt: timestampAgo(50),
      updatedAt: timestampAgo(50),
    },
    {
      id: 'party-fauji',
      name: 'Fauji Cement Company Ltd',
      contactPerson: 'Maj (R) Khalid (Fuels Head)',
      phone: '0345-5123987',
      address: 'Near Brahma Interchange, Fateh Jang, Rawalpindi',
      createdAt: timestampAgo(45),
      updatedAt: timestampAgo(45),
    },
    {
      id: 'party-dgkhan',
      name: 'DG Khan Cement Company',
      contactPerson: 'Malik Shahzad (Purchase Dept)',
      phone: '0301-7788990',
      address: 'Khairpur Plant, Chakwal / DG Khan Works',
      createdAt: timestampAgo(40),
      updatedAt: timestampAgo(40),
    },
    {
      id: 'party-pioneer',
      name: 'Pioneer Cement Limited',
      contactPerson: 'Engr. Bilal Hassan (Quality Assurance)',
      phone: '0312-4455667',
      address: 'Chenki, Tehsil Noorpur Thal, Khushab',
      createdAt: timestampAgo(35),
      updatedAt: timestampAgo(35),
    },
  ];

  for (const p of parties) {
    await saveParty(p);
  }

  // -------------------------------------------------------------
  // 5. Purchase Orders
  // -------------------------------------------------------------
  const pos: PurchaseOrder[] = [
    {
      id: 'po-maple-01',
      partyId: 'party-maple-leaf',
      poNumber: 'MLC-2026-88',
      targetGcv: 4500,
      baseRate: 34000,
      commissionPerTon: 200,
      totalTons: 500,
      isActive: true,
      notes: 'Quarterly supply contract - Grade A Steaming Coal',
      createdAt: timestampAgo(30),
      updatedAt: timestampAgo(30),
    },
    {
      id: 'po-bestway-01',
      partyId: 'party-bestway',
      poNumber: 'BWC-OCT-409',
      targetGcv: 5500,
      baseRate: 36000,
      commissionPerTon: 250,
      totalTons: 400,
      isActive: true,
      notes: 'High-caloric supply for Kiln Line 2',
      createdAt: timestampAgo(25),
      updatedAt: timestampAgo(25),
    },
    {
      id: 'po-lucky-01',
      partyId: 'party-lucky',
      poNumber: 'LCL-PZ-991',
      targetGcv: 5800,
      baseRate: 38000,
      commissionPerTon: 300,
      totalTons: 800,
      isActive: true,
      notes: 'Long-term agreement with caloric bonus clauses',
      createdAt: timestampAgo(28),
      updatedAt: timestampAgo(28),
    },
    {
      id: 'po-fauji-01',
      partyId: 'party-fauji',
      poNumber: 'FCCL-FJ-221',
      targetGcv: 4800,
      baseRate: 35000,
      commissionPerTon: 200,
      totalTons: 350,
      isActive: true,
      notes: 'Moisture tolerance standard 6-8%',
      createdAt: timestampAgo(20),
      updatedAt: timestampAgo(20),
    },
    {
      id: 'po-dgkhan-01',
      partyId: 'party-dgkhan',
      poNumber: 'DGK-KP-705',
      targetGcv: 4400,
      baseRate: 33500,
      commissionPerTon: 150,
      totalTons: 600,
      isActive: true,
      notes: 'Formula 18/5 sales tax & advance income tax applicable',
      createdAt: timestampAgo(22),
      updatedAt: timestampAgo(22),
    },
  ];

  for (const po of pos) {
    await savePurchaseOrder(po);
  }

  // -------------------------------------------------------------
  // 6. Linked Dispatches (12 dispatches, including benchmarks from real slips)
  // -------------------------------------------------------------
  const dispatches: Dispatch[] = [
    // 1. Maple Leaf - LES-9944 linked to lot-hamza-pit
    {
      id: 'disp-maple-9944',
      partyId: 'party-maple-leaf',
      poId: 'po-maple-01',
      date: dayAgo(18),
      truckNumber: 'LES-9944',
      factoryName: 'Maple Leaf Cement Factory',
      targetGcv: 4500,
      baseRate: 34000,
      commissionPerTon: 200,
      labActualGcv: 4500,
      labReceivedWeight: 40.0,
      labSulphur: 0.95,
      labAsh: 8.5,
      coalInputs: [
        {
          id: 'ci-maple-1',
          lotId: 'lot-hamza-pit',
          mineId: 'mine-islam-duki',
          sourceName: 'Islam Coal Mine - Hamza Pit Incline',
          weight: 40.0,
          purchaseRate: 20500,
        },
      ],
      overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
      taxMethod: 'manual',
      manualTax: 0,
      status: 'settled',
      createdAt: timestampAgo(18),
      updatedAt: timestampAgo(18),
    },

    // 2. Maple Leaf - FSD-8821 linked to lot-gulkhan-pit
    {
      id: 'disp-maple-8821',
      partyId: 'party-maple-leaf',
      poId: 'po-maple-01',
      date: dayAgo(14),
      truckNumber: 'FSD-8821',
      factoryName: 'Maple Leaf Cement Factory',
      targetGcv: 4500,
      baseRate: 34000,
      commissionPerTon: 200,
      labActualGcv: 4420,
      labReceivedWeight: 34.6,
      labSulphur: 1.1,
      labAsh: 9.2,
      coalInputs: [
        {
          id: 'ci-maple-2',
          lotId: 'lot-gulkhan-pit',
          mineId: 'mine-islam-duki',
          sourceName: 'Islam Coal Mine - Gul Khan Deep Shaft',
          weight: 34.6,
          purchaseRate: 21777.46,
        },
      ],
      overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
      taxMethod: 'manual',
      manualTax: 0,
      status: 'settled',
      createdAt: timestampAgo(14),
      updatedAt: timestampAgo(14),
    },

    // 3. Bestway - TKX-3312 linked to lot-chamalang-cs2
    {
      id: 'disp-bestway-3312',
      partyId: 'party-bestway',
      poId: 'po-bestway-01',
      date: dayAgo(15),
      truckNumber: 'TKX-3312',
      factoryName: 'Bestway Cement Plant',
      targetGcv: 5500,
      baseRate: 36000,
      commissionPerTon: 250,
      labActualGcv: 5620,
      labReceivedWeight: 50.0,
      labSulphur: 0.85,
      manualPremium: 500,
      coalInputs: [
        {
          id: 'ci-bestway-1',
          lotId: 'lot-chamalang-cs2',
          mineId: 'mine-chamalang',
          sourceName: 'Chamalang Coal Field - Central Shaft 2',
          weight: 50.0,
          purchaseRate: 23980,
        },
      ],
      overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
      taxMethod: 'manual',
      manualTax: 1200,
      status: 'settled',
      createdAt: timestampAgo(15),
      updatedAt: timestampAgo(15),
    },

    // 4. Lucky Cement - PMA-1290 linked to lot-chamalang-north (SLIP-003 Caloric Bonus benchmark)
    {
      id: 'disp-lucky-1290',
      partyId: 'party-lucky',
      poId: 'po-lucky-01',
      date: dayAgo(11),
      truckNumber: 'PMA-1290',
      factoryName: 'Lucky Cement Limited',
      targetGcv: 5800,
      baseRate: 36000,
      labActualGcv: 6150,
      labReceivedWeight: 31.2,
      labSulphur: 0.8,
      manualDeduction: 0,
      manualPremium: 1200,
      manualTax: 1000,
      coalInputs: [
        {
          id: 'ci-lucky-1',
          lotId: 'lot-chamalang-north',
          mineId: 'mine-chamalang',
          sourceName: 'Chamalang Coal Field - North Ridge Pit',
          weight: 31.2,
          purchaseRate: 24866.67,
        },
      ],
      overheads: { freight: 45000, loading: 3000, crush: 0, royalty: 0, other: 0 },
      taxMethod: 'manual',
      status: 'settled',
      createdAt: timestampAgo(11),
      updatedAt: timestampAgo(11),
    },

    // 5. Lucky Cement - LHR-7761 linked to lot-sorange-depot1 (Formula 18/5 Tax benchmark)
    {
      id: 'disp-lucky-7761',
      partyId: 'party-lucky',
      poId: 'po-lucky-01',
      date: dayAgo(9),
      truckNumber: 'LHR-7761',
      factoryName: 'Lucky Cement Limited',
      targetGcv: 5800,
      baseRate: 38000,
      commissionPerTon: 200,
      labActualGcv: 5800,
      labReceivedWeight: 29.4,
      labSulphur: 0.9,
      manualDeduction: 500,
      taxMethod: 'formula_18_5',
      taxSalesPercent: 18,
      taxIncomePercent: 5,
      coalInputs: [
        {
          id: 'ci-lucky-2',
          lotId: 'lot-sorange-depot1',
          mineId: 'mine-sorange-degari',
          sourceName: 'Sorange Degari Colliery - Main Degari Siding',
          weight: 29.4,
          purchaseRate: 25530.95,
        },
      ],
      overheads: { freight: 40000, loading: 3000, crush: 0, royalty: 0, other: 0 },
      status: 'settled',
      createdAt: timestampAgo(9),
      updatedAt: timestampAgo(9),
    },

    // 6. Fauji Cement - KHI-4402 linked to lot-mach-steamer
    {
      id: 'disp-fauji-4402',
      partyId: 'party-fauji',
      poId: 'po-fauji-01',
      date: dayAgo(12),
      truckNumber: 'KHI-4402',
      factoryName: 'Fauji Cement Company Ltd',
      targetGcv: 4800,
      baseRate: 35000,
      commissionPerTon: 200,
      labActualGcv: 4810,
      labReceivedWeight: 36.0,
      labSulphur: 1.25,
      coalInputs: [
        {
          id: 'ci-fauji-1',
          lotId: 'lot-mach-steamer',
          mineId: 'mine-mach-bolan',
          sourceName: 'Mach Bolan Mines - Bolan Railway Siding',
          weight: 36.0,
          purchaseRate: 21027.78,
        },
      ],
      overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
      taxMethod: 'manual',
      manualTax: 0,
      status: 'settled',
      createdAt: timestampAgo(12),
      updatedAt: timestampAgo(12),
    },

    // 7. DG Khan - RWP-5519 linked to lot-makerwal-lump
    {
      id: 'disp-dgkhan-5519',
      partyId: 'party-dgkhan',
      poId: 'po-dgkhan-01',
      date: dayAgo(10),
      truckNumber: 'RWP-5519',
      factoryName: 'DG Khan Cement Company',
      targetGcv: 4400,
      baseRate: 33500,
      commissionPerTon: 150,
      labActualGcv: 4400,
      labReceivedWeight: 32.0,
      labSulphur: 1.05,
      coalInputs: [
        {
          id: 'ci-dgkhan-1',
          lotId: 'lot-makerwal-lump',
          mineId: 'mine-makerwal',
          sourceName: 'Makerwal Collieries - Salt Range Outcrop 5',
          weight: 32.0,
          purchaseRate: 22968.75,
        },
      ],
      overheads: { loading: 0, freight: 0, crush: 0, royalty: 0, other: 0 },
      taxMethod: 'manual',
      manualTax: 500,
      status: 'settled',
      createdAt: timestampAgo(10),
      updatedAt: timestampAgo(10),
    },

    // 8. Maple Leaf - BWP-3104 Blended Recipe (15T Islam Shaft3 + 15T Chamalang Washed)
    {
      id: 'disp-blend-3104',
      partyId: 'party-maple-leaf',
      poId: 'po-maple-01',
      date: dayAgo(7),
      truckNumber: 'BWP-3104',
      factoryName: 'Maple Leaf Cement Factory',
      targetGcv: 4800,
      baseRate: 35000,
      labActualGcv: 4850,
      labReceivedWeight: 30.0,
      labSulphur: 1.0,
      coalInputs: [
        {
          id: 'ci-blend-1',
          lotId: 'lot-islam-shaft3',
          mineId: 'mine-islam-duki',
          sourceName: 'Islam Coal Mine - Sardar Incline #3',
          weight: 15.0,
          purchaseRate: 21000,
        },
        {
          id: 'ci-blend-2',
          lotId: 'lot-chamalang-washed',
          mineId: 'mine-chamalang',
          sourceName: 'Chamalang Coal Field - High-GCV Washed Seam',
          weight: 15.0,
          purchaseRate: 25583.33,
        },
      ],
      overheads: { freight: 42000, loading: 3000, crush: 2500, royalty: 0, other: 0 },
      taxMethod: 'manual',
      manualTax: 0,
      status: 'settled',
      createdAt: timestampAgo(7),
      updatedAt: timestampAgo(7),
    },

    // 9. Bestway - MN-9011 (Pro-Rata GCV Penalty benchmark: 6000 target, 5600 actual)
    {
      id: 'disp-prorata-9011',
      partyId: 'party-bestway',
      poId: 'po-bestway-01',
      date: dayAgo(6),
      truckNumber: 'MN-9011',
      factoryName: 'Bestway Cement Plant',
      targetGcv: 6000,
      baseRate: 42000,
      labActualGcv: 5600,
      labReceivedWeight: 26.85,
      labSulphur: 0.9,
      manualDeduction: 1400,
      manualTax: 1500,
      gcvAdjustment: 'prorata',
      gcvAdjustmentRounding: 'rupee',
      coalInputs: [
        {
          id: 'ci-prorata-1',
          lotId: 'lot-sorange-lump',
          mineId: 'mine-sorange-degari',
          sourceName: 'Sorange Degari Colliery - Selected Lumps Incline 1',
          weight: 27.0,
          purchaseRate: 26544.03,
        },
      ],
      overheads: { freight: 35000, loading: 2500, crush: 0, royalty: 0, other: 0 },
      taxMethod: 'manual',
      status: 'settled',
      createdAt: timestampAgo(6),
      updatedAt: timestampAgo(6),
    },

    // 10. Pioneer Cement - TLD-4491 Transit shortage voucher benchmark
    {
      id: 'disp-pioneer-4491',
      partyId: 'party-pioneer',
      date: dayAgo(4),
      truckNumber: 'TLD-4491',
      factoryName: 'Pioneer Cement Limited',
      targetGcv: 4500,
      baseRate: 35000,
      labActualGcv: 4500,
      labReceivedWeight: 28.5,
      labSulphur: 1.15,
      coalInputs: [
        {
          id: 'ci-pioneer-1',
          lotId: 'lot-makerwal-fines',
          mineId: 'mine-makerwal',
          sourceName: 'Makerwal Collieries - Tunnel Seam B',
          weight: 30.0,
          purchaseRate: 22518.99,
        },
      ],
      overheads: { freight: 45000, loading: 3000, crush: 0, royalty: 0, other: 0 },
      taxMethod: 'manual',
      status: 'settled',
      createdAt: timestampAgo(4),
      updatedAt: timestampAgo(4),
    },

    // 11. DG Khan - KPK-8810 Formula 18/5 with high moisture benchmark
    {
      id: 'disp-dgkhan-8810',
      partyId: 'party-dgkhan',
      poId: 'po-dgkhan-01',
      date: dayAgo(2),
      truckNumber: 'KPK-8810',
      factoryName: 'DG Khan Cement Company',
      targetGcv: 4400,
      baseRate: 39000,
      commissionPerTon: 150,
      labActualGcv: 4400,
      labReceivedWeight: 27.5,
      labSulphur: 1.2,
      labMoisture: 9.5,
      manualDeduction: 800,
      taxMethod: 'formula_18_5',
      taxSalesPercent: 18,
      taxIncomePercent: 5,
      coalInputs: [
        {
          id: 'ci-dgkhan-2',
          lotId: 'lot-mach-bulk',
          mineId: 'mine-mach-bolan',
          sourceName: 'Mach Bolan Mines - Lower Tunnel Pit',
          weight: 28.0,
          purchaseRate: 21782.70,
        },
      ],
      overheads: { freight: 38000, loading: 2800, crush: 0, royalty: 0, other: 0 },
      status: 'settled',
      createdAt: timestampAgo(2),
      updatedAt: timestampAgo(2),
    },

    // 12. Fauji Cement - GLT-2200 In-Transit Dispatch (Awaiting lab results)
    {
      id: 'disp-fauji-2200',
      partyId: 'party-fauji',
      poId: 'po-fauji-01',
      date: dayAgo(0),
      truckNumber: 'GLT-2200',
      factoryName: 'Fauji Cement Company Ltd',
      targetGcv: 4800,
      baseRate: 37000,
      commissionPerTon: 200,
      labActualGcv: 0,
      labReceivedWeight: 0,
      labSulphur: 0,
      coalInputs: [
        {
          id: 'ci-fauji-2',
          lotId: 'lot-islam-reserve',
          mineId: 'mine-islam-duki',
          sourceName: 'Islam Coal Mine - Yard Stockpile A',
          weight: 28.0,
          purchaseRate: 22071.17,
        },
      ],
      overheads: { freight: 40000, loading: 3000, crush: 0, royalty: 0, other: 0 },
      taxMethod: 'manual',
      status: 'pending',
      createdAt: timestampAgo(0),
      updatedAt: timestampAgo(0),
    },
  ];

  for (const d of dispatches) {
    await saveDispatch(d);
  }

  // -------------------------------------------------------------
  // 7. Payments History (12 payments across parties)
  // -------------------------------------------------------------
  const payments: Payment[] = [
    // Maple Leaf Payments
    {
      id: 'pay-maple-01',
      partyId: 'party-maple-leaf',
      amount: 600000,
      date: dayAgo(17),
      type: 'received',
      mode: 'bank',
      referenceNote: 'HBL IBFT Ref: 20261017-9812 - Advance against PO-88',
      createdAt: timestampAgo(17),
      updatedAt: timestampAgo(17),
    },
    {
      id: 'pay-maple-02',
      partyId: 'party-maple-leaf',
      amount: 550000,
      date: dayAgo(11),
      type: 'received',
      mode: 'cheque',
      referenceNote: 'MCB Clearing Cheque #0049281 - On-account settlement',
      createdAt: timestampAgo(11),
      updatedAt: timestampAgo(11),
    },
    {
      id: 'pay-maple-03',
      partyId: 'party-maple-leaf',
      amount: 450000,
      date: dayAgo(3),
      type: 'received',
      mode: 'online',
      referenceNote: 'Raast Fast Transfer: ML-CW-991',
      createdAt: timestampAgo(3),
      updatedAt: timestampAgo(3),
    },

    // Bestway Payments
    {
      id: 'pay-bestway-01',
      partyId: 'party-bestway',
      amount: 1000000,
      date: dayAgo(14),
      type: 'received',
      mode: 'bank',
      referenceNote: 'UBL Commercial Transfer: BWC-ADV-409',
      createdAt: timestampAgo(14),
      updatedAt: timestampAgo(14),
    },
    {
      id: 'pay-bestway-02',
      partyId: 'party-bestway',
      amount: 500000,
      date: dayAgo(5),
      type: 'received',
      mode: 'bank',
      referenceNote: 'UBL Commercial Transfer: TKX-3312 settlement',
      createdAt: timestampAgo(5),
      updatedAt: timestampAgo(5),
    },

    // Lucky Cement Payments
    {
      id: 'pay-lucky-01',
      partyId: 'party-lucky',
      amount: 1100000,
      date: dayAgo(10),
      type: 'received',
      mode: 'bank',
      referenceNote: 'Allied Bank RTGS: LCL-PZ-VOUCHER-788',
      createdAt: timestampAgo(10),
      updatedAt: timestampAgo(10),
    },
    {
      id: 'pay-lucky-02',
      partyId: 'party-lucky',
      amount: 900000,
      date: dayAgo(4),
      type: 'received',
      mode: 'online',
      referenceNote: 'Bank Alfalah Corporate Transfer: LHR-7761 delivery',
      createdAt: timestampAgo(4),
      updatedAt: timestampAgo(4),
    },

    // Fauji Cement Payments
    {
      id: 'pay-fauji-01',
      partyId: 'party-fauji',
      amount: 750000,
      date: dayAgo(11),
      type: 'received',
      mode: 'bank',
      referenceNote: 'Askari Bank Voucher: FCCL-ADV-221',
      createdAt: timestampAgo(11),
      updatedAt: timestampAgo(11),
    },
    {
      id: 'pay-fauji-02',
      partyId: 'party-fauji',
      amount: 400000,
      date: dayAgo(2),
      type: 'received',
      mode: 'online',
      referenceNote: 'Askari Corporate Portal: KHI-4402 balance',
      createdAt: timestampAgo(2),
      updatedAt: timestampAgo(2),
    },

    // DG Khan Payments
    {
      id: 'pay-dgkhan-01',
      partyId: 'party-dgkhan',
      amount: 800000,
      date: dayAgo(8),
      type: 'received',
      mode: 'bank',
      referenceNote: 'Bank of Punjab RTGS: DGK-KP-ADVANCE',
      createdAt: timestampAgo(8),
      updatedAt: timestampAgo(8),
    },
    {
      id: 'pay-dgkhan-02',
      partyId: 'party-dgkhan',
      amount: 300000,
      date: dayAgo(1),
      type: 'received',
      mode: 'cash',
      referenceNote: 'Cash Receipt Voucher #1049 - Received at site office',
      createdAt: timestampAgo(1),
      updatedAt: timestampAgo(1),
    },

    // Pioneer Cement Payment
    {
      id: 'pay-pioneer-01',
      partyId: 'party-pioneer',
      amount: 700000,
      date: dayAgo(2),
      type: 'received',
      mode: 'bank',
      referenceNote: 'Meezan Bank IBFT: TLD-4491 delivery payment',
      createdAt: timestampAgo(2),
      updatedAt: timestampAgo(2),
    },
  ];

  for (const pay of payments) {
    await savePayment(pay);
  }

  // -------------------------------------------------------------
  // 8. General Operating Expenses (13 warehouse & business overheads)
  // -------------------------------------------------------------
  const expenses: GeneralExpense[] = [
    {
      id: 'exp-rent-quetta',
      date: dayAgo(28),
      category: 'warehouse_rent',
      amount: 65000,
      description: 'Monthly Yard Rent - Western Bypass Depot Quetta',
      vendor: 'Haji Noor Muhammad (Landlord)',
      paymentMode: 'bank',
      notes: 'Advance rent paid via Meezan Bank Cheque #88392',
      createdAt: timestampAgo(28),
      updatedAt: timestampAgo(28),
    },
    {
      id: 'exp-rent-mianwali',
      date: dayAgo(25),
      category: 'warehouse_rent',
      amount: 45000,
      description: 'Stockyard Plot Rent - Mianwali Bypass',
      vendor: 'Malik Tariq Awan',
      paymentMode: 'online',
      notes: 'Plot lease installment for October',
      createdAt: timestampAgo(25),
      updatedAt: timestampAgo(25),
    },
    {
      id: 'exp-labour-quetta-01',
      date: dayAgo(21),
      category: 'warehouse_labour',
      amount: 28000,
      description: 'Manual Stacking & Segregation Wages (40 tons)',
      vendor: 'Jamal Khan (Labour Jamadar)',
      paymentMode: 'cash',
      notes: 'Weekly wages for 7 Afghan workers',
      createdAt: timestampAgo(21),
      updatedAt: timestampAgo(21),
    },
    {
      id: 'exp-util-lesco',
      date: dayAgo(18),
      category: 'utilities',
      amount: 16500,
      description: 'Depot Three-Phase Electricity Bill',
      vendor: 'QESCO (Quetta Electric)',
      paymentMode: 'online',
      notes: 'Bill Consumer #04-12948-2849',
      createdAt: timestampAgo(18),
      updatedAt: timestampAgo(18),
    },
    {
      id: 'exp-equip-scale',
      date: dayAgo(15),
      category: 'equipment',
      amount: 35000,
      description: '60-Ton Electronic Weighbridge Annual Calibration',
      vendor: 'Precision Scale Systems Lahore',
      paymentMode: 'bank',
      notes: 'Stamped by Weights & Measures Inspector',
      createdAt: timestampAgo(15),
      updatedAt: timestampAgo(15),
    },
    {
      id: 'exp-labour-mianwali-01',
      date: dayAgo(12),
      category: 'warehouse_labour',
      amount: 22000,
      description: 'Yard Labour for Coal Screening & Bagging',
      vendor: 'Sher Ali Jamadar',
      paymentMode: 'cash',
      notes: 'Daily wage handling team',
      createdAt: timestampAgo(12),
      updatedAt: timestampAgo(12),
    },
    {
      id: 'exp-maint-shed',
      date: dayAgo(10),
      category: 'maintenance',
      amount: 18500,
      description: 'Depot Gate & Security Wall Barbed Wire Repair',
      vendor: 'Bolan Hardware & Welding',
      paymentMode: 'cash',
      notes: 'Yard perimeter security reinforcement',
      createdAt: timestampAgo(10),
      updatedAt: timestampAgo(10),
    },
    {
      id: 'exp-office-stationery',
      date: dayAgo(8),
      category: 'office',
      amount: 9200,
      description: 'Dispatch Gate Pass Registers & Weighbridge Slips Print',
      vendor: 'Al-Rehman Printers Quetta',
      paymentMode: 'cash',
      notes: '5 Carbon copy dispatch books printed',
      createdAt: timestampAgo(8),
      updatedAt: timestampAgo(8),
    },
    {
      id: 'exp-util-diesel',
      date: dayAgo(6),
      category: 'utilities',
      amount: 24000,
      description: 'Backup Generator Diesel (80 Liters)',
      vendor: 'Attock Petroleum Bypass Station',
      paymentMode: 'cash',
      notes: 'Night yard lighting during load-shedding',
      createdAt: timestampAgo(6),
      updatedAt: timestampAgo(6),
    },
    {
      id: 'exp-trans-depot',
      date: dayAgo(5),
      category: 'transport',
      amount: 15000,
      description: 'Depot Tractor-Trolley Internal Shifting',
      vendor: 'Raza Khan Transport',
      paymentMode: 'cash',
      notes: 'Shifting 50t reject coal to dumping plot',
      createdAt: timestampAgo(5),
      updatedAt: timestampAgo(5),
    },
    {
      id: 'exp-equip-loader',
      date: dayAgo(3),
      category: 'equipment',
      amount: 42000,
      description: 'Front-End Wheel Loader 8-Hour Rental for Coal Blending',
      vendor: 'Zulfiqar Earthmovers',
      paymentMode: 'cheque',
      notes: 'Blending Duki and Chamalang coal lots',
      createdAt: timestampAgo(3),
      updatedAt: timestampAgo(3),
    },
    {
      id: 'exp-office-staff',
      date: dayAgo(2),
      category: 'office',
      amount: 18000,
      description: 'Monthly Bookkeeping Fee & Staff Tea Pool',
      vendor: 'Kakar & Co. Tax Consultants',
      paymentMode: 'bank',
      notes: 'Monthly ledger reconciliation services',
      createdAt: timestampAgo(2),
      updatedAt: timestampAgo(2),
    },
    {
      id: 'exp-other-tax',
      date: dayAgo(1),
      category: 'other',
      amount: 12500,
      description: 'Municipal Corporation Trade License & Plot Tax',
      vendor: 'Metropolitan Corporation Quetta',
      paymentMode: 'bank',
      notes: 'Challan #MCQ-2026-9912',
      createdAt: timestampAgo(1),
      updatedAt: timestampAgo(1),
    },
  ];

  for (const exp of expenses) {
    await saveGeneralExpense(exp);
  }

  console.log('[DevSeed] Comprehensive test data successfully seeded into IndexedDB!');
  console.log('   - 5 Mines (Islam, Chamalang, Sorange, Mach, Makerwal)');
  console.log('   - 14 Stock Lots with realistic weights, costs & landed rates');
  console.log('   - 6 Commercial Cement Plants (Maple Leaf, Bestway, Lucky, Fauji, DG Khan, Pioneer)');
  console.log('   - 5 Active Purchase Orders');
  console.log('   - 12 Dispatches (with real lab metrics, formula 18/5 tax, blended recipes, in-transit)');
  console.log('   - 12 Bank & Cash Payments');
  console.log('   - 13 General Operating Expenses (Rent, Labour, Utilities, Equipment, Maintenance, Transport)');
  console.log('   - Company Settings profile');

  // Trigger page reload if running in browser window
  if (options.reload !== false && typeof window !== 'undefined' && window.location) {
    window.location.reload();
  }
}

/**
 * Resets the IndexedDB database to empty state.
 */
export async function clearAllData(options: { reload?: boolean } = {}): Promise<void> {
  console.log('[DevSeed] Clearing all IndexedDB tables...');
  await idb.parties.clear();
  await idb.dispatches.clear();
  await idb.payments.clear();
  await idb.expenses.clear();
  await idb.pos.clear();
  await idb.mines.clear();
  await idb.lots.clear();
  console.log('[DevSeed] Database cleared!');
  if (options.reload !== false && typeof window !== 'undefined' && window.location) {
    window.location.reload();
  }
}
