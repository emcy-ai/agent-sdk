import React from 'react';
import * as styles from './styles';

export interface McpServerStatus {
  url: string;
  name: string;
  authStatus: 'connected' | 'needs_auth';
  canSignOut?: boolean;
}

export interface McpServerStatusBarProps {
  servers: McpServerStatus[];
  onAuthClick?: (serverUrl: string, serverName: string) => void;
  onSignOutClick?: (serverUrl: string, serverName: string) => void;
  authButtonLabel?: string;
}

const statusBarContainer: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: `1px solid ${styles.colors.border}`,
  backgroundColor: styles.colors.bgSecondary,
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  flexWrap: 'wrap',
  flexShrink: 0,
};

const statusBarLabel: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: styles.colors.textMuted,
};

const serverChip: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  border: `1px solid ${styles.colors.border}`,
  borderRadius: '999px',
  backgroundColor: styles.colors.bg,
  padding: '4px 6px 4px 10px',
  gap: '8px',
  minHeight: '30px',
};

const serverName: React.CSSProperties = {
  color: styles.colors.text,
  fontWeight: 500,
  fontSize: '12px',
  lineHeight: 1.2,
  maxWidth: '160px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const statusBadgeConnected: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 500,
  padding: '4px 8px',
  borderRadius: '9999px',
  backgroundColor: '#dcfce7',
  color: '#166534',
  flexShrink: 0,
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
};

const serverActions: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  flexShrink: 0,
};

const statusDotConnected: React.CSSProperties = {
  width: '6px',
  height: '6px',
  borderRadius: '999px',
  backgroundColor: '#16a34a',
  boxShadow: '0 0 0 3px rgba(22,163,74,0.12)',
};

const statusBadgeNeedsAuth: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 500,
  padding: '4px 8px',
  borderRadius: '9999px',
  backgroundColor: '#fef3c7',
  color: '#92400e',
  cursor: 'pointer',
  border: 'none',
  flexShrink: 0,
};

const signOutButton: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 500,
  padding: '4px 8px',
  borderRadius: '9999px',
  backgroundColor: 'transparent',
  color: styles.colors.textSecondary,
  cursor: 'pointer',
  border: `1px solid ${styles.colors.border}`,
  flexShrink: 0,
};

export function McpServerStatusBar({
  servers,
  onAuthClick,
  onSignOutClick,
  authButtonLabel = 'Needs Auth',
}: McpServerStatusBarProps) {
  if (!servers || servers.length === 0) return null;

  return (
    <div style={statusBarContainer}>
      <span style={statusBarLabel}>Connections</span>
      {servers.map((server) => (
        <div key={server.url} style={serverChip}>
          <span style={serverName}>{server.name}</span>
          {server.authStatus === 'connected' ? (
            <div style={serverActions}>
              <span style={statusBadgeConnected}>
                <span aria-hidden="true" style={statusDotConnected} />
                Connected
              </span>
              {server.canSignOut && (
                <button
                  style={signOutButton}
                  onClick={() => onSignOutClick?.(server.url, server.name)}
                  type="button"
                >
                  Sign Out
                </button>
              )}
            </div>
          ) : (
            <button
              style={statusBadgeNeedsAuth}
              onClick={() => onAuthClick?.(server.url, server.name)}
              type="button"
            >
              {authButtonLabel}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
