import { describe, expect, it } from 'vitest';
import {
  PULL_TO_SYNC_MAX_DISTANCE,
  PULL_TO_SYNC_THRESHOLD,
  calculatePullToSyncDistance,
  getPullToSyncProgress,
  shouldTriggerPullToSync,
} from '../src/utils/pullToSync';

describe('Issue 71: app-wide pull-to-sync gesture', () => {
  it('ignores upward/invalid travel and applies resisted downward movement', () => {
    expect(calculatePullToSyncDistance(-20)).toBe(0);
    expect(calculatePullToSyncDistance(Number.NaN)).toBe(0);
    expect(calculatePullToSyncDistance(50)).toBeCloseTo(34);
  });

  it('caps the visual pull distance and progress', () => {
    expect(calculatePullToSyncDistance(1000)).toBe(PULL_TO_SYNC_MAX_DISTANCE);
    expect(getPullToSyncProgress(PULL_TO_SYNC_THRESHOLD / 2)).toBe(0.5);
    expect(getPullToSyncProgress(PULL_TO_SYNC_MAX_DISTANCE)).toBe(1);
  });

  it('only triggers after the release threshold is reached', () => {
    expect(shouldTriggerPullToSync(PULL_TO_SYNC_THRESHOLD - 0.01)).toBe(false);
    expect(shouldTriggerPullToSync(PULL_TO_SYNC_THRESHOLD)).toBe(true);
  });
});
