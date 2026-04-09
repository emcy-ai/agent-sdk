import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  EmcyEmbeddedAuthConfig,
  EmcyEmbeddedAuthIdentity,
  McpServerAuthConfig,
  OAuthTokenResponse,
} from '../core/types';
import {
  applyResolvedRegistration,
  buildRegistrationCacheKey,
  clearStoredRegistration,
  resolveOAuthRegistration,
} from '../core/auth/registration';
import { normalizeAuthSessionKey } from '../core/auth-storage';
import type { OAuthPopupPhase, OAuthPopupViewState } from './components/OAuthPopup';

const OAUTH_CALLBACK_CHANNEL_NAME = 'emcy-oauth';
const OAUTH_CALLBACK_STORAGE_PREFIX = 'emcy-oauth-callback:';

interface UsePopupOAuthControllerOptions {
  resolveServerName: (serverUrl: string) => string;
  oauthCallbackUrl: string;
  oauthClientMetadataUrl: string;
  embeddedAuth?: EmcyEmbeddedAuthConfig;
  authSessionKey?: string | null;
}

interface ActivePopupAuthRequest {
  serverName: string;
  serverUrl: string;
  authConfig: McpServerAuthConfig;
  resolvedAuthConfig: McpServerAuthConfig;
  promise: Promise<OAuthTokenResponse | undefined>;
  resolve: (tokenResponse: OAuthTokenResponse | undefined) => void;
  state: string;
  codeVerifier: string;
  handledCallback: boolean;
  popupWindow: Window | null;
  pollTimer?: ReturnType<typeof setInterval>;
  hostIdentity?: EmcyEmbeddedAuthIdentity;
  hostIdentityLabel?: string | null;
}

function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function createPopupState(
  request: ActivePopupAuthRequest,
  phase: OAuthPopupPhase,
  statusMessage?: string | null,
  errorMessage?: string | null,
): OAuthPopupViewState {
  return {
    serverName: request.serverName,
    serverUrl: request.serverUrl,
    phase,
    statusMessage: statusMessage ?? null,
    errorMessage: errorMessage ?? null,
    hostIdentityLabel: request.hostIdentityLabel ?? null,
  };
}

function normalizeOptionalValue(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function formatHostIdentityLabel(identity?: EmcyEmbeddedAuthIdentity): string | null {
  if (!identity) {
    return null;
  }

  return (
    normalizeOptionalValue(identity.displayName) ??
    normalizeOptionalValue(identity.email) ??
    normalizeOptionalValue(identity.subject) ??
    null
  );
}

function isHostedMcpAuthorizeUrl(authConfig: McpServerAuthConfig): boolean {
  const loginUrl = authConfig.authorizationEndpoint ?? authConfig.loginUrl;
  if (!loginUrl) {
    return false;
  }

  try {
    const url = new URL(loginUrl);
    return /\/api\/v1\/hosted-mcp\/[^/]+\/authorize$/i.test(url.pathname);
  } catch {
    return false;
  }
}

export interface PopupOAuthControllerState {
  popupState: OAuthPopupViewState | null;
  requestAuth: (
    serverUrl: string,
    authConfig: McpServerAuthConfig,
  ) => Promise<OAuthTokenResponse | undefined>;
  startOrRetryPopupAuth: () => void;
  cancelPopupAuth: () => void;
  handleServerAuthStatus: (
    serverUrl: string,
    authStatus: 'connected' | 'needs_auth',
  ) => void;
}

export function usePopupOAuthController(
  options: UsePopupOAuthControllerOptions,
): PopupOAuthControllerState {
  const [popupState, setPopupState] = useState<OAuthPopupViewState | null>(null);
  const activeRequestRef = useRef<ActivePopupAuthRequest | null>(null);
  const mountedRef = useRef(true);
  const optionsRef = useRef(options);
  const authSessionKeyRef = useRef(normalizeAuthSessionKey(options.authSessionKey));

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const getCallbackUrl = useCallback((config: McpServerAuthConfig) => (
    config.callbackUrl ?? optionsRef.current.oauthCallbackUrl
  ), []);

  const clearStoredCallbackPayload = useCallback((state: string) => {
    if (!state) {
      return;
    }

    try {
      localStorage.removeItem(`${OAUTH_CALLBACK_STORAGE_PREFIX}${state}`);
    } catch {
      // Ignore storage failures in restricted environments.
    }
  }, []);

  const clearPollTimer = useCallback((request: ActivePopupAuthRequest | null) => {
    if (request?.pollTimer) {
      clearInterval(request.pollTimer);
      request.pollTimer = undefined;
    }
  }, []);

  const dismissPopupState = useCallback((serverUrl?: string) => {
    if (!mountedRef.current) {
      return;
    }

    setPopupState((currentState) => {
      if (!currentState) {
        return null;
      }

      if (!serverUrl || currentState.serverUrl === serverUrl) {
        return null;
      }

      return currentState;
    });
  }, []);

  const closePopupWindow = useCallback((request: ActivePopupAuthRequest | null) => {
    if (request?.popupWindow && !request.popupWindow.closed) {
      request.popupWindow.close();
    }

    if (request) {
      request.popupWindow = null;
    }
  }, []);

  useEffect(() => {
    const previousAuthSessionKey = authSessionKeyRef.current;
    const nextAuthSessionKey = normalizeAuthSessionKey(options.authSessionKey);

    authSessionKeyRef.current = nextAuthSessionKey;
    if (previousAuthSessionKey === nextAuthSessionKey) {
      return;
    }

    const request = activeRequestRef.current;
    if (!request) {
      if (mountedRef.current) {
        setPopupState(null);
      }
      return;
    }

    clearPollTimer(request);
    closePopupWindow(request);
    clearStoredCallbackPayload(request.state);
    activeRequestRef.current = null;
    request.resolve(undefined);

    if (mountedRef.current) {
      setPopupState(null);
    }
  }, [
    clearPollTimer,
    clearStoredCallbackPayload,
    closePopupWindow,
    options.authSessionKey,
  ]);

  const resolveAndClearActiveRequest = useCallback((tokenResponse?: OAuthTokenResponse) => {
    const request = activeRequestRef.current;
    if (!request) {
      dismissPopupState();
      return;
    }

    clearPollTimer(request);
    closePopupWindow(request);
    clearStoredCallbackPayload(request.state);
    activeRequestRef.current = null;

    request.resolve(tokenResponse);
    dismissPopupState(request.serverUrl);
  }, [clearPollTimer, clearStoredCallbackPayload, closePopupWindow, dismissPopupState]);

  const transitionActiveRequest = useCallback((
    phase: OAuthPopupPhase,
    errorMessage?: string | null,
    statusMessage?: string | null,
  ) => {
    const request = activeRequestRef.current;
    if (!request) {
      return;
    }

    clearPollTimer(request);
    closePopupWindow(request);
    request.handledCallback = false;

    if (mountedRef.current) {
      setPopupState(createPopupState(request, phase, statusMessage, errorMessage));
    }
  }, [clearPollTimer, closePopupWindow]);

  const setActivePopupPhase = useCallback((
    phase: OAuthPopupPhase,
    errorMessage?: string | null,
    statusMessage?: string | null,
  ) => {
    const request = activeRequestRef.current;
    if (!request) {
      return;
    }

    clearPollTimer(request);
    closePopupWindow(request);

    if (mountedRef.current) {
      setPopupState(createPopupState(request, phase, statusMessage, errorMessage));
    }
  }, [clearPollTimer, closePopupWindow]);

  const exchangeCodeForToken = useCallback(async (code: string) => {
    const request = activeRequestRef.current;
    if (!request) {
      return;
    }

    const effectiveAuthConfig = request.resolvedAuthConfig;
    const callbackUrl = getCallbackUrl(effectiveAuthConfig);
    const tokenUrl = effectiveAuthConfig.tokenEndpoint ?? effectiveAuthConfig.tokenUrl;

    if (!tokenUrl) {
      request.handledCallback = false;
      transitionActiveRequest('error', 'This MCP server is missing a token endpoint.');
      return;
    }

    if (mountedRef.current) {
      setPopupState(
        createPopupState(
          request,
          'exchanging',
          'Exchanging authorization code...',
        ),
      );
    }

    try {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: request.codeVerifier,
        redirect_uri: callbackUrl,
      });

      if (effectiveAuthConfig.clientId) {
        body.set('client_id', effectiveAuthConfig.clientId);
      }

      if (effectiveAuthConfig.resource) {
        body.set('resource', effectiveAuthConfig.resource);
      }

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });

      if (response.ok) {
        const data = await response.json();
        if (data.access_token) {
          resolveAndClearActiveRequest({
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresIn: data.expires_in,
            tokenType: data.token_type,
            resolvedAuthConfig: effectiveAuthConfig,
          });
          return;
        }
      }

      const errorMessage = await response.text().catch(() => 'Token exchange failed.');
      if (effectiveAuthConfig.clientMode === 'dcr') {
        clearStoredRegistration(
          buildRegistrationCacheKey(effectiveAuthConfig, callbackUrl, 'dcr'),
        );
      }
      request.handledCallback = false;
      transitionActiveRequest('error', errorMessage || 'Token exchange failed.');
    } catch {
      request.handledCallback = false;
      transitionActiveRequest('error', 'Token exchange failed. Please try again.');
    }
  }, [getCallbackUrl, resolveAndClearActiveRequest, transitionActiveRequest]);

  const handleAuthPayload = useCallback((payload: unknown) => {
    const request = activeRequestRef.current;
    if (!request || !payload || typeof payload !== 'object') {
      return;
    }

    const data = payload as Record<string, unknown>;
    const responseState = typeof data.state === 'string' ? data.state : '';
    if (!request.state || responseState !== request.state || request.handledCallback) {
      return;
    }

    request.handledCallback = true;
    clearPollTimer(request);
    clearStoredCallbackPayload(responseState);

    if (data.type === 'emcy-oauth-callback' && typeof data.token === 'string') {
      resolveAndClearActiveRequest({
        accessToken: data.token,
        resolvedAuthConfig: request.resolvedAuthConfig,
      });
      return;
    }

    if (data.type === 'emcy-oauth-callback' && typeof data.accessToken === 'string') {
      resolveAndClearActiveRequest({
        accessToken: data.accessToken,
        refreshToken: typeof data.refreshToken === 'string' ? data.refreshToken : undefined,
        expiresIn: typeof data.expiresIn === 'number' ? data.expiresIn : undefined,
        tokenType: typeof data.tokenType === 'string' ? data.tokenType : undefined,
        resolvedAuthConfig: request.resolvedAuthConfig,
      });
      return;
    }

    if (data.type === 'emcy-oauth-code' && typeof data.code === 'string') {
      void exchangeCodeForToken(data.code);
      return;
    }

    if (data.type === 'emcy-oauth-error' && typeof data.error === 'string') {
      const description =
        typeof data.errorDescription === 'string'
          ? data.errorDescription
          : typeof data.error_description === 'string'
            ? data.error_description
            : 'Sign in could not be completed.';
      setActivePopupPhase(
        data.error === 'access_denied' ? 'canceled' : 'error',
        description,
      );
      return;
    }

    request.handledCallback = false;
  }, [
    clearStoredCallbackPayload,
    exchangeCodeForToken,
    resolveAndClearActiveRequest,
    setActivePopupPhase,
  ]);

  const startOrRetryPopupAuth = useCallback(async () => {
    const request = activeRequestRef.current;
    if (!request) {
      return;
    }

    clearStoredCallbackPayload(request.state);
    closePopupWindow(request);
    clearPollTimer(request);

    if (mountedRef.current) {
      setPopupState(
        createPopupState(request, 'preparing', 'Preparing secure sign in...'),
      );
    }

    let effectiveAuthConfig = request.authConfig;

    try {
      if (effectiveAuthConfig.authType === 'oauth2' && !effectiveAuthConfig.clientMode) {
        const registration = await resolveOAuthRegistration(effectiveAuthConfig, {
          callbackUrl: getCallbackUrl(effectiveAuthConfig),
          oauthClientMetadataUrl: optionsRef.current.oauthClientMetadataUrl,
          clientName: 'Emcy MCP Client',
          clientUri: window.location.origin,
        });
        effectiveAuthConfig = applyResolvedRegistration(effectiveAuthConfig, registration);
      }

      request.resolvedAuthConfig = effectiveAuthConfig;
    } catch (error) {
      transitionActiveRequest(
        'error',
        error instanceof Error
          ? error.message
          : 'Failed to prepare OAuth sign in for this MCP server.',
      );
      return;
    }

    const callbackUrl = getCallbackUrl(effectiveAuthConfig);
    const loginUrl = effectiveAuthConfig.authorizationEndpoint ?? effectiveAuthConfig.loginUrl;
    if (!loginUrl) {
      transitionActiveRequest('error', 'This MCP server is missing an authorization endpoint.');
      return;
    }

    const codeVerifier = generateCodeVerifier();
    request.codeVerifier = codeVerifier;
    request.state = crypto.randomUUID();
    request.handledCallback = false;

    let authUrl = '';

    if (effectiveAuthConfig.tokenEndpoint ?? effectiveAuthConfig.tokenUrl) {
      const codeChallenge = await generateCodeChallenge(codeVerifier);
      const params = new URLSearchParams({
        response_type: 'code',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state: request.state,
        redirect_uri: callbackUrl,
      });
      if (effectiveAuthConfig.clientId) {
        params.set('client_id', effectiveAuthConfig.clientId);
      }
      if (effectiveAuthConfig.scopes?.length) {
        params.set('scope', effectiveAuthConfig.scopes.join(' '));
      }
      if (effectiveAuthConfig.resource) {
        params.set('resource', effectiveAuthConfig.resource);
      }
      if (request.hostIdentity && isHostedMcpAuthorizeUrl(effectiveAuthConfig)) {
        const subject = normalizeOptionalValue(request.hostIdentity.subject);
        const email = normalizeOptionalValue(request.hostIdentity.email);
        const organizationId = normalizeOptionalValue(request.hostIdentity.organizationId);
        const displayName = normalizeOptionalValue(request.hostIdentity.displayName);

        if (subject) {
          params.set('emcy_host_subject', subject);
        }
        if (email) {
          params.set('emcy_host_email', email);
        }
        if (organizationId) {
          params.set('emcy_host_organization_id', organizationId);
        }
        if (displayName) {
          params.set('emcy_host_display_name', displayName);
        }
        params.set(
          'emcy_mismatch_policy',
          optionsRef.current.embeddedAuth?.mismatchPolicy ?? 'block_with_switch',
        );
      }
      authUrl = `${loginUrl}${loginUrl.includes('?') ? '&' : '?'}${params.toString()}`;
    } else {
      const params = new URLSearchParams({
        state: request.state,
        redirect_uri: callbackUrl,
        mode: 'popup',
      });
      if (effectiveAuthConfig.clientId) {
        params.set('client_id', effectiveAuthConfig.clientId);
      }
      if (effectiveAuthConfig.resource) {
        params.set('resource', effectiveAuthConfig.resource);
      }
      authUrl = `${loginUrl}${loginUrl.includes('?') ? '&' : '?'}${params.toString()}`;
    }

    const width = 500;
    const height = 600;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    const popupContext = encodeURIComponent(JSON.stringify({
      openerOrigin: window.location.origin,
      expectedState: request.state,
    }));

    const popupWindow = window.open(
      authUrl,
      `emcy-auth:${popupContext}`,
      `width=${width},height=${height},left=${left},top=${top},popup=true`,
    );

    if (!popupWindow) {
      transitionActiveRequest(
        'blocked',
        'Your browser blocked the sign-in popup. Allow popups and try again.',
      );
      return;
    }

    request.popupWindow = popupWindow;
    request.pollTimer = setInterval(() => {
      const activeRequest = activeRequestRef.current;
      if (!activeRequest || activeRequest !== request) {
        clearPollTimer(request);
        return;
      }

      if (request.popupWindow?.closed) {
        clearPollTimer(request);
        if (mountedRef.current) {
          setPopupState(
            createPopupState(
              request,
              'canceled',
              null,
              'The sign-in window was closed before authentication completed.',
            ),
          );
        }
      }
    }, 500);

    if (mountedRef.current) {
      setPopupState(
        createPopupState(
          request,
          'waiting',
          'Finish sign in in the popup window to connect your account.',
        ),
      );
    }
  }, [
    clearPollTimer,
    clearStoredCallbackPayload,
    closePopupWindow,
    getCallbackUrl,
    transitionActiveRequest,
  ]);

  const cancelPopupAuth = useCallback(() => {
    if (!activeRequestRef.current) {
      dismissPopupState();
      return;
    }

    resolveAndClearActiveRequest(undefined);
  }, [dismissPopupState, resolveAndClearActiveRequest]);

  const handleServerAuthStatus = useCallback((
    serverUrl: string,
    authStatus: 'connected' | 'needs_auth',
  ) => {
    if (authStatus !== 'connected') {
      return;
    }

    const request = activeRequestRef.current;
    if (request && request.serverUrl === serverUrl) {
      clearPollTimer(request);
      closePopupWindow(request);
      clearStoredCallbackPayload(request.state);
      activeRequestRef.current = null;
    }

    dismissPopupState(serverUrl);
  }, [clearPollTimer, clearStoredCallbackPayload, closePopupWindow, dismissPopupState]);

  const requestAuth = useCallback((
    serverUrl: string,
    authConfig: McpServerAuthConfig,
  ) => {
    const activeRequest = activeRequestRef.current;
    if (activeRequest) {
      if (activeRequest.serverUrl === serverUrl) {
        return activeRequest.promise;
      }

      if (mountedRef.current) {
        setPopupState((currentState) => (
          currentState
            ? {
                ...currentState,
                errorMessage: 'Another MCP server sign-in is already in progress. Finish or cancel it first.',
              }
            : createPopupState(
              activeRequest,
              'error',
              null,
              'Another MCP server sign-in is already in progress. Finish or cancel it first.',
            )
        ));
      }

      return Promise.reject(
        new Error('Another MCP server sign-in is already in progress. Finish or cancel it first.'),
      );
    }

    const serverName = optionsRef.current.resolveServerName(serverUrl);

    let resolvePromise: (tokenResponse: OAuthTokenResponse | undefined) => void = () => {};
    const promise = new Promise<OAuthTokenResponse | undefined>((resolve) => {
      resolvePromise = resolve;
    });

    const request: ActivePopupAuthRequest = {
      serverName,
      serverUrl,
      authConfig,
      resolvedAuthConfig: authConfig,
      promise,
      resolve: resolvePromise,
      state: '',
      codeVerifier: '',
      handledCallback: false,
      popupWindow: null,
      hostIdentity: optionsRef.current.embeddedAuth?.hostIdentity,
      hostIdentityLabel: formatHostIdentityLabel(optionsRef.current.embeddedAuth?.hostIdentity),
    };

    activeRequestRef.current = request;
    setPopupState(createPopupState(request, 'prompt'));

    return promise;
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const request = activeRequestRef.current;
      if (!request) {
        return;
      }

      try {
        const callbackOrigin = new URL(getCallbackUrl(request.resolvedAuthConfig)).origin;
        if (event.origin !== callbackOrigin) {
          return;
        }
      } catch {
        return;
      }

      handleAuthPayload(event.data);
    };

    const handleStorage = (event: StorageEvent) => {
      if (!event.key?.startsWith(OAUTH_CALLBACK_STORAGE_PREFIX) || !event.newValue) {
        return;
      }

      try {
        const parsed = JSON.parse(event.newValue) as Record<string, unknown>;
        handleAuthPayload(parsed);
      } catch {
        // Ignore malformed callback payloads.
      }
    };

    const channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel(OAUTH_CALLBACK_CHANNEL_NAME)
        : null;

    if (channel) {
      channel.onmessage = (event) => {
        handleAuthPayload(event.data);
      };
    }

    window.addEventListener('message', handleMessage);
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('storage', handleStorage);
      channel?.close();
    };
  }, [getCallbackUrl, handleAuthPayload]);

  useEffect(() => () => {
    mountedRef.current = false;
    const request = activeRequestRef.current;
    if (!request) {
      return;
    }

    clearPollTimer(request);
    closePopupWindow(request);
    clearStoredCallbackPayload(request.state);
    activeRequestRef.current = null;
    request.resolve(undefined);
  }, [clearPollTimer, clearStoredCallbackPayload, closePopupWindow]);

  return {
    popupState,
    requestAuth,
    startOrRetryPopupAuth,
    cancelPopupAuth,
    handleServerAuthStatus,
  };
}
