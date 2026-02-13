import type { CSSProperties } from 'react';

/**
 * All styles are defined as CSSProperties objects for zero-dependency styling.
 * Consumers can override via className props or CSS custom properties.
 */

export const colors = {
  primary: '#6366f1',
  primaryHover: '#4f46e5',
  bg: '#ffffff',
  bgSecondary: '#f9fafb',
  bgTertiary: '#f3f4f6',
  text: '#111827',
  textSecondary: '#6b7280',
  textMuted: '#9ca3af',
  border: '#e5e7eb',
  userBubble: '#6366f1',
  userText: '#ffffff',
  assistantBubble: '#f3f4f6',
  assistantText: '#111827',
  toolBg: '#fef3c7',
  toolText: '#92400e',
  toolBorder: '#fcd34d',
  errorBg: '#fef2f2',
  errorText: '#991b1b',
  errorBorder: '#fecaca',
};

export const widgetButton: CSSProperties = {
  position: 'fixed',
  bottom: '24px',
  right: '24px',
  width: '56px',
  height: '56px',
  borderRadius: '50%',
  backgroundColor: colors.primary,
  color: '#fff',
  border: 'none',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxShadow: '0 4px 16px rgba(99,102,241,0.35)',
  zIndex: 9998,
  transition: 'background-color 0.2s, transform 0.2s, box-shadow 0.2s',
};

export const chatWindow: CSSProperties = {
  position: 'fixed',
  bottom: '96px',
  right: '24px',
  width: '400px',
  height: '600px',
  maxHeight: 'calc(100vh - 120px)',
  borderRadius: '16px',
  backgroundColor: colors.bg,
  border: `1px solid ${colors.border}`,
  boxShadow: '0 12px 40px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.06)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  zIndex: 9999,
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
};

export const chatHeader: CSSProperties = {
  padding: '16px 20px',
  borderBottom: `1px solid ${colors.border}`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  backgroundColor: colors.bg,
  flexShrink: 0,
};

export const chatHeaderTitle: CSSProperties = {
  fontSize: '16px',
  fontWeight: 600,
  color: colors.text,
  margin: 0,
};

export const headerActions: CSSProperties = {
  display: 'flex',
  gap: '4px',
};

export const iconButton: CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '6px',
  borderRadius: '8px',
  color: colors.textSecondary,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background-color 0.15s',
};

export const messageList: CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};

export const welcomeContainer: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 1,
  padding: '32px',
  textAlign: 'center',
};

export const welcomeText: CSSProperties = {
  fontSize: '15px',
  color: colors.textSecondary,
  lineHeight: 1.5,
  maxWidth: '280px',
};

export const userBubble: CSSProperties = {
  maxWidth: '80%',
  padding: '10px 14px',
  borderRadius: '16px 16px 4px 16px',
  backgroundColor: colors.userBubble,
  color: colors.userText,
  alignSelf: 'flex-end',
  fontSize: '14px',
  lineHeight: 1.5,
  wordBreak: 'break-word',
  boxShadow: '0 1px 3px rgba(99,102,241,0.2)',
};

export const assistantBubble: CSSProperties = {
  maxWidth: '85%',
  padding: '10px 14px',
  borderRadius: '16px 16px 16px 4px',
  backgroundColor: colors.assistantBubble,
  color: colors.assistantText,
  alignSelf: 'flex-start',
  fontSize: '14px',
  lineHeight: 1.5,
  wordBreak: 'break-word',
};

export const streamingBubble: CSSProperties = {
  ...assistantBubble,
};

export const toolCallCard: CSSProperties = {
  maxWidth: '80%',
  padding: '8px 12px',
  borderRadius: '8px',
  backgroundColor: colors.toolBg,
  border: `1px solid ${colors.toolBorder}`,
  color: colors.toolText,
  alignSelf: 'flex-start',
  fontSize: '13px',
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
};

export const toolResultCard: CSSProperties = {
  ...toolCallCard,
  backgroundColor: colors.bgTertiary,
  border: `1px solid ${colors.border}`,
  color: colors.textSecondary,
};

export const errorCard: CSSProperties = {
  padding: '10px 14px',
  margin: '0 16px',
  borderRadius: '8px',
  backgroundColor: colors.errorBg,
  border: `1px solid ${colors.errorBorder}`,
  color: colors.errorText,
  fontSize: '13px',
  flexShrink: 0,
};

export const inputArea: CSSProperties = {
  padding: '12px 16px',
  borderTop: `1px solid ${colors.border}`,
  display: 'flex',
  gap: '8px',
  alignItems: 'flex-end',
  backgroundColor: colors.bg,
  flexShrink: 0,
};

export const textInput: CSSProperties = {
  flex: 1,
  padding: '10px 14px',
  borderRadius: '12px',
  border: `1px solid ${colors.border}`,
  backgroundColor: colors.bgSecondary,
  fontSize: '14px',
  color: colors.text,
  outline: 'none',
  resize: 'none',
  fontFamily: 'inherit',
  lineHeight: 1.5,
  maxHeight: '120px',
};

export const sendButton: CSSProperties = {
  padding: '10px 16px',
  borderRadius: '12px',
  backgroundColor: colors.primary,
  color: '#fff',
  border: 'none',
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: 500,
  flexShrink: 0,
  transition: 'background-color 0.2s, transform 0.1s',
};

export const sendButtonDisabled: CSSProperties = {
  ...sendButton,
  opacity: 0.5,
  cursor: 'not-allowed',
};

export const poweredBy: CSSProperties = {
  textAlign: 'center',
  padding: '6px',
  fontSize: '11px',
  color: colors.textMuted,
};
