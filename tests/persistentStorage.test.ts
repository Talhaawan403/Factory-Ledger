import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestPersistentStorage } from '../src/lib/dexieDb';

const originalStorageDescriptor = Object.getOwnPropertyDescriptor(navigator, 'storage');

function setStoragePersist(persist: () => Promise<boolean>) {
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { persist },
  });
}

afterEach(() => {
  vi.useRealTimers();
  if (originalStorageDescriptor) {
    Object.defineProperty(navigator, 'storage', originalStorageDescriptor);
  } else {
    Reflect.deleteProperty(navigator, 'storage');
  }
});

describe('persistent storage request', () => {
  it('returns the browser persistence decision when it resolves', async () => {
    setStoragePersist(async () => true);

    await expect(requestPersistentStorage()).resolves.toBe(true);
  });

  it('continues startup when the browser leaves the permission request pending', async () => {
    vi.useFakeTimers();
    setStoragePersist(() => new Promise<boolean>(() => {}));

    const result = requestPersistentStorage();
    await vi.advanceTimersByTimeAsync(3_000);

    await expect(result).resolves.toBe(false);
  });
});
