import React from 'react';
import type { ChatMessage } from '../../core/types';
import * as styles from './styles';
import { MarkdownRenderer } from './MarkdownRenderer';
import { EnhancedToolCallCard } from './EnhancedToolCallCard';

export interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  switch (message.role) {
    case 'user':
      return (
        <div className="emcy-fadeInUp" style={styles.userBubble}>
          {message.content}
        </div>
      );

    case 'assistant':
      return (
        <div className="emcy-fadeInUp" style={styles.assistantBubble}>
          <MarkdownRenderer content={message.content} />
        </div>
      );

    case 'tool_call':
      return (
        <EnhancedToolCallCard
          toolName={message.toolName ?? 'Unknown Tool'}
          toolCallId={message.toolCallId ?? ''}
          status={message.toolCallStatus ?? 'calling'}
          startTime={message.toolCallStartTime ?? Date.now()}
          duration={message.toolCallDuration}
          result={message.toolResult}
          error={message.toolError}
        />
      );

    case 'tool_result':
      return null;

    default:
      return null;
  }
}
