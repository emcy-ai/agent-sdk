import type { ChatMessage } from "../core/types";

export type AgentToolCallMessage = ChatMessage & { role: "tool_call" };
export type AgentAssistantMessage = ChatMessage & { role: "assistant" };
export type AgentUserMessage = ChatMessage & { role: "user" };
export type AgentConversationMessage = AgentAssistantMessage | AgentUserMessage;
export type AgentVisibleMessage = AgentConversationMessage | AgentToolCallMessage;

export type AgentRenderedNode =
  | { kind: "user"; id: string; content: string }
  | { kind: "assistant"; id: string; content: string }
  | { kind: "tools"; id: string; tools: AgentToolCallMessage[] };

export type AgentInlinePendingTurnState = {
  prompt: string;
  baselineAssistantId: string | null;
  baselineToolCount: number;
};

export type AgentToolStatusPresentation = {
  glyph: "✓" | "✕" | "…";
  tone: "success" | "error" | "active";
  badgeLabel: "Completed" | "Failed" | "Running";
};

export type AgentInlineFeedState = {
  isActive: boolean;
  pendingPrompt: string | null;
  recentTools: AgentToolCallMessage[];
  previewText: string | null;
  waitingForActivity: boolean;
};

function isAssistantMessage(message: ChatMessage): message is AgentAssistantMessage {
  return message.role === "assistant";
}

function isUserMessage(message: ChatMessage): message is AgentUserMessage {
  return message.role === "user";
}

function isToolCallMessage(message: ChatMessage): message is AgentToolCallMessage {
  return message.role === "tool_call";
}

export function deriveVisibleMessages(messages: ChatMessage[]): AgentVisibleMessage[] {
  return messages.filter(
    (message): message is AgentVisibleMessage =>
      isAssistantMessage(message) || isUserMessage(message) || isToolCallMessage(message),
  );
}

export function deriveConversationMessages(messages: ChatMessage[]): AgentConversationMessage[] {
  return messages.filter(
    (message): message is AgentConversationMessage =>
      isUserMessage(message) || isAssistantMessage(message),
  );
}

export function deriveToolMessages(messages: ChatMessage[]): AgentToolCallMessage[] {
  return messages.filter(isToolCallMessage);
}

export function getLatestAssistantMessage(messages: ChatMessage[]): AgentAssistantMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && isAssistantMessage(message)) {
      return message;
    }
  }

  return null;
}

export function getLatestUserMessage(messages: ChatMessage[]): AgentUserMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && isUserMessage(message)) {
      return message;
    }
  }

  return null;
}

export function getLatestToolMessage(messages: ChatMessage[]): AgentToolCallMessage | null {
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
): AgentInlinePendingTurnState {
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
    message.role === "user" && overrides[message.id]
      ? { ...message, content: overrides[message.id] }
      : message,
  );
}

export function buildRenderedNodes(messages: ChatMessage[]): AgentRenderedNode[] {
  const nodes: AgentRenderedNode[] = [];
  let toolBuffer: AgentToolCallMessage[] = [];

  const flushTools = (id: string) => {
    if (toolBuffer.length > 0) {
      nodes.push({ kind: "tools", id: `tools-${id}`, tools: toolBuffer });
      toolBuffer = [];
    }
  };

  messages.forEach((message) => {
    if (isToolCallMessage(message)) {
      toolBuffer.push(message);
      return;
    }

    if (message.role === "tool_result") {
      return;
    }

    flushTools(message.id);

    if (message.role === "user") {
      nodes.push({ kind: "user", id: message.id, content: message.content });
      return;
    }

    if (message.role === "assistant") {
      nodes.push({ kind: "assistant", id: message.id, content: message.content });
    }
  });

  if (toolBuffer.length > 0) {
    nodes.push({ kind: "tools", id: "tools-tail", tools: toolBuffer });
  }

  return nodes;
}

export function deriveToolStatusPresentation(
  status?: ChatMessage["toolCallStatus"],
): AgentToolStatusPresentation {
  if (status === "completed") {
    return { glyph: "✓", tone: "success", badgeLabel: "Completed" };
  }

  if (status === "error") {
    return { glyph: "✕", tone: "error", badgeLabel: "Failed" };
  }

  return { glyph: "…", tone: "active", badgeLabel: "Running" };
}

export function summarizeConversationId(value: string | null): string {
  if (!value) {
    return "Waiting";
  }

  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function formatStructuredText(value?: string): string {
  if (!value) {
    return "No payload captured.";
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
  readyLabel?: string;
  loadingLabel?: string;
  thinkingLabel?: string;
  streamingLabel?: string;
  reconnectingLabel?: string;
  connectingLabel?: string;
}): string {
  const {
    isReady,
    isLoading,
    isThinking,
    streamingContent,
    hasError = false,
    readyLabel = "Ready",
    loadingLabel = "Working…",
    thinkingLabel = "Thinking…",
    streamingLabel = "Responding…",
    reconnectingLabel = "Reconnecting…",
    connectingLabel = "Connecting…",
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

    return readyLabel;
  }

  return hasError ? reconnectingLabel : connectingLabel;
}

export function deriveInlineFeedState(options: {
  pendingTurn: AgentInlinePendingTurnState | null;
  toolMessages: AgentToolCallMessage[];
  latestAssistantContent?: string | null;
  streamingContent?: string;
  isLoading: boolean;
  isThinking: boolean;
  maxRecentTools?: number;
}): AgentInlineFeedState {
  const {
    pendingTurn,
    toolMessages,
    latestAssistantContent,
    streamingContent = "",
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
