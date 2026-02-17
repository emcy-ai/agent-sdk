// ================================================================
// Configuration
// ================================================================

export interface EmcyAgentConfig {
  /** API key for authenticating with the Emcy API */
  apiKey: string;

  /** Agent ID from the Emcy dashboard */
  agentId: string;

  /** Emcy API URL. Defaults to https://api.emcy.ai */
  agentServiceUrl?: string;

  /**
   * Callback to get the user's auth token for MCP server calls.
   * Called before each tool execution. Receives the MCP server URL
   * so you can return different tokens per server.
   * If using cookies, return undefined and set `useCookies: true`.
   */
  getToken?: (mcpServerUrl?: string) => Promise<string | undefined>;

  /**
   * If true, MCP server calls include cookies (for cookie-based auth).
   * Default: false
   */
  useCookies?: boolean;

  /** Optional: external user ID to associate with conversations */
  externalUserId?: string;

  /** Optional: additional context sent with each message */
  context?: Record<string, unknown>;
}

// ================================================================
// Messages
// ================================================================

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool_call' | 'tool_result';
  content: string;
  toolName?: string;
  toolCallId?: string;
  timestamp: Date;
  toolCallStatus?: 'calling' | 'completed' | 'error';
  toolCallStartTime?: number;
  toolCallDuration?: number;
  toolResult?: string;
  toolError?: string;
}

// ================================================================
// Agent Config Response (from GET /workspaces/{id}/config)
// ================================================================

export interface McpServerInfo {
  id: string;
  name: string;
  url: string;
  authStatus: 'connected' | 'needs_auth';
  tools: AgentToolSchema[];
}

export interface AgentConfigResponse {
  workspaceId: string;
  name: string;
  /** @deprecated Use mcpServers instead */
  mcpServerUrl?: string;
  mcpServers: McpServerInfo[];
  tools: AgentToolSchema[];
  widgetConfig?: WidgetConfig | null;
}

export interface AgentToolSchema {
  name: string;
  description?: string;
  inputSchemaJson?: string;
}

export interface WidgetConfig {
  theme?: string;
  position?: string;
  title?: string;
  placeholder?: string;
  welcomeMessage?: string;
}

// ================================================================
// SSE Events (from the chat API)
// ================================================================

export interface SseMessageStart {
  conversationId: string;
}

export interface SseContentDelta {
  text: string;
}

export interface SseToolCall {
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  mcpServerUrl?: string;
  mcpServerName?: string;
}

export interface SseMessageEnd {
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
}

export interface SseError {
  code: string;
  message: string;
}

// ================================================================
// Events emitted by EmcyAgent
// ================================================================

export interface McpAuthStatusEvent {
  mcpServerUrl: string;
  mcpServerName: string;
  authStatus: 'connected' | 'needs_auth';
}

export type EmcyAgentEventMap = {
  message: ChatMessage;
  content_delta: SseContentDelta;
  tool_call: SseToolCall;
  tool_result: { toolCallId: string; result: unknown; duration: number };
  tool_error: { toolCallId: string; error: string; duration: number };
  message_end: SseMessageEnd;
  error: SseError;
  loading: boolean;
  thinking: boolean;
  mcp_auth_status: McpAuthStatusEvent;
};

export type EmcyAgentEvent = keyof EmcyAgentEventMap;
