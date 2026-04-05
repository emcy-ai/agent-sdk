import React from 'react';
import { colors } from './styles';

interface MarkdownRendererProps {
  content: string;
}

const codeBlockStyle: React.CSSProperties = {
  backgroundColor: '#1e1e2e',
  color: '#cdd6f4',
  padding: '10px 14px',
  borderRadius: 8,
  fontSize: 12,
  fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", monospace',
  overflowX: 'auto',
  margin: '6px 0',
  lineHeight: 1.55,
  whiteSpace: 'pre',
};

const inlineCodeStyle: React.CSSProperties = {
  backgroundColor: colors.bgTertiary,
  color: colors.text,
  padding: '1px 5px',
  borderRadius: 4,
  fontSize: '0.9em',
  fontFamily: '"SF Mono", "Fira Code", monospace',
};

const blockquoteStyle: React.CSSProperties = {
  borderLeft: `3px solid ${colors.border}`,
  paddingLeft: 12,
  margin: '6px 0',
  color: colors.textSecondary,
  fontStyle: 'italic',
};

const linkStyle: React.CSSProperties = {
  color: colors.primary,
  textDecoration: 'underline',
};

/** Parse inline markdown (bold, italic, code, links) */
function parseInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const regex = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const key = `${keyPrefix}-${i++}`;
    if (match[1]) {
      nodes.push(<code key={key} style={inlineCodeStyle}>{match[1].slice(1, -1)}</code>);
    } else if (match[2]) {
      nodes.push(<strong key={key} style={{ fontWeight: 600 }}>{match[2].slice(2, -2)}</strong>);
    } else if (match[3]) {
      nodes.push(<strong key={key} style={{ fontWeight: 600 }}>{match[3].slice(2, -2)}</strong>);
    } else if (match[4]) {
      nodes.push(<em key={key}>{match[4].slice(1, -1)}</em>);
    } else if (match[5]) {
      nodes.push(<em key={key}>{match[5].slice(1, -1)}</em>);
    } else if (match[6]) {
      nodes.push(
        <a key={key} href={match[8]} target="_blank" rel="noopener noreferrer" style={linkStyle}>
          {match[7]}
        </a>,
      );
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const parts = content.split(/(```[\s\S]*?```)/g);
  const elements: React.ReactNode[] = [];
  let blockKey = 0;

  for (const part of parts) {
    // Code block
    if (part.startsWith('```') && part.endsWith('```')) {
      const inner = part.slice(3, -3);
      const newlineIdx = inner.indexOf('\n');
      const code = newlineIdx >= 0 ? inner.slice(newlineIdx + 1) : inner;
      elements.push(
        <pre key={`cb-${blockKey++}`} style={codeBlockStyle}>
          {code}
        </pre>,
      );
      continue;
    }

    // Process block-level elements
    const lines = part.split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trimStart();

      // Headings
      const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const text = headingMatch[2];
        const style: React.CSSProperties = {
          fontWeight: level <= 2 ? 600 : 500,
          fontSize: level === 1 ? '1.15em' : level === 2 ? '1.05em' : '1em',
          margin: '10px 0 4px',
          color: colors.text,
          lineHeight: 1.35,
        };
        elements.push(
          <div key={`h-${blockKey++}`} style={style}>
            {parseInline(text, `hi-${blockKey}`)}
          </div>,
        );
        i++;
        continue;
      }

      // Blockquote
      if (trimmed.startsWith('> ')) {
        const quoteLines: string[] = [];
        while (i < lines.length && lines[i].trimStart().startsWith('> ')) {
          quoteLines.push(lines[i].trimStart().slice(2));
          i++;
        }
        elements.push(
          <div key={`bq-${blockKey++}`} style={blockquoteStyle}>
            {quoteLines.map((ql, qi) => (
              <div key={qi}>{parseInline(ql, `bqi-${blockKey}-${qi}`)}</div>
            ))}
          </div>,
        );
        continue;
      }

      // Unordered list
      if (/^[-*]\s+/.test(trimmed)) {
        const items: string[] = [];
        while (i < lines.length && /^[-*]\s+/.test(lines[i].trimStart())) {
          items.push(lines[i].trimStart().replace(/^[-*]\s+/, ''));
          i++;
        }
        elements.push(
          <ul key={`ul-${blockKey++}`} style={{ margin: '4px 0', paddingLeft: 20, listStyleType: 'disc' }}>
            {items.map((item, ii) => (
              <li key={ii} style={{ marginBottom: 3, lineHeight: 1.55 }}>
                {parseInline(item, `uli-${blockKey}-${ii}`)}
              </li>
            ))}
          </ul>,
        );
        continue;
      }

      // Ordered list
      if (/^\d+[.)]\s+/.test(trimmed)) {
        const items: string[] = [];
        while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trimStart())) {
          items.push(lines[i].trimStart().replace(/^\d+[.)]\s+/, ''));
          i++;
        }
        elements.push(
          <ol key={`ol-${blockKey++}`} style={{ margin: '4px 0', paddingLeft: 20, listStyleType: 'decimal' }}>
            {items.map((item, ii) => (
              <li key={ii} style={{ marginBottom: 3, lineHeight: 1.55 }}>
                {parseInline(item, `oli-${blockKey}-${ii}`)}
              </li>
            ))}
          </ol>,
        );
        continue;
      }

      // Empty line = paragraph break
      if (trimmed === '') {
        i++;
        continue;
      }

      // Regular paragraph
      elements.push(
        <p key={`p-${blockKey++}`} style={{ margin: '4px 0', lineHeight: 1.6 }}>
          {parseInline(trimmed, `pi-${blockKey}`)}
        </p>,
      );
      i++;
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {elements}
    </div>
  );
}
