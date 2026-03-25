import { parseSseStream } from './sse-client';
import type {
  AgentConfigResponse,
  AuthorizationServerMetadata,
  ChatMessage,
  ClientToolParameter,
  EmcyAgentEvent,
  EmcyAgentEventMap,
  EmcyAgentConfig,
  SseContentDelta,
  McpServerAuthConfig,
  OAuthTokenResponse,
  ProtectedResourceMetadata,
  SseError,
  SseMessageEnd,
  SseMessageStart,
  SseToolCall,
} from './types';
import {
  applyResolvedRegistration,
  buildRegistrationCacheKey,
  buildTokenCacheKey,
  getEffectiveCallbackUrl,
  loadStoredRegistration,
  resolveOAuthRegistration,
} from './auth/registration';

type EventHandler<T> = (data: T) => void;

const DEFAULT_MCP_PROTOCOL_VERSION = '2025-11-25';
const DEFAULT_OAUTH_CALLBACK_URL = 'https://emcy.ai/oauth/callback';
const DEFAULT_OAUTH_CLIENT_METADATA_URL = 'https://emcy.ai/.well-known/oauth-client-metadata.json';

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
      oauthCallbackUrl: config.oauthCallbackUrl ?? DEFAULT_OAUTH_CALLBACK_URL,
      oauthClientMetadataUrl:
        config.oauthClientMetadataUrl ?? DEFAULT_OAUTH_CLIENT_METADATA_URL,
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

    if (this.agentConfig?.mcpServers?.length) {
      await Promise.all(
        this.agentConfig.mcpServers.map(async (server) => {
          server.authConfig = await this.resolveServerAuthConfig(server.url, server.authConfig ?? null);
        }),
      );
    }

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
      if (tokenResponse.resolvedAuthConfig) {
        this.updateServerAuthConfig(mcpServerUrl, tokenResponse.resolvedAuthConfig);
      }
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

  private getOAuthCallbackUrl(): string {
    return this.config.oauthCallbackUrl ?? DEFAULT_OAUTH_CALLBACK_URL;
  }

  private async resolveOAuthClientRegistration(
    authConfig: McpServerAuthConfig | null | undefined,
  ): Promise<McpServerAuthConfig | null> {
    if (!authConfig || authConfig.authType !== 'oauth2') {
      return authConfig ?? null;
    }

    const registration = await resolveOAuthRegistration(authConfig, {
      callbackUrl: this.getOAuthCallbackUrl(),
      oauthClientMetadataUrl: this.config.oauthClientMetadataUrl,
      clientName: 'Emcy MCP Client',
      clientUri: 'https://emcy.ai',
    });

    return applyResolvedRegistration(authConfig, registration);
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

  private buildProtectedResourceMetadataCandidates(mcpServerUrl: string): string[] {
    const url = new URL(mcpServerUrl);
    const candidates = new Set<string>();
    const normalizedPath = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;

    if (!normalizedPath || normalizedPath === '/') {
      candidates.add(`${url.origin}/.well-known/oauth-protected-resource`);
      return [...candidates];
    }

    candidates.add(`${url.origin}/.well-known/oauth-protected-resource${normalizedPath}`);
    candidates.add(`${url.origin}${normalizedPath}/.well-known/oauth-protected-resource`);
    candidates.add(`${url.origin}/.well-known/oauth-protected-resource`);
    return [...candidates];
  }

  private extractQuotedHeaderValue(header: string, key: string): string | null {
    const match = header.match(new RegExp(`${key}="([^"]+)"`, 'i'));
    return match?.[1] ?? null;
  }

  private getAuthorizationServerMetadataUrl(issuerOrMetadataUrl: string): string {
    if (issuerOrMetadataUrl.includes('/.well-known/oauth-authorization-server')) {
      return issuerOrMetadataUrl;
    }
    const url = new URL(issuerOrMetadataUrl);
    const normalizedPath = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
    if (!normalizedPath || normalizedPath === '/') {
      return `${url.origin}/.well-known/oauth-authorization-server`;
    }
    return `${url.origin}/.well-known/oauth-authorization-server${normalizedPath}`;
  }

  private hasExplicitManualOverride(
    manualConfig: McpServerAuthConfig | null | undefined,
    field: string,
  ): boolean {
    return manualConfig?.manualOverrides?.includes(field) ?? false;
  }

  private pickAuthConfigValue<T>(
    field: string,
    manualConfig: McpServerAuthConfig | null | undefined,
    manualValue: T | undefined,
    discoveredValue: T | undefined,
  ): T | undefined {
    if (this.hasExplicitManualOverride(manualConfig, field) && manualValue != null) {
      return manualValue;
    }

    return discoveredValue ?? manualValue;
  }

  private pickAuthConfigArrayValue<T>(
    field: string,
    manualConfig: McpServerAuthConfig | null | undefined,
    manualValue: T[] | undefined,
    discoveredValue: T[] | undefined,
  ): T[] | undefined {
    if (this.hasExplicitManualOverride(manualConfig, field) && manualValue?.length) {
      return manualValue;
    }

    if (discoveredValue?.length) {
      return discoveredValue;
    }

    return manualValue?.length ? manualValue : undefined;
  }

  private mergeAuthConfigs(
    manualConfig: McpServerAuthConfig | null | undefined,
    discoveredConfig: McpServerAuthConfig | null | undefined,
  ): McpServerAuthConfig | null {
    if (!manualConfig && !discoveredConfig) return null;

    const manualOverrides = new Set<string>(manualConfig?.manualOverrides ?? []);
    const authorizationEndpoint = this.pickAuthConfigValue(
      'authorizationEndpoint',
      manualConfig,
      manualConfig?.authorizationEndpoint ?? manualConfig?.loginUrl,
      discoveredConfig?.authorizationEndpoint ?? discoveredConfig?.loginUrl,
    );
    const tokenEndpoint = this.pickAuthConfigValue(
      'tokenEndpoint',
      manualConfig,
      manualConfig?.tokenEndpoint ?? manualConfig?.tokenUrl,
      discoveredConfig?.tokenEndpoint ?? discoveredConfig?.tokenUrl,
    );
    const callbackUrl = this.pickAuthConfigValue(
      'callbackUrl',
      manualConfig,
      manualConfig?.callbackUrl,
      discoveredConfig?.callbackUrl,
    ) ?? this.getOAuthCallbackUrl();

    const merged: McpServerAuthConfig = {
      authType: manualConfig?.authType ?? discoveredConfig?.authType ?? 'oauth2',
      issuer: discoveredConfig?.issuer ?? manualConfig?.issuer,
      authorizationServerUrl: this.pickAuthConfigValue(
        'authorizationServerUrl',
        manualConfig,
        manualConfig?.authorizationServerUrl,
        discoveredConfig?.authorizationServerUrl,
      ),
      authorizationServerMetadataUrl:
        this.pickAuthConfigValue(
          'authorizationServerMetadataUrl',
          manualConfig,
          manualConfig?.authorizationServerMetadataUrl,
          discoveredConfig?.authorizationServerMetadataUrl,
        ),
      authorizationEndpoint,
      loginUrl: authorizationEndpoint,
      tokenEndpoint,
      tokenUrl: tokenEndpoint,
      registrationEndpoint: this.pickAuthConfigValue(
        'registrationEndpoint',
        manualConfig,
        manualConfig?.registrationEndpoint,
        discoveredConfig?.registrationEndpoint,
      ),
      clientId: this.pickAuthConfigValue(
        'clientId',
        manualConfig,
        manualConfig?.clientId,
        discoveredConfig?.clientId,
      ),
      scopes: this.pickAuthConfigArrayValue(
        'scopes',
        manualConfig,
        manualConfig?.scopes,
        discoveredConfig?.scopes,
      ),
      resource: this.pickAuthConfigValue(
        'resource',
        manualConfig,
        manualConfig?.resource,
        discoveredConfig?.resource,
      ),
      callbackUrl,
      protectedResourceMetadataUrl:
        discoveredConfig?.protectedResourceMetadataUrl ?? manualConfig?.protectedResourceMetadataUrl,
      clientIdMetadataDocumentSupported:
        discoveredConfig?.clientIdMetadataDocumentSupported
        ?? manualConfig?.clientIdMetadataDocumentSupported,
      resourceParameterSupported:
        discoveredConfig?.resourceParameterSupported
        ?? manualConfig?.resourceParameterSupported,
      registrationPreference:
        manualConfig?.registrationPreference
        ?? discoveredConfig?.registrationPreference
        ?? 'auto',
      clientMode: discoveredConfig?.clientMode ?? manualConfig?.clientMode,
      authRecipe: manualConfig?.authRecipe ?? discoveredConfig?.authRecipe,
      manualOverrides: manualOverrides.size ? [...manualOverrides] : undefined,
      discovered: discoveredConfig?.discovered ?? false,
    };

    return merged;
  }

  private async discoverAuthConfig(
    mcpServerUrl: string,
    manualConfig: McpServerAuthConfig | null | undefined,
  ): Promise<McpServerAuthConfig | null> {
    let protectedResourceUrl: string | null = null;
    let protectedResource: ProtectedResourceMetadata | null = null;
    const protectedResourceCandidates = new Set<string>();

    if (manualConfig?.protectedResourceMetadataUrl) {
      protectedResourceCandidates.add(manualConfig.protectedResourceMetadataUrl);
    }

    for (const candidate of this.buildProtectedResourceMetadataCandidates(mcpServerUrl)) {
      protectedResourceCandidates.add(candidate);
    }

    for (const candidate of protectedResourceCandidates) {
      try {
        const response = await fetch(candidate, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });

        if (response.ok) {
          protectedResource = await response.json();
          protectedResourceUrl = candidate;
          break;
        }

        const authenticateHeader = response.headers.get('www-authenticate');
        if (authenticateHeader) {
          const resourceMetadataUrl = this.extractQuotedHeaderValue(authenticateHeader, 'resource_metadata');
          if (resourceMetadataUrl) {
            const metadataResponse = await fetch(resourceMetadataUrl, {
              method: 'GET',
              headers: { Accept: 'application/json' },
            });
            if (metadataResponse.ok) {
              protectedResource = await metadataResponse.json();
              protectedResourceUrl = resourceMetadataUrl;
              break;
            }
          }
        }
      } catch {
        // Try the next candidate.
      }
    }

    const authServerUrl =
      protectedResource?.authorization_servers?.[0] ??
      protectedResource?.authorization_server ??
      manualConfig?.authorizationServerUrl;

    const metadataUrl =
      manualConfig?.authorizationServerMetadataUrl
      ?? (authServerUrl ? this.getAuthorizationServerMetadataUrl(authServerUrl) : null);

    try {
      let metadata: AuthorizationServerMetadata | null = null;
      if (metadataUrl) {
        const response = await fetch(metadataUrl, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });
        if (response.ok) {
          metadata = (await response.json()) as AuthorizationServerMetadata;
        }
      }

      if (!metadata && !protectedResource && !manualConfig) {
        return null;
      }
      return {
        authType: 'oauth2',
        issuer: metadata?.issuer ?? authServerUrl ?? manualConfig?.issuer,
        authorizationServerUrl: authServerUrl ?? manualConfig?.authorizationServerUrl,
        authorizationServerMetadataUrl: metadataUrl ?? undefined,
        authorizationEndpoint:
          metadata?.authorization_endpoint
          ?? manualConfig?.authorizationEndpoint
          ?? manualConfig?.loginUrl,
        loginUrl:
          metadata?.authorization_endpoint
          ?? manualConfig?.loginUrl
          ?? manualConfig?.authorizationEndpoint,
        tokenEndpoint:
          metadata?.token_endpoint
          ?? manualConfig?.tokenEndpoint
          ?? manualConfig?.tokenUrl,
        tokenUrl:
          metadata?.token_endpoint
          ?? manualConfig?.tokenUrl
          ?? manualConfig?.tokenEndpoint,
        registrationEndpoint:
          metadata?.registration_endpoint ?? manualConfig?.registrationEndpoint,
        clientId: manualConfig?.clientId,
        scopes: protectedResource?.scopes_supported?.length
          ? protectedResource.scopes_supported
          : metadata?.scopes_supported ?? manualConfig?.scopes,
        resource: protectedResource?.resource ?? manualConfig?.resource,
        callbackUrl: getEffectiveCallbackUrl(manualConfig, this.getOAuthCallbackUrl()),
        protectedResourceMetadataUrl:
          protectedResourceUrl ?? manualConfig?.protectedResourceMetadataUrl,
        clientIdMetadataDocumentSupported:
          metadata?.client_id_metadata_document_supported
          ?? manualConfig?.clientIdMetadataDocumentSupported,
        resourceParameterSupported:
          metadata?.resource_parameter_supported
          ?? manualConfig?.resourceParameterSupported,
        registrationPreference: manualConfig?.registrationPreference ?? 'auto',
        authRecipe: manualConfig?.authRecipe,
        discovered: Boolean(protectedResource || metadata),
      };
    } catch {
      return manualConfig
        ? {
            ...manualConfig,
            callbackUrl: getEffectiveCallbackUrl(manualConfig, this.getOAuthCallbackUrl()),
            protectedResourceMetadataUrl:
              protectedResourceUrl ?? manualConfig.protectedResourceMetadataUrl,
            resource: protectedResource?.resource ?? manualConfig.resource,
            scopes: protectedResource?.scopes_supported?.length
              ? protectedResource.scopes_supported
              : manualConfig.scopes,
            discovered: Boolean(protectedResource),
          }
        : null;
    }
  }

  private async resolveServerAuthConfig(
    mcpServerUrl: string,
    manualConfig: McpServerAuthConfig | null | undefined,
  ): Promise<McpServerAuthConfig | null> {
    const discoveredConfig = await this.discoverAuthConfig(mcpServerUrl, manualConfig);
    return this.mergeAuthConfigs(manualConfig, discoveredConfig);
  }

  private async ensureServerAuthConfig(mcpServerUrl: string): Promise<McpServerAuthConfig | null> {
    const server = this.agentConfig?.mcpServers?.find((item) => item.url === mcpServerUrl);
    if (!server) {
      return null;
    }

    if (
      server.authConfig
      && (
        server.authConfig.authType !== 'oauth2'
        || server.authConfig.discovered
        || !!server.authConfig.authorizationEndpoint
        || !!server.authConfig.tokenEndpoint
        || !!server.authConfig.tokenUrl
        || !!server.authConfig.registrationEndpoint
        || !!server.authConfig.resource
      )
    ) {
      return server.authConfig;
    }

    server.authConfig = await this.resolveServerAuthConfig(mcpServerUrl, server.authConfig ?? null);
    return server.authConfig;
  }

  private updateServerAuthConfig(mcpServerUrl: string, authConfig: McpServerAuthConfig): void {
    const server = this.agentConfig?.mcpServers?.find((item) => item.url === mcpServerUrl);
    if (server) {
      server.authConfig = authConfig;
    }
  }

  private emit<K extends EmcyAgentEvent>(event: K, data: EmcyAgentEventMap[K]): void {
    this.listeners.get(event)?.forEach((handler) => handler(data));
  }

  // ================================================================
  // OAuth Token Storage (standalone mode only)
  // ================================================================

  /** Generate the legacy token cache suffix used before auth-aware keying. */
  private hashUrl(url: string): string {
    return btoa(url).replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
  }

  private getLegacyTokenStorageKey(mcpServerUrl: string): string {
    return `${EmcyAgent.STORAGE_PREFIX}${this.hashUrl(mcpServerUrl)}`;
  }

  private getTokenStorageKey(
    mcpServerUrl: string,
    authConfig: McpServerAuthConfig | null | undefined,
  ): string {
    return `${EmcyAgent.STORAGE_PREFIX}${buildTokenCacheKey(authConfig, mcpServerUrl)}`;
  }

  private getTokenStorageCandidates(
    mcpServerUrl: string,
  ): Array<{ storageKey: string; authConfig: McpServerAuthConfig | null }> {
    const currentAuthConfig = this.getServerAuthConfig(mcpServerUrl);
    if (!currentAuthConfig) {
      return [{
        storageKey: this.getLegacyTokenStorageKey(mcpServerUrl),
        authConfig: null,
      }];
    }

    const callbackUrl = getEffectiveCallbackUrl(currentAuthConfig, this.getOAuthCallbackUrl());
    const candidates: McpServerAuthConfig[] = [currentAuthConfig];

    if (currentAuthConfig.authType === 'oauth2') {
      candidates.push({
        ...currentAuthConfig,
        clientMode: 'manual',
        callbackUrl,
      });

      if (currentAuthConfig.clientId) {
        candidates.push({
          ...currentAuthConfig,
          clientMode: 'preregistered',
          callbackUrl,
        });
      }

      if (
        currentAuthConfig.clientIdMetadataDocumentSupported
        && this.config.oauthClientMetadataUrl
      ) {
        candidates.push({
          ...currentAuthConfig,
          clientId: this.config.oauthClientMetadataUrl,
          clientMode: 'cimd',
          callbackUrl,
        });
      }

      if (currentAuthConfig.registrationEndpoint) {
        const cacheKey = buildRegistrationCacheKey(currentAuthConfig, callbackUrl, 'dcr');
        const storedRegistration = loadStoredRegistration(cacheKey);
        if (storedRegistration?.clientId) {
          candidates.push(applyResolvedRegistration(currentAuthConfig, {
            cacheKey,
            mode: 'dcr',
            clientId: storedRegistration.clientId,
            callbackUrl,
            resource: currentAuthConfig.resource,
            authorizationServerUrl: currentAuthConfig.authorizationServerUrl,
            authorizationServerMetadataUrl: currentAuthConfig.authorizationServerMetadataUrl,
            registrationEndpoint: currentAuthConfig.registrationEndpoint,
          }));
        }
      }
    }

    const seen = new Set<string>();
    const resolved = candidates.map((candidate) => ({
      storageKey: this.getTokenStorageKey(mcpServerUrl, candidate),
      authConfig: candidate,
    })).filter((candidate) => {
      if (seen.has(candidate.storageKey)) return false;
      seen.add(candidate.storageKey);
      return true;
    });

    resolved.push({
      storageKey: this.getLegacyTokenStorageKey(mcpServerUrl),
      authConfig: currentAuthConfig,
    });

    return resolved;
  }

  /** Load OAuth token from memory/localStorage using auth-aware cache keying. */
  private loadOAuthToken(mcpServerUrl: string): {
    accessToken: string;
    refreshToken?: string;
    expiresAt: number;
  } | null {
    for (const candidate of this.getTokenStorageCandidates(mcpServerUrl)) {
      const cached = this.oauthTokens.get(candidate.storageKey);
      if (cached) {
        if (candidate.authConfig) {
          this.updateServerAuthConfig(mcpServerUrl, candidate.authConfig);
        }
        return cached;
      }
    }

    try {
      if (typeof localStorage !== 'undefined') {
        for (const candidate of this.getTokenStorageCandidates(mcpServerUrl)) {
          const stored = localStorage.getItem(candidate.storageKey);
          if (stored) {
            const data = JSON.parse(stored);
            if (data.accessToken && data.expiresAt) {
              this.oauthTokens.set(candidate.storageKey, data);
              if (candidate.authConfig) {
                this.updateServerAuthConfig(mcpServerUrl, candidate.authConfig);
              }
              return data;
            }
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
    const resolvedAuthConfig =
      tokenResponse.resolvedAuthConfig ?? this.getServerAuthConfig(mcpServerUrl);
    const storageKey = this.getTokenStorageKey(mcpServerUrl, resolvedAuthConfig);
    const expiresIn = tokenResponse.expiresIn ?? 3600;
    const expiresAt = Date.now() + (expiresIn * 1000) - (60 * 1000); // 1 min buffer
    const data = {
      accessToken: tokenResponse.accessToken,
      refreshToken: tokenResponse.refreshToken,
      expiresAt,
    };
    this.oauthTokens.set(storageKey, data);

    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(storageKey, JSON.stringify(data));
      }
    } catch { /* ignore */ }
  }

  /** Clear OAuth token from memory and localStorage */
  private clearOAuthToken(mcpServerUrl: string): void {
    for (const candidate of this.getTokenStorageCandidates(mcpServerUrl)) {
      this.oauthTokens.delete(candidate.storageKey);
    }

    try {
      if (typeof localStorage !== 'undefined') {
        for (const candidate of this.getTokenStorageCandidates(mcpServerUrl)) {
          localStorage.removeItem(candidate.storageKey);
        }
      }
    } catch { /* ignore */ }
  }

  /** Refresh OAuth token using refresh token */
  private async refreshOAuthToken(mcpServerUrl: string, refreshToken: string): Promise<string | undefined> {
    const authConfig = await this.ensureServerAuthConfig(mcpServerUrl);
    const tokenUrl = authConfig?.tokenEndpoint ?? authConfig?.tokenUrl;
    if (!tokenUrl) return undefined;

    try {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      });
      if (authConfig?.clientId) body.set('client_id', authConfig.clientId);
      if (authConfig?.resource) body.set('resource', authConfig.resource);

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
            resolvedAuthConfig: authConfig ?? undefined,
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

    const authConfig = await this.ensureServerAuthConfig(mcpServerUrl);

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
      if (authConfig) {
        const resolvedAuthConfig =
          authConfig.authType === 'oauth2'
            ? await this.resolveOAuthClientRegistration(authConfig)
            : authConfig;
        if (resolvedAuthConfig) {
          this.updateServerAuthConfig(mcpServerUrl, resolvedAuthConfig);
        }
        const tokenResponse = await this.config.onAuthRequired(
          mcpServerUrl,
          resolvedAuthConfig ?? authConfig,
        );
        if (tokenResponse?.accessToken) {
          if (tokenResponse.resolvedAuthConfig) {
            this.updateServerAuthConfig(mcpServerUrl, tokenResponse.resolvedAuthConfig);
          }
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
    await this.ensureServerAuthConfig(mcpServerUrl);
    const token = await this.resolveToken(mcpServerUrl);
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const initPayload = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: DEFAULT_MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'emcy-agent-sdk', version: '0.1.0' },
      },
    });

    const initResponse = await fetch(mcpServerUrl, {
      method: 'POST',
      headers,
      credentials: this.config.useCookies ? 'include' : 'omit',
      body: initPayload,
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
          body: initPayload,
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
