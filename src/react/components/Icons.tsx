import React from 'react';

interface IconProps {
  size?: number;
  color?: string;
  className?: string;
}

const svgBase = (size: number, className?: string): React.SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className,
});

export function DatabaseIcon({ size = 16, color, className }: IconProps) {
  return (
    <svg {...svgBase(size, className)} style={color ? { color } : undefined}>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  );
}

export function EditIcon({ size = 16, color, className }: IconProps) {
  return (
    <svg {...svgBase(size, className)} style={color ? { color } : undefined}>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

export function TrashIcon({ size = 16, color, className }: IconProps) {
  return (
    <svg {...svgBase(size, className)} style={color ? { color } : undefined}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

export function ToolWrenchIcon({ size = 16, color, className }: IconProps) {
  return (
    <svg {...svgBase(size, className)} style={color ? { color } : undefined}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

export function CheckCircleIcon({ size = 16, color, className }: IconProps) {
  return (
    <svg {...svgBase(size, className)} style={color ? { color } : undefined}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" strokeDasharray="24" strokeDashoffset="0" style={{ animation: 'emcy-checkmark 0.4s ease-out both' }} />
    </svg>
  );
}

export function XCircleIcon({ size = 16, color, className }: IconProps) {
  return (
    <svg {...svgBase(size, className)} style={color ? { color } : undefined}>
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

export function SpinnerIcon({ size = 16, color, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={`emcy-spin ${className ?? ''}`}
      style={color ? { color } : undefined}
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.2" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ChevronIcon({ size = 14, color, className, direction = 'down' }: IconProps & { direction?: 'up' | 'down' }) {
  return (
    <svg
      {...svgBase(size, className)}
      style={{
        color,
        transform: direction === 'up' ? 'rotate(180deg)' : undefined,
        transition: 'transform 0.2s',
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function SendIcon({ size = 18, color, className }: IconProps) {
  return (
    <svg {...svgBase(size, className)} style={color ? { color } : undefined}>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

export function PlusIcon({ size = 18, color, className }: IconProps) {
  return (
    <svg {...svgBase(size, className)} style={color ? { color } : undefined}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function CloseIcon({ size = 18, color, className }: IconProps) {
  return (
    <svg {...svgBase(size, className)} style={color ? { color } : undefined}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function ChatBubbleIcon({ size = 24, color, className }: IconProps) {
  return (
    <svg {...svgBase(size, className)} style={color ? { color } : undefined}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/** Pattern-match tool name to an appropriate icon */
export function getToolIcon(toolName: string): React.FC<IconProps> {
  if (/^(Get|List|Search|Query|Find|Fetch)/i.test(toolName)) return DatabaseIcon;
  if (/^(Create|Post|Update|Edit|Set|Put|Patch)/i.test(toolName)) return EditIcon;
  if (/^(Delete|Remove)/i.test(toolName)) return TrashIcon;
  return ToolWrenchIcon;
}
