import type { ChatMessage } from '../core/types';

export type AppAgentToolCallMessage = ChatMessage & { role: 'tool_call' };
export type AppAgentAssistantMessage = ChatMessage & { role: 'assistant' };
export type AppAgentUserMessage = ChatMessage & { role: 'user' };
export type AppAgentErrorMessage = ChatMessage & { role: 'error' };
export type AppAgentConversationMessage =
  | AppAgentAssistantMessage
  | AppAgentUserMessage
  | AppAgentErrorMessage;
export type AppAgentVisibleMessage = AppAgentConversationMessage | AppAgentToolCallMessage;
export type AppAgentLastTurnSummary = {
  prompt: string;
  toolsUsed: number;
  durationMs: number | null;
};

export type AppAgentRenderedNode =
  | { kind: 'user'; id: string; content: string }
  | { kind: 'assistant'; id: string; content: string }
  | { kind: 'tools'; id: string; tools: AppAgentToolCallMessage[] };

export type AppAgentInlinePendingTurnState = {
  prompt: string;
  baselineAssistantId: string | null;
  baselineToolCount: number;
};

export type AppAgentToolStatusPresentation = {
  glyph: '✓' | '✕' | '…';
  tone: 'success' | 'error' | 'active';
  badgeLabel: 'Completed' | 'Failed' | 'Running';
};

export type AppAgentInlineFeedState = {
  isActive: boolean;
  pendingPrompt: string | null;
  recentTools: AppAgentToolCallMessage[];
  previewText: string | null;
  waitingForActivity: boolean;
};

function isAssistantMessage(message: ChatMessage): message is AppAgentAssistantMessage {
  return message.role === 'assistant';
}

function isUserMessage(message: ChatMessage): message is AppAgentUserMessage {
  return message.role === 'user';
}

function isErrorMessage(message: ChatMessage): message is AppAgentErrorMessage {
  return message.role === 'error';
}

function isToolCallMessage(message: ChatMessage): message is AppAgentToolCallMessage {
  return message.role === 'tool_call';
}

export function deriveVisibleMessages(messages: ChatMessage[]): AppAgentVisibleMessage[] {
  return messages.filter(
    (message): message is AppAgentVisibleMessage =>
      isAssistantMessage(message)
      || isUserMessage(message)
      || isErrorMessage(message)
      || isToolCallMessage(message),
  );
}

export function deriveConversationMessages(messages: ChatMessage[]): AppAgentConversationMessage[] {
  return messages.filter(
    (message): message is AppAgentConversationMessage =>
      isUserMessage(message) || isAssistantMessage(message) || isErrorMessage(message),
  );
}

export function deriveToolMessages(messages: ChatMessage[]): AppAgentToolCallMessage[] {
  return messages.filter(isToolCallMessage);
}

export function getLatestAssistantMessage(messages: ChatMessage[]): AppAgentAssistantMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && isAssistantMessage(message)) {
      return message;
    }
  }

  return null;
}

export function getLatestUserMessage(messages: ChatMessage[]): AppAgentUserMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && isUserMessage(message)) {
      return message;
    }
  }

  return null;
}

export function getLatestToolMessage(messages: ChatMessage[]): AppAgentToolCallMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && isToolCallMessage(message)) {
      return message;
    }
  }

  return null;
}

export function createInlinePendingTurnState(
  prompt: string,
  messages: ChatMessage[],
): AppAgentInlinePendingTurnState {
  return {
    prompt,
    baselineAssistantId: getLatestAssistantMessage(messages)?.id ?? null,
    baselineToolCount: deriveToolMessages(messages).length,
  };
}

export function applyUserMessageOverrides(
  messages: ChatMessage[],
  overrides: Record<string, string>,
): ChatMessage[] {
  return messages.map((message) =>
    message.role === 'user' && overrides[message.id]
      ? { ...message, content: overrides[message.id] }
      : message,
  );
}

export function buildRenderedNodes(messages: ChatMessage[]): AppAgentRenderedNode[] {
  const nodes: AppAgentRenderedNode[] = [];
  let toolBuffer: AppAgentToolCallMessage[] = [];

  const flushTools = (id: string) => {
    if (toolBuffer.length > 0) {
      nodes.push({ kind: 'tools', id: `tools-${id}`, tools: toolBuffer });
      toolBuffer = [];
    }
  };

  messages.forEach((message) => {
    if (isToolCallMessage(message)) {
      toolBuffer.push(message);
      return;
    }

    if (message.role === 'tool_result') {
      return;
    }

    flushTools(message.id);

    if (message.role === 'user') {
      nodes.push({ kind: 'user', id: message.id, content: message.content });
      return;
    }

    if (message.role === 'assistant') {
      nodes.push({ kind: 'assistant', id: message.id, content: message.content });
    }
  });

  if (toolBuffer.length > 0) {
    nodes.push({ kind: 'tools', id: 'tools-tail', tools: toolBuffer });
  }

  return nodes;
}

export function deriveToolStatusPresentation(
  status?: ChatMessage['toolCallStatus'],
): AppAgentToolStatusPresentation {
  if (status === 'completed') {
    return { glyph: '✓', tone: 'success', badgeLabel: 'Completed' };
  }

  if (status === 'error') {
    return { glyph: '✕', tone: 'error', badgeLabel: 'Failed' };
  }

  return { glyph: '…', tone: 'active', badgeLabel: 'Running' };
}

export function summarizeConversationId(value: string | null): string {
  if (!value) {
    return 'Waiting';
  }

  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function formatStructuredText(value?: string): string {
  if (!value) {
    return 'No payload captured.';
  }

  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export function deriveConversationStatusLabel(options: {
  isReady: boolean;
  isLoading: boolean;
  isThinking: boolean;
  streamingContent?: string;
  hasError?: boolean;
  hasIssue?: boolean;
  hasAttention?: boolean;
  readyLabel?: string;
  loadingLabel?: string;
  thinkingLabel?: string;
  streamingLabel?: string;
  attentionLabel?: string;
  issueLabel?: string;
  reconnectingLabel?: string;
  connectingLabel?: string;
}): string {
  const {
    isReady,
    isLoading,
    isThinking,
    streamingContent,
    hasError = false,
    hasIssue = false,
    hasAttention = false,
    readyLabel = 'Ready',
    loadingLabel = 'Working…',
    thinkingLabel = 'Thinking…',
    streamingLabel = 'Responding…',
    attentionLabel = 'Needs auth',
    issueLabel = 'Needs attention',
    reconnectingLabel = 'Reconnecting…',
    connectingLabel = 'Connecting…',
  } = options;

  if (isReady) {
    if (isLoading) {
      return loadingLabel;
    }

    if (isThinking) {
      return thinkingLabel;
    }

    if (streamingContent && streamingContent.length > 0) {
      return streamingLabel;
    }

    if (hasAttention) {
      return attentionLabel;
    }

    if (hasIssue || hasError) {
      return issueLabel;
    }

    return readyLabel;
  }

  return hasIssue || hasError ? reconnectingLabel : connectingLabel;
}

export function deriveLastTurnSummary(messages: ChatMessage[]): AppAgentLastTurnSummary | null {
  const lastUser = getLatestUserMessage(messages);
  if (!lastUser) {
    return null;
  }

  const lastUserIndex = messages.findIndex((message) => message.id === lastUser.id);
  if (lastUserIndex < 0) {
    return null;
  }

  const after = messages.slice(lastUserIndex + 1);
  const tools = deriveToolMessages(after);
  const lastToolEndedAt = tools
    .map((tool) => (tool.toolCallDuration ?? 0) + (tool.timestamp ? tool.timestamp.getTime() : 0))
    .reduce<number | null>((max, value) => (max === null || value > max ? value : max), null);
  const userStartedAt = lastUser.timestamp ? lastUser.timestamp.getTime() : null;

  return {
    prompt: lastUser.content.trim(),
    toolsUsed: tools.length,
    durationMs:
      lastToolEndedAt && userStartedAt
        ? Math.max(0, lastToolEndedAt - userStartedAt)
        : null,
  };
}

export function deriveInlineFeedState(options: {
  pendingTurn: AppAgentInlinePendingTurnState | null;
  toolMessages: AppAgentToolCallMessage[];
  latestAssistantContent?: string | null;
  streamingContent?: string;
  isLoading: boolean;
  isThinking: boolean;
  maxRecentTools?: number;
}): AppAgentInlineFeedState {
  const {
    pendingTurn,
    toolMessages,
    latestAssistantContent,
    streamingContent = '',
    isLoading,
    isThinking,
    maxRecentTools = 4,
  } = options;

  const startIndex = pendingTurn
    ? Math.max(
        pendingTurn.baselineToolCount,
        toolMessages.length - maxRecentTools,
      )
    : Math.max(toolMessages.length - maxRecentTools, 0);

  const recentTools = toolMessages.slice(startIndex);
  const previewText =
    streamingContent || (pendingTurn ? latestAssistantContent ?? null : null);
  const waitingForActivity =
    Boolean(pendingTurn) &&
    recentTools.length === 0 &&
    !streamingContent &&
    (isLoading || isThinking);
  const isActive = Boolean(isLoading || isThinking || streamingContent.length > 0);

  return {
    isActive,
    pendingPrompt: pendingTurn?.prompt ?? null,
    recentTools,
    previewText,
    waitingForActivity,
  };
}
