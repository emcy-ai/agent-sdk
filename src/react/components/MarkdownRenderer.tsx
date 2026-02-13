import React from 'react';
import { colors } from './styles';

interface MarkdownRendererProps {
  content: string;
}

const codeBlockStyle: React.CSSProperties = {
  backgroundColor: '#1e1e2e',
  color: '#cdd6f4',
  padding: '12px 16px',
  borderRadius: 8,
  fontSize: 13,
  fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", monospace',
  overflowX: 'auto',
  margin: '8px 0',
  lineHeight: 1.5,
  whiteSpace: 'pre',
};

const inlineCodeStyle: React.CSSProperties = {
  backgroundColor: '#f1f5f9',
  color: '#e11d48',
  padding: '2px 6px',
  borderRadius: 4,
  fontSize: '0.9em',
  fontFamily: '"SF Mono", "Fira Code", monospace',
};

const blockquoteStyle: React.CSSProperties = {
  borderLeft: `3px solid ${colors.primary}`,
  paddingLeft: 12,
  margin: '8px 0',
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
  // Regex for inline elements: code, bold, italic, links
  const regex = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = regex.exec(text)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const key = `${keyPrefix}-${i++}`;
    if (match[1]) {
      // Inline code
      nodes.push(<code key={key} style={inlineCodeStyle}>{match[1].slice(1, -1)}</code>);
    } else if (match[2]) {
      // Bold **text**
      nodes.push(<strong key={key}>{match[2].slice(2, -2)}</strong>);
    } else if (match[3]) {
      // Bold __text__
      nodes.push(<strong key={key}>{match[3].slice(2, -2)}</strong>);
    } else if (match[4]) {
      // Italic *text*
      nodes.push(<em key={key}>{match[4].slice(1, -1)}</em>);
    } else if (match[5]) {
      // Italic _text_
      nodes.push(<em key={key}>{match[5].slice(1, -1)}</em>);
    } else if (match[6]) {
      // Link [text](url)
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
  // Split by code blocks first
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

      // Headings
      if (line.startsWith('### ')) {
        elements.push(
          <div key={`h3-${blockKey++}`} style={{ fontWeight: 600, fontSize: '1em', margin: '8px 0 4px' }}>
            {parseInline(line.slice(4), `h3i-${blockKey}`)}
          </div>,
        );
        i++;
        continue;
      }
      if (line.startsWith('## ')) {
        elements.push(
          <div key={`h2-${blockKey++}`} style={{ fontWeight: 600, fontSize: '1.1em', margin: '10px 0 4px' }}>
            {parseInline(line.slice(3), `h2i-${blockKey}`)}
          </div>,
        );
        i++;
        continue;
      }
      if (line.startsWith('# ')) {
        elements.push(
          <div key={`h1-${blockKey++}`} style={{ fontWeight: 700, fontSize: '1.25em', margin: '12px 0 4px' }}>
            {parseInline(line.slice(2), `h1i-${blockKey}`)}
          </div>,
        );
        i++;
        continue;
      }

      // Blockquote
      if (line.startsWith('> ')) {
        const quoteLines: string[] = [];
        while (i < lines.length && lines[i].startsWith('> ')) {
          quoteLines.push(lines[i].slice(2));
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
      if (/^[-*] /.test(line)) {
        const items: string[] = [];
        while (i < lines.length && /^[-*] /.test(lines[i])) {
          items.push(lines[i].slice(2));
          i++;
        }
        elements.push(
          <ul key={`ul-${blockKey++}`} style={{ margin: '4px 0', paddingLeft: 20 }}>
            {items.map((item, ii) => (
              <li key={ii} style={{ marginBottom: 2 }}>{parseInline(item, `uli-${blockKey}-${ii}`)}</li>
            ))}
          </ul>,
        );
        continue;
      }

      // Ordered list
      if (/^\d+\. /.test(line)) {
        const items: string[] = [];
        while (i < lines.length && /^\d+\. /.test(lines[i])) {
          items.push(lines[i].replace(/^\d+\. /, ''));
          i++;
        }
        elements.push(
          <ol key={`ol-${blockKey++}`} style={{ margin: '4px 0', paddingLeft: 20 }}>
            {items.map((item, ii) => (
              <li key={ii} style={{ marginBottom: 2 }}>{parseInline(item, `oli-${blockKey}-${ii}`)}</li>
            ))}
          </ol>,
        );
        continue;
      }

      // Empty line = paragraph break
      if (line.trim() === '') {
        i++;
        continue;
      }

      // Regular paragraph
      elements.push(
        <div key={`p-${blockKey++}`} style={{ margin: '2px 0' }}>
          {parseInline(line, `pi-${blockKey}`)}
        </div>,
      );
      i++;
    }
  }

  return <>{elements}</>;
}
