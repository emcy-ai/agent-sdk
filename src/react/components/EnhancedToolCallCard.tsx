import React, { useState, useEffect } from 'react';
import { colors } from './styles';
import { getToolIcon, SpinnerIcon, CheckCircleIcon, XCircleIcon, ChevronIcon } from './Icons';

export interface EnhancedToolCallCardProps {
  toolName: string;
  toolCallId: string;
  status: 'calling' | 'completed' | 'error';
  startTime: number;
  duration?: number;
  result?: string;
  error?: string;
}

const cardColors = {
  calling: {
    surface: '#ffffff',
    border: '#dbeafe',
    accent: '#2563eb',
    mutedSurface: '#eff6ff',
    mutedText: '#1d4ed8',
    detailSurface: '#f8fbff',
    detailText: '#1e3a8a',
    shadow: 'rgba(37, 99, 235, 0.12)',
  },
  completed: {
    surface: '#ffffff',
    border: '#bbf7d0',
    accent: '#16a34a',
    mutedSurface: '#f0fdf4',
    mutedText: '#166534',
    detailSurface: '#f6fef8',
    detailText: '#14532d',
    shadow: 'rgba(22, 163, 74, 0.12)',
  },
  error: {
    surface: '#ffffff',
    border: '#fecaca',
    accent: '#dc2626',
    mutedSurface: '#fef2f2',
    mutedText: '#991b1b',
    detailSurface: '#fff5f5',
    detailText: '#7f1d1d',
    shadow: 'rgba(220, 38, 38, 0.12)',
  },
};

function formatDuration(ms: number) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function shortToolCallId(toolCallId: string) {
  return toolCallId ? `#${toolCallId.slice(0, 8)}` : null;
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
    return `${error}\n\nTip: Ensure MCP Server URL is set to http://localhost:3001/mcp (or your MCP server URL) in Dashboard -> MCP Servers -> [server] -> Settings.`;
  }

  return error;
}

export function EnhancedToolCallCard({
  toolName,
  toolCallId,
  status,
  startTime,
  duration,
  result,
  error,
}: EnhancedToolCallCardProps) {
  const [elapsed, setElapsed] = useState(0);
  const [expanded, setExpanded] = useState(false);

  // Elapsed timer while calling
  useEffect(() => {
    if (status !== 'calling') return;
    const start = startTime;
    const tick = () => setElapsed(Date.now() - start);
    tick();
    const interval = setInterval(tick, 100);
    return () => clearInterval(interval);
  }, [status, startTime]);

  const c = cardColors[status];
  const ToolIcon = getToolIcon(toolName);
  const displayDuration = status === 'calling' ? elapsed : (duration ?? 0);
  const durationStr = formatDuration(displayDuration);
  const detailText =
    status === 'error' ? buildErrorDetails(error) : formatToolDetails(result);
  const hasExpandable = Boolean(detailText);
  const runId = shortToolCallId(toolCallId);
  const statusLabel =
    status === 'calling' ? 'Running' : status === 'completed' ? 'Completed' : 'Failed';
  const statusText =
    status === 'calling'
      ? `Working for ${durationStr}`
      : status === 'completed'
        ? `Completed in ${durationStr}`
        : error?.toLowerCase().includes('fetch')
          ? `Network error after ${durationStr}`
          : `Failed after ${durationStr}`;
  const detailLabel = status === 'error' ? 'error' : 'result';
  const statusIcon =
    status === 'calling' ? (
      <SpinnerIcon size={18} color={c.accent} />
    ) : status === 'completed' ? (
      <CheckCircleIcon size={18} color={c.accent} />
    ) : (
      <XCircleIcon size={18} color={c.accent} />
    );

  return (
    <div
      className="emcy-fadeInUp"
      style={{
        width: '100%',
        maxWidth: '92%',
        flexShrink: 0,
        borderRadius: 16,
        backgroundColor: c.surface,
        border: `1px solid ${c.border}`,
        alignSelf: 'flex-start',
        overflow: 'hidden',
        boxShadow: `0 14px 30px ${c.shadow}`,
        position: 'relative',
        transition: 'border-color 0.2s, box-shadow 0.2s, transform 0.2s',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(135deg, ${c.mutedSurface} 0%, rgba(255,255,255,0) 45%)`,
          pointerEvents: 'none',
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: 3,
          background: `linear-gradient(90deg, ${c.accent} 0%, ${c.border} 100%)`,
        }}
      />

      <div
        style={{
          position: 'relative',
          padding: '14px 16px 12px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            backgroundColor: c.mutedSurface,
            border: `1px solid ${c.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.7)',
          }}
        >
          <ToolIcon size={18} color={c.accent} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: colors.textMuted,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              marginBottom: 6,
            }}
          >
            Tool call
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: colors.text,
                lineHeight: 1.3,
                minWidth: 0,
                wordBreak: 'break-word',
              }}
            >
              {toolName}
            </div>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '3px 10px',
                borderRadius: 999,
                backgroundColor: c.mutedSurface,
                border: `1px solid ${c.border}`,
                color: c.mutedText,
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {statusLabel}
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 6,
              marginTop: 8,
            }}
          >
            {runId && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '2px 8px',
                  borderRadius: 999,
                  backgroundColor: colors.bgSecondary,
                  border: `1px solid ${colors.border}`,
                  color: colors.textSecondary,
                  fontSize: 11,
                  fontFamily: '"SF Mono", "Fira Code", monospace',
                }}
              >
                {runId}
              </span>
            )}
            <span style={{ fontSize: 12, color: colors.textSecondary }}>{statusText}</span>
          </div>
        </div>

        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 999,
            backgroundColor: c.mutedSurface,
            border: `1px solid ${c.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {statusIcon}
        </div>
      </div>

      <div
        style={{
          position: 'relative',
          margin: '0 16px 12px',
          height: 6,
          borderRadius: 999,
          backgroundColor: c.mutedSurface,
          border: `1px solid ${c.border}`,
          overflow: 'hidden',
        }}
      >
        {status === 'calling' ? (
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              width: '35%',
              height: '100%',
              background: `linear-gradient(90deg, ${c.accent} 0%, ${c.mutedText} 100%)`,
              animation: 'emcy-progressIndeterminate 1.5s ease-in-out infinite',
              borderRadius: 999,
            }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              background: `linear-gradient(90deg, ${c.accent} 0%, ${c.mutedText} 100%)`,
            }}
          />
        )}
      </div>

      {hasExpandable && (
        <div
          style={{
            position: 'relative',
            borderTop: `1px solid ${c.border}`,
            backgroundColor: c.mutedSurface,
          }}
        >
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              width: '100%',
              padding: '10px 16px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              color: colors.text,
            }}
            type="button"
            aria-expanded={expanded}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                minWidth: 0,
              }}
            >
              <ChevronIcon size={14} direction={expanded ? 'up' : 'down'} color={colors.textSecondary} />
              <span style={{ fontSize: 12, fontWeight: 600 }}>
                {expanded ? `Hide ${detailLabel}` : `Show ${detailLabel}`}
              </span>
            </span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '2px 8px',
                borderRadius: 999,
                backgroundColor: c.surface,
                border: `1px solid ${c.border}`,
                color: colors.textSecondary,
                fontSize: 11,
              }}
            >
              {status === 'error' ? 'Details' : 'Output'}
            </span>
          </button>

          {expanded && (
            <div
              style={{
                padding: '0 16px 16px',
                maxHeight: 220,
                overflowY: 'auto',
                animation: 'emcy-slideDown 0.2s ease-out',
              }}
            >
              <div
                style={{
                  marginBottom: 8,
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: colors.textMuted,
                }}
              >
                {status === 'error' ? 'Error output' : 'Tool output'}
              </div>
              <pre
                style={{
                  fontSize: 11,
                  fontFamily: '"SF Mono", "Fira Code", monospace',
                  color: c.detailText,
                  backgroundColor: c.detailSurface,
                  border: `1px solid ${c.border}`,
                  padding: '10px 12px',
                  borderRadius: 10,
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  lineHeight: 1.4,
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.65)',
                }}
              >
                {detailText}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
