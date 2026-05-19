import { parseSseStream } from './sse-client';
import type {
  AgentConfigResponse,
  AudioInputState,
  AudioTurnDetectionConfig,
  AuthorizationServerMetadata,
  ChatMessage,
  ConversationFeedback,
  ConversationMessagesPage,
  ClientToolsMap,
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
  SubmitConversationFeedbackRequest,
} from './types';
import {
  applyResolvedRegistration,
  buildRegistrationCacheKey,
  buildTokenCacheKey,
  getEffectiveCallbackUrl,
  loadStoredRegistration,
  resolveOAuthRegistration,
} from './auth/registration';
import {
  buildScopedOAuthTokenStorageKey,
  resolveExplicitAuthSessionKey,
} from './auth-storage';

type EventHandler<T> = (data: T) => void;
type BuiltInPopupAuthHandler = {
  __emcyBuiltinPopupAuth?: boolean;
};

type RealtimeTranscriptionSessionResponse = {
  sessionId: string;
  conversationId: string;
  webSocketUrl: string;
  expiresInSeconds: number;
  maxSessionSeconds: number;
};

type ResolvedAudioTurnDetectionConfig = Required<AudioTurnDetectionConfig>;

type AudioFrameActivity = {
  rms: number;
  peak: number;
  inputLevel: number;
  durationMs: number;
};

type AudioTurnState = {
  startedAtMs: number;
  lastFrameAtMs: number;
  speechStartedAtMs: number | null;
  lastSpeechAtMs: number | null;
  speechMs: number;
  silenceMs: number;
  noiseFloor: number;
  isSpeaking: boolean;
  autoCommitted: boolean;
  lastActivityEmitMs: number;
};

const DEFAULT_MCP_PROTOCOL_VERSION = '2025-11-25';
const DEFAULT_LOCAL_PUBLIC_APP_PORT = '3100';
const DEFAULT_OAUTH_CALLBACK_URL = 'https://emcy.ai/oauth/callback';
const DEFAULT_OAUTH_CLIENT_METADATA_URL = 'https://emcy.ai/.well-known/oauth-client-metadata.json';
const DEFAULT_AUDIO_TURN_DETECTION: ResolvedAudioTurnDetectionConfig = {
  enabled: true,
  autoSubmit: true,
  silenceDurationMs: 850,
  minSpeechDurationMs: 180,
  noSpeechTimeoutMs: 12000,
  speechThreshold: 0.012,
  noiseMultiplier: 2.4,
};
const AUDIO_ACTIVITY_EMIT_INTERVAL_MS = 120;
const MIN_AUDIO_LEVEL_DELTA_FOR_STATE = 0.03;

function isLocalhostHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function getDefaultOAuthHelperOrigin(agentServiceUrl?: string): string {
  if (!agentServiceUrl) {
    return DEFAULT_OAUTH_CALLBACK_URL.replace(/\/oauth\/callback$/, '');
  }

  try {
    const url = new URL(agentServiceUrl);
    if (isLocalhostHost(url.hostname)) {
      return `${url.protocol}//${url.hostname}:${DEFAULT_LOCAL_PUBLIC_APP_PORT}`;
    }
  } catch {
    // Fall back to the hosted public app origin.
  }

  return DEFAULT_OAUTH_CALLBACK_URL.replace(/\/oauth\/callback$/, '');
}

function getDefaultOAuthCallbackUrl(agentServiceUrl?: string): string {
  return `${getDefaultOAuthHelperOrigin(agentServiceUrl)}/oauth/callback`;
}

function getDefaultOAuthClientMetadataUrl(agentServiceUrl?: string): string {
  return `${getDefaultOAuthHelperOrigin(agentServiceUrl)}/.well-known/oauth-client-metadata.json`;
}

function extractErrorMessage(payload: unknown): string | null {
  if (typeof payload === 'string') {
    const message = payload.trim();
    return message || null;
  }

  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as Record<string, unknown>;
  for (const key of ['error', 'message', 'detail']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

async function getResponseErrorMessage(response: Response): Promise<string> {
  const fallback = `HTTP ${response.status}`;

  try {
    const payload = await response.clone().json();
    const message = extractErrorMessage(payload);
    if (message) {
      return message;
    }
  } catch {
    // Fall through to plain text below.
  }

  const text = await response.text().catch(() => '');
  return text.trim() || fallback;
}

function parameterToJsonSchema(parameter: ClientToolParameter): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    type: parameter.type,
  };

  if (parameter.description) {
    schema.description = parameter.description;
  }

  if (parameter.enum) {
    schema.enum = parameter.enum;
  }

  if (parameter.type === 'array') {
    schema.items = parameter.items
      ? parameterToJsonSchema(parameter.items)
      : { type: 'string' };
  }

  if (parameter.type === 'object' && parameter.properties) {
    const properties: Record<string, object> = {};
    const required: string[] = [];

    for (const [key, child] of Object.entries(parameter.properties)) {
      properties[key] = parameterToJsonSchema(child);
      if (child.required) required.push(key);
    }

    schema.properties = properties;
    schema.required = required;
  }

  if (parameter.additionalProperties !== undefined) {
    schema.additionalProperties =
      typeof parameter.additionalProperties === 'boolean'
        ? parameter.additionalProperties
        : parameterToJsonSchema(parameter.additionalProperties);
  }

  return schema;
}

/** Convert client tool parameters to JSON Schema for the API */
function parametersToJsonSchema(params: Record<string, ClientToolParameter>): object {
  const properties: Record<string, object> = {};
  const required: string[] = [];
  for (const [key, p] of Object.entries(params)) {
    properties[key] = parameterToJsonSchema(p);
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
  private historyCursor: string | null = null;
  private hasOlderMessages = false;
  private isLoadingHistory = false;
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
  /** Servers explicitly disconnected by the user and awaiting manual re-auth */
  private manuallySignedOutServers: Set<string> = new Set();
  private audioState: AudioInputState = {
    status: 'idle',
    isSupported: false,
    isEnabled: false,
    transcript: '',
    partialTranscript: '',
    error: null,
  };
  private audioStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private audioSource: MediaStreamAudioSourceNode | null = null;
  private audioProcessor: ScriptProcessorNode | null = null;
  private audioSilentGain: GainNode | null = null;
  private audioSocket: WebSocket | null = null;
  private audioSessionTimer: ReturnType<typeof setTimeout> | null = null;
  private audioSessionStopRequested = false;
  private audioFinalTranscript = '';
  private audioTurnState: AudioTurnState | null = null;

  constructor(config: EmcyAgentConfig) {
    this.config = {
      ...config,
      agentServiceUrl: config.agentServiceUrl ?? 'https://api.emcy.ai',
      oauthCallbackUrl: config.oauthCallbackUrl ?? getDefaultOAuthCallbackUrl(config.agentServiceUrl),
      oauthClientMetadataUrl:
        config.oauthClientMetadataUrl ?? getDefaultOAuthClientMetadataUrl(config.agentServiceUrl),
    };
    this.audioState = this.buildAudioState({ status: 'idle' });
  }

  private async resolveAuthToken(): Promise<string> {
    if (this.config.getAuthToken) {
      const token = await this.config.getAuthToken();
      if (token) return token;
    }
    return this.config.apiKey;
  }

  /** Initialize: fetch agent config (tools, widget settings, MCP servers) */
  async init(): Promise<AgentConfigResponse> {
    const token = await this.resolveAuthToken();
    const response = await fetch(
      `${this.config.agentServiceUrl}/api/v1/agents/${this.config.agentId}/config`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(await getResponseErrorMessage(response));
    }

    this.agentConfig = await response.json();
    this.audioState = this.buildAudioState({ status: 'idle' });
    this.emit('audio_state', this.audioState);

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

          if (server.authConfig?.authType === 'oauth2') {
            authStatus = server.authStatus === 'connected' || this.hasValidOAuthToken(server.url)
              ? 'connected'
              : 'needs_auth';
          } else {
            authStatus = server.authStatus || 'connected';
          }

          this.mcpSessions.set(server.url, { sessionId: null, authStatus });
        }
      }
    }

    if (this.config.initialConversationId) {
      await this.loadConversation(this.config.initialConversationId);
    }

    return this.agentConfig!;
  }

  /** Get current MCP server auth statuses */
  getMcpServers(): Array<{
    url: string;
    name: string;
    authStatus: 'connected' | 'needs_auth';
    canSignOut: boolean;
  }> {
    if (!this.agentConfig?.mcpServers) return [];
    return this.agentConfig.mcpServers.map(server => ({
      url: server.url,
      name: server.name,
      authStatus: this.mcpSessions.get(server.url)?.authStatus ?? server.authStatus ?? 'connected',
      canSignOut: (server.authConfig?.authType ?? 'none') !== 'none',
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
    this.historyCursor = null;
    this.hasOlderMessages = false;
    this.isLoadingHistory = false;
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

  getHasOlderMessages(): boolean {
    return this.hasOlderMessages;
  }

  getIsLoadingHistory(): boolean {
    return this.isLoadingHistory;
  }

  /** Get the loaded agent config */
  getAgentConfig(): AgentConfigResponse | null {
    return this.agentConfig;
  }

  getAudioInputState(): AudioInputState {
    return { ...this.audioState };
  }

  async startVoiceInput(): Promise<void> {
    if (!this.agentConfig) {
      await this.init();
    }

    if (!this.isAudioInputSupported()) {
      this.setAudioState({
        status: 'error',
        error: {
          code: 'unsupported_browser',
          message: 'Microphone input is not supported in this browser.',
        },
      });
      return;
    }

    if (!this.isAudioInputEnabled()) {
      this.setAudioState({
        status: 'error',
        error: {
          code: 'audio_not_enabled',
          message: 'Microphone input is not enabled for this agent.',
        },
      });
      return;
    }

    if (
      this.audioState.status === 'requesting_permission'
      || this.audioState.status === 'connecting'
      || this.audioState.status === 'listening'
      || this.audioState.status === 'transcribing'
    ) {
      return;
    }

    this.audioSessionStopRequested = false;
    this.audioFinalTranscript = '';
    this.audioTurnState = null;
    this.setAudioState({
      status: 'requesting_permission',
      transcript: '',
      partialTranscript: '',
      error: null,
      sessionId: null,
      conversationId: this.conversationId,
      inputLevel: 0,
      isSpeaking: false,
      speechMs: 0,
      silenceMs: 0,
      autoSubmitEnabled: this.getAudioTurnDetectionConfig().enabled
        && this.getAudioTurnDetectionConfig().autoSubmit,
    });

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (error) {
      this.setAudioState({
        status: 'error',
        error: {
          code: 'microphone_permission_denied',
          message: error instanceof Error ? error.message : 'Microphone permission was denied.',
        },
      });
      return;
    }

    try {
      this.audioStream = stream;
      this.setAudioState({ status: 'connecting' });

      const session = await this.createRealtimeTranscriptionSession();
      this.conversationId = session.conversationId;
      this.setAudioState({
        sessionId: session.sessionId,
        conversationId: session.conversationId,
        maxSessionSeconds: session.maxSessionSeconds,
      });

      const socket = await this.openAudioSocket(session.webSocketUrl);
      this.audioSocket = socket;
      this.bindAudioSocket(socket);
      await this.startAudioCapture(stream, socket);

      const maxSessionMs = Math.max(1, session.maxSessionSeconds) * 1000;
      this.audioSessionTimer = setTimeout(() => {
        void this.commitVoiceInput();
      }, maxSessionMs);

      this.setAudioState({ status: 'listening' });
    } catch (error) {
      this.cleanupAudioCapture();
      this.setAudioState({
        status: 'error',
        error: {
          code: this.extractErrorCode(error) ?? 'audio_start_failed',
          message: error instanceof Error ? error.message : 'Could not start microphone input.',
        },
      });
    }
  }

  async stopVoiceInput(): Promise<void> {
    await this.commitVoiceInput();
  }

  cancelVoiceInput(): void {
    this.audioSessionStopRequested = true;
    this.cleanupAudioCapture();
    this.audioTurnState = null;
    this.setAudioState({
      status: 'idle',
      transcript: '',
      partialTranscript: '',
      error: null,
      sessionId: null,
      inputLevel: 0,
      isSpeaking: false,
      speechMs: 0,
      silenceMs: 0,
    });
  }

  async loadConversation(
    conversationId: string,
    pageSize = this.config.conversationHistoryPageSize ?? 50,
  ): Promise<ConversationMessagesPage> {
    this.isLoadingHistory = true;
    try {
      const page = await this.fetchConversationMessages(conversationId, undefined, pageSize);
      this.applyConversationPage(page, false);
      return page;
    } finally {
      this.isLoadingHistory = false;
    }
  }

  async loadOlderMessages(
    pageSize = this.config.conversationHistoryPageSize ?? 50,
  ): Promise<ConversationMessagesPage | null> {
    if (!this.conversationId || !this.historyCursor || !this.hasOlderMessages) {
      return null;
    }

    this.isLoadingHistory = true;
    try {
      const page = await this.fetchConversationMessages(this.conversationId, this.historyCursor, pageSize);
      this.applyConversationPage(page, true);
      return page;
    } finally {
      this.isLoadingHistory = false;
    }
  }

  async submitFeedback(input: SubmitConversationFeedbackRequest): Promise<ConversationFeedback> {
    if (!this.conversationId) {
      throw new Error('No active conversation to rate.');
    }

    const token = await this.resolveAuthToken();
    const response = await fetch(
      `${this.config.agentServiceUrl}/api/v1/chat/conversations/${encodeURIComponent(this.conversationId)}/feedback`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(input),
      },
    );

    if (!response.ok) {
      throw new Error(await getResponseErrorMessage(response));
    }

    return (await response.json()) as ConversationFeedback;
  }

  /** Convert client tools to the API schema format. */
  private clientToolsToSchemas(): Array<{ name: string; description: string; inputSchema: object; selection?: unknown }> {
    if (!this.config.clientTools) return [];
    return Object.entries(this.config.clientTools).map(([name, def]) => ({
      name,
      description: def.description,
      inputSchema: parametersToJsonSchema(def.parameters) as object,
      selection: def.selection,
    }));
  }

  private buildExternalUserContext(): Record<string, unknown> | undefined {
    const hostIdentity = this.config.embeddedAuth?.hostIdentity;
    const id =
      this.config.externalUserId ??
      hostIdentity?.subject ??
      hostIdentity?.email;

    const externalUser: Record<string, unknown> = {};

    if (id) externalUser.id = id;
    if (hostIdentity?.email) externalUser.email = hostIdentity.email;
    if (hostIdentity?.displayName) externalUser.displayName = hostIdentity.displayName;
    if (hostIdentity?.avatarUrl) externalUser.avatarUrl = hostIdentity.avatarUrl;
    if (hostIdentity?.organizationId) externalUser.organizationId = hostIdentity.organizationId;

    return Object.keys(externalUser).length > 0 ? externalUser : undefined;
  }

  /** Whether a request is currently in flight */
  getIsLoading(): boolean {
    return this.isLoading;
  }

  /** Update the per-turn app context sent with each chat request. */
  setAppContext(context: Record<string, unknown> | undefined): void {
    this.config = {
      ...this.config,
      context,
    };
  }

  /** Update the client tools exposed to the agent without recreating the session. */
  setClientTools(clientTools: ClientToolsMap | undefined): void {
    this.config = {
      ...this.config,
      clientTools,
    };
  }

  /**
   * Proactively authenticate with an MCP server before sending a message.
   * If a token response is provided directly, it is stored immediately.
   * Otherwise, this uses the configured OAuth flow and verifies via MCP init.
   *
   * @param mcpServerUrl - The MCP server URL to authenticate with
   * @param tokenResponse - Optional: provide token response directly (from OAuth popup)
   */
  async authenticate(
    mcpServerUrl: string,
    tokenResponse?: OAuthTokenResponse
  ): Promise<boolean> {
    const wasManuallySignedOut = this.manuallySignedOutServers.delete(mcpServerUrl);
    try {
      if (tokenResponse?.accessToken) {
        if (tokenResponse.resolvedAuthConfig) {
          this.updateServerAuthConfig(mcpServerUrl, tokenResponse.resolvedAuthConfig);
        }
        this.storeOAuthToken(mcpServerUrl, tokenResponse);
        this.updateMcpAuthStatus(mcpServerUrl, 'connected');
        return true;
      }

      const token = await this.resolveToken(mcpServerUrl);
      if (!token) {
        if (wasManuallySignedOut) {
          this.manuallySignedOutServers.add(mcpServerUrl);
        }
        return false;
      }

      // Reflect OAuth success in the UI immediately; MCP session init can follow asynchronously.
      this.updateMcpAuthStatus(mcpServerUrl, 'connected');

      try {
        await this.initMcpSession(mcpServerUrl);
        return true;
      } catch {
        // Keep the connected badge when we already have a valid OAuth token.
        return true;
      }
    } catch {
      if (wasManuallySignedOut) {
        this.manuallySignedOutServers.add(mcpServerUrl);
      }
      this.updateMcpAuthStatus(mcpServerUrl, 'needs_auth');
      return false;
    }
  }

  /** Disconnect from an MCP server and require explicit re-authentication before reuse. */
  async signOutMcpServer(mcpServerUrl: string): Promise<void> {
    this.manuallySignedOutServers.add(mcpServerUrl);
    await this.closeMcpSession(mcpServerUrl);
    this.clearOAuthToken(mcpServerUrl);
    this.updateMcpAuthStatus(mcpServerUrl, 'needs_auth');
  }

  /** Get the auth config for an MCP server (from agent config) */
  getServerAuthConfig(mcpServerUrl: string): McpServerAuthConfig | null {
    const server = this.agentConfig?.mcpServers?.find(s => s.url === mcpServerUrl);
    return server?.authConfig ?? null;
  }

  getOAuthCallbackUrl(): string {
    return this.config.oauthCallbackUrl ?? DEFAULT_OAUTH_CALLBACK_URL;
  }

  getOAuthClientMetadataUrl(): string {
    return this.config.oauthClientMetadataUrl ?? DEFAULT_OAUTH_CLIENT_METADATA_URL;
  }

  setOnAuthRequired(
    onAuthRequired: EmcyAgentConfig['onAuthRequired'],
  ): void {
    this.config = {
      ...this.config,
      onAuthRequired,
    };
  }

  private isAudioInputSupported(): boolean {
    const audioContextCtor = this.getAudioContextConstructor();
    return (
      typeof navigator !== 'undefined'
      && Boolean(navigator.mediaDevices?.getUserMedia)
      && typeof WebSocket !== 'undefined'
      && Boolean(audioContextCtor)
      && typeof crypto !== 'undefined'
    );
  }

  private isAudioInputEnabled(): boolean {
    const capabilities = this.agentConfig?.modelConfig?.capabilities;
    return Boolean(
      this.agentConfig?.audio?.inputEnabled
      && (capabilities?.audioInput ?? capabilities?.realtimeAudioInput),
    );
  }

  private isAudioAutoSubmitEnabled(): boolean {
    const turnDetection = this.getAudioTurnDetectionConfig();
    return turnDetection.enabled && turnDetection.autoSubmit;
  }

  private getAudioTurnDetectionConfig(): ResolvedAudioTurnDetectionConfig {
    const override = this.config.audioInput?.turnDetection ?? {};
    return {
      enabled: override.enabled ?? DEFAULT_AUDIO_TURN_DETECTION.enabled,
      autoSubmit: override.autoSubmit ?? DEFAULT_AUDIO_TURN_DETECTION.autoSubmit,
      silenceDurationMs: this.clampNumber(
        override.silenceDurationMs,
        250,
        3000,
        DEFAULT_AUDIO_TURN_DETECTION.silenceDurationMs,
      ),
      minSpeechDurationMs: this.clampNumber(
        override.minSpeechDurationMs,
        80,
        1000,
        DEFAULT_AUDIO_TURN_DETECTION.minSpeechDurationMs,
      ),
      noSpeechTimeoutMs: this.clampNumber(
        override.noSpeechTimeoutMs,
        0,
        60000,
        DEFAULT_AUDIO_TURN_DETECTION.noSpeechTimeoutMs,
      ),
      speechThreshold: this.clampNumber(
        override.speechThreshold,
        0.002,
        0.2,
        DEFAULT_AUDIO_TURN_DETECTION.speechThreshold,
      ),
      noiseMultiplier: this.clampNumber(
        override.noiseMultiplier,
        1.2,
        8,
        DEFAULT_AUDIO_TURN_DETECTION.noiseMultiplier,
      ),
    };
  }

  private clampNumber(
    value: number | undefined,
    min: number,
    max: number,
    fallback: number,
  ): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, value));
  }

  private buildAudioState(patch: Partial<AudioInputState>): AudioInputState {
    const hasPatch = (key: keyof AudioInputState) => Object.prototype.hasOwnProperty.call(patch, key);
    return {
      status: patch.status ?? this.audioState.status,
      isSupported: this.isAudioInputSupported(),
      isEnabled: this.isAudioInputEnabled(),
      transcript: patch.transcript ?? this.audioState.transcript,
      partialTranscript: patch.partialTranscript ?? this.audioState.partialTranscript,
      error: hasPatch('error') ? patch.error ?? null : this.audioState.error,
      sessionId: hasPatch('sessionId') ? patch.sessionId ?? null : this.audioState.sessionId ?? null,
      conversationId: hasPatch('conversationId')
        ? patch.conversationId ?? null
        : this.audioState.conversationId ?? this.conversationId,
      maxSessionSeconds:
        hasPatch('maxSessionSeconds')
          ? patch.maxSessionSeconds ?? null
          : this.audioState.maxSessionSeconds
            ?? this.agentConfig?.audio?.maxSessionSeconds
            ?? null,
      inputLevel: hasPatch('inputLevel') ? patch.inputLevel ?? 0 : this.audioState.inputLevel ?? 0,
      isSpeaking: hasPatch('isSpeaking') ? patch.isSpeaking ?? false : this.audioState.isSpeaking ?? false,
      speechMs: hasPatch('speechMs') ? patch.speechMs ?? 0 : this.audioState.speechMs ?? 0,
      silenceMs: hasPatch('silenceMs') ? patch.silenceMs ?? 0 : this.audioState.silenceMs ?? 0,
      autoSubmitEnabled: hasPatch('autoSubmitEnabled')
        ? patch.autoSubmitEnabled ?? false
        : this.audioState.autoSubmitEnabled ?? this.isAudioAutoSubmitEnabled(),
    };
  }

  private setAudioState(patch: Partial<AudioInputState>): void {
    this.audioState = this.buildAudioState(patch);
    this.emit('audio_state', this.audioState);
  }

  private getAudioContextConstructor(): typeof AudioContext | null {
    if (typeof window === 'undefined') {
      return null;
    }

    return window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      ?? null;
  }

  private async createRealtimeTranscriptionSession(): Promise<RealtimeTranscriptionSessionResponse> {
    const token = await this.resolveAuthToken();
    const externalUser = this.buildExternalUserContext();
    const response = await fetch(
      `${this.config.agentServiceUrl}/api/v1/agents/${encodeURIComponent(this.config.agentId)}/realtime/transcription-sessions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          conversationId: this.conversationId,
          externalUserId: this.config.externalUserId,
          externalUser,
        }),
      },
    );

    if (!response.ok) {
      throw await this.buildApiError(response);
    }

    return (await response.json()) as RealtimeTranscriptionSessionResponse;
  }

  private async buildApiError(response: Response): Promise<Error> {
    let code: string | null = null;
    let message: string | null = null;

    try {
      const payload = await response.clone().json();
      if (payload && typeof payload === 'object') {
        const record = payload as Record<string, unknown>;
        code = typeof record.code === 'string' ? record.code : null;
        message = extractErrorMessage(payload);
      }
    } catch {
      // Fall back below.
    }

    const error = new Error(message ?? await getResponseErrorMessage(response));
    if (code) {
      (error as Error & { code?: string }).code = code;
    }
    return error;
  }

  private async openAudioSocket(url: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.normalizeAudioSocketUrl(url));
      const cleanup = () => {
        socket.removeEventListener('open', handleOpen);
        socket.removeEventListener('error', handleError);
      };
      const handleOpen = () => {
        cleanup();
        resolve(socket);
      };
      const handleError = () => {
        cleanup();
        reject(new Error('Could not connect to the realtime microphone service.'));
      };

      socket.addEventListener('open', handleOpen);
      socket.addEventListener('error', handleError);
    });
  }

  private normalizeAudioSocketUrl(url: string): string {
    if (typeof window === 'undefined') {
      return url;
    }

    try {
      const parsed = new URL(url, window.location.href);
      if (window.location.protocol === 'https:' && parsed.protocol === 'ws:') {
        parsed.protocol = 'wss:';
      }

      return parsed.toString();
    } catch {
      return url;
    }
  }

  private bindAudioSocket(socket: WebSocket): void {
    socket.addEventListener('message', (event) => {
      void this.handleAudioSocketMessage(event);
    });

    socket.addEventListener('close', () => {
      if (this.audioSocket !== socket) {
        return;
      }

      this.audioSocket = null;
      this.clearAudioSessionTimer();
      if (
        this.audioState.status === 'listening'
        || this.audioState.status === 'transcribing'
        || this.audioState.status === 'connecting'
      ) {
        this.cleanupAudioCapture(false);
        this.audioTurnState = null;
        this.setAudioState({
          status: 'idle',
          inputLevel: 0,
          isSpeaking: false,
          speechMs: 0,
          silenceMs: 0,
        });
      }
    });

    socket.addEventListener('error', () => {
      if (this.audioSocket !== socket) {
        return;
      }

      this.cleanupAudioCapture();
      this.audioTurnState = null;
      this.setAudioState({
        status: 'error',
        error: {
          code: 'audio_socket_error',
          message: 'The realtime microphone connection failed.',
        },
        inputLevel: 0,
        isSpeaking: false,
        speechMs: 0,
        silenceMs: 0,
      });
    });
  }

  private async handleAudioSocketMessage(event: MessageEvent): Promise<void> {
    const raw = typeof event.data === 'string'
      ? event.data
      : event.data instanceof Blob
        ? await event.data.text()
        : '';
    if (!raw) {
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    const type = typeof payload.type === 'string' ? payload.type : '';
    if (type === 'transcript_delta') {
      const text = typeof payload.text === 'string' ? payload.text : '';
      if (!text) {
        return;
      }

      this.audioFinalTranscript += text;
      this.setAudioState({
        partialTranscript: this.audioFinalTranscript,
        transcript: this.audioFinalTranscript,
      });
      this.emit('audio_transcript_delta', {
        text,
        transcript: this.audioFinalTranscript,
        isFinal: false,
      });
      return;
    }

    if (type === 'transcript_final') {
      const finalText = (
        typeof payload.text === 'string' && payload.text.trim()
          ? payload.text
          : this.audioFinalTranscript
      ).trim();

      this.cleanupAudioCapture();
      this.audioTurnState = null;
      if (!finalText) {
        this.setAudioState({
          status: 'idle',
          transcript: '',
          partialTranscript: '',
          inputLevel: 0,
          isSpeaking: false,
          speechMs: 0,
          silenceMs: 0,
        });
        return;
      }

      this.setAudioState({
        status: 'sending',
        transcript: finalText,
        partialTranscript: '',
        error: null,
        inputLevel: 0,
        isSpeaking: false,
      });
      this.emit('audio_transcript_final', {
        text: finalText,
        transcript: finalText,
        conversationId: this.conversationId ?? '',
      });
      await this.sendMessage(finalText);
      this.setAudioState({
        status: 'idle',
        transcript: finalText,
        partialTranscript: '',
        sessionId: null,
        inputLevel: 0,
        isSpeaking: false,
        speechMs: 0,
        silenceMs: 0,
      });
      return;
    }

    if (type === 'error') {
      const code = typeof payload.code === 'string' ? payload.code : 'audio_error';
      const message = typeof payload.message === 'string' ? payload.message : 'Microphone input failed.';
      this.cleanupAudioCapture();
      this.audioTurnState = null;
      this.setAudioState({
        status: 'error',
        error: { code, message },
        inputLevel: 0,
        isSpeaking: false,
        speechMs: 0,
        silenceMs: 0,
      });
    }
  }

  private async commitVoiceInput(): Promise<void> {
    if (
      this.audioSessionStopRequested
      || (
        this.audioState.status !== 'listening'
        && this.audioState.status !== 'connecting'
      )
    ) {
      return;
    }

    this.audioSessionStopRequested = true;
    this.cleanupAudioCapture(false);

    if (this.audioSocket?.readyState === WebSocket.OPEN) {
      this.audioSocket.send(JSON.stringify({ type: 'audio.commit' }));
      this.setAudioState({
        status: 'transcribing',
        inputLevel: 0,
        isSpeaking: false,
        silenceMs: this.audioTurnState?.silenceMs ?? this.audioState.silenceMs ?? 0,
        speechMs: this.audioTurnState?.speechMs ?? this.audioState.speechMs ?? 0,
      });
      return;
    }

    this.audioTurnState = null;
    this.setAudioState({
      status: 'idle',
      inputLevel: 0,
      isSpeaking: false,
      speechMs: 0,
      silenceMs: 0,
    });
  }

  private stopVoiceInputWithoutTranscript(message: string): void {
    this.audioSessionStopRequested = true;
    this.cleanupAudioCapture();
    this.audioTurnState = null;
    this.setAudioState({
      status: 'idle',
      transcript: '',
      partialTranscript: '',
      sessionId: null,
      inputLevel: 0,
      isSpeaking: false,
      speechMs: 0,
      silenceMs: 0,
      error: {
        code: 'no_speech_detected',
        message,
      },
    });
  }

  private createAudioTurnState(nowMs: number): AudioTurnState {
    return {
      startedAtMs: nowMs,
      lastFrameAtMs: nowMs,
      speechStartedAtMs: null,
      lastSpeechAtMs: null,
      speechMs: 0,
      silenceMs: 0,
      noiseFloor: DEFAULT_AUDIO_TURN_DETECTION.speechThreshold / 2,
      isSpeaking: false,
      autoCommitted: false,
      lastActivityEmitMs: 0,
    };
  }

  private analyzeAudioFrame(input: Float32Array, durationMs: number): AudioFrameActivity {
    if (input.length === 0) {
      return { rms: 0, peak: 0, inputLevel: 0, durationMs };
    }

    let sumSquares = 0;
    let peak = 0;
    for (let index = 0; index < input.length; index += 1) {
      const sample = input[index];
      const abs = Math.abs(sample);
      sumSquares += sample * sample;
      if (abs > peak) {
        peak = abs;
      }
    }

    const rms = Math.sqrt(sumSquares / input.length);
    return {
      rms,
      peak,
      inputLevel: Math.min(1, rms * 14),
      durationMs,
    };
  }

  private processAudioTurnActivity(activity: AudioFrameActivity, nowMs: number): void {
    const config = this.getAudioTurnDetectionConfig();
    if (!config.enabled) {
      this.emitAudioActivity(activity, nowMs, false, 0, 0, DEFAULT_AUDIO_TURN_DETECTION.speechThreshold / 2);
      return;
    }

    const state = this.audioTurnState ?? this.createAudioTurnState(nowMs);
    this.audioTurnState = state;

    const frameGapMs = Math.max(1, nowMs - state.lastFrameAtMs);
    const frameDurationMs = Math.max(activity.durationMs, frameGapMs);
    state.lastFrameAtMs = nowMs;

    const adaptiveThreshold = Math.max(
      config.speechThreshold,
      Math.min(0.08, state.noiseFloor * config.noiseMultiplier),
    );
    const peakThreshold = Math.max(adaptiveThreshold * 2.2, config.speechThreshold * 2.5);
    const speechCandidate = activity.rms >= adaptiveThreshold
      || (activity.rms >= adaptiveThreshold * 0.72 && activity.peak >= peakThreshold);

    if (speechCandidate) {
      if (state.speechStartedAtMs === null) {
        state.speechStartedAtMs = nowMs;
        state.speechMs = 0;
      }
      state.lastSpeechAtMs = nowMs;
      state.speechMs += frameDurationMs;
      state.silenceMs = 0;
      state.isSpeaking = true;
    } else {
      state.noiseFloor = this.updateNoiseFloor(state.noiseFloor, activity.rms);
      state.isSpeaking = false;
      if (state.lastSpeechAtMs !== null) {
        state.silenceMs = nowMs - state.lastSpeechAtMs;
      }
    }

    if (
      state.speechStartedAtMs !== null
      && state.speechMs < config.minSpeechDurationMs
      && state.silenceMs >= config.silenceDurationMs
    ) {
      state.speechStartedAtMs = null;
      state.lastSpeechAtMs = null;
      state.speechMs = 0;
      state.silenceMs = 0;
    }

    this.emitAudioActivity(
      activity,
      nowMs,
      state.isSpeaking,
      state.speechMs,
      state.silenceMs,
      state.noiseFloor,
    );

    const noSpeechElapsedMs = nowMs - state.startedAtMs;
    if (
      config.noSpeechTimeoutMs > 0
      && state.speechStartedAtMs === null
      && noSpeechElapsedMs >= config.noSpeechTimeoutMs
      && !state.autoCommitted
    ) {
      state.autoCommitted = true;
      this.stopVoiceInputWithoutTranscript('No speech was detected. Try again when you are ready to speak.');
      return;
    }

    if (
      config.autoSubmit
      && state.speechStartedAtMs !== null
      && state.speechMs >= config.minSpeechDurationMs
      && state.silenceMs >= config.silenceDurationMs
      && !state.autoCommitted
    ) {
      state.autoCommitted = true;
      void this.commitVoiceInput();
    }
  }

  private updateNoiseFloor(currentNoiseFloor: number, rms: number): number {
    const sample = Math.max(0.0015, Math.min(0.08, rms));
    const smoothing = sample > currentNoiseFloor ? 0.02 : 0.12;
    return currentNoiseFloor * (1 - smoothing) + sample * smoothing;
  }

  private emitAudioActivity(
    activity: AudioFrameActivity,
    nowMs: number,
    isSpeaking: boolean,
    speechMs: number,
    silenceMs: number,
    noiseFloor: number,
  ): void {
    const state = this.audioTurnState;
    const shouldEmitState = !state
      || nowMs - state.lastActivityEmitMs >= AUDIO_ACTIVITY_EMIT_INTERVAL_MS
      || isSpeaking !== this.audioState.isSpeaking
      || Math.abs(activity.inputLevel - (this.audioState.inputLevel ?? 0)) >= MIN_AUDIO_LEVEL_DELTA_FOR_STATE;

    if (!shouldEmitState) {
      return;
    }

    if (state) {
      state.lastActivityEmitMs = nowMs;
    }

    const roundedLevel = Number(activity.inputLevel.toFixed(3));
    const roundedNoiseFloor = Number(noiseFloor.toFixed(5));
    this.setAudioState({
      inputLevel: roundedLevel,
      isSpeaking,
      speechMs: Math.round(speechMs),
      silenceMs: Math.round(silenceMs),
      autoSubmitEnabled: this.isAudioAutoSubmitEnabled(),
    });
    this.emit('audio_activity', {
      inputLevel: roundedLevel,
      noiseFloor: roundedNoiseFloor,
      isSpeaking,
      speechMs: Math.round(speechMs),
      silenceMs: Math.round(silenceMs),
    });
  }

  private async startAudioCapture(stream: MediaStream, socket: WebSocket): Promise<void> {
    const AudioContextCtor = this.getAudioContextConstructor();
    if (!AudioContextCtor) {
      throw new Error('Audio capture is not available in this browser.');
    }

    const context = new AudioContextCtor();
    if (context.state === 'suspended') {
      await context.resume();
    }

    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const silentGain = context.createGain();
    silentGain.gain.value = 0;
    this.audioTurnState = this.createAudioTurnState(performance.now());

    processor.onaudioprocess = (event) => {
      if (
        this.audioSessionStopRequested
        || socket.readyState !== WebSocket.OPEN
        || this.audioState.status !== 'listening'
      ) {
        return;
      }

      const input = event.inputBuffer.getChannelData(0);
      const durationMs = (input.length / context.sampleRate) * 1000;
      this.processAudioTurnActivity(
        this.analyzeAudioFrame(input, durationMs),
        performance.now(),
      );

      if (this.audioSessionStopRequested) {
        return;
      }

      const resampled = this.resampleToPcm16(input, context.sampleRate, 24000);
      if (resampled.length === 0) {
        return;
      }

      socket.send(JSON.stringify({
        type: 'audio.append',
        audio: this.pcm16ToBase64(resampled),
      }));
    };

    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(context.destination);

    this.audioContext = context;
    this.audioSource = source;
    this.audioProcessor = processor;
    this.audioSilentGain = silentGain;
  }

  private resampleToPcm16(input: Float32Array, inputSampleRate: number, outputSampleRate: number): Int16Array {
    if (inputSampleRate === outputSampleRate) {
      return this.floatToPcm16(input);
    }

    const ratio = inputSampleRate / outputSampleRate;
    const outputLength = Math.floor(input.length / ratio);
    const output = new Float32Array(outputLength);

    for (let index = 0; index < outputLength; index += 1) {
      const inputIndex = index * ratio;
      const lower = Math.floor(inputIndex);
      const upper = Math.min(lower + 1, input.length - 1);
      const weight = inputIndex - lower;
      output[index] = input[lower] * (1 - weight) + input[upper] * weight;
    }

    return this.floatToPcm16(output);
  }

  private floatToPcm16(input: Float32Array): Int16Array {
    const output = new Int16Array(input.length);
    for (let index = 0; index < input.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, input[index]));
      output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return output;
  }

  private pcm16ToBase64(input: Int16Array): string {
    const bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, offset + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  }

  private cleanupAudioCapture(closeSocket = true): void {
    this.clearAudioSessionTimer();
    this.audioProcessor?.disconnect();
    this.audioSource?.disconnect();
    this.audioSilentGain?.disconnect();
    this.audioProcessor = null;
    this.audioSource = null;
    this.audioSilentGain = null;

    if (this.audioContext) {
      void this.audioContext.close().catch(() => undefined);
      this.audioContext = null;
    }

    this.audioStream?.getTracks().forEach((track) => track.stop());
    this.audioStream = null;

    if (closeSocket && this.audioSocket) {
      const socket = this.audioSocket;
      this.audioSocket = null;
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'audio.close' }));
        socket.close();
      } else if (socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    }
  }

  private clearAudioSessionTimer(): void {
    if (!this.audioSessionTimer) {
      return;
    }

    clearTimeout(this.audioSessionTimer);
    this.audioSessionTimer = null;
  }

  private extractErrorCode(error: unknown): string | null {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code?: unknown }).code;
      return typeof code === 'string' ? code : null;
    }
    return null;
  }

  private getPersistentStorage() {
    return this.config.storage ?? null;
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
      storage: this.getPersistentStorage(),
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

  private hasSameOrigin(left: string, right: string): boolean {
    try {
      const leftUrl = new URL(left);
      const rightUrl = new URL(right);
      return leftUrl.origin === rightUrl.origin;
    } catch {
      return false;
    }
  }

  private extractQuotedHeaderValue(header: string, key: string): string | null {
    const match = header.match(new RegExp(`${key}="([^"]+)"`, 'i'));
    return match?.[1] ?? null;
  }

  private buildAuthorizationServerMetadataCandidates(issuerOrMetadataUrl: string): string[] {
    const candidates = new Set<string>();

    if (
      issuerOrMetadataUrl.includes('/.well-known/oauth-authorization-server')
      || issuerOrMetadataUrl.includes('/.well-known/openid-configuration')
    ) {
      candidates.add(issuerOrMetadataUrl);
      return [...candidates];
    }

    const url = new URL(issuerOrMetadataUrl);
    const normalizedPath = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
    if (!normalizedPath || normalizedPath === '/') {
      candidates.add(`${url.origin}/.well-known/oauth-authorization-server`);
      candidates.add(`${url.origin}/.well-known/openid-configuration`);
      return [...candidates];
    }

    candidates.add(`${url.origin}/.well-known/oauth-authorization-server${normalizedPath}`);
    candidates.add(`${url.origin}/.well-known/openid-configuration${normalizedPath}`);
    candidates.add(`${url.origin}${normalizedPath}/.well-known/openid-configuration`);
    return [...candidates];
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
          if (resourceMetadataUrl && this.hasSameOrigin(candidate, resourceMetadataUrl)) {
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

    try {
      let metadata: AuthorizationServerMetadata | null = null;
      let metadataUrl: string | null = manualConfig?.authorizationServerMetadataUrl ?? null;

      const metadataCandidates = new Set<string>();
      if (manualConfig?.authorizationServerMetadataUrl) {
        metadataCandidates.add(manualConfig.authorizationServerMetadataUrl);
      }
      if (authServerUrl) {
        for (const candidate of this.buildAuthorizationServerMetadataCandidates(authServerUrl)) {
          metadataCandidates.add(candidate);
        }
      }

      for (const candidate of metadataCandidates) {
        try {
          const response = await fetch(candidate, {
            method: 'GET',
            headers: { Accept: 'application/json' },
          });
          if (response.ok) {
            metadata = (await response.json()) as AuthorizationServerMetadata;
            metadataUrl = candidate;
            break;
          }
        } catch {
          // Try the next metadata candidate.
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
    return buildScopedOAuthTokenStorageKey(this.hashUrl(mcpServerUrl));
  }

  private getAuthSessionKey(): string | null {
    return resolveExplicitAuthSessionKey(this.config);
  }

  private getTokenStorageKey(
    mcpServerUrl: string,
    authConfig: McpServerAuthConfig | null | undefined,
  ): string {
    return buildScopedOAuthTokenStorageKey(
      buildTokenCacheKey(authConfig, mcpServerUrl),
      this.getAuthSessionKey(),
    );
  }

  private getTokenStorageCandidates(
    mcpServerUrl: string,
  ): Array<{ storageKey: string; authConfig: McpServerAuthConfig | null }> {
    const currentAuthConfig = this.getServerAuthConfig(mcpServerUrl);
    const hasExplicitAuthSessionKey = this.getAuthSessionKey() !== null;
    if (!currentAuthConfig) {
      return hasExplicitAuthSessionKey
        ? [{
            storageKey: this.getTokenStorageKey(mcpServerUrl, null),
            authConfig: null,
          }]
        : [{
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
        const storedRegistration = loadStoredRegistration(cacheKey, this.getPersistentStorage());
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

    if (!hasExplicitAuthSessionKey) {
      resolved.push({
        storageKey: this.getLegacyTokenStorageKey(mcpServerUrl),
        authConfig: currentAuthConfig,
      });
    }

    return resolved;
  }

  /** Load OAuth token from memory/persistent storage using auth-aware cache keying. */
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
      const storage = this.getPersistentStorage() ?? (typeof localStorage !== 'undefined' ? localStorage : null);
      if (storage) {
        for (const candidate of this.getTokenStorageCandidates(mcpServerUrl)) {
          const stored = storage.getItem(candidate.storageKey);
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

  /** Store OAuth token to memory and persistent storage */
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
      const storage = this.getPersistentStorage() ?? (typeof localStorage !== 'undefined' ? localStorage : null);
      if (storage) {
        storage.setItem(storageKey, JSON.stringify(data));
      }
    } catch { /* ignore */ }
  }

  /** Clear OAuth token from memory and persistent storage */
  private clearOAuthToken(mcpServerUrl: string): void {
    for (const candidate of this.getTokenStorageCandidates(mcpServerUrl)) {
      this.oauthTokens.delete(candidate.storageKey);
    }

    try {
      const storage = this.getPersistentStorage() ?? (typeof localStorage !== 'undefined' ? localStorage : null);
      if (storage) {
        for (const candidate of this.getTokenStorageCandidates(mcpServerUrl)) {
          storage.removeItem(candidate.storageKey);
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
   * - OAuth mode: Checks stored token, refreshes if expired, triggers auth if needed
   */
  private async resolveToken(mcpServerUrl: string): Promise<string | undefined> {
    if (this.manuallySignedOutServers.has(mcpServerUrl)) {
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
        const isBuiltInPopupAuth =
          (this.config.onAuthRequired as BuiltInPopupAuthHandler).__emcyBuiltinPopupAuth === true;
        const authConfigForHandler =
          authConfig.authType === 'oauth2' && !isBuiltInPopupAuth
            ? await this.resolveOAuthClientRegistration(authConfig)
            : authConfig;
        if (authConfigForHandler) {
          this.updateServerAuthConfig(mcpServerUrl, authConfigForHandler);
        }
        const tokenResponse = await this.config.onAuthRequired(
          mcpServerUrl,
          authConfigForHandler ?? authConfig,
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
    const externalUser = this.buildExternalUserContext();
    if (externalUser) {
      chatBody.externalUser = externalUser;
    }
    const clientToolSchemas = this.clientToolsToSchemas();
    if (clientToolSchemas.length > 0) {
      chatBody.clientTools = clientToolSchemas;
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
            durationMs: duration,
            context: this.config.context,
          };
          const clientToolSchemas = this.clientToolsToSchemas();
          if (clientToolSchemas.length > 0) {
            toolResultBody.clientTools = clientToolSchemas;
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
              durationMs: duration,
              context: this.config.context,
            };
            const clientToolSchemas = this.clientToolsToSchemas();
            if (clientToolSchemas.length > 0) {
              toolResultBody.clientTools = clientToolSchemas;
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
      throw new Error(await getResponseErrorMessage(response));
    }

    return response;
  }

  private async fetchConversationMessages(
    conversationId: string,
    cursor?: string,
    pageSize = 50,
  ): Promise<ConversationMessagesPage> {
    const token = await this.resolveAuthToken();
    const params = new URLSearchParams();
    params.set('pageSize', String(pageSize));
    if (cursor) {
      params.set('cursor', cursor);
    }

    const response = await fetch(
      `${this.config.agentServiceUrl}/api/v1/chat/conversations/${encodeURIComponent(conversationId)}/messages?${params.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(await getResponseErrorMessage(response));
    }

    return (await response.json()) as ConversationMessagesPage;
  }

  private applyConversationPage(
    page: ConversationMessagesPage,
    prepend: boolean,
  ): void {
    const mappedMessages = page.messages.map((message) => this.mapReplayMessage(message));
    this.conversationId = page.conversationId;
    this.historyCursor = page.nextCursor ?? null;
    this.hasOlderMessages = page.hasNextPage;
    this.messages = prepend
      ? [...mappedMessages, ...this.messages]
      : mappedMessages;
  }

  private mapReplayMessage(message: ConversationMessagesPage['messages'][number]): ChatMessage {
    const timestamp = new Date(message.createdAt);
    return {
      id: message.id,
      role: message.role,
      content: message.content ?? '',
      toolName: message.toolName ?? undefined,
      toolLabel: message.toolLabel ?? undefined,
      toolCallId: message.toolCallId ?? undefined,
      timestamp,
      toolCallStatus: message.toolCallStatus ?? undefined,
      toolCallStartTime:
        message.toolCallDurationMs != null
          ? timestamp.getTime() - message.toolCallDurationMs
          : undefined,
      toolCallDuration: message.toolCallDurationMs ?? undefined,
      toolResult: message.toolResultJson ?? undefined,
      toolError: message.toolError ?? undefined,
      errorCode: message.errorCode ?? undefined,
      metadataJson: message.metadataJson ?? null,
    };
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
          const errorMsg: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'error',
            content: data.message,
            timestamp: new Date(),
            errorCode: data.code,
          };
          this.messages.push(errorMsg);
          this.emit('message', errorMsg);
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

  /** Best-effort MCP session teardown so reconnect starts cleanly after sign-out. */
  private async closeMcpSession(mcpServerUrl: string): Promise<void> {
    const session = this.mcpSessions.get(mcpServerUrl);
    if (!session?.sessionId) return;

    const headers: Record<string, string> = {
      'Accept': 'application/json, text/event-stream',
      'Mcp-Session-Id': session.sessionId,
    };

    const storedToken = this.loadOAuthToken(mcpServerUrl);
    if (storedToken?.accessToken) {
      headers['Authorization'] = `Bearer ${storedToken.accessToken}`;
    }

    try {
      await fetch(mcpServerUrl, {
        method: 'DELETE',
        headers,
        credentials: this.config.useCookies ? 'include' : 'omit',
      });
    } catch {
      // Local state still gets reset below even if the server is unavailable.
    }

    this.mcpSessions.set(mcpServerUrl, {
      sessionId: null,
      authStatus: session.authStatus,
    });
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
      this.clearOAuthToken(mcpServerUrl);
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
    this.updateMcpAuthStatus(mcpServerUrl, 'connected');
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
      this.clearOAuthToken(mcpServerUrl);
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
