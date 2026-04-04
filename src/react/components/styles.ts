import type { CSSProperties } from 'react';

/**
 * All styles are defined as CSSProperties objects for zero-dependency styling.
 * Consumers can override via className props or CSS custom properties.
 */

export const colors = {
  primary: '#18181b',
  primaryHover: '#27272a',
  bg: '#ffffff',
  bgSecondary: '#fafafa',
  bgTertiary: '#f4f4f5',
  text: '#09090b',
  textSecondary: '#52525b',
  textMuted: '#71717a',
  border: '#e4e4e7',
  userBubble: '#18181b',
  userText: '#ffffff',
  assistantBubble: '#fafafa',
  assistantText: '#09090b',
  toolBg: '#fafafa',
  toolText: '#18181b',
  toolBorder: '#e4e4e7',
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
  boxShadow: '0 12px 32px rgba(24,24,27,0.18)',
  zIndex: 9998,
  transition: 'background-color 0.2s, transform 0.2s, box-shadow 0.2s',
};

/** Floating popup variant: fixed overlay for mode="floating" */
export const chatWindow: CSSProperties = {
  position: 'fixed',
  bottom: '96px',
  right: '24px',
  width: '400px',
  height: '600px',
  maxHeight: 'calc(100vh - 120px)',
  minHeight: 0,
  borderRadius: '16px',
  backgroundColor: colors.bg,
  border: `1px solid ${colors.border}`,
  boxShadow: '0 24px 80px rgba(15,23,42,0.14), 0 6px 24px rgba(15,23,42,0.08)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  zIndex: 9999,
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
};

/**
 * Inline variant: responsive, fills its container.
 * Use mode="inline" when embedding in a dashboard, sidebar, or any layout.
 * Parent container should have defined dimensions (e.g. height: 400px, flex: 1, or height: 100%).
 */
export const chatWindowInline: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  backgroundColor: colors.bg,
  border: 'none',
  borderRadius: 0,
  boxShadow: 'none',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
};

export const chatHeader: CSSProperties = {
  padding: '10px 12px',
  borderBottom: `1px solid ${colors.border}`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  backgroundColor: colors.bg,
  flexShrink: 0,
};

export const chatHeaderTitle: CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: colors.text,
  margin: 0,
  letterSpacing: '-0.015em',
};

export const headerActions: CSSProperties = {
  display: 'flex',
  gap: '6px',
};

export const iconButton: CSSProperties = {
  backgroundColor: colors.bgSecondary,
  border: `1px solid ${colors.border}`,
  cursor: 'pointer',
  padding: '6px',
  borderRadius: '10px',
  color: colors.textSecondary,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background-color 0.15s, border-color 0.15s',
};

export const messageList: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  padding: '10px 12px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
};

export const welcomeContainer: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 1,
  padding: '24px',
  textAlign: 'center',
};

export const welcomeText: CSSProperties = {
  fontSize: '13px',
  color: colors.textMuted,
  lineHeight: 1.6,
  maxWidth: '240px',
};

export const blockingStateCard: CSSProperties = {
  width: '100%',
  maxWidth: '420px',
  padding: '20px',
  borderRadius: '16px',
  backgroundColor: colors.errorBg,
  border: `1px solid ${colors.errorBorder}`,
  boxShadow: '0 8px 24px rgba(153, 27, 27, 0.08)',
};

export const blockingStateEyebrow: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '4px 10px',
  borderRadius: '999px',
  backgroundColor: '#fee2e2',
  color: colors.errorText,
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
};

export const blockingStateTitle: CSSProperties = {
  margin: '14px 0 8px',
  fontSize: '20px',
  lineHeight: 1.3,
  fontWeight: 700,
  color: colors.errorText,
};

export const blockingStateMessage: CSSProperties = {
  margin: 0,
  fontSize: '14px',
  lineHeight: 1.6,
  color: colors.errorText,
  wordBreak: 'break-word',
};

export const blockingStateHint: CSSProperties = {
  margin: '12px 0 0',
  fontSize: '13px',
  lineHeight: 1.6,
  color: '#7f1d1d',
};

export const userBubble: CSSProperties = {
  maxWidth: '80%',
  flexShrink: 0,
  padding: '9px 12px',
  borderRadius: '16px 16px 4px 16px',
  backgroundColor: colors.userBubble,
  color: colors.userText,
  alignSelf: 'flex-end',
  fontSize: '13px',
  lineHeight: 1.5,
  wordBreak: 'break-word',
};

export const assistantBubble: CSSProperties = {
  maxWidth: '85%',
  flexShrink: 0,
  padding: '9px 12px',
  borderRadius: '16px 16px 16px 4px',
  backgroundColor: colors.assistantBubble,
  color: colors.assistantText,
  border: `1px solid ${colors.border}`,
  alignSelf: 'flex-start',
  fontSize: '13px',
  lineHeight: 1.5,
  wordBreak: 'break-word',
};

export const streamingBubble: CSSProperties = {
  ...assistantBubble,
};

export const toolCallCard: CSSProperties = {
  maxWidth: '100%',
  padding: '8px 10px',
  borderRadius: '14px',
  backgroundColor: colors.toolBg,
  border: `1px solid ${colors.toolBorder}`,
  color: colors.toolText,
  alignSelf: 'flex-start',
  fontSize: '12px',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
};

export const toolResultCard: CSSProperties = {
  ...toolCallCard,
  backgroundColor: colors.bgTertiary,
  border: `1px solid ${colors.border}`,
  color: colors.textSecondary,
};

export const errorCard: CSSProperties = {
  padding: '10px 14px',
  margin: '0 12px',
  borderRadius: '12px',
  backgroundColor: colors.errorBg,
  border: `1px solid ${colors.errorBorder}`,
  color: colors.errorText,
  fontSize: '13px',
  flexShrink: 0,
};

export const inputArea: CSSProperties = {
  padding: '10px 12px 12px',
  borderTop: `1px solid ${colors.border}`,
  display: 'flex',
  gap: '10px',
  alignItems: 'flex-end',
  backgroundColor: colors.bg,
  flexShrink: 0,
};

export const textInput: CSSProperties = {
  flex: 1,
  padding: '9px 12px',
  borderRadius: '12px',
  border: `1px solid ${colors.border}`,
  backgroundColor: colors.bgSecondary,
  fontSize: '13px',
  color: colors.text,
  outline: 'none',
  resize: 'none',
  fontFamily: 'inherit',
  lineHeight: 1.5,
  maxHeight: '120px',
};

export const sendButton: CSSProperties = {
  width: '36px',
  height: '36px',
  padding: 0,
  borderRadius: '10px',
  backgroundColor: colors.primary,
  color: '#fff',
  border: 'none',
  cursor: 'pointer',
  fontSize: '13px',
  fontWeight: 500,
  flexShrink: 0,
  transition: 'background-color 0.15s, transform 0.15s, box-shadow 0.15s',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxShadow: '0 8px 18px rgba(24,24,27,0.18)',
};

export const sendButtonDisabled: CSSProperties = {
  ...sendButton,
  opacity: 0.4,
  cursor: 'not-allowed',
};

export const poweredBy: CSSProperties = {
  textAlign: 'center',
  padding: '0 12px 8px',
  fontSize: '10px',
  color: colors.textMuted,
  letterSpacing: '0.02em',
};
