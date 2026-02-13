import React from 'react';
import * as styles from './styles';

export interface ToolCallCardProps {
  toolName: string;
  status: 'calling' | 'done';
}

/**
 * Visual indicator for an in-progress or completed tool call.
 */
export function ToolCallCard({ toolName, status }: ToolCallCardProps) {
  return (
    <div style={status === 'done' ? styles.toolResultCard : styles.toolCallCard}>
      <ToolIcon />
      <span>
        {status === 'calling' ? `Calling ${toolName}...` : `${toolName} completed`}
      </span>
    </div>
  );
}

function ToolIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}
