import React, { useEffect, useRef, useCallback, useState } from 'react';
import * as styles from './styles';
import type { McpServerAuthConfig, OAuthTokenResponse } from '../../core/types';
import {
  applyResolvedRegistration,
  buildRegistrationCacheKey,
  clearStoredRegistration,
  resolveOAuthRegistration,
} from '../../core/auth/registration';

export interface OAuthPopupProps {
  serverName: string;
  serverUrl: string;
  authConfig: McpServerAuthConfig;
  oauthCallbackUrl?: string;
  oauthClientMetadataUrl?: string;
  /** Called with the full token response (access token, refresh token, expiry) */
  onToken: (tokenResponse: OAuthTokenResponse) => void;
  onClose: () => void;
}

const OAUTH_CALLBACK_CHANNEL_NAME = 'emcy-oauth';
const OAUTH_CALLBACK_STORAGE_PREFIX = 'emcy-oauth-callback:';

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

const overlay: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10,
  borderRadius: '16px',
};

const popup: React.CSSProperties = {
  backgroundColor: styles.colors.bg,
  borderRadius: '12px',
  padding: '24px',
  maxWidth: '340px',
  width: '90%',
  textAlign: 'center',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.15)',
};

const titleStyle: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 600,
  color: styles.colors.text,
  margin: '0 0 8px 0',
};

const description: React.CSSProperties = {
  fontSize: '13px',
  color: styles.colors.textSecondary,
  lineHeight: 1.5,
  margin: '0 0 16px 0',
};

const buttonRow: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  justifyContent: 'center',
};

const signInButton: React.CSSProperties = {
  padding: '10px 24px',
  borderRadius: '8px',
  backgroundColor: styles.colors.primary,
  color: '#fff',
  border: 'none',
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: 600,
};

const cancelButton: React.CSSProperties = {
  padding: '10px 20px',
  borderRadius: '8px',
  backgroundColor: 'transparent',
  color: styles.colors.textSecondary,
  border: `1px solid ${styles.colors.border}`,
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: 500,
};

const statusText: React.CSSProperties = {
  fontSize: '12px',
  color: styles.colors.textMuted,
  margin: '12px 0 0 0',
};

const errorText: React.CSSProperties = {
  fontSize: '12px',
  color: '#b91c1c',
  margin: '12px 0 0 0',
};

export function OAuthPopup({
  serverName,
  serverUrl,
  authConfig,
  oauthCallbackUrl,
  oauthClientMetadataUrl,
  onToken,
  onClose,
}: OAuthPopupProps) {
  const popupWindowRef = useRef<Window | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const codeVerifierRef = useRef<string>('');
  const stateRef = useRef<string>('');
  const handledCallbackRef = useRef(false);
  const resolvedAuthConfigRef = useRef<McpServerAuthConfig>(authConfig);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [popupError, setPopupError] = useState<string | null>(null);

  useEffect(() => {
    resolvedAuthConfigRef.current = authConfig;
  }, [authConfig]);

  const getCallbackUrl = useCallback((config: McpServerAuthConfig) => (
    config.callbackUrl ?? oauthCallbackUrl ?? `${window.location.origin}/oauth/callback`
  ), [oauthCallbackUrl]);

  const cleanup = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = undefined;
    }
    if (popupWindowRef.current && !popupWindowRef.current.closed) {
      popupWindowRef.current.close();
    }
  }, []);

  const clearStoredCallbackPayload = useCallback((state: string) => {
    try {
      localStorage.removeItem(`${OAUTH_CALLBACK_STORAGE_PREFIX}${state}`);
    } catch {
      // Ignore storage failures in restricted environments.
    }
  }, []);

  const exchangeCodeForToken = async (code: string) => {
    const effectiveAuthConfig = resolvedAuthConfigRef.current;
    const callbackUrl = getCallbackUrl(effectiveAuthConfig);
    const tokenUrl = effectiveAuthConfig.tokenEndpoint ?? effectiveAuthConfig.tokenUrl;
    if (!tokenUrl) return;

    try {
      setPopupError(null);
      setStatusMessage('Exchanging authorization code...');
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifierRef.current,
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
          cleanup();
          onToken({
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresIn: data.expires_in,
            tokenType: data.token_type,
            resolvedAuthConfig: effectiveAuthConfig,
          });
        }
        return;
      }

      const errorMessage = await response.text().catch(() => 'Token exchange failed.');
      if (effectiveAuthConfig.clientMode === 'dcr') {
        clearStoredRegistration(
          buildRegistrationCacheKey(effectiveAuthConfig, callbackUrl, 'dcr'),
        );
      }
      setPopupError(errorMessage || 'Token exchange failed.');
      setStatusMessage(null);
      handledCallbackRef.current = false;
    } catch {
      setPopupError('Token exchange failed. Please try again.');
      setStatusMessage(null);
      handledCallbackRef.current = false;
    }
  };

  useEffect(() => {
    const handleAuthPayload = (payload: unknown) => {
      if (!payload || typeof payload !== 'object') {
        return;
      }

      const data = payload as Record<string, unknown>;
      const responseState = typeof data.state === 'string' ? data.state : '';
      if (!stateRef.current || responseState !== stateRef.current || handledCallbackRef.current) {
        return;
      }

      handledCallbackRef.current = true;
      clearStoredCallbackPayload(responseState);

      if (data.type === 'emcy-oauth-callback' && typeof data.token === 'string') {
        cleanup();
        onToken({
          accessToken: data.token,
          resolvedAuthConfig: resolvedAuthConfigRef.current,
        });
        return;
      }

      if (data.type === 'emcy-oauth-callback' && typeof data.accessToken === 'string') {
        cleanup();
        onToken({
          accessToken: data.accessToken,
          refreshToken: typeof data.refreshToken === 'string' ? data.refreshToken : undefined,
          expiresIn: typeof data.expiresIn === 'number' ? data.expiresIn : undefined,
          tokenType: typeof data.tokenType === 'string' ? data.tokenType : undefined,
          resolvedAuthConfig: resolvedAuthConfigRef.current,
        });
        return;
      }

      if (data.type === 'emcy-oauth-code' && typeof data.code === 'string') {
        void exchangeCodeForToken(data.code);
        return;
      }

      handledCallbackRef.current = false;
    };

    const handler = (event: MessageEvent) => {
      const currentCallbackUrl = getCallbackUrl(resolvedAuthConfigRef.current);
      const callbackOrigin = new URL(currentCallbackUrl).origin;
      if (event.origin !== callbackOrigin) {
        return;
      }

      handleAuthPayload(event.data);
    };

    const storageHandler = (event: StorageEvent) => {
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

    window.addEventListener('message', handler);
    window.addEventListener('storage', storageHandler);
    return () => {
      window.removeEventListener('message', handler);
      window.removeEventListener('storage', storageHandler);
      channel?.close();
      cleanup();
    };
  }, [cleanup, clearStoredCallbackPayload, getCallbackUrl, onToken]);

  const handleSignIn = async () => {
    setPopupError(null);
    setStatusMessage('Preparing secure sign in...');

    let effectiveAuthConfig = authConfig;
    try {
      if (authConfig.authType === 'oauth2') {
        const registration = await resolveOAuthRegistration(authConfig, {
          callbackUrl: getCallbackUrl(authConfig),
          oauthClientMetadataUrl,
          clientName: 'Emcy MCP Client',
          clientUri: typeof window !== 'undefined' ? window.location.origin : 'https://emcy.ai',
        });
        effectiveAuthConfig = applyResolvedRegistration(authConfig, registration);
        resolvedAuthConfigRef.current = effectiveAuthConfig;
      }
    } catch (error) {
      setPopupError(
        error instanceof Error
          ? error.message
          : 'Failed to prepare OAuth sign in for this MCP server.',
      );
      setStatusMessage(null);
      return;
    }

    const callbackUrl = getCallbackUrl(effectiveAuthConfig);
    const loginUrl = effectiveAuthConfig.authorizationEndpoint ?? effectiveAuthConfig.loginUrl;
    if (!loginUrl) {
      setPopupError('This MCP server is missing an authorization endpoint.');
      setStatusMessage(null);
      onClose();
      return;
    }

    const codeVerifier = generateCodeVerifier();
    codeVerifierRef.current = codeVerifier;
    const state = crypto.randomUUID();
    stateRef.current = state;
    handledCallbackRef.current = false;

    let authUrl: string;

    if (effectiveAuthConfig.tokenEndpoint ?? effectiveAuthConfig.tokenUrl) {
      const codeChallenge = await generateCodeChallenge(codeVerifier);
      const params = new URLSearchParams({
        response_type: 'code',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
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
      authUrl = `${loginUrl}${loginUrl.includes('?') ? '&' : '?'}${params.toString()}`;
    } else {
      // Simple login page flow - the app's login page will post back the token
      const params = new URLSearchParams({
        state,
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
      expectedState: state,
    }));

    popupWindowRef.current = window.open(
      authUrl,
      `emcy-auth:${popupContext}`,
      `width=${width},height=${height},left=${left},top=${top},popup=true`,
    );

    setStatusMessage('Waiting for sign in...');

    pollTimerRef.current = setInterval(() => {
      if (popupWindowRef.current?.closed) {
        cleanup();
        setStatusMessage(null);
      }
    }, 500);
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={popup} onClick={(e) => e.stopPropagation()}>
        <p style={titleStyle}>Sign in to {serverName}</p>
        <p style={description}>
          This tool requires authentication. Sign in to connect your account and enable AI to access your data.
        </p>
        <div style={buttonRow}>
          <button style={signInButton} onClick={handleSignIn} type="button">
            Sign In
          </button>
          <button style={cancelButton} onClick={onClose} type="button">
            Cancel
          </button>
        </div>
        {statusMessage && <p style={statusText}>{statusMessage}</p>}
        {popupError && <p style={errorText}>{popupError}</p>}
      </div>
    </div>
  );
}
