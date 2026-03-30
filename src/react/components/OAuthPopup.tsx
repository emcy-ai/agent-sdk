import React from 'react';
import * as styles from './styles';

export type OAuthPopupPhase =
  | 'prompt'
  | 'preparing'
  | 'waiting'
  | 'exchanging'
  | 'blocked'
  | 'canceled'
  | 'error';

export interface OAuthPopupViewState {
  serverName: string;
  serverUrl: string;
  phase: OAuthPopupPhase;
  statusMessage?: string | null;
  errorMessage?: string | null;
  hostIdentityLabel?: string | null;
}

export interface OAuthPopupProps extends OAuthPopupViewState {
  onPrimaryAction?: () => void;
  onClose: () => void;
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

const primaryButton: React.CSSProperties = {
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

function getPrimaryActionLabel(
  phase: OAuthPopupPhase,
  hostIdentityLabel?: string | null,
): string | null {
  if (phase === 'prompt') {
    return hostIdentityLabel ? 'Start AI with your account' : 'Sign In';
  }

  if (phase === 'blocked' || phase === 'canceled' || phase === 'error') {
    return 'Retry';
  }

  return null;
}

function getDescription(
  phase: OAuthPopupPhase,
  hostIdentityLabel?: string | null,
): string {
  switch (phase) {
    case 'preparing':
      return 'Preparing a secure sign-in flow for this MCP server.';
    case 'waiting':
      return 'Continue in the popup window to connect your account.';
    case 'exchanging':
      return 'Finishing OAuth and storing your MCP connection.';
    case 'blocked':
      return 'Your browser blocked the sign-in window before the OAuth flow could start.';
    case 'canceled':
      return 'The sign-in window was closed before authentication completed.';
    case 'error':
      return 'Sign in could not be completed. Retry or cancel to keep using the widget.';
    case 'prompt':
    default:
      return hostIdentityLabel
        ? `This tool will try to connect as ${hostIdentityLabel} first, then fall back to interactive sign in only if needed.`
        : 'This tool requires authentication. Sign in to connect your account and enable AI to access your data.';
  }
}

export function OAuthPopup({
  serverName,
  phase,
  statusMessage,
  errorMessage,
  hostIdentityLabel,
  onPrimaryAction,
  onClose,
}: OAuthPopupProps) {
  const primaryActionLabel = getPrimaryActionLabel(phase, hostIdentityLabel);

  return (
    <div style={overlay} onClick={onClose}>
      <div style={popup} onClick={(e) => e.stopPropagation()}>
        <p style={titleStyle}>Sign in to {serverName}</p>
        <p style={description}>{getDescription(phase, hostIdentityLabel)}</p>
        {hostIdentityLabel && phase === 'prompt' && (
          <p style={statusText}>Current account: {hostIdentityLabel}</p>
        )}
        <div style={buttonRow}>
          {primaryActionLabel && onPrimaryAction && (
            <button style={primaryButton} onClick={onPrimaryAction} type="button">
              {primaryActionLabel}
            </button>
          )}
          <button style={cancelButton} onClick={onClose} type="button">
            Cancel
          </button>
        </div>
        {statusMessage && <p style={statusText}>{statusMessage}</p>}
        {errorMessage && <p style={errorText}>{errorMessage}</p>}
      </div>
    </div>
  );
}
