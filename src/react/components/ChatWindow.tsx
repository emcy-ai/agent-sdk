import React from 'react';
import type { ChatMessage } from '../../core/types';
import type { SseError } from '../../core/types';
import { StyleInjector } from './AnimationStyles';
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
  onSend: (message: string) => void;
  onClose?: () => void;
  onNewConversation?: () => void;
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
  onSend,
  onClose,
  onNewConversation,
}: ChatWindowProps) {
  return (
    <div style={styles.chatWindow}>
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

      {/* Messages */}
      <MessageList
        messages={messages}
        streamingContent={streamingContent}
        welcomeMessage={welcomeMessage}
        isThinking={isThinking}
      />

      {/* Error banner */}
      {error && (
        <div style={styles.errorCard}>
          {error.message || 'Something went wrong. Please try again.'}
        </div>
      )}

      {/* Input */}
      <InputArea
        onSend={onSend}
        disabled={isLoading}
        placeholder={placeholder}
      />

      {/* Powered by */}
      <div style={styles.poweredBy}>
        Powered by <a href="https://emcy.ai" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>Emcy</a>
      </div>
    </div>
  );
}
