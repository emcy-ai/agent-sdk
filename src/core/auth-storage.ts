import type { EmcyAgentConfig, EmcyStorageLike } from './types';

export type PersistedStateStorage = EmcyStorageLike & Pick<Storage, 'key' | 'length'>;

const LEGACY_OAUTH_TOKEN_STORAGE_PREFIX = 'emcy_oauth_';
const REGISTRATION_STORAGE_PREFIX = 'emcy_oauth_registration_';
const SCOPED_OAUTH_TOKEN_STORAGE_PREFIX = 'emcy_oauth_session_';
const OAUTH_CALLBACK_STORAGE_PREFIX = 'emcy-oauth-callback:';

export interface ClearPersistedMcpAuthStateOptions {
  /** Session scope to clear. Ignored when `clearAll` is true. */
  authSessionKey?: string | null;
  /** Clear all persisted MCP auth state, regardless of scope. */
  clearAll?: boolean;
  /** Test hook for injecting a storage implementation. */
  storage?: PersistedStateStorage | null;
}

function hashAuthSessionKey(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

export function normalizeAuthSessionKey(value?: string | null): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

export function resolveExplicitAuthSessionKey(
  config: Pick<EmcyAgentConfig, 'authSessionKey'>,
): string | null {
  return normalizeAuthSessionKey(config.authSessionKey);
}

export function buildScopedOAuthTokenStoragePrefix(authSessionKey?: string | null): string {
  const normalizedSessionKey = normalizeAuthSessionKey(authSessionKey);
  if (!normalizedSessionKey) {
    return LEGACY_OAUTH_TOKEN_STORAGE_PREFIX;
  }

  return `${SCOPED_OAUTH_TOKEN_STORAGE_PREFIX}${hashAuthSessionKey(normalizedSessionKey)}_`;
}

export function buildScopedOAuthTokenStorageKey(
  cacheKey: string,
  authSessionKey?: string | null,
): string {
  return `${buildScopedOAuthTokenStoragePrefix(authSessionKey)}${cacheKey}`;
}

function getStorage(storage?: PersistedStateStorage | null): PersistedStateStorage | null {
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

  const scopedPrefix = buildScopedOAuthTokenStoragePrefix(
    options.authSessionKey,
  );
  const tokenPrefixes = options.clearAll
    ? [LEGACY_OAUTH_TOKEN_STORAGE_PREFIX, SCOPED_OAUTH_TOKEN_STORAGE_PREFIX]
    : [scopedPrefix];

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

      if (key.startsWith(REGISTRATION_STORAGE_PREFIX)) {
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

export function clearPersistedMcpAuth(): void {
  clearPersistedMcpAuthState({ clearAll: true });
}
