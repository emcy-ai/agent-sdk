import type { EmcyAgentConfig } from './types';

type StorageLike = Pick<Storage, 'key' | 'length' | 'removeItem'>;

const OAUTH_TOKEN_STORAGE_PREFIX = 'emcy_oauth_';
const OAUTH_CALLBACK_STORAGE_PREFIX = 'emcy-oauth-callback:';

export interface ClearPersistedMcpAuthStateOptions {
  /** Scope to clear. Ignored when `clearAll` is true. */
  authStorageScope?: string | null;
  /** Clear all persisted MCP auth state, regardless of scope. */
  clearAll?: boolean;
  /** Test hook for injecting a storage implementation. */
  storage?: StorageLike | null;
}

function hashStorageScope(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

export function normalizeAuthStorageScope(value?: string | null): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

export function resolveAuthStorageScope(
  config: Pick<EmcyAgentConfig, 'authStorageScope' | 'embeddedAuth' | 'externalUserId'>,
): string | null {
  return (
    normalizeAuthStorageScope(config.authStorageScope)
    ?? normalizeAuthStorageScope(config.embeddedAuth?.hostIdentity?.subject)
    ?? normalizeAuthStorageScope(config.embeddedAuth?.hostIdentity?.email)
    ?? normalizeAuthStorageScope(config.externalUserId)
  );
}

export function buildScopedOAuthTokenStoragePrefix(authStorageScope?: string | null): string {
  const normalizedScope = normalizeAuthStorageScope(authStorageScope);
  if (!normalizedScope) {
    return OAUTH_TOKEN_STORAGE_PREFIX;
  }

  return `${OAUTH_TOKEN_STORAGE_PREFIX}${hashStorageScope(normalizedScope)}_`;
}

export function buildScopedOAuthTokenStorageKey(
  cacheKey: string,
  authStorageScope?: string | null,
): string {
  return `${buildScopedOAuthTokenStoragePrefix(authStorageScope)}${cacheKey}`;
}

function getStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage) {
    return storage;
  }

  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function clearPersistedMcpAuthState(
  options: ClearPersistedMcpAuthStateOptions = {},
): void {
  const storage = getStorage(options.storage);
  if (!storage) {
    return;
  }

  const tokenPrefixes = options.clearAll
    ? [OAUTH_TOKEN_STORAGE_PREFIX]
    : [buildScopedOAuthTokenStoragePrefix(options.authStorageScope)];

  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (!key) {
        continue;
      }

      if (key.startsWith(OAUTH_CALLBACK_STORAGE_PREFIX)) {
        storage.removeItem(key);
        continue;
      }

      if (tokenPrefixes.some((prefix) => key.startsWith(prefix))) {
        storage.removeItem(key);
      }
    }
  } catch {
    // Ignore storage failures during logout.
  }
}
