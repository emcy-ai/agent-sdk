import React, { useState, useEffect } from 'react';
import { colors } from './styles';
import { SpinnerIcon, CheckCircleIcon, XCircleIcon, ChevronIcon } from './Icons';

export interface EnhancedToolCallCardProps {
  toolName: string;
  toolCallId: string;
  status: 'calling' | 'completed' | 'error';
  startTime: number;
  duration?: number;
  result?: string;
  error?: string;
}

function formatDuration(ms: number) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatToolDetails(value?: string) {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object') {
      return JSON.stringify(parsed, null, 2);
    }
  } catch {
    // Keep raw output when the payload is plain text.
  }

  return value;
}

function buildErrorDetails(error?: string) {
  if (!error) return null;

  if (error.toLowerCase().includes('fetch')) {
    return `${error}\n\nTip: Ensure MCP Server URL is set correctly in Dashboard -> MCP Servers -> Settings.`;
  }

  return error;
}

const statusColors = {
  calling: { accent: '#2563eb', bg: '#eff6ff', text: '#1d4ed8' },
  completed: { accent: '#16a34a', bg: '#f0fdf4', text: '#166534' },
  error: { accent: '#dc2626', bg: '#fef2f2', text: '#991b1b' },
};

export function EnhancedToolCallCard({
  toolName,
  toolCallId: _toolCallId,
  status,
  startTime,
  duration,
  result,
  error,
}: EnhancedToolCallCardProps) {
  const [elapsed, setElapsed] = useState(0);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (status !== 'calling') return;
    const start = startTime;
    const tick = () => setElapsed(Date.now() - start);
    tick();
    const interval = setInterval(tick, 100);
    return () => clearInterval(interval);
  }, [status, startTime]);

  const sc = statusColors[status];
  const displayDuration = status === 'calling' ? elapsed : (duration ?? 0);
  const durationStr = formatDuration(displayDuration);
  const detailText =
    status === 'error' ? buildErrorDetails(error) : formatToolDetails(result);
  const hasExpandable = Boolean(detailText);

  const statusIcon =
    status === 'calling' ? (
      <SpinnerIcon size={12} color={sc.accent} />
    ) : status === 'completed' ? (
      <CheckCircleIcon size={12} color={sc.accent} />
    ) : (
      <XCircleIcon size={12} color={sc.accent} />
    );

  return (
    <div
      className="emcy-fadeInUp"
      style={{
        maxWidth: '92%',
        alignSelf: 'flex-start',
        flexShrink: 0,
      }}
    >
      {/* Compact single-line row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 0',
        }}
      >
        {/* Status icon */}
        {statusIcon}

        {/* Tool name */}
        <span
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: colors.textSecondary,
            lineHeight: 1.3,
            minWidth: 0,
            wordBreak: 'break-word',
          }}
        >
          {toolName}
        </span>

        {/* Duration */}
        <span style={{ fontSize: 11, color: colors.textMuted, flexShrink: 0 }}>
          {durationStr}
        </span>

        {/* Expand toggle */}
        {hasExpandable ? (
          <button
            onClick={() => setExpanded(!expanded)}
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? 'Hide details' : 'Show details'}
            style={{
              width: 20,
              height: 20,
              borderRadius: 6,
              border: 'none',
              backgroundColor: expanded ? sc.bg : 'transparent',
              color: colors.textMuted,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              cursor: 'pointer',
              padding: 0,
              transition: 'background-color 0.15s',
            }}
          >
            <ChevronIcon size={12} direction={expanded ? 'up' : 'down'} color={colors.textMuted} />
          </button>
        ) : null}
      </div>

      {/* Expandable detail pane */}
      {hasExpandable && expanded ? (
        <div
          style={{
            marginTop: 4,
            marginBottom: 8,
            animation: 'emcy-slideDown 0.2s ease-out',
          }}
        >
          <pre
            style={{
              fontSize: 11,
              fontFamily: '"SF Mono", "Fira Code", monospace',
              color: colors.textSecondary,
              backgroundColor: colors.bgTertiary,
              border: `1px solid ${colors.border}`,
              padding: '8px 10px',
              borderRadius: 8,
              margin: 0,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              lineHeight: 1.5,
              maxHeight: 200,
              overflowY: 'auto',
            }}
          >
            {detailText}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
