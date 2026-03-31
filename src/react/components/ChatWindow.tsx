import React from 'react';
import type { ChatMessage } from '../../core/types';
import type { SseError } from '../../core/types';
import { StyleInjector } from './AnimationStyles';
import { McpServerStatusBar } from './McpServerStatusBar';
import type { McpServerStatus } from './McpServerStatusBar';
import { MessageList } from './MessageList';
import { InputArea } from './InputArea';
import { PlusIcon, CloseIcon } from './Icons';
import * as styles from './styles';

export interface ChatWindowProps {
  messages: ChatMessage[];
  streamingContent: string;
  isLoading: boolean;
  isThinking?: boolean;
  error: SseError | null;
  title?: string;
  welcomeMessage?: string;
  placeholder?: string;
  mcpServers?: McpServerStatus[];
  mcpAuthButtonLabel?: string;
  onSend: (message: string) => void;
  onClose?: () => void;
  onNewConversation?: () => void;
  onMcpAuthClick?: (serverUrl: string, serverName: string) => void;
  onMcpSignOutClick?: (serverUrl: string, serverName: string) => void;
  /** 'floating' = fixed card (default), 'inline' = fill container */
  variant?: 'floating' | 'inline';
}

export function ChatWindow({
  messages,
  streamingContent,
  isLoading,
  isThinking,
  error,
  title = 'AI Assistant',
  welcomeMessage,
  placeholder,
  mcpServers,
  mcpAuthButtonLabel,
  onSend,
  onClose,
  onNewConversation,
  onMcpAuthClick,
  onMcpSignOutClick,
  variant = 'floating',
}: ChatWindowProps) {
  const containerStyle = variant === 'inline' ? styles.chatWindowInline : styles.chatWindow;
  const blockingError = error && error.code.startsWith('workspace_config_') ? error : null;

  return (
    <div style={containerStyle}>
      <StyleInjector />

      {/* Header */}
      <div style={styles.chatHeader}>
        <h3 style={styles.chatHeaderTitle}>{title}</h3>
        <div style={styles.headerActions}>
          {onNewConversation && (
            <button
              style={styles.iconButton}
              onClick={onNewConversation}
              type="button"
              aria-label="New conversation"
              title="New conversation"
            >
              <PlusIcon size={16} color={styles.colors.textSecondary} />
            </button>
          )}
          {onClose && (
            <button
              style={styles.iconButton}
              onClick={onClose}
              type="button"
              aria-label="Close"
              title="Close"
            >
              <CloseIcon size={16} color={styles.colors.textSecondary} />
            </button>
          )}
        </div>
      </div>

      {/* MCP Server Status */}
      <McpServerStatusBar
        servers={mcpServers || []}
        authButtonLabel={mcpAuthButtonLabel}
        onAuthClick={onMcpAuthClick}
        onSignOutClick={onMcpSignOutClick}
      />

      {/* Messages */}
      <MessageList
        messages={messages}
        streamingContent={streamingContent}
        welcomeMessage={welcomeMessage}
        isThinking={isThinking}
        blockingError={blockingError}
      />

      {/* Error banner */}
      {error && !blockingError && (
        <div style={styles.errorCard}>
          {error.message || 'Something went wrong. Please try again.'}
        </div>
      )}

      {/* Input */}
      <InputArea
        onSend={onSend}
        disabled={isLoading || Boolean(blockingError)}
        placeholder={
          blockingError
            ? 'Embedded workspace unavailable'
            : placeholder
        }
      />

      {/* Powered by */}
      <div style={styles.poweredBy}>
        Powered by <a href="https://emcy.ai" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>Emcy</a>
      </div>
    </div>
  );
}
