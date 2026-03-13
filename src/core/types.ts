// ================================================================
// Client Tools (execute locally in browser, exposed to LLM)
// ================================================================

export interface ClientToolParameter {
  type: string;
  description: string;
  required?: boolean;
  enum?: string[];
}

export interface ClientToolDefinition {
  description: string;
  parameters: Record<string, ClientToolParameter>;
  execute: (params: Record<string, unknown>) => Promise<unknown>;
  requireConfirmation?: boolean;
}

export type ClientToolsMap = Record<string, ClientToolDefinition>;

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
   * Callback to get the auth token for Emcy API requests.
   * If provided, called before each chat API request.
   * Use this when your session token may expire and needs refresh (e.g., dashboard playground).
   * If not provided, uses the static `apiKey` value.
   */
  getAuthToken?: () => Promise<string | undefined>;

  /**
   * Callback to get the user's auth token for MCP server calls.
   * Called every time a token is needed. Receives the MCP server URL
   * so you can return different tokens per server.
   * If using cookies, return undefined and set `useCookies: true`.
   *
   * In embedded mode, the host app provides this to supply tokens
   * from its own auth system. The SDK does NOT cache tokens - it calls
   * this function every time, so your app manages token refresh.
   */
  getToken?: (mcpServerUrl?: string) => Promise<OAuthTokenResponse | string | undefined>;

  /**
   * Called when an MCP server requires authentication and no `getToken`
   * callback is provided (standalone mode). The SDK will invoke this
   * so the integrator can trigger a login flow (e.g., OAuth popup).
   *
   * Return the token response on success, or undefined to cancel.
   * The SDK stores the token and handles refresh automatically.
   */
  onAuthRequired?: (mcpServerUrl: string, authConfig: McpServerAuthConfig) => Promise<OAuthTokenResponse | undefined>;

  /**
   * If true, MCP server calls include cookies (for cookie-based auth).
   * Default: false
   */
  useCookies?: boolean;

  /** Optional: external user ID to associate with conversations */
  externalUserId?: string;

  /** Optional: additional context sent with each message */
  context?: Record<string, unknown>;

  /**
   * Client tools — execute locally in browser, exposed to LLM.
   * The agent can call these to interact with the host app (e.g. fill forms, read page state).
   */
  clientTools?: ClientToolsMap;
}

// ================================================================
// Messages
// ================================================================

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool_call' | 'tool_result';
  content: string;
  toolName?: string;
  toolLabel?: string;
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

export interface McpServerAuthConfig {
  authType: 'none' | 'apiKey' | 'bearer' | 'oauth2';
  authorizationServerUrl?: string;
  loginUrl?: string;
  tokenUrl?: string;
  clientId?: string;
  scopes?: string[];
}

/** OAuth token response from token endpoint */
export interface OAuthTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType?: string;
}

export interface McpServerInfo {
  id: string;
  name: string;
  url: string;
  authStatus: 'connected' | 'needs_auth';
  authConfig?: McpServerAuthConfig | null;
}

export interface AgentConfigResponse {
  workspaceId: string;
  name: string;
  /** @deprecated Use mcpServers instead */
  mcpServerUrl?: string;
  mcpServers: McpServerInfo[];
  widgetConfig?: WidgetConfig | null;
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
  toolLabel?: string;
  arguments: Record<string, unknown>;
  mcpServerUrl?: string;
  mcpServerName?: string;
  /** When 'client', execute locally via clientTools; when 'mcp' or absent with mcpServerUrl, use MCP */
  source?: 'client' | 'mcp';
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
