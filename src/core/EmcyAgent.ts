import { parseSseStream } from './sse-client';
import type {
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
} from './types';

type EventHandler<T> = (data: T) => void;

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
  /** Cached tokens per MCP server URL */
  private tokenCache: Map<string, { token: string; expiresAt: number }> = new Map();

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
    if (this.agentConfig?.mcpServers) {
      for (const server of this.agentConfig.mcpServers) {
        if (!this.mcpSessions.has(server.url)) {
          this.mcpSessions.set(server.url, {
            sessionId: null,
            authStatus: server.authStatus || 'connected',
          });
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

  /** Whether a request is currently in flight */
  getIsLoading(): boolean {
    return this.isLoading;
  }

  /**
   * Proactively authenticate with an MCP server before sending a message.
   * In embedded mode (getToken provided), this calls getToken.
   * In standalone mode, this invokes onAuthRequired to trigger a login flow.
   */
  async authenticate(mcpServerUrl: string, token?: string): Promise<boolean> {
    if (token) {
      this.tokenCache.set(mcpServerUrl, {
        token,
        expiresAt: Date.now() + 55 * 60 * 1000,
      });
      this.updateMcpAuthStatus(mcpServerUrl, 'connected');
      return true;
    }
    const resolved = await this.resolveToken(mcpServerUrl);
    if (resolved) {
      this.updateMcpAuthStatus(mcpServerUrl, 'connected');
      return true;
    }
    return false;
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

    // First request: send user message
    let response = await this.callChatApi(
      {
        agentId: this.config.agentId,
        conversationId: this.conversationId,
        message,
        externalUserId: this.config.externalUserId,
        context: this.config.context,
      },
      'chat',
    );

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
          response = await this.callChatApi(
            {
              conversationId: this.conversationId!,
              toolCallId: toolCall.toolCallId,
              result: toolResult,
            },
            'chat/tool-result',
          );
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
          this.emit('error', { code: 'tool_error', message: errorMsg });
          break;
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
   * Priority: getToken callback > cached token > onAuthRequired callback
   */
  private async resolveToken(mcpServerUrl: string): Promise<string | undefined> {
    // 1. Embedded mode: host app provides token via getToken
    if (this.config.getToken) {
      const token = await this.config.getToken(mcpServerUrl);
      if (token) {
        this.tokenCache.set(mcpServerUrl, {
          token,
          expiresAt: Date.now() + 55 * 60 * 1000, // assume ~1hr tokens, refresh at 55min
        });
        return token;
      }
    }

    // 2. Check cached token
    const cached = this.tokenCache.get(mcpServerUrl);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }

    // 3. Standalone mode: trigger auth flow via onAuthRequired
    if (this.config.onAuthRequired) {
      const authConfig = this.getServerAuthConfig(mcpServerUrl);
      if (authConfig) {
        const token = await this.config.onAuthRequired(mcpServerUrl, authConfig);
        if (token) {
          this.tokenCache.set(mcpServerUrl, {
            token,
            expiresAt: Date.now() + 55 * 60 * 1000,
          });
          return token;
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
      this.updateMcpAuthStatus(mcpServerUrl, 'needs_auth');
      // Clear stale cached token and try auth flow
      this.tokenCache.delete(mcpServerUrl);
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

    // 401 → clear cache, try auth flow, retry once
    if (response.status === 401) {
      this.updateMcpAuthStatus(mcpServerUrl, 'needs_auth');
      this.tokenCache.delete(mcpServerUrl);
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
