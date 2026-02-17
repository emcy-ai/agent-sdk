import React from 'react';
import * as styles from './styles';

export interface OAuthStubPopupProps {
  serverName: string;
  serverUrl: string;
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
  maxWidth: '300px',
  width: '90%',
  textAlign: 'center',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.15)',
};

const title: React.CSSProperties = {
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

const urlText: React.CSSProperties = {
  fontSize: '11px',
  color: styles.colors.textMuted,
  fontFamily: 'monospace',
  wordBreak: 'break-all',
  margin: '0 0 16px 0',
};

const closeButton: React.CSSProperties = {
  padding: '8px 20px',
  borderRadius: '8px',
  backgroundColor: styles.colors.primary,
  color: '#fff',
  border: 'none',
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: 500,
};

export function OAuthStubPopup({ serverName, serverUrl, onClose }: OAuthStubPopupProps) {
  return (
    <div style={overlay} onClick={onClose}>
      <div style={popup} onClick={(e) => e.stopPropagation()}>
        <p style={title}>Authenticate with {serverName}</p>
        <p style={description}>
          OAuth login for this MCP server would appear here. The browser would open
          the provider&apos;s login page and return an auth token.
        </p>
        <p style={urlText}>{serverUrl}</p>
        <button style={closeButton} onClick={onClose} type="button">
          Close
        </button>
      </div>
    </div>
  );
}
