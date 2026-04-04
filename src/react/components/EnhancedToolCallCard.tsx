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
    border: '#e4e4e7',
    accent: '#2563eb',
    mutedSurface: '#f8fafc',
    mutedText: '#1d4ed8',
    badgeSurface: '#eff6ff',
    detailSurface: '#f8fafc',
    detailText: '#0f172a',
    shadow: 'rgba(15, 23, 42, 0.06)',
  },
  completed: {
    surface: '#ffffff',
    border: '#e4e4e7',
    accent: '#16a34a',
    mutedSurface: '#fafafa',
    mutedText: '#166534',
    badgeSurface: '#ecfdf5',
    detailSurface: '#fafafa',
    detailText: '#18181b',
    shadow: 'rgba(15, 23, 42, 0.06)',
  },
  error: {
    surface: '#ffffff',
    border: '#e4e4e7',
    accent: '#dc2626',
    mutedSurface: '#fafafa',
    mutedText: '#991b1b',
    badgeSurface: '#fef2f2',
    detailSurface: '#fff7f7',
    detailText: '#7f1d1d',
    shadow: 'rgba(15, 23, 42, 0.06)',
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

function AnimatedEllipsis({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
      }}
    >
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          style={{
            width: 4,
            height: 4,
            borderRadius: 999,
            backgroundColor: color,
            opacity: 0.35,
            animation: 'emcy-pulse 1.2s ease-in-out infinite',
            animationDelay: `${index * 0.16}s`,
          }}
        />
      ))}
    </span>
  );
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
  const detailLabel = status === 'error' ? 'details' : 'result';
  const statusIcon =
    status === 'calling' ? (
      <SpinnerIcon size={14} color={c.accent} />
    ) : status === 'completed' ? (
      <CheckCircleIcon size={14} color={c.accent} />
    ) : (
      <XCircleIcon size={14} color={c.accent} />
    );

  return (
    <div
      className="emcy-fadeInUp"
      style={{
        width: expanded ? '92%' : 'fit-content',
        maxWidth: '92%',
        flexShrink: 0,
        borderRadius: 18,
        backgroundColor: c.surface,
        border: `1px solid ${c.border}`,
        alignSelf: 'flex-start',
        overflow: 'hidden',
        boxShadow: `0 1px 2px rgba(15,23,42,0.06), 0 12px 34px ${c.shadow}`,
        position: 'relative',
        transition: 'width 0.2s ease, border-color 0.2s, box-shadow 0.2s, transform 0.2s',
      }}
    >
      <div
        style={{
          position: 'relative',
          padding: '10px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 999,
            backgroundColor: c.mutedSurface,
            border: `1px solid ${colors.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <ToolIcon size={14} color={c.accent} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              minWidth: 0,
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                minWidth: 0,
                flexWrap: 'wrap',
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: colors.text,
                  lineHeight: 1.35,
                  minWidth: 0,
                  wordBreak: 'break-word',
                }}
              >
                {toolName}
              </span>
              {status === 'calling' ? (
                <AnimatedEllipsis color={c.accent} />
              ) : null}
            </span>

            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 8px',
                borderRadius: 999,
                backgroundColor: c.badgeSurface,
                color: c.mutedText,
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {statusIcon}
              {statusLabel}
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 6,
              marginTop: 4,
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: colors.textMuted,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              Tool call
            </span>
            {runId && (
              <>
                <span style={{ color: colors.textMuted, fontSize: 11 }}>•</span>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    color: colors.textSecondary,
                    fontSize: 11,
                    fontFamily: '"SF Mono", "Fira Code", monospace',
                  }}
                >
                  {runId}
                </span>
              </>
            )}
            <span style={{ color: colors.textMuted, fontSize: 11 }}>•</span>
            <span style={{ fontSize: 11, color: colors.textSecondary }}>
              {statusText}
            </span>
          </div>
        </div>

        {hasExpandable && (
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              width: 28,
              height: 28,
              borderRadius: 999,
              border: `1px solid ${colors.border}`,
              backgroundColor: expanded ? c.badgeSurface : colors.bgSecondary,
              color: colors.textSecondary,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              cursor: 'pointer',
            }}
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? `Hide ${detailLabel}` : `Show ${detailLabel}`}
            title={expanded ? `Hide ${detailLabel}` : `Show ${detailLabel}`}
          >
            {expanded ? (
              <ChevronIcon size={14} direction="up" color={colors.textSecondary} />
            ) : (
              <span
                aria-hidden="true"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 2,
                }}
              >
                {[0, 1, 2].map((index) => (
                  <span
                    key={index}
                    style={{
                      width: 3.5,
                      height: 3.5,
                      borderRadius: 999,
                      backgroundColor: colors.textSecondary,
                    }}
                  />
                ))}
              </span>
            )}
          </button>
        )}
      </div>

      {hasExpandable && (
        <div
          style={{
            position: 'relative',
            borderTop: `1px solid ${c.border}`,
            backgroundColor: c.surface,
          }}
        >
          {expanded && (
            <div
              style={{
                padding: '12px',
                maxHeight: 260,
                overflowY: 'auto',
                animation: 'emcy-slideDown 0.2s ease-out',
              }}
            >
              <div
                style={{
                  marginBottom: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: colors.textMuted,
                  }}
                >
                  {status === 'error' ? 'Error output' : 'Tool output'}
                </div>
                <button
                  onClick={() => setExpanded(false)}
                  type="button"
                  style={{
                    border: 'none',
                    background: 'none',
                    color: colors.textSecondary,
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: 500,
                    padding: 0,
                  }}
                >
                  Hide
                </button>
              </div>
              <pre
                style={{
                  fontSize: 11,
                  fontFamily: '"SF Mono", "Fira Code", monospace',
                  color: c.detailText,
                  backgroundColor: c.detailSurface,
                  border: `1px solid ${c.border}`,
                  padding: '10px 12px',
                  borderRadius: 12,
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  lineHeight: 1.4,
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
