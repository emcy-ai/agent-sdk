import React from 'react';
import * as styles from './styles';

export interface McpServerStatus {
  url: string;
  name: string;
  authStatus: 'connected' | 'needs_auth';
}

export interface McpServerStatusBarProps {
  servers: McpServerStatus[];
  onAuthClick?: (serverUrl: string, serverName: string) => void;
}

const statusBarContainer: React.CSSProperties = {
  padding: '8px 16px',
  borderBottom: `1px solid ${styles.colors.border}`,
  backgroundColor: styles.colors.bgSecondary,
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  flexShrink: 0,
};

const serverRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  fontSize: '12px',
};

const serverName: React.CSSProperties = {
  color: styles.colors.text,
  fontWeight: 500,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
};

const statusBadgeConnected: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 500,
  padding: '2px 8px',
  borderRadius: '9999px',
  backgroundColor: '#dcfce7',
  color: '#166534',
  flexShrink: 0,
};

const statusBadgeNeedsAuth: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 500,
  padding: '2px 8px',
  borderRadius: '9999px',
  backgroundColor: '#fef3c7',
  color: '#92400e',
  cursor: 'pointer',
  border: 'none',
  flexShrink: 0,
};

export function McpServerStatusBar({ servers, onAuthClick }: McpServerStatusBarProps) {
  if (!servers || servers.length === 0) return null;

  return (
    <div style={statusBarContainer}>
      {servers.map((server) => (
        <div key={server.url} style={serverRow}>
          <span style={serverName}>{server.name}</span>
          {server.authStatus === 'connected' ? (
            <span style={statusBadgeConnected}>Connected</span>
          ) : (
            <button
              style={statusBadgeNeedsAuth}
              onClick={() => onAuthClick?.(server.url, server.name)}
              type="button"
            >
              Needs Auth
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
