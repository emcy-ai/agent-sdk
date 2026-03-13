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
  /** OAuth tokens per MCP server URL (standalone mode only) */
  private oauthTokens: Map<string, {
    accessToken: string;
    refreshToken?: string;
    expiresAt: number;
  }> = new Map();

  /** localStorage key prefix for persisted OAuth tokens */
  private static readonly STORAGE_PREFIX = 'emcy_oauth_';

  constructor(config: EmcyAgentConfig) {
    this.config = {
      ...config,
      agentServiceUrl: config.agentServiceUrl ?? 'https://api.emcy.ai',
    };
  }

  private async resolveAuthToken(): Promise<string> {
    if (this.config.getAuthToken) {
      const token = await this.config.getAuthToken();
      if (token) return token;
    }
    return this.config.apiKey;
  }

  /** Initialize: fetch workspace config (tools, widget settings, MCP servers) */
  async init(): Promise<AgentConfigResponse> {
    const token = await this.resolveAuthToken();
    const response = await fetch(
      `${this.config.agentServiceUrl}/api/v1/workspaces/${this.config.agentId}/config`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Failed to fetch workspace config' }));
      throw new Error(error.message ?? `HTTP ${response.status}`);
    }

    this.agentConfig = await response.json();

    // Pre-initialize session tracking for each MCP server
    if (this.agentConfig?.mcpServers) {
      for (const server of this.agentConfig.mcpServers) {
        if (!this.mcpSessions.has(server.url)) {
          let authStatus: 'connected' | 'needs_auth';

          if (this.config.getToken) {
            // Embedded mode: always show "connected" - host app manages auth
            authStatus = 'connected';
          } else if (this.hasValidOAuthToken(server.url)) {
            // OAuth mode with valid stored token
            authStatus = 'connected';
          } else {
            // OAuth mode without token - use server's auth status
            authStatus = server.authStatus || 'connected';
          }

          this.mcpSessions.set(server.url, { sessionId: null, authStatus });
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
   * In standalone mode, this stores the provided token or triggers onAuthRequired.
   *
   * @param mcpServerUrl - The MCP server URL to authenticate with
   * @param tokenResponse - Optional: provide token response directly (from OAuth popup)
   */
  async authenticate(
    mcpServerUrl: string,
    tokenResponse?: OAuthTokenResponse
  ): Promise<boolean> {
    if (tokenResponse?.accessToken) {
      this.storeOAuthToken(mcpServerUrl, tokenResponse);
      this.updateMcpAuthStatus(mcpServerUrl, 'connected');
      return true;
    }

    const token = await this.resolveToken(mcpServerUrl);
    if (!token) return false;

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

  // ================================================================
  // OAuth Token Storage (standalone mode only)
  // ================================================================

  /** Generate a localStorage key for an MCP server URL */
  private hashUrl(url: string): string {
    return btoa(url).replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
  }

  /** Load OAuth token from localStorage */
  private loadOAuthToken(mcpServerUrl: string): {
    accessToken: string;
    refreshToken?: string;
    expiresAt: number;
  } | null {
    const cached = this.oauthTokens.get(mcpServerUrl);
    if (cached) return cached;

    try {
      if (typeof localStorage !== 'undefined') {
        const key = `${EmcyAgent.STORAGE_PREFIX}${this.hashUrl(mcpServerUrl)}`;
        const stored = localStorage.getItem(key);
        if (stored) {
          const data = JSON.parse(stored);
          if (data.accessToken && data.expiresAt) {
            this.oauthTokens.set(mcpServerUrl, data);
            return data;
          }
        }
      }
    } catch { /* ignore */ }

    return null;
  }

  /** Check if we have a valid (non-expired) OAuth token */
  private hasValidOAuthToken(mcpServerUrl: string): boolean {
    const token = this.loadOAuthToken(mcpServerUrl);
    if (!token) return false;
    // Valid if not expired OR we have a refresh token
    return token.expiresAt > Date.now() || !!token.refreshToken;
  }

  /** Store OAuth token to memory and localStorage */
  private storeOAuthToken(mcpServerUrl: string, tokenResponse: OAuthTokenResponse): void {
    const expiresIn = tokenResponse.expiresIn ?? 3600;
    const expiresAt = Date.now() + (expiresIn * 1000) - (60 * 1000); // 1 min buffer
    const data = {
      accessToken: tokenResponse.accessToken,
      refreshToken: tokenResponse.refreshToken,
      expiresAt,
    };
    this.oauthTokens.set(mcpServerUrl, data);

    try {
      if (typeof localStorage !== 'undefined') {
        const key = `${EmcyAgent.STORAGE_PREFIX}${this.hashUrl(mcpServerUrl)}`;
        localStorage.setItem(key, JSON.stringify(data));
      }
    } catch { /* ignore */ }
  }

  /** Clear OAuth token from memory and localStorage */
  private clearOAuthToken(mcpServerUrl: string): void {
    this.oauthTokens.delete(mcpServerUrl);

    try {
      if (typeof localStorage !== 'undefined') {
        const key = `${EmcyAgent.STORAGE_PREFIX}${this.hashUrl(mcpServerUrl)}`;
        localStorage.removeItem(key);
      }
    } catch { /* ignore */ }
  }

  /** Refresh OAuth token using refresh token */
  private async refreshOAuthToken(mcpServerUrl: string, refreshToken: string): Promise<string | undefined> {
    const authConfig = this.getServerAuthConfig(mcpServerUrl);
    const tokenUrl = authConfig?.tokenUrl;
    if (!tokenUrl) return undefined;

    try {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      });
      if (authConfig?.clientId) body.set('client_id', authConfig.clientId);

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });

      if (response.ok) {
        const data = await response.json();
        if (data.access_token) {
          const tokenResponse: OAuthTokenResponse = {
            accessToken: data.access_token,
            refreshToken: data.refresh_token ?? refreshToken,
            expiresIn: data.expires_in,
          };
          this.storeOAuthToken(mcpServerUrl, tokenResponse);
          return data.access_token;
        }
      }
    } catch { /* ignore */ }

    return undefined;
  }

  // ================================================================
  // Token Resolution
  // ================================================================

  /**
   * Resolve the auth token for an MCP server.
   * - Embed mode (getToken): Always calls getToken - no caching
   * - OAuth mode: Checks stored token, refreshes if expired, triggers auth if needed
   */
  private async resolveToken(mcpServerUrl: string): Promise<string | undefined> {
    // Embed mode: always call getToken - host app manages the session
    if (this.config.getToken) {
      const result = await this.config.getToken(mcpServerUrl);
      if (typeof result === 'string') return result;
      if (result?.accessToken) return result.accessToken;
      return undefined;
    }

    // OAuth mode: check stored token with expiry
    const stored = this.loadOAuthToken(mcpServerUrl);
    if (stored) {
      // Token not expired - use it
      if (stored.expiresAt > Date.now()) {
        return stored.accessToken;
      }

      // Token expired - try refresh if we have refresh token
      if (stored.refreshToken) {
        const refreshed = await this.refreshOAuthToken(mcpServerUrl, stored.refreshToken);
        if (refreshed) return refreshed;
      }

      // Refresh failed or no refresh token - clear and re-auth
      this.clearOAuthToken(mcpServerUrl);
    }

    // No valid token - trigger auth flow
    if (this.config.onAuthRequired) {
      const authConfig = this.getServerAuthConfig(mcpServerUrl);
      if (authConfig) {
        const tokenResponse = await this.config.onAuthRequired(mcpServerUrl, authConfig);
        if (tokenResponse?.accessToken) {
          this.storeOAuthToken(mcpServerUrl, tokenResponse);
          return tokenResponse.accessToken;
        }
      }
    }

    return undefined;
  }

  // ================================================================
  // Chat Loop
  // ================================================================

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

          const toolCallMsg = this.messages.find(
            m => m.role === 'tool_call' && m.toolCallId === toolCall.toolCallId
          );
          if (toolCallMsg) {
            toolCallMsg.toolCallStatus = 'completed';
            toolCallMsg.toolCallDuration = duration;
            toolCallMsg.toolResult = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
          }

          this.emit('tool_result', { toolCallId: toolCall.toolCallId, result: toolResult, duration });

          const toolResultMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'tool_result',
            content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            timestamp: new Date(),
          };
          this.messages.push(toolResultMsg);

          this.emit('thinking', true);

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

          const toolCallMsg = this.messages.find(
            m => m.role === 'tool_call' && m.toolCallId === toolCall.toolCallId
          );
          if (toolCallMsg) {
            toolCallMsg.toolCallStatus = 'error';
            toolCallMsg.toolCallDuration = duration;
            toolCallMsg.toolError = errorMsg;
          }

          this.emit('tool_error', { toolCallId: toolCall.toolCallId, error: errorMsg, duration });

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
    const token = await this.resolveAuthToken();
    const response = await fetch(
      `${this.config.agentServiceUrl}/api/v1/${endpoint}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
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

          const toolCallMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'tool_call',
            content: `Calling ${data.toolLabel ?? data.toolName}...`,
            toolName: data.toolName,
            toolLabel: data.toolLabel,
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

  // ================================================================
  // MCP Session Management
  // ================================================================

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
      // Clear stored OAuth token (embed mode will just call getToken again)
      if (!this.config.getToken) {
        this.clearOAuthToken(mcpServerUrl);
      }
      this.updateMcpAuthStatus(mcpServerUrl, 'needs_auth');

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
        if (retryResponse.ok) {
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
      }
      throw new Error('MCP initialization failed (401): Authentication required');
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

  // ================================================================
  // Tool Execution
  // ================================================================

  private async executeTool(toolCall: SseToolCall): Promise<unknown> {
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

    // 401 → clear token and try fresh auth
    if (response.status === 401) {
      if (!this.config.getToken) {
        this.clearOAuthToken(mcpServerUrl);
      }
      this.updateMcpAuthStatus(mcpServerUrl, 'needs_auth');

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
