import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearAllData, saveMine, saveLot, getMines, getLots } from '../src/lib/db';
import { exportDatabaseBackupJson } from '../src/utils/exportSharing';

// Mock Capacitor Share & Filesystem so export doesn't fail in headless environment
vi.mock('@capacitor/share', () => ({
  Share: {
    share: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: {
    writeFile: vi.fn().mockResolvedValue({ uri: 'mock://cache/backup.json' }),
  },
  Directory: { Cache: 'CACHE' },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => false,
  },
}));

describe('Data & Backup stats and last backup date tracking', () => {
  beforeEach(async () => {
    localStorage.clear();
    await clearAllData();
  });

  it('correctly tracks mines count and lots count in exportDatabaseBackupJson', async () => {
    // 1. Initial counts are 0
    let mines = await getMines();
    let lots = await getLots();
    expect(mines.length).toBe(0);
    expect(lots.length).toBe(0);

    // 2. Add sample mines
    await saveMine({
      id: 'mine-1',
      name: 'Chamalung Block A',
      ratePerTon: 28000,
      location: 'Duki',
      createdAt: 1,
      updatedAt: 1,
    });
    await saveMine({
      id: 'mine-2',
      name: 'Sharigh Deep Mine',
      ratePerTon: 32000,
      location: 'Sharigh',
      createdAt: 1,
      updatedAt: 1,
    });

    // 3. Add sample stock lot
    await saveLot({
      id: 'lot-1',
      mineId: 'mine-1',
      supplier: 'Chamalung Block A',
      date: '2026-10-10',
      truckNumber: 'TK-999',
      billedWeight: 35.5,
      receivedWeight: 35.0,
      purchaseRate: 28000,
      landedRate: 28171.43,
      loadingCost: 1000,
      freightCost: 5000,
      createdAt: 1,
      updatedAt: 1,
    });

    mines = await getMines();
    lots = await getLots();
    expect(mines.length).toBe(2);
    expect(lots.length).toBe(1);

    // 4. Before export, no last backup date is recorded
    expect(localStorage.getItem('fl_last_backup_date')).toBeNull();

    // 5. Trigger export
    const result = await exportDatabaseBackupJson();
    expect(result.success).toBe(true);
    expect(result.counts.mines).toBe(2);
    expect(result.counts.lots).toBe(1);
    expect(result.exportedAt).toBeTruthy();

    // 6. Verify fl_last_backup_date was stored in localStorage
    const savedDate = localStorage.getItem('fl_last_backup_date');
    expect(savedDate).toBe(result.exportedAt);
    expect(new Date(savedDate!).getTime()).toBeGreaterThan(0);
  });
});
