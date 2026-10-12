export const PULL_TO_SYNC_THRESHOLD = 64;
export const PULL_TO_SYNC_MAX_DISTANCE = 92;
export const PULL_TO_SYNC_HOLD_DISTANCE = 52;

const PULL_RESISTANCE = 0.68;

/**
 * Converts finger travel into a resisted visual offset, matching the elastic
 * feel of a native iOS pull-to-refresh interaction.
 */
export function calculatePullToSyncDistance(deltaY: number): number {
  if (!Number.isFinite(deltaY) || deltaY <= 0) return 0;
  return Math.min(PULL_TO_SYNC_MAX_DISTANCE, deltaY * PULL_RESISTANCE);
}

export function getPullToSyncProgress(distance: number): number {
  if (!Number.isFinite(distance) || distance <= 0) return 0;
  return Math.min(1, distance / PULL_TO_SYNC_THRESHOLD);
}

export function shouldTriggerPullToSync(distance: number): boolean {
  return Number.isFinite(distance) && distance >= PULL_TO_SYNC_THRESHOLD;
}
