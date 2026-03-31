import React, { useEffect, useRef } from 'react';
import type { ChatMessage, SseError } from '../../core/types';
import { MessageBubble } from './MessageBubble';
import { ThinkingIndicator } from './ThinkingIndicator';
import { StreamingCursor } from './StreamingCursor';
import { MarkdownRenderer } from './MarkdownRenderer';
import * as styles from './styles';

export interface MessageListProps {
  messages: ChatMessage[];
  streamingContent: string;
  welcomeMessage?: string;
  isThinking?: boolean;
  blockingError?: SseError | null;
}

export function MessageList({
  messages,
  streamingContent,
  welcomeMessage,
  isThinking,
  blockingError,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages or streaming content
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, isThinking]);

  // Filter out tool_result messages (internal only)
  const visibleMessages = messages.filter((m) => m.role !== 'tool_result');

  // Check if there's an active tool call (calling status)
  const hasActiveToolCall = messages.some(
    (m) => m.role === 'tool_call' && m.toolCallStatus === 'calling',
  );

  // Show thinking indicator when thinking, no streaming content, and no active tool call
  const showThinking = isThinking && !streamingContent && !hasActiveToolCall;

  if (blockingError && visibleMessages.length === 0 && !streamingContent && !showThinking) {
    const isAuthError = blockingError.code === 'workspace_config_auth_error';

    return (
      <div style={styles.messageList}>
        <div style={styles.welcomeContainer}>
          <div style={styles.blockingStateCard} role="alert" aria-live="assertive">
            <span style={styles.blockingStateEyebrow}>Configuration error</span>
            <h4 style={styles.blockingStateTitle}>
              {isAuthError ? 'Embedded workspace authentication failed' : 'Unable to load workspace'}
            </h4>
            <p style={styles.blockingStateMessage}>{blockingError.message}</p>
            <p style={styles.blockingStateHint}>
              {isAuthError
                ? 'Update the API key for this embedded workspace and reload the page.'
                : 'Check the workspace configuration and reload the page.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (visibleMessages.length === 0 && !streamingContent && !showThinking) {
    return (
      <div style={styles.messageList}>
        <div style={styles.welcomeContainer}>
          <p style={styles.welcomeText}>
            {welcomeMessage || 'How can I help you today?'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.messageList}>
      {visibleMessages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}

      {/* Thinking indicator */}
      {showThinking && <ThinkingIndicator />}

      {/* Streaming content shown as a partial assistant bubble */}
      {streamingContent && (
        <div className="emcy-fadeInUp" style={styles.streamingBubble}>
          <MarkdownRenderer content={streamingContent} />
          <StreamingCursor />
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
