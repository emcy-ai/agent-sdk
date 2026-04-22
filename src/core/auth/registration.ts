import type {
  EmcyStorageLike,
  McpClientRegistrationPreference,
  McpResolvedClientMode,
  McpServerAuthConfig,
  OAuthDynamicClientRegistrationRequest,
  OAuthDynamicClientRegistrationResponse,
  ResolvedOAuthRegistration,
  StoredOAuthRegistration,
} from '../types';

const REGISTRATION_STORAGE_PREFIX = 'emcy_oauth_registration_';

function getStorage(storage?: EmcyStorageLike | null): EmcyStorageLike | null {
  if (storage) {
    return storage;
  }

  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function encodeCacheKey(raw: string): string {
  return btoa(raw).replace(/[^a-zA-Z0-9]/g, '');
}

export function getPreferredRegistrationPreference(
  authConfig: McpServerAuthConfig | null | undefined,
): McpClientRegistrationPreference {
  return authConfig?.registrationPreference ?? 'auto';
}

export function getEffectiveCallbackUrl(
  authConfig: McpServerAuthConfig | null | undefined,
  fallbackCallbackUrl: string,
): string {
  const configuredCallbackUrl = authConfig?.callbackUrl?.trim();
  if (!configuredCallbackUrl) {
    return fallbackCallbackUrl;
  }

  if (isNativeCallbackUrl(fallbackCallbackUrl) && !isNativeCallbackUrl(configuredCallbackUrl)) {
    return fallbackCallbackUrl;
  }

  return configuredCallbackUrl;
}

export function buildRegistrationCacheKey(
  authConfig: McpServerAuthConfig,
  callbackUrl: string,
  requestedMode: McpResolvedClientMode,
): string {
  const raw = [
    authConfig.authorizationServerUrl ?? '',
    authConfig.authorizationServerMetadataUrl ?? '',
    authConfig.resource ?? '',
    callbackUrl,
    requestedMode,
  ].join('|');
  return encodeCacheKey(raw);
}

export function buildTokenCacheKey(
  authConfig: McpServerAuthConfig | null | undefined,
  mcpServerUrl: string,
): string {
  if (!authConfig) {
    return encodeCacheKey(`legacy|${mcpServerUrl}`);
  }

  const callbackUrl = authConfig.callbackUrl ?? '';
  const clientMode = authConfig.clientMode ?? 'manual';
  const raw = [
    authConfig.authorizationServerUrl ?? mcpServerUrl,
    authConfig.resource ?? '',
    callbackUrl,
    clientMode,
  ].join('|');
  return encodeCacheKey(raw);
}

export function loadStoredRegistration(
  cacheKey: string,
  storage?: EmcyStorageLike | null,
): StoredOAuthRegistration | null {
  const targetStorage = getStorage(storage);
  if (!targetStorage) return null;

  try {
    const raw = targetStorage.getItem(`${REGISTRATION_STORAGE_PREFIX}${cacheKey}`);
    if (!raw) return null;
    return JSON.parse(raw) as StoredOAuthRegistration;
  } catch {
    return null;
  }
}

export function saveStoredRegistration(
  registration: StoredOAuthRegistration,
  storage?: EmcyStorageLike | null,
): void {
  const targetStorage = getStorage(storage);
  if (!targetStorage) return;

  try {
    targetStorage.setItem(
      `${REGISTRATION_STORAGE_PREFIX}${registration.key}`,
      JSON.stringify(registration),
    );
  } catch {
    // Ignore storage failures in private browsing or sandboxed contexts.
  }
}

export function clearStoredRegistration(
  cacheKey: string,
  storage?: EmcyStorageLike | null,
): void {
  const targetStorage = getStorage(storage);
  if (!targetStorage) return;

  try {
    targetStorage.removeItem(`${REGISTRATION_STORAGE_PREFIX}${cacheKey}`);
  } catch {
    // Ignore storage failures.
  }
}

export function applyResolvedRegistration(
  authConfig: McpServerAuthConfig,
  registration: ResolvedOAuthRegistration,
): McpServerAuthConfig {
  return {
    ...authConfig,
    callbackUrl: registration.callbackUrl,
    clientId: registration.clientId ?? authConfig.clientId,
    clientMode: registration.mode,
    resource: registration.resource ?? authConfig.resource,
    authorizationServerUrl:
      registration.authorizationServerUrl ?? authConfig.authorizationServerUrl,
    authorizationServerMetadataUrl:
      registration.authorizationServerMetadataUrl
      ?? authConfig.authorizationServerMetadataUrl,
    registrationEndpoint:
      registration.registrationEndpoint ?? authConfig.registrationEndpoint,
  };
}

export interface ResolveOAuthRegistrationOptions {
  callbackUrl: string;
  oauthClientMetadataUrl?: string;
  clientName?: string;
  clientUri?: string;
  fetchImpl?: typeof fetch;
  storage?: EmcyStorageLike | null;
}

function createResolvedRegistration(
  authConfig: McpServerAuthConfig,
  mode: McpResolvedClientMode,
  callbackUrl: string,
  clientId?: string,
  clientMetadataUrl?: string,
): ResolvedOAuthRegistration {
  return {
    cacheKey: buildRegistrationCacheKey(authConfig, callbackUrl, mode),
    mode,
    clientId,
    callbackUrl,
    resource: authConfig.resource,
    authorizationServerUrl: authConfig.authorizationServerUrl,
    authorizationServerMetadataUrl: authConfig.authorizationServerMetadataUrl,
    registrationEndpoint: authConfig.registrationEndpoint,
    clientMetadataUrl,
  };
}

function shouldAttemptMode(
  preferred: McpClientRegistrationPreference,
  candidate: McpResolvedClientMode,
): boolean {
  return preferred === 'auto' || preferred === candidate;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

function isNativeCallbackUrl(callbackUrl: string): boolean {
  try {
    const url = new URL(callbackUrl);
    return url.protocol !== 'http:' && url.protocol !== 'https:';
  } catch {
    return !callbackUrl.startsWith('http://') && !callbackUrl.startsWith('https://');
  }
}

function inferApplicationType(callbackUrl: string): 'web' | 'native' {
  try {
    const url = new URL(callbackUrl);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return isLoopbackHost(url.hostname) ? 'native' : 'web';
    }

    return 'native';
  } catch {
    return 'native';
  }
}

export async function registerPublicClient(
  authConfig: McpServerAuthConfig,
  options: ResolveOAuthRegistrationOptions,
): Promise<ResolvedOAuthRegistration> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const callbackUrl = options.callbackUrl;
  const registration = createResolvedRegistration(authConfig, 'dcr', callbackUrl);

  if (!authConfig.registrationEndpoint) {
    throw new Error('Dynamic client registration is not available for this server.');
  }

  const existing = loadStoredRegistration(registration.cacheKey, options.storage);
  if (existing?.clientId) {
    return {
      ...registration,
      clientId: existing.clientId,
    };
  }

  const requestBody: OAuthDynamicClientRegistrationRequest = {
    client_name: options.clientName ?? 'Emcy MCP Client',
    application_type: inferApplicationType(callbackUrl),
    redirect_uris: [callbackUrl],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: authConfig.scopes?.join(' '),
    client_uri: options.clientUri,
  };

  const response = await fetchImpl(authConfig.registrationEndpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Dynamic client registration failed.');
    throw new Error(`Dynamic client registration failed (${response.status}): ${errorText}`);
  }

  const payload = await response.json() as OAuthDynamicClientRegistrationResponse;
  if (!payload.client_id) {
    throw new Error('Dynamic client registration response did not include a client_id.');
  }

  saveStoredRegistration({
    key: registration.cacheKey,
    mode: 'dcr',
    authorizationServerUrl: authConfig.authorizationServerUrl ?? '',
    authorizationServerMetadataUrl: authConfig.authorizationServerMetadataUrl,
    registrationEndpoint: authConfig.registrationEndpoint,
    clientId: payload.client_id,
    callbackUrl,
    resource: authConfig.resource,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }, options.storage);

  return {
    ...registration,
    clientId: payload.client_id,
  };
}

export async function resolveOAuthRegistration(
  authConfig: McpServerAuthConfig,
  options: ResolveOAuthRegistrationOptions,
): Promise<ResolvedOAuthRegistration> {
  const callbackUrl = getEffectiveCallbackUrl(authConfig, options.callbackUrl);
  const preferred = getPreferredRegistrationPreference(authConfig);
  const preregClientId = authConfig.clientId?.trim();

  if (preregClientId && shouldAttemptMode(preferred, 'preregistered')) {
    return createResolvedRegistration(
      authConfig,
      'preregistered',
      callbackUrl,
      preregClientId,
    );
  }

  if (
    authConfig.clientIdMetadataDocumentSupported
    && options.oauthClientMetadataUrl
    && shouldAttemptMode(preferred, 'cimd')
  ) {
    return createResolvedRegistration(
      authConfig,
      'cimd',
      callbackUrl,
      options.oauthClientMetadataUrl,
      options.oauthClientMetadataUrl,
    );
  }

  if (authConfig.registrationEndpoint && shouldAttemptMode(preferred, 'dcr')) {
    return registerPublicClient(authConfig, {
      ...options,
      callbackUrl,
    });
  }

  return createResolvedRegistration(
    authConfig,
    preregClientId ? 'preregistered' : 'manual',
    callbackUrl,
    preregClientId,
  );
}
