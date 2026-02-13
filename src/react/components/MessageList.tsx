import React, { useEffect, useRef } from 'react';
import type { ChatMessage } from '../../core/types';
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
}

export function MessageList({ messages, streamingContent, welcomeMessage, isThinking }: MessageListProps) {
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
