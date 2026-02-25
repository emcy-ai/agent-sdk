import { parseSseStream } from './sse-client';
import type {
  ClientToolParameter,
  EmcyAgentConfig,
  AgentConfigResponse,
  ChatMessage,
  EmcyAgentEvent,
  EmcyAgentEventMap,
  SseContentDelta,
  SseToolCall,
  SseMessageEnd,
  SseMessageStart,
  SseError,
  McpAuthStatusEvent,
  McpServerAuthConfig,
  OAuthTokenResponse,
} from './types';

type EventHandler<T> = (data: T) => void;

/** Convert client tool parameters to JSON Schema for the API */
function parametersToJsonSchema(params: Record<string, ClientToolParameter>): object {
  const properties: Record<string, object> = {};
  const required: string[] = [];
  for (const [key, p] of Object.entries(params)) {
    const prop: Record<string, unknown> = {
      type: p.type,
      description: p.description,
    };
    if (p.enum) prop.enum = p.enum;
    properties[key] = prop;
    if (p.required) required.push(key);
  }
  return { type: 'object', properties, required };
}

/**
 * Core orchestration class for the Emcy Agent SDK.
 * Framework-agnostic — works in any JavaScript environment.
 *
 * Handles:
 * - Communication with the Emcy chat API (SSE streaming)
 * - Tool execution via MCP server (browser-side, with user's auth token)
 * - Conversation state management
 * - Event emission for UI updates
 */
export class EmcyAgent {
  private config: Required<
    Pick<EmcyAgentConfig, 'apiKey' | 'agentId' | 'agentServiceUrl'>
  > &
    EmcyAgentConfig;
  private agentConfig: AgentConfigResponse | null = null;
  private conversationId: string | null = null;
  private messages: ChatMessage[] = [];
  private abortController: AbortController | null = null;
  private isLoading = false;
  private listeners: Map<string, Set<EventHandler<unknown>>> = new Map();
  /** Per-server MCP session tracking */
  private mcpSessions: Map<string, {
    sessionId: string | null;
    authStatus: 'connected' | 'needs_auth';
  }> = new Map();
  /** Cached tokens per MCP server URL (includes refresh token for renewal) */
  private tokenCache: Map<string, {
    accessToken: string;
    refreshToken?: string;
    expiresAt: number;
  }> = new Map();

  /** localStorage key prefix for persisted tokens */
  private static readonly STORAGE_PREFIX = 'emcy_oauth_';

  constructor(config: EmcyAgentConfig) {
    this.config = {
      ...config,
      agentServiceUrl: config.agentServiceUrl ?? 'https://api.emcy.ai',
    };
  }

  /** Initialize: fetch workspace config (tools, widget settings, MCP servers) */
  async init(): Promise<AgentConfigResponse> {
    const response = await fetch(
      `${this.config.agentServiceUrl}/api/v1/workspaces/${this.config.agentId}/config`,
      {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
      },
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Failed to fetch workspace config' }));
      throw new Error(error.message ?? `HTTP ${response.status}`);
    }

    this.agentConfig = await response.json();

    // Pre-initialize session tracking for each MCP server
    // Check localStorage for persisted tokens to restore auth status
    if (this.agentConfig?.mcpServers) {
      for (const server of this.agentConfig.mcpServers) {
        if (!this.mcpSessions.has(server.url)) {
          // Check if we have a valid persisted token for this server
          const storedToken = this.loadTokenFromStorage(server.url);
          
          // Token is valid if: access token not expired, OR we have a refresh token
          const hasValidToken = storedToken !== null && (
            storedToken.expiresAt > Date.now() || storedToken.refreshToken
          );
          
          // If server needs auth but we have a persisted token, mark as connected
          const authStatus = hasValidToken 
            ? 'connected' 
            : (server.authStatus || 'connected');
          
          this.mcpSessions.set(server.url, {
            sessionId: null,
            authStatus,
          });

          // Restore token to in-memory cache if found
          if (storedToken) {
            this.tokenCache.set(server.url, storedToken);
          }
        }
      }
    }

    return this.agentConfig!;
  }

  /** Get current MCP server auth statuses */
  getMcpServers(): Array<{ url: string; name: string; authStatus: 'connected' | 'needs_auth' }> {
    if (!this.agentConfig?.mcpServers) return [];
    return this.agentConfig.mcpServers.map(server => ({
      url: server.url,
      name: server.name,
      authStatus: this.mcpSessions.get(server.url)?.authStatus ?? server.authStatus ?? 'connected',
    }));
  }

  /** Send a message and process the full orchestration loop (including tool calls) */
  async sendMessage(message: string): Promise<void> {
    if (!this.agentConfig) {
      await this.init();
    }

    this.isLoading = true;
    this.emit('loading', true);

    // Add user message
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
      timestamp: new Date(),
    };
    this.messages.push(userMsg);
    this.emit('message', userMsg);

    try {
      await this.runChatLoop(message);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      this.emit('error', { code: 'sdk_error', message: errorMsg });
    } finally {
      this.isLoading = false;
      this.emit('loading', false);
      this.emit('thinking', false);
    }
  }

  /** Start a new conversation */
  newConversation(): void {
    this.conversationId = null;
    this.messages = [];
  }

  /** Cancel the current in-flight request */
  cancel(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  /** Get all messages in the current conversation */
  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  /** Get the current conversation ID */
  getConversationId(): string | null {
    return this.conversationId;
  }

  /** Get the loaded agent config */
  getAgentConfig(): AgentConfigResponse | null {
    return this.agentConfig;
  }

  /** Convert client tools to API schema format */
  private clientToolsToSchemas(): Array<{ name: string; description: string; inputSchema: object }> {
    if (!this.config.clientTools) return [];
    return Object.entries(this.config.clientTools).map(([name, def]) => ({
      name,
      description: def.description,
      inputSchema: parametersToJsonSchema(def.parameters) as object,
    }));
  }

  /** Whether a request is currently in flight */
  getIsLoading(): boolean {
    return this.isLoading;
  }

  /**
   * Proactively authenticate with an MCP server before sending a message.
   * In embedded mode (getToken provided), this calls getToken and verifies via MCP init.
   * In standalone mode, this invokes onAuthRequired to trigger a login flow.
   *
   * @param mcpServerUrl - The MCP server URL to authenticate with
   * @param tokenResponse - Optional: provide token response directly instead of using callbacks
   */
  async authenticate(
    mcpServerUrl: string,
    tokenResponse?: OAuthTokenResponse
  ): Promise<boolean> {
    if (tokenResponse) {
      this.cacheTokenResponse(mcpServerUrl, tokenResponse);
      this.updateMcpAuthStatus(mcpServerUrl, 'connected');
      return true;
    }
    const resolved = await this.resolveToken(mcpServerUrl);
    if (!resolved) return false;
    try {
      await this.initMcpSession(mcpServerUrl);
      return true;
    } catch {
      this.updateMcpAuthStatus(mcpServerUrl, 'needs_auth');
      return false;
    }
  }

  /** Get the auth config for an MCP server (from workspace config) */
  getServerAuthConfig(mcpServerUrl: string): McpServerAuthConfig | null {
    const server = this.agentConfig?.mcpServers?.find(s => s.url === mcpServerUrl);
    return server?.authConfig ?? null;
  }

  /** Subscribe to events */
  on<K extends EmcyAgentEvent>(event: K, handler: EventHandler<EmcyAgentEventMap[K]>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as EventHandler<unknown>);
  }

  /** Unsubscribe from events */
  off<K extends EmcyAgentEvent>(event: K, handler: EventHandler<EmcyAgentEventMap[K]>): void {
    this.listeners.get(event)?.delete(handler as EventHandler<unknown>);
  }

  // ================================================================
  // Private methods
  // ================================================================

  private emit<K extends EmcyAgentEvent>(event: K, data: EmcyAgentEventMap[K]): void {
    this.listeners.get(event)?.forEach((handler) => handler(data));
  }

  /** Generate a localStorage key for an MCP server URL */
  private getStorageKey(mcpServerUrl: string): string {
    // Simple hash to create a safe key from the URL
    const hash = btoa(mcpServerUrl).replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
    return `${EmcyAgent.STORAGE_PREFIX}${hash}`;
  }

  /** Save token to both in-memory cache and localStorage */
  private cacheToken(
    mcpServerUrl: string,
    accessToken: string,
    expiresAt: number,
    refreshToken?: string
  ): void {
    this.tokenCache.set(mcpServerUrl, { accessToken, refreshToken, expiresAt });

    // Persist to localStorage for cross-refresh persistence
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(
          this.getStorageKey(mcpServerUrl),
          JSON.stringify({ accessToken, refreshToken, expiresAt, url: mcpServerUrl })
        );
      }
    } catch {
      // localStorage may be unavailable (SSR, private browsing, quota exceeded)
    }
  }

  /** Cache an OAuthTokenResponse and return the access token */
  private cacheTokenResponse(mcpServerUrl: string, tokenResponse: OAuthTokenResponse): string {
    const expiresIn = tokenResponse.expiresIn ?? 3600;
    const expiresAt = Date.now() + (expiresIn * 1000) - (5 * 60 * 1000); // 5 min buffer
    this.cacheToken(mcpServerUrl, tokenResponse.accessToken, expiresAt, tokenResponse.refreshToken);
    return tokenResponse.accessToken;
  }

  /** Load token from localStorage if available */
  private loadTokenFromStorage(mcpServerUrl: string): {
    accessToken: string;
    refreshToken?: string;
    expiresAt: number;
  } | null {
    try {
      if (typeof localStorage === 'undefined') return null;

      const stored = localStorage.getItem(this.getStorageKey(mcpServerUrl));
      if (!stored) return null;

      const data = JSON.parse(stored) as {
        accessToken?: string;
        token?: string; // Legacy field name
        refreshToken?: string;
        expiresAt: number;
      };

      // Handle legacy storage format (token vs accessToken)
      const accessToken = data.accessToken ?? data.token;
      if (!accessToken) return null;

      // If access token is expired but we have a refresh token, still return it
      // so we can attempt a refresh
      if (data.expiresAt <= Date.now() && !data.refreshToken) {
        localStorage.removeItem(this.getStorageKey(mcpServerUrl));
        return null;
      }

      return {
        accessToken,
        refreshToken: data.refreshToken,
        expiresAt: data.expiresAt,
      };
    } catch {
      return null;
    }
  }

  /** Clear token from both in-memory cache and localStorage */
  private clearToken(mcpServerUrl: string): void {
    this.tokenCache.delete(mcpServerUrl);

    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(this.getStorageKey(mcpServerUrl));
      }
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Attempt to refresh an access token using the stored refresh token.
   * Returns the new access token on success, undefined on failure.
   */
  private async refreshAccessToken(mcpServerUrl: string): Promise<string | undefined> {
    const cached = this.tokenCache.get(mcpServerUrl);
    const stored = cached ?? this.loadTokenFromStorage(mcpServerUrl);

    if (!stored?.refreshToken) {
      return undefined;
    }

    const authConfig = this.getServerAuthConfig(mcpServerUrl);
    const tokenUrl = authConfig?.tokenUrl;

    if (!tokenUrl) {
      return undefined;
    }

    try {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: stored.refreshToken,
      });

      if (authConfig?.clientId) {
        body.set('client_id', authConfig.clientId);
      }

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });

      if (response.ok) {
        const data = await response.json();
        if (data.access_token) {
          // Calculate expiration (default to 1 hour if not provided)
          const expiresIn = data.expires_in ?? 3600;
          const expiresAt = Date.now() + (expiresIn * 1000) - (5 * 60 * 1000); // 5 min buffer

          // Use new refresh token if provided, otherwise keep the old one
          const newRefreshToken = data.refresh_token ?? stored.refreshToken;

          this.cacheToken(mcpServerUrl, data.access_token, expiresAt, newRefreshToken);
          return data.access_token;
        }
      }

      // Refresh failed - clear tokens so user can re-authenticate
      this.clearToken(mcpServerUrl);
      return undefined;
    } catch {
      // Network error or other failure
      return undefined;
    }
  }

  /**
   * The core orchestration loop:
   * 1. Send message to chat API
   * 2. Stream response
   * 3. If tool_call → execute tool via MCP → send result → continue
   * 4. If message_end → done
   */
  private async runChatLoop(message: string): Promise<void> {
    this.abortController = new AbortController();
    this.emit('thinking', true);

    // First request: send user message (include client tools for LLM)
    const chatBody: Record<string, unknown> = {
      agentId: this.config.agentId,
      conversationId: this.conversationId,
      message,
      externalUserId: this.config.externalUserId,
      context: this.config.context,
    };
    const clientToolsSchemas = this.clientToolsToSchemas();
    if (clientToolsSchemas.length > 0) {
      chatBody.clientTools = clientToolsSchemas;
    }
    let response = await this.callChatApi(chatBody, 'chat');

    // Process SSE stream — may loop if there are tool calls
    while (true) {
      const result = await this.processSseStream(response);

      if (result.type === 'message_end') {
        break;
      }

      if (result.type === 'tool_call') {
        const toolCall = result.data as SseToolCall;
        const startTime = Date.now();

        try {
          const toolResult = await this.executeTool(toolCall);
          const duration = Date.now() - startTime;

          // Update the tool_call message in-place with completion data
          const toolCallMsg = this.messages.find(
            m => m.role === 'tool_call' && m.toolCallId === toolCall.toolCallId
          );
          if (toolCallMsg) {
            toolCallMsg.toolCallStatus = 'completed';
            toolCallMsg.toolCallDuration = duration;
            toolCallMsg.toolResult = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
          }

          this.emit('tool_result', { toolCallId: toolCall.toolCallId, result: toolResult, duration });

          // Add tool result indicator to messages
          const toolResultMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'tool_result',
            content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            timestamp: new Date(),
          };
          this.messages.push(toolResultMsg);

          // Emit thinking again while waiting for LLM to process tool result
          this.emit('thinking', true);

          // Send tool result back to continue the conversation
          const toolResultBody: Record<string, unknown> = {
            conversationId: this.conversationId!,
            toolCallId: toolCall.toolCallId,
            result: toolResult,
          };
          const clientToolsSchemas = this.clientToolsToSchemas();
          if (clientToolsSchemas.length > 0) {
            toolResultBody.clientTools = clientToolsSchemas;
          }
          response = await this.callChatApi(toolResultBody, 'chat/tool-result');
        } catch (err) {
          const duration = Date.now() - startTime;
          const errorMsg = err instanceof Error ? err.message : 'Tool execution failed';

          // Update the tool_call message with error data
          const toolCallMsg = this.messages.find(
            m => m.role === 'tool_call' && m.toolCallId === toolCall.toolCallId
          );
          if (toolCallMsg) {
            toolCallMsg.toolCallStatus = 'error';
            toolCallMsg.toolCallDuration = duration;
            toolCallMsg.toolError = errorMsg;
          }

          this.emit('tool_error', { toolCallId: toolCall.toolCallId, error: errorMsg, duration });

          // Send error as tool_result so the conversation history stays valid
          // (Anthropic requires every tool_use to have a matching tool_result)
          const errorResult = `Error: ${errorMsg}`;
          const toolResultMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'tool_result',
            content: errorResult,
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            timestamp: new Date(),
          };
          this.messages.push(toolResultMsg);

          this.emit('thinking', true);

          try {
            const toolResultBody: Record<string, unknown> = {
              conversationId: this.conversationId!,
              toolCallId: toolCall.toolCallId,
              result: errorResult,
              isError: true,
            };
            const clientToolsSchemas = this.clientToolsToSchemas();
            if (clientToolsSchemas.length > 0) {
              toolResultBody.clientTools = clientToolsSchemas;
            }
            response = await this.callChatApi(toolResultBody, 'chat/tool-result');
          } catch {
            // If sending the error result also fails, break to avoid infinite loop
            this.emit('error', { code: 'tool_error', message: errorMsg });
            break;
          }
        }
      }

      if (result.type === 'error') {
        break;
      }
    }
  }

  private async callChatApi(body: unknown, endpoint: string): Promise<Response> {
    const response = await fetch(
      `${this.config.agentServiceUrl}/api/v1/${endpoint}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: this.abortController?.signal,
      },
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: `HTTP ${response.status}` }));
      throw new Error(error.error ?? error.message ?? `HTTP ${response.status}`);
    }

    return response;
  }

  /**
   * Process an SSE stream from the chat API.
   * Returns when the stream ends (either message_end or tool_call).
   */
  private async processSseStream(
    response: Response,
  ): Promise<{ type: 'message_end' | 'tool_call' | 'error'; data?: unknown }> {
    let assistantContent = '';
    let lastToolCall: SseToolCall | null = null;
    let emittedThinkingFalse = false;

    for await (const event of parseSseStream(response, this.abortController?.signal)) {
      switch (event.type) {
        case 'message_start': {
          const data = event.data as SseMessageStart;
          this.conversationId = data.conversationId;
          break;
        }

        case 'content_delta': {
          const data = event.data as SseContentDelta;
          if (!emittedThinkingFalse) {
            this.emit('thinking', false);
            emittedThinkingFalse = true;
          }
          assistantContent += data.text;
          this.emit('content_delta', data);
          break;
        }

        case 'tool_call': {
          const data = event.data as SseToolCall;
          if (!emittedThinkingFalse) {
            this.emit('thinking', false);
            emittedThinkingFalse = true;
          }
          lastToolCall = data;

          // Add tool call indicator to messages with status tracking
          const toolCallMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'tool_call',
            content: `Calling ${data.toolName}...`,
            toolName: data.toolName,
            toolCallId: data.toolCallId,
            timestamp: new Date(),
            toolCallStatus: 'calling',
            toolCallStartTime: Date.now(),
          };
          this.messages.push(toolCallMsg);
          this.emit('tool_call', data);
          break;
        }

        case 'message_end': {
          const data = event.data as SseMessageEnd;

          if (assistantContent) {
            const assistantMsg: ChatMessage = {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: assistantContent,
              timestamp: new Date(),
            };
            this.messages.push(assistantMsg);
            this.emit('message', assistantMsg);
          }

          this.emit('message_end', data);
          return { type: 'message_end', data };
        }

        case 'error': {
          const data = event.data as SseError;
          this.emit('error', data);
          return { type: 'error', data };
        }
      }
    }

    // Stream ended — check if there was a pending tool call
    if (lastToolCall) {
      if (assistantContent) {
        const assistantMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: assistantContent,
          timestamp: new Date(),
        };
        this.messages.push(assistantMsg);
        this.emit('message', assistantMsg);
      }

      return { type: 'tool_call', data: lastToolCall };
    }

    // Stream ended without explicit message_end
    if (assistantContent) {
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: assistantContent,
        timestamp: new Date(),
      };
      this.messages.push(assistantMsg);
      this.emit('message', assistantMsg);
    }

    return { type: 'message_end' };
  }

  /**
   * Resolve the auth token for an MCP server.
   * Priority: in-memory cache > localStorage > refresh token > getToken callback > onAuthRequired callback
   */
  private async resolveToken(mcpServerUrl: string): Promise<string | undefined> {
    // 1. Check in-memory cache first (fastest)
    const cached = this.tokenCache.get(mcpServerUrl);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.accessToken;
    }

    // 2. Check localStorage (survives page refresh)
    const stored = this.loadTokenFromStorage(mcpServerUrl);
    if (stored) {
      // If access token is still valid, use it
      if (stored.expiresAt > Date.now()) {
        // Restore to in-memory cache for faster subsequent access
        this.tokenCache.set(mcpServerUrl, stored);
        return stored.accessToken;
      }

      // Access token expired but we have a refresh token - try to refresh
      if (stored.refreshToken) {
        // Restore to cache first so refreshAccessToken can find the refresh token
        this.tokenCache.set(mcpServerUrl, stored);
        const refreshedToken = await this.refreshAccessToken(mcpServerUrl);
        if (refreshedToken) {
          return refreshedToken;
        }
      }
    }

    // 3. Try refresh if we have a cached refresh token (might be from memory)
    if (cached?.refreshToken) {
      const refreshedToken = await this.refreshAccessToken(mcpServerUrl);
      if (refreshedToken) {
        return refreshedToken;
      }
    }

    // 4. Embedded mode: host app provides token via getToken
    if (this.config.getToken) {
      const tokenResponse = await this.config.getToken(mcpServerUrl);
      if (tokenResponse) {
        const normalized =
          typeof tokenResponse === 'string'
            ? { accessToken: tokenResponse, expiresIn: 3600 }
            : tokenResponse;
        return this.cacheTokenResponse(mcpServerUrl, normalized);
      }
    }

    // 5. Standalone mode: trigger auth flow via onAuthRequired
    if (this.config.onAuthRequired) {
      const authConfig = this.getServerAuthConfig(mcpServerUrl);
      if (authConfig) {
        const tokenResponse = await this.config.onAuthRequired(mcpServerUrl, authConfig);
        if (tokenResponse) {
          return this.cacheTokenResponse(mcpServerUrl, tokenResponse);
        }
      }
    }

    return undefined;
  }

  /** Build headers for MCP server requests */
  private getMcpHeaders(mcpServerUrl: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    };
    const session = this.mcpSessions.get(mcpServerUrl);
    if (session?.sessionId) {
      headers['Mcp-Session-Id'] = session.sessionId;
    }
    return headers;
  }

  /** Initialize the MCP session for a specific server (required before tools/call) */
  private async initMcpSession(mcpServerUrl: string): Promise<void> {
    const session = this.mcpSessions.get(mcpServerUrl);
    if (session?.sessionId) return;

    const headers = this.getMcpHeaders(mcpServerUrl);
    const token = await this.resolveToken(mcpServerUrl);
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const initResponse = await fetch(mcpServerUrl, {
      method: 'POST',
      headers,
      credentials: this.config.useCookies ? 'include' : 'omit',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'emcy-agent-sdk', version: '0.1.0' },
        },
      }),
    });

    if (initResponse.status === 401) {
      // First, try to refresh the token if we have a refresh token
      const refreshedToken = await this.refreshAccessToken(mcpServerUrl);
      if (refreshedToken) {
        headers['Authorization'] = `Bearer ${refreshedToken}`;
        const retryWithRefresh = await fetch(mcpServerUrl, {
          method: 'POST',
          headers,
          credentials: this.config.useCookies ? 'include' : 'omit',
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2025-03-26',
              capabilities: {},
              clientInfo: { name: 'emcy-agent-sdk', version: '0.1.0' },
            },
          }),
        });
        if (retryWithRefresh.ok) {
          const sessionId = retryWithRefresh.headers.get('mcp-session-id');
          this.mcpSessions.set(mcpServerUrl, { sessionId, authStatus: 'connected' });
          this.updateMcpAuthStatus(mcpServerUrl, 'connected');
          await retryWithRefresh.text().catch(() => {});
          const notifyHeaders = this.getMcpHeaders(mcpServerUrl);
          notifyHeaders['Authorization'] = `Bearer ${refreshedToken}`;
          await fetch(mcpServerUrl, {
            method: 'POST',
            headers: notifyHeaders,
            credentials: this.config.useCookies ? 'include' : 'omit',
            body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
          });
          return;
        }
      }

      // Refresh failed or no refresh token - clear and try full auth flow
      this.updateMcpAuthStatus(mcpServerUrl, 'needs_auth');
      this.clearToken(mcpServerUrl);
      const freshToken = await this.resolveToken(mcpServerUrl);
      if (freshToken) {
        headers['Authorization'] = `Bearer ${freshToken}`;
        const retryResponse = await fetch(mcpServerUrl, {
          method: 'POST',
          headers,
          credentials: this.config.useCookies ? 'include' : 'omit',
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2025-03-26',
              capabilities: {},
              clientInfo: { name: 'emcy-agent-sdk', version: '0.1.0' },
            },
          }),
        });
        if (!retryResponse.ok) {
          const errorText = await retryResponse.text().catch(() => 'MCP init error');
          throw new Error(`MCP initialization failed (${retryResponse.status}): ${errorText}`);
        }
        const sessionId = retryResponse.headers.get('mcp-session-id');
        this.mcpSessions.set(mcpServerUrl, { sessionId, authStatus: 'connected' });
        this.updateMcpAuthStatus(mcpServerUrl, 'connected');
        await retryResponse.text().catch(() => {});
        const notifyHeaders = this.getMcpHeaders(mcpServerUrl);
        notifyHeaders['Authorization'] = `Bearer ${freshToken}`;
        await fetch(mcpServerUrl, {
          method: 'POST',
          headers: notifyHeaders,
          credentials: this.config.useCookies ? 'include' : 'omit',
          body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        });
        return;
      }
      const errorText = await initResponse.text().catch(() => 'Authentication required');
      throw new Error(`MCP initialization failed (401): ${errorText}`);
    }

    if (!initResponse.ok) {
      const errorText = await initResponse.text().catch(() => 'MCP init error');
      throw new Error(`MCP initialization failed (${initResponse.status}): ${errorText}`);
    }

    const sessionId = initResponse.headers.get('mcp-session-id');
    this.mcpSessions.set(mcpServerUrl, { sessionId, authStatus: 'connected' });
    await initResponse.text().catch(() => {});

    const notifyHeaders = this.getMcpHeaders(mcpServerUrl);
    if (token) notifyHeaders['Authorization'] = `Bearer ${token}`;
    await fetch(mcpServerUrl, {
      method: 'POST',
      headers: notifyHeaders,
      credentials: this.config.useCookies ? 'include' : 'omit',
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
  }

  /** Update auth status for an MCP server and emit event */
  private updateMcpAuthStatus(mcpServerUrl: string, authStatus: 'connected' | 'needs_auth'): void {
    const session = this.mcpSessions.get(mcpServerUrl);
    if (session) {
      session.authStatus = authStatus;
    } else {
      this.mcpSessions.set(mcpServerUrl, { sessionId: null, authStatus });
    }

    // Find the server name from config
    const serverInfo = this.agentConfig?.mcpServers?.find(s => s.url === mcpServerUrl);
    this.emit('mcp_auth_status', {
      mcpServerUrl,
      mcpServerName: serverInfo?.name ?? mcpServerUrl,
      authStatus,
    });
  }

  /** Parse a JSON-RPC response from either JSON or SSE format */
  private async parseMcpResponse(response: Response): Promise<Record<string, unknown>> {
    const contentType = (response.headers.get('content-type') || '').toLowerCase();

    if (contentType.includes('text/event-stream')) {
      const text = await response.text();
      const lines = text.split('\n');
      let jsonData = '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          jsonData += line.slice(6);
        }
      }
      if (!jsonData) {
        throw new Error('No data received from MCP server SSE response');
      }
      return JSON.parse(jsonData);
    }

    return response.json();
  }

  private async executeTool(toolCall: SseToolCall): Promise<unknown> {
    // Client tools: execute locally (source === 'client' or empty/missing mcpServerUrl)
    const isClientTool =
      toolCall.source === 'client' || !toolCall.mcpServerUrl;

    if (isClientTool && this.config.clientTools) {
      const def = this.config.clientTools[toolCall.toolName];
      if (def) {
        const result = await def.execute(toolCall.arguments ?? {});
        return result;
      }
      throw new Error(`Unknown client tool: ${toolCall.toolName}`);
    }

    const mcpServerUrl = toolCall.mcpServerUrl || this.agentConfig?.mcpServerUrl;
    if (!mcpServerUrl) {
      throw new Error('No MCP server URL for tool call');
    }

    await this.initMcpSession(mcpServerUrl);

    const token = await this.resolveToken(mcpServerUrl);
    const headers = this.getMcpHeaders(mcpServerUrl);
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const toolCallBody = JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: toolCall.toolName, arguments: toolCall.arguments },
    });

    let response = await fetch(mcpServerUrl, {
      method: 'POST',
      headers,
      credentials: this.config.useCookies ? 'include' : 'omit',
      body: toolCallBody,
      signal: this.abortController?.signal,
    });

    // Session expired (404) → reinitialize and retry
    const session = this.mcpSessions.get(mcpServerUrl);
    if (response.status === 404 && session?.sessionId) {
      this.mcpSessions.set(mcpServerUrl, { ...session, sessionId: null });
      await this.initMcpSession(mcpServerUrl);
      const retryHeaders = this.getMcpHeaders(mcpServerUrl);
      if (token) retryHeaders['Authorization'] = `Bearer ${token}`;
      response = await fetch(mcpServerUrl, {
        method: 'POST',
        headers: retryHeaders,
        credentials: this.config.useCookies ? 'include' : 'omit',
        body: toolCallBody,
        signal: this.abortController?.signal,
      });
    }

    // 401 → try refresh token first, then full auth flow
    if (response.status === 401) {
      // First, try to refresh the token
      const refreshedToken = await this.refreshAccessToken(mcpServerUrl);
      if (refreshedToken) {
        const refreshHeaders = this.getMcpHeaders(mcpServerUrl);
        refreshHeaders['Authorization'] = `Bearer ${refreshedToken}`;
        response = await fetch(mcpServerUrl, {
          method: 'POST',
          headers: refreshHeaders,
          credentials: this.config.useCookies ? 'include' : 'omit',
          body: toolCallBody,
          signal: this.abortController?.signal,
        });
        if (response.ok) {
          this.updateMcpAuthStatus(mcpServerUrl, 'connected');
        }
      }

      // If refresh didn't work, clear and try full auth flow
      if (!response.ok) {
        this.updateMcpAuthStatus(mcpServerUrl, 'needs_auth');
        this.clearToken(mcpServerUrl);
        const freshToken = await this.resolveToken(mcpServerUrl);
        if (freshToken) {
          const authHeaders = this.getMcpHeaders(mcpServerUrl);
          authHeaders['Authorization'] = `Bearer ${freshToken}`;
          response = await fetch(mcpServerUrl, {
            method: 'POST',
            headers: authHeaders,
            credentials: this.config.useCookies ? 'include' : 'omit',
            body: toolCallBody,
            signal: this.abortController?.signal,
          });
          if (response.ok) {
            this.updateMcpAuthStatus(mcpServerUrl, 'connected');
          }
        }
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Authentication required');
        throw new Error(`Tool execution failed (401): ${errorText}`);
      }
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'MCP server error');
      throw new Error(`Tool execution failed (${response.status}): ${errorText}`);
    }

    const currentSession = this.mcpSessions.get(mcpServerUrl);
    if (currentSession?.authStatus === 'needs_auth') {
      this.updateMcpAuthStatus(mcpServerUrl, 'connected');
    }

    const result = await this.parseMcpResponse(response) as {
      result?: { content?: Array<{ type: string; text: string }> };
      error?: { code: number; message: string };
    };

    if (result.error) {
      throw new Error(`MCP error (${result.error.code}): ${result.error.message}`);
    }

    if (result.result?.content) {
      const textContent = result.result.content
        .filter((c: { type: string }) => c.type === 'text')
        .map((c: { text: string }) => c.text)
        .join('\n');
      return textContent || result.result;
    }

    return result.result ?? result;
  }
}
