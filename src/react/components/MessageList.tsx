import React, { useCallback, useEffect, useRef, useState } from 'react';
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

const BOTTOM_THRESHOLD = 40;

export function MessageList({
  messages,
  streamingContent,
  welcomeMessage,
  isThinking,
  blockingError,
}: MessageListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [showScrollHint, setShowScrollHint] = useState(false);

  const isNearBottom = useCallback(() => {
    const el = listRef.current;
    if (!el) {
      return true;
    }

    return el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD;
  }, []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Track user scroll intent
  const handleScroll = useCallback(() => {
    const nearBottom = isNearBottom();
    pinnedRef.current = nearBottom;
    setShowScrollHint(!nearBottom);
  }, [isNearBottom]);

  // Auto-scroll when pinned and content changes
  useEffect(() => {
    if (pinnedRef.current) {
      scrollToBottom();
    }
  }, [messages, streamingContent, isThinking, scrollToBottom]);

  // Pin to bottom when a new user message is sent
  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === 'user') {
      pinnedRef.current = true;
      setShowScrollHint(false);
      scrollToBottom();
    }
  }, [messages, scrollToBottom]);

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
    <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div ref={listRef} style={styles.messageList} onScroll={handleScroll}>
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

      {/* "Scroll to bottom" hint when user has scrolled up */}
      {showScrollHint ? (
        <button
          type="button"
          onClick={() => {
            pinnedRef.current = true;
            setShowScrollHint(false);
            scrollToBottom();
          }}
          style={{
            position: 'absolute',
            bottom: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '6px 14px',
            borderRadius: 20,
            border: 'none',
            background: 'rgba(15, 23, 42, 0.88)',
            color: '#e2e8f0',
            fontSize: 12,
            cursor: 'pointer',
            backdropFilter: 'blur(8px)',
            boxShadow: '0 4px 16px -4px rgba(0,0,0,0.3)',
            zIndex: 10,
            transition: 'opacity 200ms',
          }}
        >
          ↓ New messages
        </button>
      ) : null}
    </div>
  );
}
