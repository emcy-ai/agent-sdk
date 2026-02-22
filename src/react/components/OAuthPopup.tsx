import React, { useEffect, useRef, useCallback } from 'react';
import * as styles from './styles';
import type { McpServerAuthConfig } from '../../core/types';

export interface OAuthPopupProps {
  serverName: string;
  serverUrl: string;
  authConfig: McpServerAuthConfig;
  onToken: (token: string) => void;
  onClose: () => void;
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

export function OAuthPopup({ serverName, serverUrl, authConfig, onToken, onClose }: OAuthPopupProps) {
  const popupWindowRef = useRef<Window | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const codeVerifierRef = useRef<string>('');
  const stateRef = useRef<string>('');

  const cleanup = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = undefined;
    }
    if (popupWindowRef.current && !popupWindowRef.current.closed) {
      popupWindowRef.current.close();
    }
  }, []);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'emcy-oauth-callback' && event.data?.token) {
        cleanup();
        onToken(event.data.token);
      }
      if (event.data?.type === 'emcy-oauth-code' && event.data?.code) {
        exchangeCodeForToken(event.data.code);
      }
    };

    window.addEventListener('message', handler);
    return () => {
      window.removeEventListener('message', handler);
      cleanup();
    };
  }, [cleanup, onToken]);

  const exchangeCodeForToken = async (code: string) => {
    const tokenUrl = authConfig.tokenUrl;
    if (!tokenUrl) return;

    try {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifierRef.current,
        redirect_uri: `${window.location.origin}/oauth/callback`,
      });
      if (authConfig.clientId) {
        body.set('client_id', authConfig.clientId);
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
          onToken(data.access_token);
        }
      }
    } catch {
      // Token exchange failed silently; user can retry
    }
  };

  const handleSignIn = async () => {
    const loginUrl = authConfig.loginUrl;
    if (!loginUrl) {
      onClose();
      return;
    }

    const codeVerifier = generateCodeVerifier();
    codeVerifierRef.current = codeVerifier;
    const state = crypto.randomUUID();
    stateRef.current = state;

    let authUrl: string;

    if (authConfig.tokenUrl) {
      const codeChallenge = await generateCodeChallenge(codeVerifier);
      const params = new URLSearchParams({
        response_type: 'code',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
        redirect_uri: `${window.location.origin}/oauth/callback`,
      });
      if (authConfig.clientId) {
        params.set('client_id', authConfig.clientId);
      }
      if (authConfig.scopes?.length) {
        params.set('scope', authConfig.scopes.join(' '));
      }
      authUrl = `${loginUrl}${loginUrl.includes('?') ? '&' : '?'}${params.toString()}`;
    } else {
      // Simple login page flow - the app's login page will post back the token
      const params = new URLSearchParams({
        state,
        redirect_uri: `${window.location.origin}/oauth/callback`,
        mode: 'popup',
      });
      authUrl = `${loginUrl}${loginUrl.includes('?') ? '&' : '?'}${params.toString()}`;
    }

    const width = 500;
    const height = 600;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    popupWindowRef.current = window.open(
      authUrl,
      `emcy-auth-${serverUrl}`,
      `width=${width},height=${height},left=${left},top=${top},popup=true`,
    );

    pollTimerRef.current = setInterval(() => {
      if (popupWindowRef.current?.closed) {
        cleanup();
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
        {popupWindowRef.current && !popupWindowRef.current.closed && (
          <p style={statusText}>Waiting for sign in...</p>
        )}
      </div>
    </div>
  );
}
