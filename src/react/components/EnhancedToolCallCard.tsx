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
    bg: '#f0f4ff',
    border: '#c7d2fe',
    accent: colors.primary,
    text: '#3730a3',
  },
  completed: {
    bg: '#f0fdf4',
    border: '#bbf7d0',
    accent: '#16a34a',
    text: '#166534',
  },
  error: {
    bg: '#fef2f2',
    border: '#fecaca',
    accent: '#dc2626',
    text: '#991b1b',
  },
};

export function EnhancedToolCallCard({
  toolName,
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
  const durationStr = (displayDuration / 1000).toFixed(1) + 's';
  const hasExpandable = (status === 'completed' && result) || (status === 'error' && error);

  return (
    <div
      className="emcy-fadeInUp"
      style={{
        maxWidth: '90%',
        borderRadius: 10,
        backgroundColor: c.bg,
        border: `1px solid ${c.border}`,
        borderLeft: `3px solid ${c.accent}`,
        alignSelf: 'flex-start',
        overflow: 'hidden',
        transition: 'background-color 0.3s, border-color 0.3s',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        {/* Tool icon */}
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            backgroundColor: `${c.accent}15`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <ToolIcon size={16} color={c.accent} />
        </div>

        {/* Name + status */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: c.text,
              fontFamily: '"SF Mono", "Fira Code", monospace',
            }}
          >
            {toolName}
          </div>
          <div style={{ fontSize: 12, color: c.text, opacity: 0.7, marginTop: 1 }}>
            {status === 'calling' && `Executing... ${durationStr}`}
            {status === 'completed' && `Completed in ${durationStr}`}
            {status === 'error' && `Failed after ${durationStr}`}
          </div>
        </div>

        {/* Status icon */}
        <div style={{ flexShrink: 0 }}>
          {status === 'calling' && <SpinnerIcon size={18} color={c.accent} />}
          {status === 'completed' && <CheckCircleIcon size={18} color={c.accent} />}
          {status === 'error' && <XCircleIcon size={18} color={c.accent} />}
        </div>
      </div>

      {/* Progress bar */}
      <div
        style={{
          height: 2,
          backgroundColor: `${c.accent}20`,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {status === 'calling' ? (
          <div
            style={{
              position: 'absolute',
              top: 0,
              width: '30%',
              height: '100%',
              backgroundColor: c.accent,
              animation: 'emcy-progressIndeterminate 1.5s ease-in-out infinite',
              borderRadius: 1,
            }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              backgroundColor: c.accent,
              transition: 'width 0.3s ease-out',
            }}
          />
        )}
      </div>

      {/* Expandable result/error */}
      {hasExpandable && (
        <div style={{ borderTop: `1px solid ${c.border}` }}>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              width: '100%',
              padding: '6px 14px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
              color: c.text,
              opacity: 0.7,
            }}
          >
            <ChevronIcon size={12} direction={expanded ? 'up' : 'down'} color={c.text} />
            {expanded ? 'Hide result' : 'Show result'}
          </button>

          {expanded && (
            <div
              style={{
                padding: '0 14px 10px',
                maxHeight: 200,
                overflowY: 'auto',
                animation: 'emcy-slideDown 0.2s ease-out',
              }}
            >
              <pre
                style={{
                  fontSize: 11,
                  fontFamily: '"SF Mono", "Fira Code", monospace',
                  color: status === 'error' ? c.text : '#334155',
                  backgroundColor: status === 'error' ? '#fee2e2' : '#f8fafc',
                  padding: '8px 10px',
                  borderRadius: 6,
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  lineHeight: 1.4,
                }}
              >
                {status === 'error' ? error : result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
