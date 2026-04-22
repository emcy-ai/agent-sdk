import type { AppAgentPlatform, KeyValueStore } from './types';

type LocalStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function createBrowserKeyValueStore(
  storage?: LocalStorageLike | null,
): KeyValueStore {
  const resolvedStorage = storage ?? (() => {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null;
    }
  })();

  return {
    getItem(key) {
      return resolvedStorage?.getItem(key) ?? null;
    },
    setItem(key, value) {
      resolvedStorage?.setItem(key, value);
    },
    removeItem(key) {
      resolvedStorage?.removeItem(key);
    },
  };
}

export function createBrowserAppAgentPlatform(
  storage?: LocalStorageLike | null,
): AppAgentPlatform {
  return {
    storage: {
      durable: createBrowserKeyValueStore(storage),
    },
  };
}

export function createMemoryKeyValueStore(
  seed: Record<string, string> = {},
): KeyValueStore {
  const map = new Map(Object.entries(seed));

  return {
    getItem(key) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key, value) {
      map.set(key, value);
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

export async function resolveStoreValue<T>(
  value: Promise<T> | T,
): Promise<T> {
  return await Promise.resolve(value);
}
