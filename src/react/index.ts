export { EmcyChat } from './EmcyChat';
export type { EmcyChatProps } from './EmcyChat';

export { EmcyChatProvider, useEmcyChatContext } from './EmcyChatProvider';
export type { EmcyChatProviderProps, EmcyChatContextValue } from './EmcyChatProvider';

export { useEmcyAgent } from './useEmcyAgent';
export type { UseEmcyAgentReturn } from './useEmcyAgent';

// Sub-components (for advanced composition)
export { ChatWindow } from './components/ChatWindow';
export type { ChatWindowProps } from './components/ChatWindow';
export { MessageList } from './components/MessageList';
export type { MessageListProps } from './components/MessageList';
export { MessageBubble } from './components/MessageBubble';
export type { MessageBubbleProps } from './components/MessageBubble';
export { InputArea } from './components/InputArea';
export type { InputAreaProps } from './components/InputArea';
export { WidgetButton } from './components/WidgetButton';
export type { WidgetButtonProps } from './components/WidgetButton';

// Enhanced components
export { EnhancedToolCallCard } from './components/EnhancedToolCallCard';
export type { EnhancedToolCallCardProps } from './components/EnhancedToolCallCard';
export { MarkdownRenderer } from './components/MarkdownRenderer';
export { ThinkingIndicator } from './components/ThinkingIndicator';
export { StreamingCursor } from './components/StreamingCursor';

// Icons
export {
  DatabaseIcon,
  EditIcon,
  TrashIcon,
  ToolWrenchIcon,
  CheckCircleIcon,
  XCircleIcon,
  SpinnerIcon,
  ChevronIcon,
  SendIcon,
  PlusIcon,
  CloseIcon,
  ChatBubbleIcon,
  getToolIcon,
} from './components/Icons';
